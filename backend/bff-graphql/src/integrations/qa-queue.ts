// The QA bot's queue, read from Jira: tickets in UAT CHECK, plus any the bot holds with QA-WAIT-DEPENDENCY, oldest in
// UAT CHECK first. QA-WAIT-DEPENDENCY rows name the tickets they wait on from their "is blocked by" links and are
// counted apart from ESCALATED. One JQL per minute at most, whatever the number of viewers.

import { labelCauses } from './retro';

export const QA_QUEUE_STATUS = 'UAT CHECK';
export const WAIT_DEPENDENCY_LABEL = 'QA-WAIT-DEPENDENCY';
export const QA_QUEUE_TTL_MS = 60 * 1000;
const PAGE_SIZE = 100;
/** The search stops here; the rest is counted, not read. */
export const QA_QUEUE_MAX_ROWS = 500;
const FIELDS = ['summary', 'status', 'assignee', 'labels', 'issuelinks', 'statuscategorychangedate', 'updated'];
/** Where a blocker no longer holds the QA bot: in UAT CHECK or past it. */
const PAST_UAT = new Set(['uat check', 'readyforproduction', 'ready for production', 'done / merged', 'done', 'closed']);

export type QaQueueKind = 'queue' | 'dependency' | 'escalated';

export interface QaQueueRow {
  position: number;
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  /** The QA bot's labels on the ticket (QA-*). */
  labels: string[];
  kind: QaQueueKind;
  /** The tickets a QA-WAIT-DEPENDENCY row waits on. */
  waitsOn: string[];
  enteredAt: string | null;
  waitingMinutes: number | null;
}

export interface QaQueueMetrics { total: number; queue: number; dependency: number; escalated: number; averageWaitMinutes: number | null; oldestWaitMinutes: number | null }

/** `more`: issues left unread when the search hit QA_QUEUE_MAX_ROWS; null when it did not, or the count failed while capped (-1). */
export interface QaQueue { at: string; me: string | null; rows: QaQueueRow[]; metrics: QaQueueMetrics; error: string | null; capped: boolean; more: number | null }

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

/** The bot finished testing (QA-DONE-PASSED and the like): the ticket waits for a human, not for the bot. */
export const isDoneLabel = (label: string) => /^QA[-_]DONE[-_]/i.test(label.trim()) && !/ESCALATED$/i.test(label.trim());

/** The time the issue last entered UAT CHECK from its changelog, else when its status category last changed. */
export function enteredUatAt(issue: any): string | null {
  let latest: string | null = null;
  for (const history of issue?.changelog?.histories || []) {
    const hit = (history.items || []).some((item: any) => item.field === 'status' && lower(item.toString) === lower(QA_QUEUE_STATUS));
    if (hit && typeof history.created === 'string' && (!latest || Date.parse(history.created) > Date.parse(latest))) latest = history.created;
  }
  if (latest) return latest;
  const fallback = issue?.fields?.statuscategorychangedate;
  return typeof fallback === 'string' && fallback ? fallback : null;
}

/** The "is blocked by" tickets of an issue still before UAT CHECK; all of them when none of their statuses came back. */
export function blockedByOpen(issueLinks: unknown): string[] {
  const blockers = (Array.isArray(issueLinks) ? issueLinks : []).flatMap((link: any) => {
    const type = link?.type;
    if (lower(type?.name) !== 'blocks' && lower(type?.inward) !== 'is blocked by') return [];
    return typeof link?.inwardIssue?.key === 'string' ? [{ key: link.inwardIssue.key as string, status: link.inwardIssue.fields?.status?.name as string | undefined }] : [];
  });
  const open = blockers.filter((blocker) => !blocker.status || !PAST_UAT.has(lower(blocker.status)));
  return [...new Set(open.map((blocker) => blocker.key))];
}

export function qaKind(labels: string[]): QaQueueKind {
  if (labels.some((label) => label.trim().toUpperCase() === WAIT_DEPENDENCY_LABEL)) return 'dependency';
  return labels.some((label) => labelCauses(label).length > 0) ? 'escalated' : 'queue';
}

const labelsOf = (issue: any): string[] => (Array.isArray(issue?.fields?.labels) ? issue.fields.labels : []).filter((label: unknown): label is string => typeof label === 'string');

/**
 * The queue as the page shows it: oldest in UAT CHECK first, a ticket with no time last by key. A ticket the bot is done
 * with (a QA-DONE-* label) is left out, unless it is also escalated: that one waits for a human and keeps its count.
 */
export function buildQaQueue(issues: any[], now: number, me: string | null = null, page: { capped: boolean; more: number | null } = { capped: false, more: null }): QaQueue {
  const waiting = issues.filter((issue) => {
    const labels = labelsOf(issue);
    return !labels.some(isDoneLabel) || qaKind(labels) === 'escalated';
  });
  const rows = waiting.map((issue) => {
    const fields = issue.fields || {};
    const qaLabels = labelsOf(issue).filter((label) => /^QA[-_]/i.test(label));
    const kind = qaKind(qaLabels);
    const enteredAt = enteredUatAt(issue);
    const since = enteredAt ? Date.parse(enteredAt) : Number.NaN;
    return {
      position: 0,
      key: String(issue.key),
      summary: String(fields.summary || issue.key),
      status: String(fields.status?.name || ''),
      assignee: typeof fields.assignee?.displayName === 'string' ? fields.assignee.displayName : null,
      labels: qaLabels,
      kind,
      waitsOn: kind === 'dependency' ? blockedByOpen(fields.issuelinks) : [],
      enteredAt,
      waitingMinutes: Number.isFinite(since) ? Math.max(0, Math.round((now - since) / 60000)) : null,
    } satisfies QaQueueRow;
  });
  const time = (row: QaQueueRow) => (row.enteredAt ? Date.parse(row.enteredAt) : Number.POSITIVE_INFINITY);
  rows.sort((a, b) => (time(a) - time(b)) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  rows.forEach((row, index) => { row.position = index + 1; });
  const waits = rows.map((row) => row.waitingMinutes).filter((value): value is number => value !== null);
  return {
    at: new Date(now).toISOString(),
    me,
    rows,
    metrics: {
      total: rows.length,
      queue: rows.filter((row) => row.kind === 'queue').length,
      dependency: rows.filter((row) => row.kind === 'dependency').length,
      escalated: rows.filter((row) => row.kind === 'escalated').length,
      averageWaitMinutes: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : null,
      oldestWaitMinutes: waits.length ? Math.max(...waits) : null,
    },
    error: null,
    capped: page.capped,
    more: page.more,
  };
}

export function qaQueueJql(projectKeys: string[]): string {
  const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`;
  const scope = projectKeys.length ? `project in (${projectKeys.map(quote).join(', ')}) AND ` : '';
  return `${scope}(status = ${quote(QA_QUEUE_STATUS)} OR (labels = ${quote(WAIT_DEPENDENCY_LABEL)} AND statusCategory != Done)) ORDER BY updated ASC`;
}

export interface QaQueueDeps {
  /** One page of the Jira search: the issues with FIELDS and their changelog, and the token of the next page. */
  search(jql: string, fields: string[], maxResults: number, nextPageToken?: string): Promise<{ issues: any[]; nextPageToken?: string | null }>;
  /** Jira's approximate count of the search, asked only when the read stopped at QA_QUEUE_MAX_ROWS. */
  count?(jql: string): Promise<number>;
  projectKeys(): Promise<string[]>;
  /** The display name of DOCK's Jira user, for "Punya saya". */
  me(): Promise<string | null>;
  now?(): number;
}

/**
 * The queue with a server cache: a read inside QA_QUEUE_TTL_MS of the last search gets that search, reads that arrive
 * while one runs share it, and a failed search keeps the last good queue with the error on it.
 */
export class QaQueueService {
  private last: { at: number; queue: QaQueue } | null = null;
  private running: Promise<QaQueue> | null = null;
  private me: string | null = null;

  constructor(private readonly deps: QaQueueDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }

  async queue(): Promise<QaQueue> {
    if (this.last && this.now() - this.last.at < QA_QUEUE_TTL_MS) return this.last.queue;
    if (!this.running) this.running = this.read().finally(() => { this.running = null; });
    return this.running;
  }

  /** The 1-based place of a ticket in the queue, or null when it is not in it. Never searches on its own. */
  async position(key: string): Promise<number | null> {
    const queue = await this.queue();
    return queue.rows.find((row) => row.key === key.trim().toUpperCase())?.position ?? null;
  }

  private async read(): Promise<QaQueue> {
    const started = this.now();
    try {
      if (!this.me) this.me = await this.deps.me().catch(() => null);
      const jql = qaQueueJql(await this.deps.projectKeys());
      const issues: any[] = [];
      let token: string | undefined;
      do {
        const page = await this.deps.search(jql, FIELDS, Math.min(PAGE_SIZE, QA_QUEUE_MAX_ROWS - issues.length), token);
        issues.push(...(page.issues || []));
        token = page.nextPageToken || undefined;
      } while (token && issues.length < QA_QUEUE_MAX_ROWS);
      const capped = Boolean(token);
      const more = capped ? (this.deps.count ? await this.deps.count(jql).then((total) => Math.max(0, total - issues.length), () => -1) : -1) : null;
      const queue = buildQaQueue(issues, started, this.me, { capped, more });
      this.last = { at: started, queue };
      return queue;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The Jira search failed';
      const queue = this.last ? { ...this.last.queue, error: message } : { ...buildQaQueue([], started, this.me), error: message };
      this.last = { at: started, queue };
      return queue;
    }
  }
}
