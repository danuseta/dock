import axios from 'axios';
import { GitHubClient } from '../clients/github.client';

export class GitHubService {
    private lastRefresh = new Map<string, number>();
    private refreshing = new Set<string>();

    private get STORAGE_SERVICE_URL(): string {
        const base = process.env.STORAGE_SERVICE_URL || 'http://localhost:8004/api/cache/github';
        if (base.includes('/cache/github')) return base;
        return base.endsWith('/api') ? `${base}/cache/github` : `${base}/api/cache/github`;
    }

    private get storageHeaders(): Record<string, string> {
        const token = process.env.INTERNAL_SERVICE_TOKEN;
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    private async getCache(key: string): Promise<any> {
        try {
            const res = await axios.get(`${this.STORAGE_SERVICE_URL}/${encodeURIComponent(key)}`, { headers: this.storageHeaders });
            return res.data?.data;
        } catch (error) {
            return null;
        }
    }

    private async setCache(key: string, data: any, ttlSeconds = 3600): Promise<void> {
        try {
            await axios.post(this.STORAGE_SERVICE_URL, {
                key,
                data,
                ttl: ttlSeconds
            }, { headers: this.storageHeaders });
            this.lastRefresh.set(key, Date.now());
        } catch (error) {
            console.error('Failed to set cache', error);
        }
    }

    public async searchPRs(pat: string, repos: string[], ticketKey: string) {
        const cacheKey = `prs_v2_${ticketKey}`;
        const cached = await this.getCache(cacheKey);
        
        // Stale-While-Revalidate asynchronous background loading:
        // If we have cached data (even an empty array []), return it IMMEDIATELY to prevent blocking UX.
        // Meanwhile, if more than 45 seconds have passed, re-fetch asynchronously in the background!
        if (cached !== null && Array.isArray(cached)) {
            const lastTime = this.lastRefresh.get(cacheKey) || 0;
            if (Date.now() - lastTime > 45000 && !this.refreshing.has(cacheKey)) {
                this.refreshing.add(cacheKey);
                this.fetchAndCachePRs(pat, repos, ticketKey, cacheKey)
                    .catch(e => console.error(`[Async Background Sync] Error refreshing PRs for ${ticketKey}:`, e.message))
                    .finally(() => this.refreshing.delete(cacheKey));
            }
            return cached;
        }

        return await this.fetchAndCachePRs(pat, repos, ticketKey, cacheKey);
    }

    private async fetchAndCachePRs(pat: string, repos: string[], ticketKey: string, cacheKey: string) {
        try {
            const client = new GitHubClient(pat);
            const prs = await client.searchPRsByTicketKey(repos, ticketKey);
            
            // Enhance PRs with detailed status and GitHub-like commit/file activity in parallel
            const enhancedPRs = await Promise.all(prs.map(async (pr: any) => {
                const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
                if (!owner || !repo) return null;
                
                const [status, activity] = await Promise.all([
                    client.getPRStatus(owner, repo, pr.number),
                    client.getPRActivity(owner, repo, pr.number)
                ]);
                const prStatus = status.merged ? 'merged' : status.draft ? 'draft' : pr.state || 'open';
                return {
                    id: String(pr.id),
                    title: pr.title,
                    url: pr.html_url || pr.url || '',
                    html_url: pr.html_url || pr.url || '',
                    status: prStatus,
                    state: pr.state || prStatus,
                    draft: status.draft,
                    merged: status.merged,
                    mergeable: status.mergeable,
                    mergeable_state: status.mergeable_state,
                    type: status.mergeable === false ? 'CONFLICT' : 'PR',
                    created_at: pr.created_at,
                    updated_at: pr.updated_at,
                    owner,
                    repo,
                    pullNumber: pr.number,
                    number: pr.number,
                    baseBranch: status.base?.ref || pr.base?.ref || 'main',
                    headBranch: status.head?.ref || pr.head?.ref || '',
                    commitsCount: activity.commits?.length || 0,
                    commits: activity.commits || [],
                    changedFilesCount: activity.files?.length || 0,
                    files: activity.files || []
                };
            }));
            
            const validPRs = enhancedPRs.filter(Boolean);
            const ttl = 3600; // 1 hour cache, kept fresh via background async SWR
            await this.setCache(cacheKey, validPRs, ttl);
            return validPRs;
        } catch (err: any) {
            console.error(`[GitHub Service] Error fetching PRs for ${ticketKey} (status ${err?.response?.status || 'unknown'}):`, err?.message || err);
            // On 403 rate limit or error, temporarily cache empty array for 5 minutes so we don't keep triggering rate limits
            await this.setCache(cacheKey, [], 300);
            return [];
        }
    }

    public async checkConflicts(pat: string, owner: string, repo: string, number: number) {
        const client = new GitHubClient(pat);
        return await client.checkConflicts(owner, repo, number);
    }

    public async validateCredentials(pat: string) {
        const client = new GitHubClient(pat);
        return await client.validateCredentials();
    }

    public async listRepositories(pat: string) {
        const cacheKey = `repos_list_${pat.slice(-8)}`;
        const cached = await this.getCache(cacheKey);
        if (cached) return cached;

        try {
            const client = new GitHubClient(pat);
            const repos = await client.listRepositories();
            await this.setCache(cacheKey, repos, 600); // cache for 10 mins
            return repos;
        } catch (err: any) {
            console.error(`[GitHub Service] Error listing repositories (status ${err?.response?.status || 'unknown'}):`, err?.message || err);
            return [];
        }
    }

    public async getNeedsAttention(pat: string, repos: string[]) {
        const cacheKey = `needs-attention-me:${pat.slice(-10)}:${repos.join(',')}`;
        const cached = await this.getCache(cacheKey);
        if (cached) return cached;

        try {
            const client = new GitHubClient(pat);
            const repoQueries = repos.map(repo => `repo:${repo}`).join(' ');
            const query = `type:pr state:open author:@me ${repoQueries}`;
            
            const response = await (client as any).client.get('/search/issues', {
                params: { q: query, per_page: 50 }
            });

            const openPRs = response.data.items || [];

            const results = await Promise.all(openPRs.map(async (pr: any) => {
                try {
                    const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
                    if (!owner || !repo) return null;

                    const status = await client.getPRStatus(owner, repo, pr.number);
                    const hasConflicts = status.mergeable === false || status.mergeable_state === 'dirty';

                    if (hasConflicts) {
                        const textToSearch = `${pr.title || ''} ${status.head?.ref || ''} ${pr.body || ''}`;
                        const match = textToSearch.match(/([A-Za-z]+-\d+)/);
                        const ticketKey = match ? match[1].toUpperCase() : null;

                        return {
                            id: String(pr.id),
                            title: pr.title,
                            url: pr.html_url || pr.url,
                            hasConflicts: true,
                            owner,
                            repo,
                            number: pr.number,
                            ticketKey
                        };
                    }
                    return null;
                } catch (err) {
                    console.error(`Error processing PR #${pr.number}:`, err);
                    return null;
                }
            }));

            const needsAttention = results.filter(Boolean);
            await this.setCache(cacheKey, needsAttention, 120); // cache for 2 mins
            return needsAttention;
        } catch (err: any) {
            console.error(`[GitHub Service] Error in getNeedsAttention (status ${err?.response?.status || 'unknown'}):`, err?.message || err);
            await this.setCache(cacheKey, [], 180); // cache empty array for 3 minutes during rate limits
            return [];
        }
    }
}
