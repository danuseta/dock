import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import { StorageService } from '../storage/service';
import { checkRunsState, combineChecks, commitStatusState, reviewDecisionOf, type PullRequestSignal } from './pr-signals';
import { pullRequestProblems } from './attention';

function credentialCacheId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function buildPullRequestCacheKey(token: string, repos: string[], ticketKey: string): string {
  return `prs_v4_${credentialCacheId(token)}_${repos.slice().sort().join(',')}_${ticketKey}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OTHER_TICKET_KEY = /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9]+-\d+(?![A-Za-z0-9_])/;

export function hasCanonicalTicketReference(pr: any, ticketKey: string): boolean {
  const normalizedKey = ticketKey.trim().toUpperCase();
  if (!normalizedKey) return false;
  const exactKey = new RegExp(`(^|[^A-Z0-9_])${escapeRegExp(normalizedKey)}(?![A-Z0-9_])`, 'i');
  const names = [pr?.title, pr?.head?.ref].filter((value): value is string => typeof value === 'string');
  if (names.some((value) => exactKey.test(value))) return true;
  // A pull request that names another ticket in its title or branch only mentions this one in passing.
  if (names.some((value) => OTHER_TICKET_KEY.test(value))) return false;
  if (typeof pr?.body !== 'string' || !exactKey.test(pr.body)) return false;
  // A body that names several tickets is a release or roll-up list, not this ticket's pull request.
  const keys = new Set([...pr.body.matchAll(new RegExp(OTHER_TICKET_KEY.source, 'g'))].map((match) => match[0].replace(/^[^A-Za-z]/, '').toUpperCase()));
  return keys.size === 1;
}

const SIGNAL_PULL_REQUESTS = 5;
const NEEDS_ATTENTION_TTL_SECONDS = 300;
const MERGEABILITY_PENDING_TTL_SECONDS = 15;
const SIGNAL_REFRESH_MS = 5 * 60 * 1000;

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

  async getPRSignal(owner: string, repo: string, pullNumber: number, headSha?: string): Promise<PullRequestSignal> {
    const sha = headSha || (await this.getPRStatus(owner, repo, pullNumber)).head?.sha;
    const [reviews, checkRuns, status] = await Promise.all([
      this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, { params: { per_page: 100 } }),
      this.client.get(`/repos/${owner}/${repo}/commits/${sha}/check-runs`, { params: { per_page: 100 } }),
      this.client.get(`/repos/${owner}/${repo}/commits/${sha}/status`),
    ]);
    return {
      reviewDecision: reviewDecisionOf(reviews.data || []),
      checks: combineChecks(checkRunsState(checkRuns.data?.check_runs || []), commitStatusState(status.data)),
    };
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

  async approvePullRequest(owner: string, repo: string, pullNumber: number) {
    await this.client.post(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, { event: 'APPROVE' });
  }

  /** Marks a draft pull request ready for review (GraphQL only); false when it was not a draft. */
  async markReadyForReview(owner: string, repo: string, pullNumber: number): Promise<boolean> {
    const { data } = await this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (!data?.draft) return false;
    const response = await this.client.post('/graphql', {
      query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }',
      variables: { id: data.node_id },
    });
    if (response.data?.errors?.length) throw new Error(String(response.data.errors[0]?.message ?? 'GitHub refused'));
    return true;
  }

  /** Issues of a repository, pull requests left out; `creator` narrows to one author. */
  async listIssues(repo: string, state: 'open' | 'closed' | 'all', creator?: string): Promise<any[]> {
    const response = await this.client.get(`/repos/${repo}/issues`, {
      params: { state, per_page: 100, sort: 'updated', direction: 'desc', ...(creator ? { creator } : {}) },
    });
    return (Array.isArray(response.data) ? response.data : []).filter((item: any) => !item.pull_request);
  }

  async getIssue(repo: string, number: number): Promise<{ issue: any; comments: any[] }> {
    const [issue, comments] = await Promise.all([
      this.client.get(`/repos/${repo}/issues/${number}`),
      this.client.get(`/repos/${repo}/issues/${number}/comments`, { params: { per_page: 100 } }),
    ]);
    return { issue: issue.data, comments: Array.isArray(comments.data) ? comments.data : [] };
  }

  async createIssue(repo: string, title: string, body: string): Promise<{ number: number; html_url: string }> {
    const response = await this.client.post(`/repos/${repo}/issues`, { title, body });
    return response.data;
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
  private readonly signalsInFlight = new Map<string, Promise<void>>();

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

  /**
   * Review decision and check state of a ticket's newest open pull requests, for the Agents page only. Reads the cache
   * and returns at once; a missing or five-minute-old entry is refreshed in the background (at most 5 pull requests, 3
   * requests each, one refresh at a time per ticket). A failing call leaves the previous answer in place.
   */
  async getPRSignals(
    pat: string,
    ticketKey: string,
    pullRequests: Array<{ url: string; status: string; owner: string; repo: string; number: number; headSha?: string }>,
  ): Promise<Record<string, PullRequestSignal>> {
    const cacheKey = `signals_v1_${credentialCacheId(pat)}_${ticketKey}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    const entry = cached && typeof cached === 'object' && !Array.isArray(cached) ? cached as { at?: number; signals?: Record<string, PullRequestSignal> } : null;
    const open = pullRequests
      .filter((pr) => (pr.status === 'open' || pr.status === 'draft') && pr.owner && pr.repo && pr.number)
      .sort((a, b) => b.number - a.number)
      .slice(0, SIGNAL_PULL_REQUESTS);
    if (open.length > 0 && (!entry || Date.now() - (entry.at || 0) > SIGNAL_REFRESH_MS) && !this.signalsInFlight.has(cacheKey)) {
      const refresh = this.refreshSignals(pat, open, cacheKey, entry?.signals || {})
        .finally(() => { this.signalsInFlight.delete(cacheKey); });
      this.signalsInFlight.set(cacheKey, refresh);
    }
    return entry?.signals || {};
  }

  private async refreshSignals(
    pat: string,
    open: Array<{ url: string; owner: string; repo: string; number: number; headSha?: string }>,
    cacheKey: string,
    previous: Record<string, PullRequestSignal>,
  ) {
    try {
      const client = new GitHubClient(pat);
      const signals: Record<string, PullRequestSignal> = {};
      await Promise.all(open.map(async (pr) => {
        try { signals[pr.url] = await client.getPRSignal(pr.owner, pr.repo, pr.number, pr.headSha); }
        catch (error: any) { if (previous[pr.url]) signals[pr.url] = previous[pr.url]; console.error(`[GitHub] Failed to read review signals of ${pr.owner}/${pr.repo}#${pr.number}:`, error.message); }
      }));
      await this.storage.upsertCache('github', cacheKey, { at: Date.now(), signals }, 3600);
    } catch (error: any) {
      console.error('[GitHub] Failed to refresh review signals:', error.message);
    }
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
            owner, repo, pullNumber: pr.number, number: pr.number, headSha: status.head?.sha || '',
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

  /** The owner's open pull requests that have a merge conflict, a changes-requested review or failing checks. */
  async getNeedsAttention(pat: string, repos: string[]) {
    const cacheKey = `needs_attention_v2_${credentialCacheId(pat)}_${repos.slice().sort().join(',')}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;
    try {
      const client = new GitHubClient(pat);
      let mergeabilityPending = false;
      const results = (await Promise.all((await client.searchOwnOpenPRs(repos)).map(async (pr: any) => {
        const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
        if (!owner || !repo) return null;
        const status = await client.getPRStatus(owner, repo, pr.number);
        if (status.mergeable === null) mergeabilityPending = true;
        const problems = pullRequestProblems(status, await client.getPRSignal(owner, repo, pr.number, status.head?.sha));
        if (problems.length === 0) return null;
        const match = `${pr.title || ''} ${status.head?.ref || ''} ${pr.body || ''}`.match(/([A-Za-z]+-\d+)/);
        return {
          id: String(pr.id), title: pr.title, url: pr.html_url || pr.url,
          problems, owner, repo, number: pr.number,
          ticketKey: match ? match[1].toUpperCase() : null,
        };
      }))).filter(Boolean);
      // GitHub answers mergeable: null while it is still computing; that answer is asked again soon instead of kept.
      await this.storage.upsertCache('github', cacheKey, results, mergeabilityPending ? MERGEABILITY_PENDING_TTL_SECONDS : NEEDS_ATTENTION_TTL_SECONDS);
      return results;
    } catch (error: any) {
      console.error('[GitHub] Failed to fetch needs-attention:', error.message);
      await this.storage.upsertCache('github', cacheKey, [], 180).catch(() => undefined);
      return [];
    }
  }
}
