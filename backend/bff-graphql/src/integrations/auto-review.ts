import { DISCORD_CLOSE, DISCORD_OPEN, parseDiscordBlock, threadIdOf, type DiscordPostFiles, type DiscordPostResult } from './discord-post';
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
/** The detail of a pending post whose body the review session still owes through its skill; the template text waits as the fallback. */
export const WAITING_SKILL = 'Waiting for the skill message';
/** How long past its time a post waits for the skill message before the template goes out instead. */
const SKILL_WAIT_MS = 15 * 60_000;
/** A post the session writes waits at least a minute, so the owner can read it before it goes out. */
const skillDelay = (settings: Pick<AutoReviewSettings, 'postDelayMinutes'>) => Math.max(1, settings.postDelayMinutes);
const PLACEHOLDER =/\{\{\s*(\w+)\s*\}\}/g;

export const REVIEW_POST_FORMATS = ['skill', 'template'] as const;
export const REVIEW_REPLY_FORMATS = ['builtin', 'skill', 'template'] as const;
export const SKILL_NAME = /^[a-z0-9][a-z0-9:_-]{0,60}$/;
export const MAX_TEMPLATE_CHARS = 2_000;
export const DEFAULT_REVIEW_SKILL = 'review-message';
export const DEFAULT_REVIEW_POST_TEMPLATE = 'mas {{author}}, {{status}}. {{lgtm}} catatan: {{notes}}';
export const DEFAULT_REVIEW_REPLY_TEMPLATE = 'mas {{author}}, {{status}} di {{sha}}. {{notes}}';
/** The Settings keys of the two Discord message formats: the review post and the reply after a fix. */
export const MESSAGE_KEYS = {
  post: { format: 'reviewPostFormat', skill: 'reviewPostSkill', template: 'reviewPostTemplate' },
  reply: { format: 'reviewReplyFormat', skill: 'reviewReplySkill', template: 'reviewReplyTemplate' },
} as const;
export interface MessageFormat { format: string; skill: string; template: string }

const isTemplate = (value: unknown) => typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEMPLATE_CHARS;

/** Whether a value fits a message format Settings key. */
export function isMessageSetting(key: string, value: unknown): boolean {
  if (key === 'reviewPostFormat') return (REVIEW_POST_FORMATS as readonly string[]).includes(String(value));
  if (key === 'reviewReplyFormat') return (REVIEW_REPLY_FORMATS as readonly string[]).includes(String(value));
  if (key === 'reviewPostSkill' || key === 'reviewReplySkill') return SKILL_NAME.test(String(value));
  return isTemplate(value);
}

/** A saved message format with its defaults; a value that no longer fits takes the default. */
export function messageFormat(kind: 'post' | 'reply', values: { get(key: string): string | null | undefined }): MessageFormat {
  const keys = MESSAGE_KEYS[kind];
  const saved = (key: string, fallback: string) => {
    const value = values.get(key);
    return value != null && isMessageSetting(key, value) ? value : fallback;
  };
  return {
    format: saved(keys.format, kind === 'post' ? 'skill' : 'builtin'),
    skill: saved(keys.skill, DEFAULT_REVIEW_SKILL),
    template: saved(keys.template, kind === 'post' ? DEFAULT_REVIEW_POST_TEMPLATE : DEFAULT_REVIEW_REPLY_TEMPLATE),
  };
}

/** A template with its placeholders filled; an unknown placeholder is left empty, and the spaces it leaves are folded. */
export const fillTemplate = (template: string, values: Record<string, string>) =>
  template.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '').split('\n').map((line) => line.replace(/[ \t]{2,}/g, ' ').trim()).join('\n').trim();

/** The lines asking a session to write a Discord message for DOCK to post, wrapped in the block DOCK reads. */
export const discordBlockLines = (key: string) => [
  `Bungkus pesannya persis di antara baris ${DISCORD_OPEN} dan ${DISCORD_CLOSE}. Di dalam blok, satu baris GAMBAR: <nama file> per gambar, nama file saja dari folder screenshots/ di blackboard ${key}, maksimal 10.`,
  'DOCK yang mem-post pesan itu ke thread setelah jeda; jangan post sendiri.',
];

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

export interface AutoReviewSettings { enabled: boolean; autoLgtm: boolean; post: boolean; postDelayMinutes: number; reReviewWaitMinutes: number; maxRounds: number; message: MessageFormat }
export interface PullState { open: boolean; headSha: string }
export interface AutoReviewRecord {
  id: string; prUrl: string; headSha: string; ticketKey: string; threadUrl: string; sessionId: string | null; status: string; detail: string | null; startedAt: Date; finishedAt: Date | null;
  round: number; postStatus: string | null; postAt: Date | null; postText: string | null; postMessageId: string | null; postDetail: string | null; postImages: string | null;
}
export interface AutoReviewUpdate {
  sessionId?: string | null; status?: string; detail?: string | null; finishedAt?: Date | null;
  postStatus?: string | null; postAt?: Date | null; postText?: string | null; postMessageId?: string | null; postDetail?: string | null; postImages?: string | null;
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
  /** Changes a post only while it is pending and still waiting for the skill message; false after an edit, a cancel or a send. */
  updateWaitingSkill(id: string, data: AutoReviewUpdate): Promise<boolean>;
  openReview(key: string, prompt: string): Promise<string>;
  /** The same steps as the LGTM button on the Agents page; true when every step went through. */
  approve(key: string): Promise<boolean>;
  push(message: PushMessage): Promise<unknown>;
  owner(): Promise<AutoReviewOwner>;
  /** Posts to a thread through the owner's webhook; the message id and the image names left out. */
  postDiscord(webhookUrl: string, content: string, options: { threadId: string; username: string; files?: DiscordPostFiles }): Promise<DiscordPostResult>;
  /** The text of the session's newest assistant message, or null. */
  newestReply(sessionId: string): Promise<string | null>;
  /** The names of the skills installed where the sessions read them. */
  skills(): Promise<string[]>;
  /** The folder a ticket's review screenshots are uploaded from; null when the key is not one of this DOCK's blackboard tickets. */
  imageRoot(key: string): Promise<string | null>;
  now(): Date;
}

/**
 * The prompt of an auto review: one sous review of every pull request of the ticket, with the thread as context. With a skill,
 * the session also writes the Discord message with it for DOCK to post; it never posts anything itself.
 */
export const reviewPrompt = (key: string, prUrls: string[], threadUrl: string, skill: string | null = null) => [
  `Pakai skill sous. review ${key}: ${prUrls.join(' ')}`,
  `Thread Discord pr-review: ${threadUrl} (baca dulu lewat discord-files.cjs).`,
  'Ini auto review dari DOCK karena owner bilang on it di thread itu. Jangan komentar di PR, Jira, atau Discord; tulis verdict dan temuan ke ledger seperti biasa.',
  ...(skill ? [`Setelah verdict tertulis di ledger, tulis pesan Discord hasil review pakai skill ${skill} sebagai bagian akhir balasanmu.`, ...discordBlockLines(key)] : []),
].join('\n');

/**
 * The line DOCK puts under every review it posts; teammates' DOCKs read the review through it, so no format changes it. The
 * verdict in it comes from the ledger, so a body a session wrote cannot misstate it.
 */
export const reviewMarker = (ownerId: string, round: number, sha: string, verdict = '') => `DOCK-REVIEW on it by <@${ownerId}> · round ${round} · @ ${sha.slice(0, 7)}${verdict ? ` · ${verdict}` : ''}`;

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Text as it goes out: a masked link shows as text, and a raw link stays a link without a preview. */
export const plainText = (text: string) => text.trim().replace(/\]\(/g, ']\u200B(').replace(/(?<!<)\bhttps?:\/\/[^\s<>()]+/g, (url) => `<${url}>`);

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

/** The open findings a post names: a finding the author already answered "tidak diubah karena" is left out. */
function reviewParts(run: ReviewLedger, answered: string[]) {
  const open = (run.findings ?? []).filter((finding) => !finding.resolvedAt);
  const posted = open.filter((finding) => {
    const text = normalized(finding.text);
    return text.length < MIN_ANSWERED_CHARS || !answered.some((answer) => answer.includes(text) && text.length * 2 >= answer.length);
  });
  return {
    blockers: posted.filter((finding) => finding.severity === 'blocker'),
    notes: posted.filter((finding) => finding.severity === 'non-blocking'),
    nits: open.filter((finding) => finding.severity === 'nit').length,
    clean: run.verdict === 'approve' && !open.some((finding) => finding.severity === 'blocker'),
  };
}

/** The verdict of the marker line, from the ledger: the label and every open blocker. */
export function markerVerdict(run: ReviewLedger): string {
  const { notes, clean } = reviewParts(run, []);
  const blockers = (run.findings ?? []).filter((finding) => !finding.resolvedAt && finding.severity === 'blocker').length;
  return `${clean ? (notes.length ? 'Approve with comments' : 'Approve') : 'Request change'} · ${blockers} blocker`;
}

/**
 * The DOCK default text of a review: the verdict, each pull request at its head, the open blockers and non-blocking findings
 * with their text, and only a count of nits. A finding the author already answered "tidak diubah karena" is left out.
 */
export function reviewBody(run: ReviewLedger, pulls: Array<{ url: string; headSha: string }>, answered: string[] = []): string {
  const { blockers, notes, nits, clean } = reviewParts(run, answered);
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
  withMarker(reviewBody(run, pulls, answered), reviewMarker(ownerId, round, pulls[0]?.headSha ?? '', markerVerdict(run)));

const numbered = (texts: string[]) => texts.map((text, index) => `${index + 1}) ${plainText(text)}`).join(' ');

/** The placeholders of the review template, from the ledger, the pull requests at their heads and the thread poster. */
export function reviewTemplateValues(run: ReviewLedger, pulls: Array<{ url: string; headSha: string }>, round: number, author: string, answered: string[] = []): Record<string, string> {
  const { blockers, notes, clean } = reviewParts(run, answered);
  return {
    author, ticket: run.key, round: String(round), sha: pulls[0]?.headSha.slice(0, 7) ?? '', pr: pulls.map((pull) => `<${pull.url}>`).join(' '),
    status: blockers.length ? `ada blocker ${blockers.length}` : 'gak ada blocker', lgtm: clean ? 'lgtm' : '',
    blockers: numbered(blockers.map((finding) => finding.text)), notes: numbered(notes.map((finding) => finding.text)),
  };
}

/** A person asking DOCK to stop in a thread; a DOCK post quoting it does not count. */
export const saysStop =(message: Pick<ThreadMessage, 'text'>) => STOP_DOCK.test(message.text) && !DOCK_POST.test(message.text);

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
    const detail = record.postDetail === WAITING_SKILL ? { postDetail: null, postImages: null } : {};
    if (!(await this.deps.updatePending(id, { postText: withMarker(text, marker), ...detail }))) throw new Error(NOT_PENDING);
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
      const sessionId = await this.deps.openReview(key, reviewPrompt(key, due.map((pull) => pull.url), row.url, await this.postSkill(settings)));
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
    if (record.postDetail === WAITING_SKILL && !(await this.takeSkillMessage(record, settings))) return;
    if (!(await this.deps.updatePending(record.id, { postStatus: 'sending' }))) return;
    try {
      const current = await this.deps.get(record.id);
      if (!current?.postText) throw new Error('Nothing to post to this thread');
      const names = current.postImages ? JSON.parse(current.postImages) as string[] : [];
      const root = names.length ? await this.deps.imageRoot(record.ticketKey) : null;
      const posted = await this.deps.postDiscord(owner.webhookUrl, current.postText, { threadId, username: `${owner.name} (DOCK)`, files: root ? { root, names } : undefined });
      const { id } = posted;
      const skipped = root ? posted.skipped : names;
      await this.deps.update(record.id, { postStatus: 'sent', postMessageId: id, postDetail: null });
      if (skipped.length) await this.deps.push({ title: `${record.ticketKey}: images left out of the review post`, body: skipped.join(', '), url: '/agents', tag: `auto-review-post-${record.id}` });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 300) : 'Discord refused the post';
      await this.deps.update(record.id, { postStatus: 'failed', postDetail: detail });
      await this.deps.push({ title: `${record.ticketKey}: review post failed`, body: detail, url: '/agents', tag: `auto-review-post-${record.id}` });
    }
  }

  /** The skill the review session writes the post with; null for the template, with posting off, or when the skill is not installed. */
  private async postSkill(settings: AutoReviewSettings): Promise<string | null> {
    if (!settings.post || settings.message.format !== 'skill') return null;
    const installed = await this.deps.skills().catch(() => [] as string[]);
    return installed.includes(settings.message.skill) ? settings.message.skill : null;
  }

  /**
   * Swaps the waiting template text for the message the review session wrote with its skill. With no message yet the post waits a
   * minute more, up to 15 min after the verdict; after that the template goes out and the owner is told. A message that arrives
   * waits the post delay again, at least a minute, so the owner reads it first. Each change is made only while the post still
   * waits for the skill, so an owner's edit is never overwritten and goes out as it is. False while it waits.
   */
  private async takeSkillMessage(record: AutoReviewRecord, settings: AutoReviewSettings): Promise<boolean> {
    const block = parseDiscordBlock(record.sessionId ? await this.deps.newestReply(record.sessionId) : null);
    const marker = record.postText?.split('\n').pop() ?? '';
    const now = this.deps.now().getTime();
    if (block) {
      const minutes = skillDelay(settings);
      const swapped = await this.deps.updateWaitingSkill(record.id, {
        postText: withMarker(plainText(block.body), marker), postImages: block.images.length ? JSON.stringify(block.images) : null, postDetail: null, postAt: new Date(now + minutes * 60_000),
      });
      if (!swapped) return true;
      await this.deps.push({ title: `${record.ticketKey}: review post ready, sends in ${minutes} min`, body: 'The review session wrote the Discord message. Cancel or edit it on Agents before then.', url: '/agents', tag: `auto-review-post-${record.id}` });
      return false;
    }
    if (now - (record.finishedAt ?? record.startedAt).getTime() < SKILL_WAIT_MS) return !(await this.deps.updateWaitingSkill(record.id, { postAt: new Date(now + 60_000) }));
    if (!(await this.deps.updateWaitingSkill(record.id, { postDetail: null }))) return true;
    await this.deps.push({ title: `${record.ticketKey}: no skill message, DOCK template posted`, body: 'The review session wrote no Discord block; the post uses the DOCK template.', url: '/agents', tag: `auto-review-post-${record.id}` });
    return true;
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
    const pulls = group.map((record) => ({ url: record.prUrl, headSha: record.headSha }));
    const answered = answeredFindings(row?.messages ?? [], Date.parse(row?.ownClaim?.at ?? '') || 0);
    const marker = reviewMarker(owner.discordUserId, first.round, pulls[0]?.headSha ?? '', markerVerdict(run));
    const template = () => withMarker(plainText(fillTemplate(settings.message.template, reviewTemplateValues(run, pulls, first.round, row?.createdBy ?? '', answered))), marker);
    const postAt = new Date(this.deps.now().getTime() + settings.postDelayMinutes * 60_000);
    if (settings.message.format === 'template') {
      await this.deps.update(first.id, { postStatus: 'pending', postAt, postText: template() });
      return;
    }
    if (!(await this.postSkill(settings))) {
      await this.deps.update(first.id, { postStatus: 'pending', postAt, postText: template() });
      await this.deps.push({ title: `${run.key}: skill ${settings.message.skill} not installed`, body: 'The review post uses the DOCK template.', url: '/agents', tag: `auto-review-post-${first.id}` });
      return;
    }
    await this.deps.update(first.id, { postStatus: 'pending', postAt: new Date(this.deps.now().getTime() + skillDelay(settings) * 60_000), postText: template(), postDetail: WAITING_SKILL });
  }

  private finish(record: AutoReviewRecord, status: string, detail: string) {
    return this.deps.update(record.id, { status, detail, finishedAt: this.deps.now() });
  }
}
