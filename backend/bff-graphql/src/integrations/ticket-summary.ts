// The ticket summary ("Intinya") the planning agent writes once per sync through the ingest route sprint-draft/summary,
// and what the ticket detail and the board read to say whether a ticket is ready to work on. A summary is written for
// one AC: DOCK refuses a summary whose acHash is not the hash of the ticket's AC in the draft, so a stale one never
// lands. Nothing here is written to Jira.
import { SprintInputError } from './sprint-dashboard';
import { acAction, type DraftView } from './sprint-draft';

export const SUMMARY_CACHE = 'ticket-summary';
const STATUS_CACHE = 'ref-status';
const AC_CHANGED_CACHE = 'ac-changed';
const STATUS_TTL_SECONDS = 300;
const AC_CHANGED_TTL_SECONDS = 600;
const MAX_TEXT = 2000;
const MAX_LINES = 200;
const MAX_KEYS = 100;
const MAX_REFS = 200;
const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** In Indonesian: what it builds, what is checked here, what is not part of it, what it waits for, and before / after. */
export interface TicketSummary {
  key: string; acHash: string;
  made: string; checked: string; notHere: string; waitsOn: string[];
  before: string; after: string;
  /** One sentence for the board card. */
  line: string;
  /** The test data the ticket needs, null when the AC names none. */
  testData: string | null;
  /** The ticket changes a screen. */
  ui: boolean;
  /** One Indonesian line per AC line, in AC order. */
  acId: string[];
  titleId: string | null;
  writtenAt: string;
}
/** current: written for the AC the draft holds now. acChangedAt: when the AC field last changed in Jira, if known. */
export interface SummaryView extends TicketSummary { current: boolean; acChangedAt: string | null }

export interface ReadinessTicket { key: string; sprint: string | null; summary: SummaryView | null; tcApproved: boolean; decisions: Array<{ refKey: string; action: string }> }
export interface ReadinessFacts { tickets: ReadinessTicket[]; statuses: Array<{ key: string; status: string }> }

export interface SummaryStore {
  getCache(namespace: string, key: string): Promise<unknown>;
  upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): Promise<unknown>;
}

export interface SummaryDeps {
  store: SummaryStore;
  view(sprint: string): Promise<DraftView | null>;
  /** The sprint drafts holding any of the keys. */
  draftsWith(keys: string[]): Promise<string[]>;
  /** Jira status by key. */
  statusesOf(keys: string[]): Promise<Map<string, string>>;
  /** When the AC field of the ticket last changed in Jira; null when it never did. */
  acChangedAt?(key: string): Promise<string | null>;
  now?: () => Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(body: Record<string, unknown>, name: string, required = true): string | null {
  const value = body[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new SprintInputError(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new SprintInputError(`${name} must be a string`);
  const trimmed = value.trim().slice(0, MAX_TEXT);
  if (!trimmed && required) throw new SprintInputError(`${name} is required`);
  return trimmed || null;
}

function lines(body: Record<string, unknown>, name: string): string[] {
  const value = body[name] ?? [];
  if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) throw new SprintInputError(`${name} must be an array of strings`);
  if (value.length > MAX_LINES) throw new SprintInputError(`${name} holds at most ${MAX_LINES} lines`);
  return (value as string[]).map((line) => line.trim().slice(0, MAX_TEXT));
}

/** The summary as the route sends it; anything malformed is refused whole. */
export function parseSummary(input: unknown, now: Date): TicketSummary {
  const body = isRecord(input) ? input : {};
  const key = text(body, 'key')!.toUpperCase();
  if (!TICKET_KEY.test(key)) throw new SprintInputError('key must be a ticket key such as QRD-1312');
  const waitsOn = lines(body, 'waitsOn').map((item) => item.toUpperCase());
  if (waitsOn.some((item) => !TICKET_KEY.test(item))) throw new SprintInputError('waitsOn must list ticket keys');
  if (body.ui !== undefined && typeof body.ui !== 'boolean') throw new SprintInputError('ui must be true or false');
  return {
    key, acHash: text(body, 'acHash')!,
    made: text(body, 'made')!, checked: text(body, 'checked')!, notHere: text(body, 'notHere', false) ?? '', waitsOn: [...new Set(waitsOn)],
    before: text(body, 'before')!, after: text(body, 'after')!, line: text(body, 'line')!,
    testData: text(body, 'testData', false), ui: body.ui === true, acId: lines(body, 'acId'), titleId: text(body, 'titleId', false),
    writtenAt: now.toISOString(),
  };
}

const ticketOf = (view: DraftView, key: string) => view.tickets.find((ticket) => ticket.key === key) ?? null;

export class TicketSummaryService {
  constructor(private readonly deps: SummaryDeps) {}

  private now() { return (this.deps.now ?? (() => new Date()))(); }

  /** Stores the planning agent's summary of a draft ticket, refused when it was written for other AC lines. */
  async write(sprint: string, input: unknown): Promise<TicketSummary> {
    const summary = parseSummary(input, this.now());
    const view = await this.deps.view(sprint);
    if (!view) throw new SprintInputError(`No draft for ${sprint}; load it in Planning › Draft first`);
    const ticket = ticketOf(view, summary.key);
    if (!ticket) throw new SprintInputError(`${summary.key} is not in the ${sprint} draft`);
    if (ticket.acHash !== summary.acHash) throw new SprintInputError(`The AC of ${summary.key} changed since this summary was written (acHash ${ticket.acHash}); read the draft and write it again`);
    if (summary.acId.length && summary.acId.length !== ticket.ac.length) throw new SprintInputError(`acId must hold one line per AC line (${ticket.ac.length})`);
    await this.deps.store.upsertCache(SUMMARY_CACHE, summary.key, summary, 0);
    return summary;
  }

  async stored(key: string): Promise<TicketSummary | null> {
    const value = await this.deps.store.getCache(SUMMARY_CACHE, key.trim().toUpperCase()).catch(() => null);
    return isRecord(value) && typeof value.acHash === 'string' ? value as unknown as TicketSummary : null;
  }

  /** The acHash of every stored summary of the draft's tickets, for the agent to write only what is missing or stale. */
  async hashes(keys: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(keys.map(async (key) => [key, (await this.stored(key))?.acHash ?? null] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null));
  }

  /** The newest draft holding each key. */
  private async draftsOf(keys: string[]): Promise<Map<string, DraftView>> {
    const sprints = keys.length ? await this.deps.draftsWith(keys) : [];
    const views = (await Promise.all(sprints.map((sprint) => this.deps.view(sprint).catch(() => null)))).filter((view): view is DraftView => !!view);
    views.sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
    const result = new Map<string, DraftView>();
    for (const key of keys) {
      const view = views.find((item) => ticketOf(item, key));
      if (view) result.set(key, view);
    }
    return result;
  }

  private viewOf(summary: TicketSummary | null, draft: DraftView | undefined, acChangedAt: string | null): SummaryView | null {
    if (!summary) return null;
    const ticket = draft ? ticketOf(draft, summary.key) : null;
    return { ...summary, current: !ticket || ticket.acHash === summary.acHash, acChangedAt };
  }

  /** The summary for the ticket detail, with when the AC last changed in Jira. Null when none was written. */
  async summary(key: string): Promise<SummaryView | null> {
    const wanted = key.trim().toUpperCase();
    const stored = await this.stored(wanted);
    if (!stored) return null;
    const drafts = await this.draftsOf([wanted]);
    return this.viewOf(stored, drafts.get(wanted), await this.acChangedAt(wanted));
  }

  private async acChangedAt(key: string): Promise<string | null> {
    if (!this.deps.acChangedAt) return null;
    const cached = await this.deps.store.getCache(AC_CHANGED_CACHE, key).catch(() => null);
    if (isRecord(cached)) return typeof cached.at === 'string' ? cached.at : null;
    const at = await this.deps.acChangedAt(key).catch(() => undefined);
    if (at === undefined) return null;
    await this.deps.store.upsertCache(AC_CHANGED_CACHE, key, { at }, AC_CHANGED_TTL_SECONDS).catch(() => undefined);
    return at;
  }

  /** Jira statuses of the referenced tickets, read once for the whole board and kept a few minutes. */
  private async statuses(refs: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const missing: string[] = [];
    for (const key of refs) {
      const cached = await this.deps.store.getCache(STATUS_CACHE, key).catch(() => null);
      if (isRecord(cached) && typeof cached.status === 'string') result.set(key, cached.status);
      else missing.push(key);
    }
    if (missing.length) {
      const read = await this.deps.statusesOf(missing).catch(() => new Map<string, string>());
      for (const [key, status] of read) {
        result.set(key, status);
        await this.deps.store.upsertCache(STATUS_CACHE, key, { status }, STATUS_TTL_SECONDS).catch(() => undefined);
      }
    }
    return result;
  }

  /** What the readiness of each ticket needs beyond its Jira fields, for every card of the board in one call. */
  async readiness(keys: string[], refs: string[] = []): Promise<ReadinessFacts> {
    const wanted = [...new Set(keys.map((key) => key.trim().toUpperCase()).filter((key) => TICKET_KEY.test(key)))].slice(0, MAX_KEYS);
    const named = [...new Set(refs.map((key) => key.trim().toUpperCase()).filter((key) => TICKET_KEY.test(key)))].slice(0, MAX_REFS);
    const [drafts, statuses] = await Promise.all([this.draftsOf(wanted), this.statuses(named)]);
    const tickets = await Promise.all(wanted.map(async (key): Promise<ReadinessTicket> => {
      const draft = drafts.get(key);
      const ticket = draft ? ticketOf(draft, key) : null;
      const decisions = (draft?.findings ?? []).filter((finding) => finding.key === key && finding.decision)
        .map((finding) => ({ refKey: finding.refKey, action: acAction(finding.decision!.action) }));
      return { key, sprint: draft?.sprint ?? null, summary: this.viewOf(await this.stored(key), draft, null), tcApproved: !!ticket?.tcApproved, decisions };
    }));
    return { tickets, statuses: [...statuses].map(([key, status]) => ({ key, status })) };
  }
}

/** When the Acceptance Criteria field last changed, from the issue changelog (oldest first); null when it never did. */
export function acChangedFrom(histories: Array<{ created?: string; items?: Array<{ field?: string; fieldId?: string }> }>): string | null {
  const changed = histories.filter((history) => (history.items ?? []).some((item) => item.fieldId === 'customfield_10332' || item.field === 'Acceptance Criteria'));
  return changed.at(-1)?.created ?? null;
}
