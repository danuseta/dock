import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import { StorageService } from '../storage/service';

function credentialCacheId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function buildPullRequestCacheKey(token: string, repos: string[], ticketKey: string): string {
  return `prs_v4_${credentialCacheId(token)}_${repos.slice().sort().join(',')}_${ticketKey}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasCanonicalTicketReference(pr: any, ticketKey: string): boolean {
  const normalizedKey = ticketKey.trim().toUpperCase();
  if (!normalizedKey) return false;
  const exactKey = new RegExp(`(^|[^A-Z0-9_])${escapeRegExp(normalizedKey)}(?![A-Z0-9_])`, 'i');
  return [pr?.title, pr?.head?.ref, pr?.body]
    .some((value) => typeof value === 'string' && exactKey.test(value));
}

export interface SearchPRsOptions {
  staleWhileRevalidate?: boolean;
}

export class GitHubClient {
  private readonly client: AxiosInstance;
  readonly rateLimit = { remaining: -1, reset: -1 };

  constructor(pat: string) {
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${pat.trim()}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 15000,
    });
    this.client.interceptors.response.use(
      (response) => { this.updateRateLimit(response); return response; },
      (error) => {
        if (error.response) this.updateRateLimit(error.response);
        return Promise.reject(error);
      },
    );
  }

  private updateRateLimit(response: AxiosResponse) {
    const remaining = response.headers['x-ratelimit-remaining'];
    const reset = response.headers['x-ratelimit-reset'];
    if (remaining !== undefined) this.rateLimit.remaining = Number.parseInt(remaining, 10);
    if (reset !== undefined) this.rateLimit.reset = Number.parseInt(reset, 10);
  }

  async searchPRsByTicketKey(repos: string[], ticketKey: string) {
    const results = new Map<string, any>();
    try {
      const repoQuery = repos.map((repo) => `repo:${repo}`).join(' ');
      const response = await this.client.get('/search/issues', {
        params: { q: `type:pr ${repoQuery} "${ticketKey}"`, per_page: 50 },
      });
      for (const item of response.data?.items || []) {
        if (item.html_url && hasCanonicalTicketReference(item, ticketKey)) results.set(item.html_url, item);
      }
    } catch (error: any) {
      console.error('[GitHub] Search API failed:', error.message);
    }

    await Promise.all(repos.map(async (fullName) => {
      try {
        const response = await this.client.get(`/repos/${fullName}/pulls`, {
          params: { state: 'all', per_page: 50 },
        });
        for (const pr of response.data || []) {
          if (hasCanonicalTicketReference(pr, ticketKey)) {
            pr.repository_url ||= `https://api.github.com/repos/${fullName}`;
            results.set(pr.html_url, pr);
          }
        }
      } catch (error: any) {
        console.error(`[GitHub] Failed to inspect ${fullName}:`, error.message);
      }
    }));
    return [...results.values()];
  }

  async getPRStatus(owner: string, repo: string, pullNumber: number) {
    const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return response.data;
  }

  async getPRActivity(owner: string, repo: string, pullNumber: number) {
    const [commitsResponse, filesResponse] = await Promise.all([
      this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits`, { params: { per_page: 30 } }),
      this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, { params: { per_page: 50 } }),
    ]);
    return {
      commits: (commitsResponse.data || []).map((commit: any) => ({
        sha: commit.sha?.substring(0, 7) || '',
        author: commit.commit?.author?.name || commit.author?.login || 'Unknown Author',
        message: commit.commit?.message || '',
        date: commit.commit?.author?.date || commit.commit?.committer?.date || '',
        url: commit.html_url || '',
      })),
      files: (filesResponse.data || []).map((file: any) => ({
        filename: file.filename || '', status: file.status || 'modified',
        additions: file.additions || 0, deletions: file.deletions || 0,
        changes: file.changes || 0, blobUrl: file.blob_url || '',
      })),
    };
  }

  async searchOwnOpenPRs(repos: string[]) {
    const repoQuery = repos.map((repo) => `repo:${repo}`).join(' ');
    const response = await this.client.get('/search/issues', {
      params: { q: `type:pr state:open author:@me ${repoQuery}`, per_page: 50 },
    });
    return response.data?.items || [];
  }

  async validateCredentials() {
    const response = await this.client.get('/user');
    return response.data;
  }

  async listRepositories() {
    const repositories = new Map<string, any>();
    const addRepos = (items: any[]) => items.forEach((repo) => repositories.set(repo.full_name, {
      id: String(repo.id), name: repo.name, fullName: repo.full_name,
      private: repo.private, url: repo.html_url, description: repo.description || '',
    }));

    for (let page = 1; page <= 5; page += 1) {
      const response = await this.client.get('/user/repos', {
        params: { affiliation: 'owner,collaborator,organization_member', per_page: 100, sort: 'updated', page },
      });
      addRepos(response.data || []);
      if ((response.data || []).length < 100) break;
    }

    try {
      const organizations = await this.client.get('/user/orgs', { params: { per_page: 100 } });
      await Promise.all((organizations.data || []).map(async (organization: any) => {
        const response = await this.client.get(`/orgs/${organization.login}/repos`, { params: { type: 'all', per_page: 100 } });
        addRepos(response.data || []);
      }));
    } catch (error: any) {
      console.warn('[GitHub] Organization repositories unavailable:', error.message);
    }

    try {
      const teams = await this.client.get('/user/teams', { params: { per_page: 100 } });
      await Promise.all((teams.data || []).map(async (team: any) => {
        const response = await this.client.get(`/teams/${team.id}/repos`, { params: { per_page: 100 } });
        addRepos(response.data || []);
      }));
    } catch (error: any) {
      console.warn('[GitHub] Team repositories unavailable:', error.message);
    }
    return [...repositories.values()];
  }
}

export class GitHubService {
  private readonly lastRefresh = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<any[]>>();

  constructor(private readonly storage = new StorageService()) {}

  async searchPRs(
    pat: string,
    repos: string[],
    ticketKey: string,
    options: SearchPRsOptions = {},
  ) {
    const cacheKey = buildPullRequestCacheKey(pat, repos, ticketKey);
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) {
      const lastRefresh = this.lastRefresh.get(cacheKey) || 0;
      if (Date.now() - lastRefresh > 45000) {
        void this.fetchAndCachePRsOnce(pat, repos, ticketKey, cacheKey);
      }
      return cached;
    }

    const pending = this.fetchAndCachePRsOnce(pat, repos, ticketKey, cacheKey);
    if (options.staleWhileRevalidate) {
      return [];
    }
    return pending;
  }

  private fetchAndCachePRsOnce(pat: string, repos: string[], ticketKey: string, cacheKey: string) {
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const request = this.fetchAndCachePRs(pat, repos, ticketKey, cacheKey)
      .finally(() => {
        if (this.inFlight.get(cacheKey) === request) this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchAndCachePRs(pat: string, repos: string[], ticketKey: string, cacheKey: string) {
    try {
      const client = new GitHubClient(pat);
      const pullRequests = await client.searchPRsByTicketKey(repos, ticketKey);
      const enhanced = (await Promise.all(pullRequests.map(async (pr: any) => {
        const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
        if (!owner || !repo) return null;
        try {
          const [status, activity] = await Promise.all([
            client.getPRStatus(owner, repo, pr.number),
            client.getPRActivity(owner, repo, pr.number),
          ]);
          const prStatus = status.merged ? 'merged' : status.draft ? 'draft' : pr.state || 'open';
          return {
            id: String(pr.id), title: pr.title, url: pr.html_url || pr.url || '',
            html_url: pr.html_url || pr.url || '', status: prStatus, state: pr.state || prStatus,
            draft: status.draft, merged: status.merged, mergeable: status.mergeable,
            mergeable_state: status.mergeable_state,
            type: status.mergeable === false ? 'CONFLICT' : 'PR',
            created_at: pr.created_at, updated_at: pr.updated_at,
            owner, repo, pullNumber: pr.number, number: pr.number,
            baseBranch: status.base?.ref || pr.base?.ref || 'main',
            headBranch: status.head?.ref || pr.head?.ref || '',
            commitsCount: activity.commits.length, commits: activity.commits,
            changedFilesCount: activity.files.length, files: activity.files,
          };
        } catch (error: any) {
          console.error(`[GitHub] Failed to enrich ${owner}/${repo}#${pr.number}:`, error.message);
          return null;
        }
      }))).filter(Boolean);
      await this.storage.upsertCache('github', cacheKey, enhanced, 3600);
      this.lastRefresh.set(cacheKey, Date.now());
      return enhanced;
    } catch (error: any) {
      console.error(`[GitHub] Failed to fetch PRs for ${ticketKey}:`, error.message);
      await this.storage.upsertCache('github', cacheKey, [], 300).catch(() => undefined);
      return [];
    }
  }

  async checkConflicts(pat: string, owner: string, repo: string, number: number) {
    const status = await new GitHubClient(pat).getPRStatus(owner, repo, number);
    return {
      hasConflicts: status.mergeable === false,
      mergeableState: status.mergeable_state,
      conflictingFiles: [],
      changedFiles: status.changed_files,
    };
  }

  validateCredentials(pat: string) { return new GitHubClient(pat).validateCredentials(); }

  async listRepositories(pat: string) {
    const cacheKey = `repos_list_${credentialCacheId(pat)}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;
    const repos = await new GitHubClient(pat).listRepositories();
    await this.storage.upsertCache('github', cacheKey, repos, 600).catch(() => undefined);
    return repos;
  }

  async getNeedsAttention(pat: string, repos: string[]) {
    const cacheKey = `needs_attention_${credentialCacheId(pat)}_${repos.slice().sort().join(',')}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;
    try {
      const client = new GitHubClient(pat);
      const results = (await Promise.all((await client.searchOwnOpenPRs(repos)).map(async (pr: any) => {
        const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
        if (!owner || !repo) return null;
        const status = await client.getPRStatus(owner, repo, pr.number);
        if (status.mergeable !== false && status.mergeable_state !== 'dirty') return null;
        const match = `${pr.title || ''} ${status.head?.ref || ''} ${pr.body || ''}`.match(/([A-Za-z]+-\d+)/);
        return {
          id: String(pr.id), title: pr.title, url: pr.html_url || pr.url,
          hasConflicts: true, owner, repo, number: pr.number,
          ticketKey: match ? match[1].toUpperCase() : null,
        };
      }))).filter(Boolean);
      await this.storage.upsertCache('github', cacheKey, results, 120);
      return results;
    } catch (error: any) {
      console.error('[GitHub] Failed to fetch needs-attention:', error.message);
      await this.storage.upsertCache('github', cacheKey, [], 180).catch(() => undefined);
      return [];
    }
  }
}
