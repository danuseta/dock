import { normalizeTicketKey, type LedgerFinding, type LedgerRounds } from './orchestrator';

/**
 * The diff of a ticket's pull requests for the Changes page: one tab per pull request, the files of the open tab only,
 * and the newest review run's findings. GitHub answers are cached so a reload costs nothing: the pull request itself
 * for a minute, its files per head commit for a week, since a head never changes.
 */

const PULL_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
const SHA = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 100;
/** GitHub lists at most 3000 files of a pull request. */
const MAX_PAGES = 30;
/** Past 300 files or 4 MB of patches, the rest come without a patch and load one by one. */
const FULL_FILES = 300;
const FULL_BYTES = 4 * 1024 * 1024;
export const MAX_LINES = 500;
const META_FRESH_MS = 60 * 1000;
const KEEP_SECONDS = 7 * 24 * 3600;

export type ChangesError = 'GITHUB_NOT_CONNECTED' | 'NO_ACCESS' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE';

export interface PullFile { path: string; previousPath: string | null; status: string; additions: number; deletions: number; patch: string | null; tooLarge: boolean }
export interface PullMeta {
  url: string; owner: string; repo: string; number: number; title: string; state: string; author: string | null;
  headRef: string; baseRef: string; headSha: string; additions: number; deletions: number; changedFiles: number;
}
export interface PullChanges extends PullMeta {
  /** The tab's name: the repository, or repository#number when the ticket has two pull requests in one repository. */
  tab: string;
  headDate: string | null;
  /** Null for the tabs not asked for. */
  files: PullFile[] | null;
  partial: boolean;
  stale: boolean;
  retryAt: string | null;
  error: ChangesError | null;
}
export interface ChangesReview { runKey: string; verdict: string | null; roundsUsed: number | null; roundsMax: number | null; updatedAt: string; findings: LedgerFinding[] }
export interface TicketChanges { ticketKey: string; title: string | null; pulls: PullChanges[]; review: ChangesReview | null; error: ChangesError | null }

/** The GitHub calls the page needs, with one token. */
export interface GitHubReader {
  pull(owner: string, repo: string, number: number): Promise<any>;
  files(owner: string, repo: string, number: number, page: number): Promise<any[]>;
  commitDate(owner: string, repo: string, sha: string): Promise<string | null>;
  raw(owner: string, repo: string, path: string, ref: string): Promise<string>;
  repo(owner: string, repo: string): Promise<unknown>;
}
/** What the page reads of a run. */
export interface ChangesRun {
  key: string; kind: string; title: string; prBe: string | null; prFe: string | null; reviewTicket: string | null; reviewPrs: string[];
  verdict: string | null; rounds: LedgerRounds | null; findings: LedgerFinding[]; updatedAt: string;
}
export interface ChangesDeps {
  /** Null when Settings has no GitHub token. */
  github(): Promise<GitHubReader | null>;
  /** Pull request links GitHub search finds for the ticket. */
  search(ticketKey: string): Promise<string[]>;
  /** Every run DOCK keeps, dismissed ones too. */
  runs(): Promise<ChangesRun[]>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<unknown>;
  now(): Date;
}

export class ChangesInputError extends Error {}

interface CachedMeta { meta: PullMeta; at: number }
interface CachedFiles { files: PullFile[]; headDate: string | null }
interface Failure { code: ChangesError; retryAt: string | null }

export function parsePullUrl(url: string): { url: string; owner: string; repo: string; number: number } | null {
  const match = PULL_URL.exec(url.trim());
  return match ? { url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`, owner: match[1], repo: match[2], number: Number(match[3]) } : null;
}

/** What a failed GitHub call means for the page. */
export function failureOf(error: unknown): Failure {
  const response = (error as { response?: { status?: number; headers?: Record<string, string> } })?.response;
  if (!response?.status) return { code: 'UNAVAILABLE', retryAt: null };
  const reset = Number(response.headers?.['x-ratelimit-reset']);
  const limited = response.status === 429 || (response.status === 403 && response.headers?.['x-ratelimit-remaining'] === '0');
  if (limited) return { code: 'RATE_LIMITED', retryAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null };
  if (response.status === 401 || response.status === 403) return { code: 'NO_ACCESS', retryAt: null };
  if (response.status === 404) return { code: 'NOT_FOUND', retryAt: null };
  return { code: 'UNAVAILABLE', retryAt: null };
}

/** A file of GitHub's list. GitHub sends no patch for a binary or very large file; a rename without changes has none either. */
export function toFile(raw: any): PullFile {
  const patch = typeof raw?.patch === 'string' ? raw.patch : null;
  const additions = Number(raw?.additions ?? 0);
  const deletions = Number(raw?.deletions ?? 0);
  const status = String(raw?.status ?? 'modified');
  return {
    path: String(raw?.filename ?? ''),
    previousPath: raw?.previous_filename ? String(raw.previous_filename) : null,
    status,
    additions,
    deletions,
    patch,
    tooLarge: patch === null && !(status === 'renamed' && additions + deletions === 0),
  };
}

function toMeta(pull: { url: string; owner: string; repo: string; number: number }, raw: any): PullMeta {
  const state = raw?.merged_at || raw?.merged ? 'merged' : raw?.state === 'closed' ? 'closed' : raw?.draft ? 'draft' : 'open';
  return {
    ...pull,
    title: String(raw?.title ?? ''),
    state,
    author: raw?.user?.login ?? null,
    headRef: String(raw?.head?.ref ?? ''),
    baseRef: String(raw?.base?.ref ?? ''),
    headSha: String(raw?.head?.sha ?? ''),
    additions: Number(raw?.additions ?? 0),
    deletions: Number(raw?.deletions ?? 0),
    changedFiles: Number(raw?.changed_files ?? 0),
  };
}

/** Keeps the response small: past the first 300 files or 4 MB of patches a file comes without its patch. */
export function trimFiles(files: PullFile[]): { files: PullFile[]; partial: boolean } {
  let bytes = 0;
  let partial = false;
  const trimmed = files.map((file, index) => {
    bytes += file.patch?.length ?? 0;
    if (file.patch === null || (index < FULL_FILES && bytes <= FULL_BYTES)) return file;
    partial = true;
    return { ...file, patch: null };
  });
  return { files: trimmed, partial };
}

/** The pull request links of a ticket, deduplicated: backend repositories first, then frontend, then the rest by name. */
export function orderPulls(urls: string[], backend: Set<string>, frontend: Set<string>) {
  const pulls = new Map<string, NonNullable<ReturnType<typeof parsePullUrl>>>();
  for (const url of urls) {
    const pull = parsePullUrl(url);
    if (pull && !pulls.has(pull.url)) pulls.set(pull.url, pull);
  }
  const rank = (pull: { url: string; repo: string }) => (backend.has(pull.url) || /backend/i.test(pull.repo) ? 0 : frontend.has(pull.url) || /frontend/i.test(pull.repo) ? 1 : 2);
  const ordered = [...pulls.values()].sort((a, b) => rank(a) - rank(b) || a.repo.localeCompare(b.repo) || a.number - b.number);
  const repos = ordered.map((pull) => pull.repo);
  return ordered.map((pull) => ({ ...pull, tab: repos.filter((repo) => repo === pull.repo).length > 1 ? `${pull.repo}#${pull.number}` : pull.repo }));
}

const byNewest = (a: ChangesRun, b: ChangesRun) => b.updatedAt.localeCompare(a.updatedAt);

export class PullChangesService {
  constructor(private readonly deps: ChangesDeps) {}

  private async ticket(ticketKey: string) {
    let key: string;
    try { key = normalizeTicketKey(ticketKey); } catch { throw new ChangesInputError('A valid ticket key is required'); }
    const runs = await this.deps.runs();
    const review = runs.filter((run) => run.kind === 'review' && (run.reviewTicket ?? run.key) === key).sort(byNewest)[0] ?? null;
    const builds = runs.filter((run) => run.kind !== 'review' && run.key === key);
    const links = (run: ChangesRun, field: 'prBe' | 'prFe') => (run[field] ? [run[field] as string] : []);
    const backend = new Set(builds.flatMap((run) => links(run, 'prBe')).map((url) => parsePullUrl(url)?.url ?? url));
    const frontend = new Set(builds.flatMap((run) => links(run, 'prFe')).map((url) => parsePullUrl(url)?.url ?? url));
    const searched = await this.deps.search(key).catch(() => []);
    const pulls = orderPulls([...searched, ...(review?.reviewPrs ?? []), ...backend, ...frontend], backend, frontend);
    return { key, review, title: builds[0]?.title || review?.title || null, pulls };
  }

  private async meta(github: GitHubReader, pull: { url: string; owner: string; repo: string; number: number }): Promise<{ meta: PullMeta | null; stale: boolean; failure: Failure | null }> {
    const cached = await this.deps.cacheGet(`meta:${pull.url}`) as CachedMeta | null;
    const now = this.deps.now().getTime();
    if (cached && now - cached.at < META_FRESH_MS) return { meta: cached.meta, stale: false, failure: null };
    try {
      const meta = toMeta(pull, await github.pull(pull.owner, pull.repo, pull.number));
      await this.deps.cacheSet(`meta:${pull.url}`, { meta, at: now }, KEEP_SECONDS);
      return { meta, stale: false, failure: null };
    } catch (error) {
      const failure = failureOf(error);
      if (cached && (failure.code === 'RATE_LIMITED' || failure.code === 'UNAVAILABLE')) return { meta: cached.meta, stale: true, failure };
      // GitHub answers 404 for a private repository the token cannot read too.
      if (failure.code === 'NOT_FOUND') failure.code = await github.repo(pull.owner, pull.repo).then(() => 'NOT_FOUND' as const, () => 'NO_ACCESS' as const);
      return { meta: null, stale: false, failure };
    }
  }

  private async files(github: GitHubReader, meta: PullMeta): Promise<CachedFiles> {
    const key = `files:${meta.url}@${meta.headSha}`;
    const cached = await this.deps.cacheGet(key) as CachedFiles | null;
    if (cached) return cached;
    const files: PullFile[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const raw = await github.files(meta.owner, meta.repo, meta.number, page);
      files.push(...raw.map(toFile));
      if (raw.length < PAGE_SIZE) break;
    }
    const headDate = await github.commitDate(meta.owner, meta.repo, meta.headSha).catch(() => null);
    const value = { files, headDate };
    await this.deps.cacheSet(key, value, KEEP_SECONDS);
    return value;
  }

  /** Every pull request of the ticket with its header, and the files of the one in `tab` (the first when not given). */
  async changes(ticketKey: string, tab?: string | null): Promise<TicketChanges> {
    const { key, review, title, pulls } = await this.ticket(ticketKey);
    const reviewView = review && {
      runKey: review.key, verdict: review.verdict, roundsUsed: review.rounds?.used ?? null, roundsMax: review.rounds?.max ?? null, updatedAt: review.updatedAt, findings: review.findings,
    };
    const github = await this.deps.github();
    if (!github) return { ticketKey: key, title, pulls: [], review: reviewView, error: 'GITHUB_NOT_CONNECTED' };
    const chosen = pulls.find((pull) => pull.tab === tab) ?? pulls.find((pull) => pull.repo === tab) ?? pulls[0];
    const views: PullChanges[] = [];
    for (const pull of pulls) {
      const { meta, stale, failure } = await this.meta(github, pull);
      const view: PullChanges = {
        ...(meta ?? { ...pull, title: '', state: 'unknown', author: null, headRef: '', baseRef: '', headSha: '', additions: 0, deletions: 0, changedFiles: 0 }),
        tab: pull.tab, headDate: null, files: null, partial: false, stale, retryAt: failure?.retryAt ?? null, error: meta ? null : failure?.code ?? null,
      };
      if (meta && pull === chosen) {
        try {
          const loaded = await this.files(github, meta);
          const trimmed = trimFiles(loaded.files);
          Object.assign(view, { files: trimmed.files, partial: trimmed.partial, headDate: loaded.headDate });
        } catch (error) {
          const files = failureOf(error);
          Object.assign(view, { error: files.code, retryAt: files.retryAt });
        }
      }
      views.push(view);
    }
    return { ticketKey: key, title: title ?? views[0]?.title ?? null, pulls: views, review: reviewView, error: null };
  }

  /** A pull request of the ticket, or an input error for any other link. */
  private async pullOf(ticketKey: string, url: string) {
    const { pulls } = await this.ticket(ticketKey);
    const pull = pulls.find((item) => item.url === parsePullUrl(url)?.url);
    if (!pull) throw new ChangesInputError('That pull request is not one of the ticket');
    const github = await this.deps.github();
    if (!github) throw new ChangesInputError('Connect GitHub in Settings first');
    return { pull, github };
  }

  /** One file with its patch, for a file the size guard sent without one. */
  async filePatch(ticketKey: string, url: string, path: string): Promise<PullFile | null> {
    const { pull, github } = await this.pullOf(ticketKey, url);
    const { meta, failure } = await this.meta(github, pull);
    if (!meta) throw new ChangesInputError(`GitHub: ${failure?.code ?? 'UNAVAILABLE'}`);
    return (await this.files(github, meta)).files.find((file) => file.path === path) ?? null;
  }

  /** Lines `from`..`to` (1-based, at most 500) of a file at a commit, for Expand. */
  async fileLines(ticketKey: string, url: string, path: string, ref: string, from: number, to: number): Promise<string[]> {
    if (!SHA.test(ref)) throw new ChangesInputError('ref must be a commit sha');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new ChangesInputError('from and to must be a line range');
    if (to - from + 1 > MAX_LINES) throw new ChangesInputError(`At most ${MAX_LINES} lines at a time`);
    const { pull, github } = await this.pullOf(ticketKey, url);
    const key = `raw:${pull.owner}/${pull.repo}@${ref}:${path}`;
    let text = await this.deps.cacheGet(key) as string | null;
    if (text === null) {
      text = await github.raw(pull.owner, pull.repo, path, ref).catch((error: unknown) => {
        throw new ChangesInputError(`GitHub: ${failureOf(error).code}`);
      });
      await this.deps.cacheSet(key, text, KEEP_SECONDS);
    }
    return text.split('\n').slice(from - 1, to);
  }
}
