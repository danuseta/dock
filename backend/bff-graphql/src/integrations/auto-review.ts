import type { ThreadRow } from './discord-threads';
import type { Orchestration } from './orchestrator';

/** How long an "on it" starts a review: an old one does not fire when the setting is turned on later. */
export const ON_IT_WINDOW_MS = 6 * 60 * 60 * 1000;
const PULL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export interface AutoReviewSettings { enabled: boolean; autoLgtm: boolean }
export interface PullState { open: boolean; headSha: string }
export interface AutoReviewRecord { id: string; prUrl: string; headSha: string; ticketKey: string; threadUrl: string; sessionId: string | null; status: string; detail: string | null; startedAt: Date; finishedAt: Date | null }
export interface PushMessage { title: string; body: string; url: string; tag: string }

export interface AutoReviewDeps {
  settings(): Promise<AutoReviewSettings>;
  rows(): Promise<ThreadRow[]>;
  pull(owner: string, repo: string, number: number): Promise<PullState>;
  latest(prUrl: string): Promise<AutoReviewRecord | null>;
  running(ticketKey: string): Promise<AutoReviewRecord | null>;
  create(data: { prUrl: string; headSha: string; ticketKey: string; threadUrl: string; startedAt: Date }): Promise<AutoReviewRecord>;
  update(id: string, data: { sessionId?: string | null; status?: string; detail?: string | null; finishedAt?: Date | null }): Promise<unknown>;
  openReview(key: string, prompt: string): Promise<string>;
  /** The same steps as the LGTM button on the Agents page; true when every step went through. */
  approve(key: string): Promise<boolean>;
  push(message: PushMessage): Promise<unknown>;
  now(): Date;
}

/** The prompt of an auto review: the sous review of the pull request, with the thread as context. Nothing is posted anywhere. */
export const reviewPrompt = (key: string, prUrl: string, threadUrl: string) => [
  `Pakai skill sous. review ${key}: ${prUrl}`,
  `Thread Discord pr-review: ${threadUrl} (baca dulu lewat discord-files.cjs).`,
  'Ini auto review dari DOCK karena owner bilang on it di thread itu. Jangan komentar di PR, Jira, atau Discord; tulis verdict dan temuan ke ledger seperti biasa.',
].join('\n');

/** The ticket of a pull request thread: the first key in its title, tags or a Jira link. */
const ticketOf = (row: ThreadRow) => row.tickets[0] ?? null;

/**
 * Starts a sous review when the owner says "on it" in a pr-review thread, and acts on its verdict: an approve without an
 * open blocker is LGTM'd the way the button does it when the owner allows that, anything else is handed to the owner.
 */
export class AutoReview {
  private busy = false;
  private readonly deciding = new Set<string>();

  constructor(private readonly deps: AutoReviewDeps) {}

  /** One look at the stored threads. Cheap when the setting is off: one settings read. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const settings = await this.deps.settings();
      if (!settings.enabled) return 0;
      let started = 0;
      for (const row of await this.deps.rows()) started += await this.consider(row);
      return started;
    } finally {
      this.busy = false;
    }
  }

  /** The pull requests of a thread the owner just said on it in, each reviewed once per head commit and once per "on it". */
  private async consider(row: ThreadRow): Promise<number> {
    if (row.kind !== 'pr' || !row.claim?.mine) return 0;
    const saidAt = Date.parse(row.claim.at);
    if (!(this.deps.now().getTime() - saidAt <= ON_IT_WINDOW_MS)) return 0;
    const key = ticketOf(row);
    if (!key) return 0;
    let started = 0;
    for (const prUrl of row.prs) {
      const match = PULL.exec(prUrl);
      if (!match) continue;
      const url = match[0];
      const last = await this.deps.latest(url);
      if (last && last.startedAt.getTime() >= saidAt) continue;
      let state: PullState;
      try {
        state = await this.deps.pull(match[1], match[2], Number(match[3]));
      } catch {
        continue;
      }
      if (!state.open || (last && last.headSha === state.headSha)) continue;
      const record = await this.deps.create({ prUrl: url, headSha: state.headSha, ticketKey: key, threadUrl: row.url, startedAt: this.deps.now() });
      try {
        const sessionId = await this.deps.openReview(key, reviewPrompt(key, url, row.url));
        await this.deps.update(record.id, { sessionId });
        started += 1;
      } catch (error) {
        await this.deps.update(record.id, { status: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : 'the session did not start', finishedAt: this.deps.now() });
      }
    }
    return started;
  }

  /** A review ledger with a verdict, for the auto review running on that ticket. */
  async ledger(run: Orchestration): Promise<void> {
    if (run.kind !== 'review' || !run.verdict) return;
    const record = await this.deps.running(run.key);
    if (!record || this.deciding.has(record.id) || new Date(run.updatedAt).getTime() < record.startedAt.getTime()) return;
    this.deciding.add(record.id);
    try {
      await this.decide(run, record);
    } finally {
      this.deciding.delete(record.id);
    }
  }

  private async decide(run: Orchestration, record: AutoReviewRecord): Promise<void> {
    const blockers = (run.findings ?? []).filter((finding) => finding.severity === 'blocker' && !finding.resolvedAt).length;
    const clean = run.verdict === 'approve' && blockers === 0;
    // Taken off running first: the LGTM finishes the review run, which pushes its ledger through here again.
    await this.deps.update(record.id, { status: 'deciding' });
    const settings = await this.deps.settings();
    const url = '/agents';
    if (clean && settings.autoLgtm) {
      const ok = await this.deps.approve(run.key);
      await this.finish(record, ok ? 'lgtm' : 'clean', ok ? 'LGTM by DOCK' : 'Clean, but the LGTM steps failed; LGTM it on Agents');
      await this.deps.push({ title: ok ? `${run.key}: auto LGTM` : `${run.key}: LGTM failed`, body: ok ? 'The review was clean; DOCK sent the LGTM. Say it in the thread.' : 'The review was clean but a LGTM step failed. Open Agents.', url, tag: `auto-review-${record.id}` });
      return;
    }
    if (clean) {
      await this.finish(record, 'clean', 'Clean; waiting for your LGTM');
      await this.deps.push({ title: `${run.key}: review clean`, body: 'Approve verdict, no blocker. LGTM it on Agents.', url, tag: `auto-review-${record.id}` });
      return;
    }
    const detail = blockers > 0 ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : 'Request change';
    await this.finish(record, 'blockers', detail);
    await this.deps.push({ title: `${run.key}: ${detail}`, body: 'The auto review needs you. Open Agents.', url, tag: `auto-review-${record.id}` });
  }

  private finish(record: AutoReviewRecord, status: string, detail: string) {
    return this.deps.update(record.id, { status, detail, finishedAt: this.deps.now() });
  }
}
