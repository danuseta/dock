import { threadIdOf } from './discord-post';
import type { ThreadMessage, ThreadRow } from './discord-threads';
import type { Orchestration } from './orchestrator';

/** How long an "on it" starts a review: long enough for one said while the workspace was off, through a weekend. */
export const ON_IT_WINDOW_MS = 72 * 60 * 60 * 1000;
const PULL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const MAX_POST_CHARS = 2_000;
const STOP_DOCK = /\bstop\s+dock\b/i;
const DOCK_POST = /\bDOCK-(?:REVIEW|FIX)\b/;
const NOT_CHANGED = /tidak\s+diubah\s+karena/i;
const ARENA_DONE = ['lgtm', 'clean'];
/** A line that reads as a DOCK marker in any spelling; a body never carries one, only the marker DOCK adds. */
const FORGED_MARKER = /dock[\W_]*-?[\W_]*(review|fix)/i;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
/** A finding shorter than this is too common to tell apart from another, so it is posted again even when answered. */
const MIN_ANSWERED_CHARS = 15;
const SEEN_HEADS = 500;
const NOT_PENDING = 'Only a pending post can be changed';

/** The numbers of the review arena, with their defaults and the range Settings accepts. */
export const ARENA_SETTINGS = {
  reviewPostDelayMinutes: { fallback: 2, min: 0, max: 60 },
  reviewReReviewWaitMinutes: { fallback: 10, min: 0, max: 240 },
  reviewMaxRounds: { fallback: 3, min: 1, max: 10 },
} as const;
export type ArenaSettingKey = keyof typeof ARENA_SETTINGS;

export const isArenaSetting = (key: ArenaSettingKey, value: unknown) => {
  const number = Number(value);
  return value !== '' && value !== null && Number.isInteger(number) && number >= ARENA_SETTINGS[key].min && number <= ARENA_SETTINGS[key].max;
};

/** A saved arena number, or its default when it was never saved or no longer fits. */
export const arenaSetting = (key: ArenaSettingKey, value: string | null | undefined) => (value != null && isArenaSetting(key, value) ? Number(value) : ARENA_SETTINGS[key].fallback);

export interface AutoReviewSettings { enabled: boolean; autoLgtm: boolean; post: boolean; postDelayMinutes: number; reReviewWaitMinutes: number; maxRounds: number }
export interface PullState { open: boolean; headSha: string }
export interface AutoReviewRecord {
  id: string; prUrl: string; headSha: string; ticketKey: string; threadUrl: string; sessionId: string | null; status: string; detail: string | null; startedAt: Date; finishedAt: Date | null;
  round: number; postStatus: string | null; postAt: Date | null; postText: string | null; postMessageId: string | null; postDetail: string | null;
}
export interface AutoReviewUpdate {
  sessionId?: string | null; status?: string; detail?: string | null; finishedAt?: Date | null;
  postStatus?: string | null; postAt?: Date | null; postText?: string | null; postMessageId?: string | null; postDetail?: string | null;
}
export interface PushMessage { title: string; body: string; url: string; tag: string }
/** Who posts: the owner's Discord user id for the marker, the owner's webhook and the name the post carries. */
export interface AutoReviewOwner { discordUserId: string | null; webhookUrl: string | null; name: string }

export interface AutoReviewDeps {
  settings(): Promise<AutoReviewSettings>;
  rows(): Promise<ThreadRow[]>;
  pull(owner: string, repo: string, number: number): Promise<PullState>;
  /** When a commit was made; null when GitHub does not say. */
  commitAt(owner: string, repo: string, sha: string): Promise<Date | null>;
  latest(prUrl: string): Promise<AutoReviewRecord | null>;
  running(ticketKey: string): Promise<AutoReviewRecord | null>;
  get(id: string): Promise<AutoReviewRecord | null>;
  /** Pending posts whose time has come, oldest first. */
  duePosts(now: Date): Promise<AutoReviewRecord[]>;
  create(data: { prUrl: string; headSha: string; ticketKey: string; threadUrl: string; startedAt: Date; round: number }): Promise<AutoReviewRecord>;
  update(id: string, data: AutoReviewUpdate): Promise<unknown>;
  /** Changes a post only while it is still pending; false when it already went out, was taken for sending or was cancelled. */
  updatePending(id: string, data: AutoReviewUpdate): Promise<boolean>;
  openReview(key: string, prompt: string): Promise<string>;
  /** The same steps as the LGTM button on the Agents page; true when every step went through. */
  approve(key: string): Promise<boolean>;
  push(message: PushMessage): Promise<unknown>;
  owner(): Promise<AutoReviewOwner>;
  /** Posts to a thread through the owner's webhook and returns the message id. */
  postDiscord(webhookUrl: string, content: string, options: { threadId: string; username: string }): Promise<string>;
  now(): Date;
}

/** The prompt of an auto review: one sous review of every pull request of the ticket, with the thread as context. Nothing is posted anywhere. */
export const reviewPrompt = (key: string, prUrls: string[], threadUrl: string) => [
  `Pakai skill sous. review ${key}: ${prUrls.join(' ')}`,
  `Thread Discord pr-review: ${threadUrl} (baca dulu lewat discord-files.cjs).`,
  'Ini auto review dari DOCK karena owner bilang on it di thread itu. Jangan komentar di PR, Jira, atau Discord; tulis verdict dan temuan ke ledger seperti biasa.',
].join('\n');

/** The line DOCK puts under every review it posts; teammates' DOCKs read the review through it, so no format changes it. */
export const reviewMarker = (ownerId: string, round: number, sha: string) => `DOCK-REVIEW on it by <@${ownerId}> · round ${round} · @ ${sha.slice(0, 7)}`;

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Finding text as it goes out: a masked link shows as text, and a raw link stays a link without a preview. */
const plainText = (text: string) => text.trim().replace(/\]\(/g, ']\u200B(').replace(/(?<!<)\bhttps?:\/\/[^\s<>()]+/g, (url) => `<${url}>`);

/** A DOCK-FIX reply: posted by a webhook, as a DOCK does, after the arena opened. A person typing the words is not one. */
const isFixReply = (message: Pick<ThreadMessage, 'text' | 'at' | 'webhookId'>, since: number) =>
  Boolean(message.webhookId) && Date.parse(message.at) > since && /\bDOCK-FIX\b/.test(message.text);

/** What the author answered "tidak diubah karena" to in a DOCK-FIX reply since `since`: the text before it on each such line, normalized. */
export function answeredFindings(messages: Array<Pick<ThreadMessage, 'text' | 'at' | 'webhookId'>>, since: number): string[] {
  return messages
    .filter((message) => isFixReply(message, since))
    .flatMap((message) => message.text.split('\n'))
    .map((line) => NOT_CHANGED.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => normalized(match.input.slice(0, match.index)))
    .filter(Boolean);
}

type ReviewLedger = Pick<Orchestration, 'key' | 'verdict' | 'findings'>;

/**
 * The DOCK default text of a review: the verdict, each pull request at its head, the open blockers and non-blocking findings
 * with their text, and only a count of nits. A finding the author already answered "tidak diubah karena" is left out.
 */
export function reviewBody(run: ReviewLedger, pulls: Array<{ url: string; headSha: string }>, answered: string[] = []): string {
  const open = (run.findings ?? []).filter((finding) => !finding.resolvedAt);
  const posted = open.filter((finding) => {
    const text = normalized(finding.text);
    return text.length < MIN_ANSWERED_CHARS || !answered.some((answer) => answer.includes(text) && text.length * 2 >= answer.length);
  });
  const blockers = posted.filter((finding) => finding.severity === 'blocker');
  const notes = posted.filter((finding) => finding.severity === 'non-blocking');
  const nits = open.filter((finding) => finding.severity === 'nit').length;
  const clean = run.verdict === 'approve' && !open.some((finding) => finding.severity === 'blocker');
  const label = clean ? (notes.length ? 'Approve with comments' : 'Approve') : 'Request change';
  const counts = [blockers.length ? `${blockers.length} blocker` : '', notes.length ? `${notes.length} non-blocking` : ''].filter(Boolean).join(', ');
  return [
    [run.key, label, counts].filter(Boolean).join(' · '),
    ...pulls.map((pull) => `<${pull.url}> @ ${pull.headSha.slice(0, 7)}`),
    ...[...blockers, ...notes].map((finding, index) => `${index + 1}) ${finding.severity}: ${plainText(finding.text)}`),
    ...(nits ? [`nit: ${nits}, di ledger`] : []),
  ].join('\n');
}

/** A body with the marker under it; a marker line typed into the body is dropped and the whole post fits Discord's 2000 characters. */
export function withMarker(body: string, marker: string): string {
  const own = body.split('\n').filter((line) => !FORGED_MARKER.test(line.normalize('NFKC').replace(ZERO_WIDTH, ''))).join('\n').trim();
  const room = MAX_POST_CHARS - marker.length - 1;
  return `${own.length > room ? `${own.slice(0, room - 1)}…` : own}\n${marker}`;
}

/** The post of one review round: the DOCK default body, then the fixed marker line. */
export const reviewPost = (run: ReviewLedger, pulls: Array<{ url: string; headSha: string }>, round: number, ownerId: string, answered: string[] = []) =>
  withMarker(reviewBody(run, pulls, answered), reviewMarker(ownerId, round, pulls[0]?.headSha ?? ''));

/** A person asking DOCK to stop in a thread; a DOCK post quoting it does not count. */
const saysStop = (message: Pick<ThreadMessage, 'text'>) => STOP_DOCK.test(message.text) && !DOCK_POST.test(message.text);

/**
 * The auto reviews worth showing: one still running, or one whose pull request is open at the commit it reviewed. A review of a
 * commit the author has since pushed past, or of a merged or closed pull request, is done with. A pull request GitHub cannot be
 * asked about keeps its rows.
 */
export async function currentReviews<T extends Pick<AutoReviewRecord, 'prUrl' | 'headSha' | 'status'>>(rows: T[], pull: AutoReviewDeps['pull']): Promise<T[]> {
  const states = new Map<string, Promise<PullState | null>>();
  const stateOf = (url: string) => {
    let state = states.get(url);
    if (!state) {
      const match = PULL.exec(url);
      state = match ? pull(match[1], match[2], Number(match[3])).catch(() => null) : Promise.resolve(null);
      states.set(url, state);
    }
    return state;
  };
  const keep = await Promise.all(rows.map(async (row) => {
    if (row.status === 'running' || row.status === 'deciding') return true;
    const state = await stateOf(row.prUrl);
    return !state || (state.open && state.headSha === row.headSha);
  }));
  return rows.filter((_, index) => keep[index]);
}

/** The last thing that happened in an arena: its last round starting or settling. */
const lastActivity = (arena: AutoReviewRecord) => Math.max(arena.startedAt.getTime(), arena.finishedAt?.getTime() ?? 0);

/** The ticket of a pull request thread: the first key in its title, tags or a Jira link. */
const ticketOf = (row: ThreadRow) => row.tickets[0] ?? null;

/**
 * Starts a sous review when the owner says "on it" in a pr-review thread, and acts on its verdict: an approve without an
 * open blocker is LGTM'd the way the button does it when the owner allows that, anything else is handed to the owner.
 * The verdict is posted to the thread after a short delay, and a new head commit starts the next round of the same arena.
 */
export class AutoReview {
  private busy = false;
  private readonly skipped = new Map<string, string>();
  private readonly deciding = new Set<string>();
  private wasEnabled: boolean | null = null;
  private enabledAt: number | null = null;
  private readonly seenHeads = new Map<string, number>();

  constructor(private readonly deps: AutoReviewDeps) {}

  /** One look at the stored threads, after sending the posts that are due. Cheap when the setting is off: one settings read. */
  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const settings = await this.deps.settings();
      if (!settings.enabled) {
        this.skipped.clear();
        this.wasEnabled = false;
        return 0;
      }
      if (this.wasEnabled === false) this.enabledAt = this.deps.now().getTime();
      this.wasEnabled = true;
      const rows = await this.deps.rows();
      await this.sendDue(rows, settings);
      let started = 0;
      for (const row of rows) started += await this.consider(row, settings);
      return started;
    } finally {
      this.busy = false;
    }
  }

  /** Why the last look at a thread did not start a review; null when it did or the thread was never skipped. */
  skipReason(threadId: string): string | null {
    return this.skipped.get(threadId) ?? null;
  }

  /** Stops a post that has not gone out yet. */
  async cancelPost(id: string): Promise<boolean> {
    if (!(await this.deps.updatePending(id, { postStatus: 'cancelled', postDetail: 'Cancelled by the owner' }))) throw new Error(NOT_PENDING);
    return true;
  }

  /** Replaces the text of a post that has not gone out yet; the marker line stays as DOCK wrote it. */
  async editPost(id: string, text: string): Promise<boolean> {
    const record = await this.deps.get(id);
    if (!record || record.postStatus !== 'pending') throw new Error(NOT_PENDING);
    const marker = record.postText?.split('\n').pop() ?? '';
    if (!marker.startsWith('DOCK-REVIEW on it by')) throw new Error('The post has no DOCK marker');
    if (!withMarker(text, '').trim()) throw new Error('The post text is empty');
    if (!(await this.deps.updatePending(id, { postText: withMarker(text, marker) }))) throw new Error(NOT_PENDING);
    return true;
  }

  private skip(row: ThreadRow, reasons: string[]): 0 {
    if (reasons.length) this.skipped.set(row.id, [...new Set(reasons)].join('; '));
    return 0;
  }

  /**
   * The pull requests of a thread the owner said on it in. The owner's own "on it" opens an arena: the first round reviews the
   * head commit, and while the arena is open each new head commit is reviewed again once the author's DOCK posted DOCK-FIX for
   * it, or the commit is old enough that the author is not pushing any more. Only the owner's own "on it" counts, however many
   * reviewers said it after. The ones due go in one Review session for the ticket, BE and FE together, with one record per
   * pull request.
   */
  private async consider(row: ThreadRow, settings: AutoReviewSettings): Promise<number> {
    if (row.kind !== 'pr') return 0;
    this.skipped.delete(row.id);
    const ownClaim = row.ownClaim === undefined ? (row.claim?.mine ? row.claim : null) : row.ownClaim;
    if (!ownClaim) return 0;
    const saidAt = Date.parse(ownClaim.at);
    const fresh = this.deps.now().getTime() - saidAt <= ON_IT_WINDOW_MS;
    if (this.enabledAt !== null && saidAt < this.enabledAt) return this.skip(row, ['said before the setting was turned on']);
    const key = ticketOf(row);
    if (!key) return this.skip(row, ['no ticket key']);
    const due: Array<{ url: string; headSha: string; round: number }> = [];
    const reasons: string[] = [];
    if (!row.prs.some((prUrl) => PULL.test(prUrl))) return this.skip(row, ['no pull request link']);
    for (const prUrl of row.prs) {
      const match = PULL.exec(prUrl);
      if (!match || due.some((pull) => pull.url === match[0])) continue;
      const url = match[0];
      const last = await this.deps.latest(url);
      const arena = last && last.startedAt.getTime() >= saidAt ? last : null;
      if (!arena && !fresh) {
        reasons.push('older than 72 h');
        continue;
      }
      if (arena && (arena.status === 'running' || arena.status === 'deciding')) continue;
      const closed = arena ? this.closed(row, arena, saidAt, settings) : null;
      if (closed) {
        reasons.push(closed);
        continue;
      }
      let state: PullState;
      try {
        state = await this.deps.pull(match[1], match[2], Number(match[3]));
      } catch {
        reasons.push('GitHub fetch failed');
        continue;
      }
      if (!state.open) {
        reasons.push('pull request closed');
        continue;
      }
      if (last && last.headSha === state.headSha) {
        reasons.push('same head commit, already reviewed');
        continue;
      }
      const waiting = arena ? await this.waiting(row, match, arena, state.headSha, saidAt, settings) : null;
      if (waiting) {
        reasons.push(waiting);
        continue;
      }
      due.push({ url, headSha: state.headSha, round: arena ? arena.round + 1 : 1 });
    }
    if (!due.length) return this.skip(row, reasons);
    const records: AutoReviewRecord[] = [];
    for (const pull of due) records.push(await this.deps.create({ prUrl: pull.url, headSha: pull.headSha, ticketKey: key, threadUrl: row.url, startedAt: this.deps.now(), round: pull.round }));
    try {
      const sessionId = await this.deps.openReview(key, reviewPrompt(key, due.map((pull) => pull.url), row.url));
      for (const record of records) await this.deps.update(record.id, { sessionId });
      return 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 300) : 'the session did not start';
      for (const record of records) await this.deps.update(record.id, { status: 'failed', detail, finishedAt: this.deps.now() });
      return this.skip(row, [`session did not start: ${detail}`]);
    }
  }

  /** Why an arena no longer reviews: approved, out of rounds, or a person wrote stop dock in the thread since the on it. */
  private closed(row: ThreadRow, arena: AutoReviewRecord, saidAt: number, settings: AutoReviewSettings): string | null {
    if (ARENA_DONE.includes(arena.status)) return 'arena closed: approved';
    if (arena.round >= settings.maxRounds) return `arena closed: ${settings.maxRounds} rounds`;
    if (row.messages.some((message) => Date.parse(message.at) > saidAt && saysStop(message))) return 'arena closed: stop dock';
    if (this.deps.now().getTime() - lastActivity(arena) > ON_IT_WINDOW_MS) return 'arena closed: 72 h without a new commit';
    return null;
  }

  /** When DOCK first saw a head commit; a commit date can be set to anything, the moment it showed up cannot. */
  private firstSeen(url: string, headSha: string): number {
    const key = `${url}@${headSha}`;
    const seen = this.seenHeads.get(key);
    if (seen !== undefined) return seen;
    const now = this.deps.now().getTime();
    this.seenHeads.set(key, now);
    if (this.seenHeads.size > SEEN_HEADS) this.seenHeads.delete(this.seenHeads.keys().next().value as string);
    return now;
  }

  /** Why a new head commit is not reviewed yet: 72 h went by without a commit, or the author may still be pushing. */
  private async waiting(row: ThreadRow, match: RegExpExecArray, arena: AutoReviewRecord, headSha: string, saidAt: number, settings: AutoReviewSettings): Promise<string | null> {
    const now = this.deps.now().getTime();
    const seen = this.firstSeen(match[0], headSha);
    const at = await this.deps.commitAt(match[1], match[2], headSha).catch(() => null);
    if (Math.max(at?.getTime() ?? 0, seen) - lastActivity(arena) > ON_IT_WINDOW_MS) return 'arena closed: 72 h without a new commit';
    const short = headSha.slice(0, 7);
    if (row.messages.some((message) => isFixReply(message, Math.max(saidAt, arena.startedAt.getTime())) && message.text.includes(short))) return null;
    if (at && now - at.getTime() >= settings.reReviewWaitMinutes * 60_000) return null;
    return `waiting for DOCK-FIX or ${settings.reReviewWaitMinutes} min after the last commit`;
  }

  /** Sends the posts that are due, unless the pull request closed, a person wrote stop dock or posting was turned off. */
  private async sendDue(rows: ThreadRow[], settings: AutoReviewSettings): Promise<void> {
    const due = await this.deps.duePosts(this.deps.now());
    if (!due.length) return;
    const owner = await this.deps.owner();
    for (const record of due) {
      try {
        await this.send(record, rows, settings, owner);
      } catch (error) {
        console.warn('[AutoReview] post failed:', error instanceof Error ? error.message : 'unknown error');
      }
    }
  }

  /** One due post: taken for sending first, so a Cancel or Edit after that is refused and nothing goes out twice. */
  private async send(record: AutoReviewRecord, rows: ThreadRow[], settings: AutoReviewSettings, owner: AutoReviewOwner): Promise<void> {
    const row = rows.find((item) => item.url === record.threadUrl);
    const stopped = row?.messages.some((message) => Date.parse(message.at) > record.startedAt.getTime() && saysStop(message));
    const match = PULL.exec(record.prUrl);
    const state = match ? await this.deps.pull(match[1], match[2], Number(match[3])).catch(() => null) : null;
    const cancel = !settings.post ? 'Posting is turned off' : stopped ? 'stop dock' : state && !state.open ? 'pull request closed' : null;
    if (cancel) {
      await this.deps.updatePending(record.id, { postStatus: 'cancelled', postDetail: cancel });
      return;
    }
    const threadId = threadIdOf(record.threadUrl);
    if (!owner.webhookUrl || !threadId) {
      await this.deps.updatePending(record.id, { postStatus: 'failed', postDetail: !owner.webhookUrl ? 'No Discord webhook in Settings' : 'Nothing to post to this thread' });
      return;
    }
    if (!(await this.deps.updatePending(record.id, { postStatus: 'sending' }))) return;
    try {
      const text = (await this.deps.get(record.id))?.postText;
      if (!text) throw new Error('Nothing to post to this thread');
      const messageId = await this.deps.postDiscord(owner.webhookUrl, text, { threadId, username: `${owner.name} (DOCK)` });
      await this.deps.update(record.id, { postStatus: 'sent', postMessageId: messageId, postDetail: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 300) : 'Discord refused the post';
      await this.deps.update(record.id, { postStatus: 'failed', postDetail: detail });
      await this.deps.push({ title: `${record.ticketKey}: review post failed`, body: detail, url: '/agents', tag: `auto-review-post-${record.id}` });
    }
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

  private async decide(run: Orchestration, first: AutoReviewRecord): Promise<void> {
    const blockers = (run.findings ?? []).filter((finding) => finding.severity === 'blocker' && !finding.resolvedAt).length;
    const clean = run.verdict === 'approve' && blockers === 0;
    // Taken off running first: the LGTM finishes the review run, which pushes its ledger through here again.
    await this.deps.update(first.id, { status: 'deciding' });
    const group = [first];
    for (let next = await this.deps.running(run.key); next && first.sessionId && next.sessionId === first.sessionId; next = await this.deps.running(run.key)) {
      await this.deps.update(next.id, { status: 'deciding' });
      group.push(next);
    }
    const finish = (status: string, detail: string) => Promise.all(group.map((item) => this.finish(item, status, detail)));
    const settings = await this.deps.settings();
    try {
      await this.schedule(run, group, settings);
    } catch (error) {
      const postDetail = error instanceof Error ? error.message.slice(0, 300) : 'The post could not be scheduled';
      await this.deps.update(first.id, { postStatus: 'failed', postDetail }).catch(() => undefined);
    }
    const url = '/agents';
    if (clean && settings.autoLgtm) {
      const ok = await this.deps.approve(run.key);
      await finish(ok ? 'lgtm' : 'clean', ok ? 'LGTM by DOCK' : 'Clean, but the LGTM steps failed; LGTM it on Agents');
      await this.deps.push({ title: ok ? `${run.key}: auto LGTM` : `${run.key}: LGTM failed`, body: ok ? 'The review was clean; DOCK sent the LGTM. Say it in the thread.' : 'The review was clean but a LGTM step failed. Open Agents.', url, tag: `auto-review-${first.id}` });
      return;
    }
    if (clean) {
      await finish('clean', 'Clean; waiting for your LGTM');
      await this.deps.push({ title: `${run.key}: review clean`, body: 'Approve verdict, no blocker. LGTM it on Agents.', url, tag: `auto-review-${first.id}` });
      return;
    }
    const detail = blockers > 0 ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : 'Request change';
    await finish('blockers', detail);
    if (first.round >= settings.maxRounds) {
      await this.deps.push({ title: `${run.key}: ${first.round} rounds, still ${detail}`, body: 'The arena is closed. Talk to the author, or say on it again for a new arena.', url, tag: `auto-review-${first.id}` });
      return;
    }
    await this.deps.push({ title: `${run.key}: ${detail}`, body: 'The auto review needs you. Open Agents.', url, tag: `auto-review-${first.id}` });
  }

  /** Keeps the verdict post of a round for later, so the owner can cancel or edit it before it goes out. */
  private async schedule(run: Orchestration, group: AutoReviewRecord[], settings: AutoReviewSettings): Promise<void> {
    const first = group[0];
    if (!settings.post || first.round > settings.maxRounds) return;
    const owner = await this.deps.owner();
    if (!owner.discordUserId) {
      await this.deps.update(first.id, { postStatus: 'skipped', postDetail: 'No Discord user id in Settings' });
      return;
    }
    const row = (await this.deps.rows()).find((item) => item.url === first.threadUrl);
    const postText = reviewPost(run, group.map((record) => ({ url: record.prUrl, headSha: record.headSha })), first.round, owner.discordUserId, answeredFindings(row?.messages ?? [], Date.parse(row?.ownClaim?.at ?? '') || 0));
    await this.deps.update(first.id, { postStatus: 'pending', postAt: new Date(this.deps.now().getTime() + settings.postDelayMinutes * 60_000), postText });
  }

  private finish(record: AutoReviewRecord, status: string, detail: string) {
    return this.deps.update(record.id, { status, detail, finishedAt: this.deps.now() });
  }
}
