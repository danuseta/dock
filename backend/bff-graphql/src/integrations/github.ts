import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import { StorageService } from '../storage/service';
import { checkRunsState, combineChecks, commitStatusState, reviewDecisionOf, type PullRequestSignal } from './pr-signals';
import { pullRequestProblems } from './attention';
import { githubApiBase } from './mock-base';
import { GitHubBudget, GitHubRateLimitError, githubBudget, isRateLimitError, type GitHubQuotaState } from './github-budget';

function credentialCacheId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function buildPullRequestCacheKey(token: string, repos: string[], ticketKey: string): string {
  return `prs_v5_${credentialCacheId(token)}_${repos.slice().sort().join(',')}_${ticketKey}`;
}

/** The quota of a token as the last GitHub response said. */
export function githubQuotaOf(token: string, budget: GitHubBudget = githubBudget): GitHubQuotaState {
  return budget.state(credentialCacheId(token));
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
const OPEN_TTL_SECONDS = 180;
const SETTLED_TTL_SECONDS = 1800;
const FAILED_TTL_SECONDS = 300;
const REPO_PULLS_FRESH_MS = 120_000;
const TICKET_KEEP_SECONDS = 3600;
const REPO_PULLS_KEEP_SECONDS = 86_400;
const PULL_DETAIL_KEEP_SECONDS = 7 * 86_400;

export interface SearchPRsOptions {
  staleWhileRevalidate?: boolean;
  /** Ask GitHub now: a pull request just marked ready still reads as draft in the cache. */
  fresh?: boolean;
}

export interface GitHubClientOptions {
  /** Work that may still use the last requests of a low quota: review replies, approvals, live lookups. */
  priority?: boolean;
  budget?: GitHubBudget;
}

const RELEASE = Symbol('githubBudgetRelease');

export class GitHubClient {
  private readonly client: AxiosInstance;
  readonly rateLimit = { remaining: -1, reset: -1 };

  constructor(pat: string, options: GitHubClientOptions = {}) {
    const budget = options.budget ?? githubBudget;
    const budgetKey = credentialCacheId(pat);
    this.client = axios.create({
      baseURL: githubApiBase(),
      headers: {
        Authorization: `Bearer ${pat.trim()}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 15000,
    });
    const release = (config: any) => { config?.[RELEASE]?.(); };
    this.client.interceptors.request.use(async (config) => {
      (config as any)[RELEASE] = await budget.acquire(budgetKey, options.priority === true);
      return config;
    });
    this.client.interceptors.response.use(
      (response) => {
        release(response.config);
        this.updateRateLimit(response);
        budget.record(budgetKey, response.status, response.headers);
        return response;
      },
      (error) => {
        release(error.config);
        if (error.response) {
          this.updateRateLimit(error.response);
          budget.record(budgetKey, error.response.status, error.response.headers, String(error.response.data?.message ?? ''));
        }
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

  /** Pull requests that name the ticket, from the search API; the fallback for ones beyond the newest of each repository. */
  async searchTicketPRs(repos: string[], ticketKey: string): Promise<any[]> {
    const repoQuery = repos.map((repo) => `repo:${repo}`).join(' ');
    const response = await this.client.get('/search/issues', {
      params: { q: `type:pr ${repoQuery} "${ticketKey}"`, per_page: 50 },
    });
    return (response.data?.items || []).filter((item: any) => item.html_url && hasCanonicalTicketReference(item, ticketKey));
  }

  /** The newest 50 pull requests of a repository; with the ETag of the last answer, GitHub says 304 when nothing changed. */
  async listPulls(fullName: string, etag?: string | null): Promise<{ notModified: true } | { notModified: false; pulls: any[]; etag: string | null }> {
    const response = await this.client.get(`/repos/${fullName}/pulls`, {
      params: { state: 'all', per_page: 50 },
      headers: etag ? { 'If-None-Match': etag } : undefined,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
    if (response.status === 304) return { notModified: true };
    return { notModified: false, pulls: Array.isArray(response.data) ? response.data : [], etag: response.headers.etag ? String(response.headers.etag) : null };
  }

  async getPRStatus(owner: string, repo: string, pullNumber: number) {
    const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return response.data;
  }

  /** One page of a pull request's files, 100 per page. */
  async getPullFiles(owner: string, repo: string, pullNumber: number, page: number): Promise<any[]> {
    const response = await this.client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, { params: { per_page: 100, page } });
    return Array.isArray(response.data) ? response.data : [];
  }

  /** When a commit was made, for telling a review made before the last push. */
  async getCommitDate(owner: string, repo: string, sha: string): Promise<string | null> {
    const response = await this.client.get(`/repos/${owner}/${repo}/commits/${sha}`);
    return response.data?.commit?.committer?.date ?? null;
  }

  /** Runs of one workflow file on one branch, newest first (30 at most). */
  async getWorkflowRuns(owner: string, repo: string, workflow: string, branch: string): Promise<any[]> {
    const response = await this.client.get(`/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`, { params: { branch, per_page: 30 } });
    return Array.isArray(response.data?.workflow_runs) ? response.data.workflow_runs : [];
  }

  /** Whether commit `head` contains commit `base`: GitHub's compare says identical or ahead. */
  async commitContains(owner: string, repo: string, base: string, head: string): Promise<boolean> {
    if (base === head) return true;
    const response = await this.client.get(`/repos/${owner}/${repo}/compare/${base}...${head}`);
    return response.data?.status === 'identical' || response.data?.status === 'ahead';
  }

  /** A file at a commit as plain text. */
  async getRawFile(owner: string, repo: string, filePath: string, ref: string): Promise<string> {
    const response = await this.client.get(`/repos/${owner}/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
      params: { ref },
      headers: { Accept: 'application/vnd.github.raw' },
      responseType: 'text',
      transformResponse: (data) => data,
    });
    return String(response.data ?? '');
  }

  async getRepo(owner: string, repo: string) {
    const response = await this.client.get(`/repos/${owner}/${repo}`);
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

interface TicketEntry { expiresAt: number; prs: any[] }
interface RepoPulls { at: number; etag: string | null; pulls: any[] }
interface PullDetail {
  updatedAt: string;
  status: { merged: boolean; draft: boolean; mergeable: boolean | null; mergeable_state: string; head: { sha: string; ref: string }; base: { ref: string } };
  activity: { commits: any[]; files: any[] };
}

export interface GitHubServiceOptions {
  now?: () => number;
  budget?: GitHubBudget;
}

const isOpenStatus = (status: unknown) => status === 'open' || status === 'draft';

function slimPull(pr: any, fullName: string) {
  return {
    id: pr.id, number: pr.number, title: pr.title, body: pr.body, state: pr.state, draft: pr.draft, merged_at: pr.merged_at,
    html_url: pr.html_url, url: pr.url, created_at: pr.created_at, updated_at: pr.updated_at,
    head: { ref: pr.head?.ref }, base: { ref: pr.base?.ref },
    repository_url: pr.repository_url || `${githubApiBase()}/repos/${fullName}`,
  };
}

export class GitHubService {
  private readonly inFlight = new Map<string, Promise<any[]>>();
  private readonly repoPullsInFlight = new Map<string, Promise<{ pulls: any[]; error?: any }>>();
  private readonly signalsInFlight = new Map<string, Promise<void>>();
  private readonly incomplete = new Set<string>();
  private readonly now: () => number;
  private readonly budget: GitHubBudget;

  constructor(private readonly storage = new StorageService(), options: GitHubServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.budget = options.budget ?? githubBudget;
  }

  private client(pat: string, priority = false) {
    return new GitHubClient(pat, { priority, budget: this.budget });
  }

  private async ticketEntry(cacheKey: string): Promise<TicketEntry | null> {
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null) as TicketEntry | null;
    return cached && typeof cached.expiresAt === 'number' && Array.isArray(cached.prs) ? cached : null;
  }

  private writeTicket(cacheKey: string, prs: any[], expiresAt: number) {
    const keep = Math.max(TICKET_KEEP_SECONDS, Math.ceil((expiresAt - this.now()) / 1000));
    return this.storage.upsertCache('github', cacheKey, { expiresAt, prs }, keep).catch(() => undefined);
  }

  /** The cached search result only; null on a miss. Never calls GitHub. */
  async cachedPRs(pat: string, repos: string[], ticketKey: string): Promise<any[] | null> {
    return (await this.ticketEntry(buildPullRequestCacheKey(pat, repos, ticketKey)))?.prs ?? null;
  }

  /** False when the last fetch for this ticket dropped a pull request it could not enrich, or failed outright. */
  lastFetchComplete(pat: string, repos: string[], ticketKey: string): boolean {
    return !this.incomplete.has(buildPullRequestCacheKey(pat, repos, ticketKey));
  }

  /**
   * A ticket's pull requests. A cached answer is served until it expires (3 minutes while a pull request is open or
   * draft, 30 minutes otherwise) and only then asked again; `fresh` asks GitHub now.
   */
  async searchPRs(
    pat: string,
    repos: string[],
    ticketKey: string,
    options: SearchPRsOptions = {},
  ) {
    const cacheKey = buildPullRequestCacheKey(pat, repos, ticketKey);
    if (options.fresh) return this.fetchAndCachePRsOnce(pat, repos, ticketKey, cacheKey, true);
    const entry = await this.ticketEntry(cacheKey);
    if (entry && entry.expiresAt > this.now()) return entry.prs;

    const pending = this.fetchAndCachePRsOnce(pat, repos, ticketKey, cacheKey, false);
    if (options.staleWhileRevalidate) {
      return entry?.prs ?? [];
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
      const client = this.client(pat);
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

  private fetchAndCachePRsOnce(pat: string, repos: string[], ticketKey: string, cacheKey: string, fresh: boolean) {
    const flightKey = `${cacheKey}_${fresh ? 'fresh' : 'cached'}`;
    const pending = this.inFlight.get(flightKey);
    if (pending) return pending;

    const request = this.fetchAndCachePRs(pat, repos, ticketKey, cacheKey, fresh)
      .finally(() => {
        if (this.inFlight.get(flightKey) === request) this.inFlight.delete(flightKey);
      });
    this.inFlight.set(flightKey, request);
    return request;
  }

  /** The newest pull requests of one repository, shared by every ticket: fresh for two minutes, then asked with its ETag. */
  private repoPulls(client: GitHubClient, pat: string, fullName: string, fresh: boolean) {
    const cacheKey = `repo_pulls_v1_${credentialCacheId(pat)}_${fullName}`;
    const flightKey = `${cacheKey}_${fresh ? 'fresh' : 'cached'}`;
    const pending = this.repoPullsInFlight.get(flightKey);
    if (pending) return pending;
    const request = this.loadRepoPulls(client, cacheKey, fullName, fresh)
      .finally(() => {
        if (this.repoPullsInFlight.get(flightKey) === request) this.repoPullsInFlight.delete(flightKey);
      });
    this.repoPullsInFlight.set(flightKey, request);
    return request;
  }

  private async loadRepoPulls(client: GitHubClient, cacheKey: string, fullName: string, fresh: boolean): Promise<{ pulls: any[]; error?: any }> {
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null) as RepoPulls | null;
    const entry = cached && Array.isArray(cached.pulls) ? cached : null;
    if (!fresh && entry && this.now() - entry.at < REPO_PULLS_FRESH_MS) return { pulls: entry.pulls };
    try {
      const response = await client.listPulls(fullName, entry?.etag);
      const next: RepoPulls = response.notModified
        ? { at: this.now(), etag: entry?.etag ?? null, pulls: entry?.pulls ?? [] }
        : { at: this.now(), etag: response.etag, pulls: response.pulls.map((pr) => slimPull(pr, fullName)) };
      await this.storage.upsertCache('github', cacheKey, next, REPO_PULLS_KEEP_SECONDS).catch(() => undefined);
      return { pulls: next.pulls };
    } catch (error: any) {
      return { pulls: entry?.pulls ?? [], error };
    }
  }

  /** The search fallback for a ticket missing from the repository lists; its answer is kept as long as a ticket's. */
  private async searchFallback(client: GitHubClient, pat: string, repos: string[], ticketKey: string, fresh: boolean): Promise<any[]> {
    const cacheKey = `pr_search_v1_${credentialCacheId(pat)}_${repos.slice().sort().join(',')}_${ticketKey}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null) as TicketEntry | null;
    if (!fresh && cached && Array.isArray(cached.prs) && cached.expiresAt > this.now()) return cached.prs;
    const prs = await client.searchTicketPRs(repos, ticketKey);
    const ttl = prs.some((pr) => pr.state === 'open') ? OPEN_TTL_SECONDS : SETTLED_TTL_SECONDS;
    await this.storage.upsertCache('github', cacheKey, { expiresAt: this.now() + ttl * 1000, prs }, ttl).catch(() => undefined);
    return prs;
  }

  /** Status and activity of a pull request, asked again only when its `updated_at` moved. */
  private async pullDetail(client: GitHubClient, pat: string, owner: string, repo: string, pr: any, fresh: boolean, onError: (error: any) => void): Promise<PullDetail> {
    const cacheKey = `pr_detail_v1_${credentialCacheId(pat)}_${owner}/${repo}#${pr.number}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null) as PullDetail | null;
    const entry = cached && cached.status && cached.activity ? cached : null;
    if (!fresh && entry && pr.updated_at && entry.updatedAt === pr.updated_at) return entry;
    try {
      const [status, activity] = await Promise.all([
        client.getPRStatus(owner, repo, pr.number),
        client.getPRActivity(owner, repo, pr.number),
      ]);
      const detail: PullDetail = {
        updatedAt: pr.updated_at || '',
        status: {
          merged: status.merged, draft: status.draft, mergeable: status.mergeable, mergeable_state: status.mergeable_state,
          head: { sha: status.head?.sha || '', ref: status.head?.ref || '' }, base: { ref: status.base?.ref || '' },
        },
        activity,
      };
      if (pr.updated_at && status.mergeable !== null) await this.storage.upsertCache('github', cacheKey, detail, PULL_DETAIL_KEEP_SECONDS).catch(() => undefined);
      return detail;
    } catch (error: any) {
      if (!entry || !isRateLimitError(error)) throw error;
      onError(error);
      return entry;
    }
  }

  private async fetchAndCachePRs(pat: string, repos: string[], ticketKey: string, cacheKey: string, fresh: boolean) {
    this.incomplete.delete(cacheKey);
    const previous = await this.ticketEntry(cacheKey);
    let failed = false;
    let limit: GitHubRateLimitError | null = null;
    const noteFailure = (error: any) => {
      failed = true;
      if (isRateLimitError(error) && (!limit || error.resetAt > limit.resetAt)) limit = error;
    };
    try {
      const client = this.client(pat, fresh);
      const found = new Map<string, any>();
      const lists = await Promise.all(repos.map((fullName) => this.repoPulls(client, pat, fullName, fresh)));
      lists.forEach((list, index) => {
        if (list.error) {
          console.error(`[GitHub] Failed to inspect ${repos[index]}:`, list.error.message);
          noteFailure(list.error);
        }
        for (const pr of list.pulls) {
          if (hasCanonicalTicketReference(pr, ticketKey)) found.set(pr.html_url, pr);
        }
      });
      if (found.size === 0) {
        try {
          for (const pr of await this.searchFallback(client, pat, repos, ticketKey, fresh)) found.set(pr.html_url, pr);
        } catch (error: any) {
          console.error('[GitHub] Search API failed:', error.message);
          noteFailure(error);
        }
      }
      const enhanced = (await Promise.all([...found.values()].map(async (pr: any) => {
        const [owner, repo] = (pr.repository_url || '').split('/').slice(-2);
        if (!owner || !repo) { failed = true; return null; }
        try {
          const { status, activity } = await this.pullDetail(client, pat, owner, repo, pr, fresh, noteFailure);
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
          noteFailure(error);
          return null;
        }
      }))).filter(Boolean);
      if (failed) this.incomplete.add(cacheKey);
      const limited = limit as GitHubRateLimitError | null;
      if (limited) {
        if (previous) {
          await this.writeTicket(cacheKey, previous.prs, limited.resetAt);
          return previous.prs;
        }
        return enhanced;
      }
      const ttl = Math.min(enhanced.some((pr: any) => isOpenStatus(pr.status)) ? OPEN_TTL_SECONDS : SETTLED_TTL_SECONDS, failed ? FAILED_TTL_SECONDS : Infinity);
      await this.writeTicket(cacheKey, enhanced, this.now() + ttl * 1000);
      return enhanced;
    } catch (error: any) {
      console.error(`[GitHub] Failed to fetch PRs for ${ticketKey}:`, error.message);
      this.incomplete.add(cacheKey);
      return previous?.prs ?? [];
    }
  }

  async checkConflicts(pat: string, owner: string, repo: string, number: number) {
    const status = await this.client(pat, true).getPRStatus(owner, repo, number);
    return {
      hasConflicts: status.mergeable === false,
      mergeableState: status.mergeable_state,
      conflictingFiles: [],
      changedFiles: status.changed_files,
    };
  }

  validateCredentials(pat: string) { return this.client(pat, true).validateCredentials(); }

  async listRepositories(pat: string) {
    const cacheKey = `repos_list_${credentialCacheId(pat)}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;
    const repos = await this.client(pat).listRepositories();
    await this.storage.upsertCache('github', cacheKey, repos, 600).catch(() => undefined);
    return repos;
  }

  /** The owner's open pull requests that have a merge conflict, a changes-requested review or failing checks. */
  async getNeedsAttention(pat: string, repos: string[]) {
    const cacheKey = `needs_attention_v2_${credentialCacheId(pat)}_${repos.slice().sort().join(',')}`;
    const cached = await this.storage.getCache('github', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;
    try {
      const client = this.client(pat);
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
      const ttl = isRateLimitError(error) ? Math.max(180, Math.ceil((error.resetAt - this.now()) / 1000)) : 180;
      await this.storage.upsertCache('github', cacheKey, [], ttl).catch(() => undefined);
      return [];
    }
  }
}
