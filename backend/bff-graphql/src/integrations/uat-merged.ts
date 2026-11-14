import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { REVIEW_STATUS } from './broadcast-review';
import { orchestratorService } from './orchestrator';
import { qaGuide } from './qa-guide-live';
import { isDocsSyncPull } from './merge-state';
import { DEFAULT_STATUS_AFTER_MERGE, STATUS_AFTER_MERGE_KEY, readStatusAfterMerge, type StatusAfterMerge } from './ops-rules';
import type { DockMode } from '../mode';

export const UAT_MERGED_STATUS = 'UAT MERGED';

export interface UatPullRequest { url: string; status: string; owner: string; repo: string; number: number; title?: string; headBranch?: string }

export interface UatMergedDeps {
  cachedPullRequests(key: string): Promise<UatPullRequest[] | null>;
  pullStatus(owner: string, repo: string, number: number): Promise<'open' | 'merged' | 'closed'>;
  freshPullRequests(key: string): Promise<{ prs: UatPullRequest[]; complete: boolean }>;
  statusNow(key: string): Promise<string | null>;
  move(key: string, status: string): Promise<'moved' | 'not-offered' | 'error'>;
  marker(key: string): Promise<string[] | null>;
  setMarker(key: string, urls: string[]): Promise<unknown>;
  event(key: string, kind: string, detail: string): Promise<unknown>;
  /** Runs once the ticket moved to UAT MERGED: the QA guide block in Developer Context. A failure never undoes the move. */
  afterMove?(key: string): Promise<unknown>;
  /** Settings › Sous flow › Aturan: on or off, the status to move to, docs-sync ignored, the laptop DOCK too. Left out, the defaults. */
  settings?(): Promise<StatusAfterMerge>;
  now?(): number;
}

const MAX_FAILURES = 3;
const BACKOFF_MS = 60 * 60 * 1000;

const isOpen = (status: string) => status === 'open' || status === 'draft';
const sameUrls = (a: string[] | null, b: string[]) => a !== null && a.length === b.length && a.every((url, index) => url === b[index]);
const inReview = (status: string | null | undefined) => String(status ?? '').trim().toLowerCase() === REVIEW_STATUS.toLowerCase();

/**
 * Moves a ticket from PR Review to UAT MERGED (or the status Settings name) once every pull request linked to it is
 * merged, whatever the base branch; with ignoreDocsSync a docs-sync pull request of the bot does not count. GitHub is
 * asked only about pull requests still open; the Jira status is read fresh just before the move, so a ticket two DOCKs
 * look at moves once.
 */
export class UatMerged {
  private busy = false;
  private readonly failed = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly skipUntil = new Map<string, number>();

  constructor(private readonly deps: UatMergedDeps) {}

  /** Returns the keys it moved. The laptop DOCK moves nothing unless the laptop rule is on. */
  async tick(tickets: Array<{ key: string; status?: string | null }>, mode: DockMode = 'workspace'): Promise<string[]> {
    const candidates = tickets.filter((ticket) => inReview(ticket.status));
    if (candidates.length === 0 || this.busy) return [];
    const rules = this.deps.settings ? await this.deps.settings() : DEFAULT_STATUS_AFTER_MERGE;
    if (!rules.enabled || (mode === 'laptop' && !rules.laptop)) return [];
    this.busy = true;
    const moved: string[] = [];
    try {
      for (const { key } of candidates) {
        try {
          if (await this.check(key, rules)) moved.push(key);
        } catch (error) {
          console.error(`[UatMerged] ${key}:`, error instanceof Error ? error.message : error);
        }
      }
    } finally {
      this.busy = false;
    }
    return moved;
  }

  private async check(key: string, rules: StatusAfterMerge): Promise<boolean> {
    const now = this.deps.now?.() ?? Date.now();
    if ((this.skipUntil.get(key) ?? 0) > now) return false;
    const counted = (prs: UatPullRequest[]) => (rules.ignoreDocsSync ? prs.filter((pr) => !isDocsSyncPull(pr)) : prs);
    const listed = await this.deps.cachedPullRequests(key);
    const cached = listed && counted(listed);
    if (cached) {
      const merged = new Set(cached.filter((pr) => pr.status === 'merged').map((pr) => pr.url));
      for (const pr of cached.filter((item) => isOpen(item.status))) {
        const state = await this.deps.pullStatus(pr.owner, pr.repo, pr.number);
        if (state === 'open') return false;
        if (state === 'merged') merged.add(pr.url);
      }
      if (merged.size === 0) return false;
      if (sameUrls(await this.deps.marker(key), [...merged].sort())) return false;
    }

    const read = await this.deps.freshPullRequests(key);
    if (!read.complete) return false;
    const fresh = { prs: counted(read.prs) };
    const urls = new Set(fresh.prs.map((pr) => pr.url));
    if (cached && cached.some((pr) => !urls.has(pr.url))) return false;
    if (fresh.prs.some((pr) => isOpen(pr.status))) return false;
    const mergedUrls = fresh.prs.filter((pr) => pr.status === 'merged').map((pr) => pr.url).sort();
    if (mergedUrls.length === 0 || sameUrls(await this.deps.marker(key), mergedUrls)) return false;

    if (!inReview(await this.deps.statusNow(key))) return false;

    const result = await this.deps.move(key, rules.next);
    if (result !== 'moved') {
      const count = (this.failures.get(key) ?? 0) + 1;
      this.failures.set(key, count);
      if (count >= MAX_FAILURES) {
        this.skipUntil.set(key, now + BACKOFF_MS);
        this.failures.delete(key);
      }
      if (result === 'not-offered' && !this.failed.has(key)) {
        this.failed.add(key);
        await this.deps.event(key, 'JIRA_MOVE_FAILED', `Jira offers no move to ${rules.next}`).catch(() => undefined);
      }
      return false;
    }
    this.failed.delete(key);
    this.failures.delete(key);
    await this.deps.setMarker(key, mergedUrls);
    await this.deps.event(key, 'JIRA', `${rules.next}: every pull request merged (${mergedUrls.join(', ')})`).catch(() => undefined);
    await this.deps.afterMove?.(key).catch((error) => console.error(`[UatMerged] ${key} after the move:`, error instanceof Error ? error.message : error));
    return true;
  }
}

const UAT_MERGED_CACHE = 'uat-merged';
const storage = new StorageService();
const githubAPI = new GitHubAPI();
const jiraAPI = new JiraAPI();

export const uatMerged = new UatMerged({
  cachedPullRequests: (key) => githubAPI.cachedPullRequestsForTicket(key),
  pullStatus: (owner, repo, number) => githubAPI.pullStatus(owner, repo, number),
  freshPullRequests: (key) => githubAPI.freshPullRequestsForTicket(key),
  statusNow: (key) => jiraAPI.statusNow(key),
  move: (key, status) => jiraAPI.tryTransition(key, status),
  marker: async (key) => {
    const entry = await storage.getCache(UAT_MERGED_CACHE, key).catch(() => null) as { prs?: string[] } | null;
    return Array.isArray(entry?.prs) ? entry.prs : null;
  },
  setMarker: (key, urls) => storage.upsertCache(UAT_MERGED_CACHE, key, { at: new Date().toISOString(), prs: urls }, 0),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
  afterMove: (key) => qaGuide.afterUat(key),
  settings: async () => readStatusAfterMerge((await storage.getSettingValues([STATUS_AFTER_MERGE_KEY]))[0]?.value),
});
