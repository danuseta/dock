import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface GitHubRateLimitInfo {
    remaining: number;
    reset: number;
}

export class GitHubClient {
    private client: AxiosInstance;
    public rateLimit: GitHubRateLimitInfo = { remaining: -1, reset: -1 };

    constructor(pat: string) {
        this.client = axios.create({
            baseURL: 'https://api.github.com',
            headers: {
                Authorization: `Bearer ${pat}`,
                Accept: 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });

        this.client.interceptors.response.use(
            (response) => {
                this.updateRateLimit(response);
                return response;
            },
            (error) => {
                if (error.response) {
                    this.updateRateLimit(error.response);
                }
                return Promise.reject(error);
            }
        );
    }

    private updateRateLimit(response: AxiosResponse) {
        const remaining = response.headers['x-ratelimit-remaining'];
        const reset = response.headers['x-ratelimit-reset'];
        if (remaining !== undefined) this.rateLimit.remaining = parseInt(remaining, 10);
        if (reset !== undefined) this.rateLimit.reset = parseInt(reset, 10);
    }

    public async searchPRsByTicketKey(repos: string[], ticketKey: string) {
        const keyLower = ticketKey.toLowerCase();
        const resultsMap = new Map<string, any>();

        // 1. Search via GitHub Search API (catches occurrences in PR titles, bodies, and comments)
        try {
            const repoQueries = repos.map(repo => `repo:${repo}`).join(' ');
            const query = `type:pr ${repoQueries} "${ticketKey}"`;
            const response = await this.client.get('/search/issues', {
                params: { q: query, per_page: 50 }
            });
            const items = response.data?.items || [];
            for (const item of items) {
                if (item.html_url) {
                    resultsMap.set(item.html_url, item);
                }
            }
        } catch (err) {
            console.error('GitHub Search API error for PRs:', err);
        }

        // 2. Direct Repository Pulls matching (catches occurrences in branch names / head.ref, which Search API ignores!)
        await Promise.all(repos.map(async (repo) => {
            try {
                const res = await this.client.get(`/repos/${repo}/pulls`, {
                    params: { state: 'all', per_page: 50 }
                });
                const prs = res.data || [];
                for (const pr of prs) {
                    const titleMatch = pr.title?.toLowerCase().includes(keyLower);
                    const branchMatch = pr.head?.ref?.toLowerCase().includes(keyLower);
                    const bodyMatch = pr.body?.toLowerCase().includes(keyLower);
                    if (titleMatch || branchMatch || bodyMatch) {
                        if (!resultsMap.has(pr.html_url)) {
                            // Ensure repository_url is set as expected by github.service.ts
                            pr.repository_url = pr.repository_url || `https://api.github.com/repos/${repo}`;
                            resultsMap.set(pr.html_url, pr);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error fetching PRs directly from repo ${repo}:`, err);
            }
        }));

        return Array.from(resultsMap.values());
    }

    public async getPRStatus(owner: string, repo: string, pullNumber: number) {
        try {
            const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
            return response.data;
        } catch (err: any) {
            console.error(`Error fetching PR status for ${owner}/${repo} #${pullNumber}:`, err.message || err);
            return { merged: false, draft: false, mergeable: null, mergeable_state: 'unknown' };
        }
    }

    public async getPRActivity(owner: string, repo: string, pullNumber: number) {
        try {
            const [commitsRes, filesRes] = await Promise.all([
                this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits?per_page=30`),
                this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=50`)
            ]);

            const commits = (commitsRes.data || []).map((c: any) => ({
                sha: c.sha ? c.sha.substring(0, 7) : '',
                author: c.commit?.author?.name || c.author?.login || 'Unknown Author',
                message: c.commit?.message || '',
                date: c.commit?.author?.date || c.commit?.committer?.date || '',
                url: c.html_url || ''
            }));

            const files = (filesRes.data || []).map((f: any) => ({
                filename: f.filename || '',
                status: f.status || 'modified',
                additions: f.additions || 0,
                deletions: f.deletions || 0,
                changes: f.changes || 0,
                blobUrl: f.blob_url || ''
            }));

            return { commits, files };
        } catch (err: any) {
            console.error(`Error fetching PR activity for ${owner}/${repo} #${pullNumber}:`, err.message || err);
            return { commits: [], files: [] };
        }
    }

    public async checkConflicts(owner: string, repo: string, pullNumber: number) {
        const pr = await this.getPRStatus(owner, repo, pullNumber);
        
        // If mergeable is false, there might be conflicts
        const hasConflicts = pr.mergeable === false;
        
        return {
            hasConflicts,
            mergeableState: pr.mergeable_state,
            // GitHub's REST pull request API does not expose the exact files
            // causing a merge conflict. Keep this separate from changed files
            // so the UI does not present every changed file as conflicting.
            conflictingFiles: [],
            changedFiles: pr.changed_files
        };
    }

    public async validateCredentials() {
        try {
            const response = await this.client.get('/user');
            return response.data;
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                throw new Error('Invalid PAT');
            }
            throw error;
        }
    }

    public async listRepositories() {
        try {
            const allReposMap = new Map<string, any>();

            // 1. Fetch user repos (owner, collaborator, organization_member) across multiple pages
            for (let page = 1; page <= 5; page++) {
                const res = await this.client.get('/user/repos', {
                    params: { 
                        affiliation: 'owner,collaborator,organization_member', 
                        per_page: 100, 
                        sort: 'updated',
                        page 
                    }
                });
                for (const repo of res.data) {
                    allReposMap.set(repo.full_name, {
                        id: String(repo.id),
                        name: repo.name,
                        fullName: repo.full_name,
                        private: repo.private,
                        url: repo.html_url,
                        description: repo.description || ''
                    });
                }
                if (res.data.length < 100) break;
            }

            // 2. Explicitly fetch user organizations and their repos to ensure nothing is missed
            try {
                const orgsRes = await this.client.get('/user/orgs', { params: { per_page: 100 } });
                for (const org of orgsRes.data) {
                    for (let page = 1; page <= 3; page++) {
                        const orgReposRes = await this.client.get(`/orgs/${org.login}/repos`, {
                            params: { type: 'all', per_page: 100, page }
                        });
                        for (const repo of orgReposRes.data) {
                            if (!allReposMap.has(repo.full_name)) {
                                allReposMap.set(repo.full_name, {
                                    id: String(repo.id),
                                    name: repo.name,
                                    fullName: repo.full_name,
                                    private: repo.private,
                                    url: repo.html_url,
                                    description: repo.description || ''
                                });
                            }
                        }
                        if (orgReposRes.data.length < 100) break;
                    }
                }
            } catch (orgErr) {
                // Some PAT tokens might lack org permissions, ignore gracefully
                console.warn('[GitHubClient] Notice: Could not query extra org repos directly:', (orgErr as any).message);
            }

            // 3. Explicitly fetch team repositories (crucial for orgs where users are assigned via teams, e.g. Dev-Read)
            try {
                const teamsRes = await this.client.get('/user/teams', { params: { per_page: 100 } });
                if (Array.isArray(teamsRes.data)) {
                    for (const team of teamsRes.data) {
                        for (let page = 1; page <= 3; page++) {
                            const teamReposRes = await this.client.get(`/teams/${team.id}/repos`, {
                                params: { per_page: 100, page }
                            });
                            for (const repo of teamReposRes.data) {
                                if (!allReposMap.has(repo.full_name)) {
                                    allReposMap.set(repo.full_name, {
                                        id: String(repo.id),
                                        name: repo.name,
                                        fullName: repo.full_name,
                                        private: repo.private,
                                        url: repo.html_url,
                                        description: repo.description || ''
                                    });
                                }
                            }
                            if (teamReposRes.data.length < 100) break;
                        }
                    }
                }
            } catch (teamErr) {
                console.warn('[GitHubClient] Notice: Could not query user teams repos directly:', (teamErr as any).message);
            }

            return Array.from(allReposMap.values());
        } catch (error: any) {
            console.error('[GitHubClient] Error listing repos:', error.response?.status || error.message);
            throw error;
        }
    }
}
