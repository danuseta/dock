/** The QA queue page: rows as the qaQueue query returns them, the per-person filter, and how a wait reads. */

export type QaQueueKind = 'queue' | 'dependency' | 'escalated';

export interface QaQueueRow {
  position: number;
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  labels: string[];
  kind: QaQueueKind;
  waitsOn: string[];
  enteredAt: string | null;
  waitingMinutes: number | null;
}

export interface QaQueueMetrics { total: number; queue: number; dependency: number; escalated: number; averageWaitMinutes: number | null; oldestWaitMinutes: number | null }
export interface QaQueue { at: string; me: string | null; error: string | null; metrics: QaQueueMetrics; rows: QaQueueRow[]; capped: boolean; more: number | null }

export const QA_QUEUE_REFRESH_MS = 60_000;
export const EVERYONE = 'Semua';
export const UNASSIGNED = 'Belum ada';

/** The first name, the way the team calls each other; a leading initial ("M Danu Seta W") is skipped. */
export function shortName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return UNASSIGNED;
  return parts[0].length === 1 && parts[1] ? parts[1] : parts[0];
}

export function peopleOf(rows: QaQueueRow[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(shortName(row.assignee), (counts.get(shortName(row.assignee)) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The rows a person filter and "Punya saya" leave; "Punya saya" matches DOCK's Jira user by full name. */
export function filterQueue(rows: QaQueueRow[], who: string, mine: boolean, me: string | null): QaQueueRow[] {
  return rows.filter((row) => (who === EVERYONE || shortName(row.assignee) === who) && (!mine || (me !== null && row.assignee?.trim().toLowerCase() === me.trim().toLowerCase())));
}

export function formatWait(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The note under a queue the search stopped reading: "+n lagi", or "+ lagi" when Jira could not count the rest. */
export const moreText = (queue: Pick<QaQueue, 'capped' | 'more'>) => (!queue.capped ? null : queue.more !== null && queue.more > 0 ? `+${queue.more} lagi` : '+ lagi');

export const waitText = (row: Pick<QaQueueRow, 'waitsOn'>) => (row.waitsOn.length ? `Nunggu ${row.waitsOn.join(', ')}` : 'Nunggu dependency');
