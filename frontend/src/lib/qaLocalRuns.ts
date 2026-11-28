import type { QaRun } from '../chat/qa';

export const MAX_FIX_ROUNDS = 2;

export interface QaLocalRow {
  key: string;
  title: string | null;
  jiraStatus: string | null;
  run: QaRun;
  runs: number;
  fixRound: number;
  fixSent: boolean;
  sessionId: string | null;
  fixResult?: string | null;
  sprint?: string | null;
}
export interface QaNotRunRow { key: string; title: string | null; jiraStatus: string | null; sprint: string | null; prs: number; openPrs: number }
export interface QaLocalRuns { available: boolean; hidden: number; rows: QaLocalRow[]; notRun: QaNotRunRow[] }

export type QaLocalFilter = 'all' | 'running' | 'action' | 'lolos' | 'notrun';

/** A row of the table: a ticket with a run, or one of the owner's tickets that never had one. */
export type QaQueueItem = { kind: 'run'; row: QaLocalRow } | { kind: 'notrun'; row: QaNotRunRow };

export const NO_SPRINT = 'No Sprint';
export const ALL_SPRINTS = 'all';
export const sprintOf = (sprint: string | null | undefined) => sprint?.trim() || NO_SPRINT;
const sprintNumber = (name: string) => Number(/(\d+)\s*$/.exec(name)?.[1] ?? -1);

/** Newest sprint first by its number, No Sprint last. */
export const compareSprints = (a: string, b: string) =>
  Number(a === NO_SPRINT) - Number(b === NO_SPRINT) || sprintNumber(b) - sprintNumber(a) || a.localeCompare(b);

/** Why Run QA is off for a ticket with no run, or null when it can start: only open or draft pull requests are tested here. */
export const notRunBlock = (row: Pick<QaNotRunRow, 'prs' | 'openPrs'>) => (row.openPrs > 0 ? null : row.prs > 0 ? 'PR merged' : 'No PR yet');

/** A run under way: tests going, or a QA session still preparing the stack and test cases. */
export const isLive = (row: Pick<QaLocalRow, 'run'>) => row.run.state === 'running' || row.run.state === 'preparing';

/** A run that needs the owner or the author: REVISION, ESCALATED, or a run whose process died. */
export const needsAction = (row: QaLocalRow) => row.run.state === 'failed' || (row.run.state === 'done' && (row.run.verdict === 'REVISION' || row.run.verdict === 'ESCALATED'));

export const matchesFilter = (row: QaLocalRow, filter: QaLocalFilter) =>
  filter === 'all' || (filter === 'running' ? isLive(row) : filter === 'action' ? needsAction(row) : filter === 'lolos' && row.run.state === 'done' && row.run.verdict === 'LOLOS');

export const itemMatches = (item: QaQueueItem, filter: QaLocalFilter) =>
  item.kind === 'notrun' ? filter === 'all' || filter === 'notrun' : filter !== 'notrun' && matchesFilter(item.row, filter);

const itemRank = (item: QaQueueItem) => (item.kind === 'notrun' ? 2 : isLive(item.row) ? 0 : needsAction(item.row) ? 1 : 3);

/**
 * Rows per sprint, newest sprint first. Inside a sprint: running, needs action, not run, then the rest, each in the order
 * the server gave (runs newest started first).
 */
export function sprintGroups(rows: QaLocalRow[], notRun: QaNotRunRow[]): Array<{ sprint: string; items: QaQueueItem[] }> {
  const items: QaQueueItem[] = [...rows.map((row) => ({ kind: 'run' as const, row })), ...notRun.map((row) => ({ kind: 'notrun' as const, row }))];
  const groups = new Map<string, QaQueueItem[]>();
  for (const item of items) {
    const name = sprintOf(item.row.sprint);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups.keys()].sort(compareSprints).map((sprint) => ({
    sprint,
    items: (groups.get(sprint) ?? []).map((item, index) => ({ item, index })).sort((a, b) => itemRank(a.item) - itemRank(b.item) || a.index - b.index).map(({ item }) => item),
  }));
}

export function qaLocalSummary(rows: QaLocalRow[]) {
  const done = rows.filter((row) => row.run.state === 'done');
  const minutes = done.map((row) => runMinutes(row.run)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return {
    running: rows.filter(isLive).length,
    lolos: done.filter((row) => row.run.verdict === 'LOLOS').length,
    revision: done.filter((row) => row.run.verdict === 'REVISION').length,
    escalated: done.filter((row) => row.run.verdict === 'ESCALATED').length,
    failed: rows.filter((row) => row.run.state === 'failed').length,
    medianMinutes: minutes.length ? minutes[Math.floor((minutes.length - 1) / 2)] : null,
  };
}

/** Minutes from start to finish, or to now while the run goes on; null without a start. */
export function runMinutes(run: Pick<QaRun, 'startedAt' | 'finishedAt' | 'updatedAt' | 'state'>, now = Date.now()): number | null {
  const start = Date.parse(run.startedAt ?? '');
  if (Number.isNaN(start)) return null;
  const endText = run.state === 'running' || run.state === 'preparing' ? null : run.finishedAt ?? run.updatedAt;
  const end = endText ? Date.parse(endText) : now;
  return Number.isNaN(end) ? null : Math.max(0, (end - start) / 60000);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

/** Run again is offered once a run has stopped; Send fix on a REVISION whose fix has not gone out. */
export const canRunAgain = (row: QaLocalRow) => !isLive(row);
export const canSendFix = (row: QaLocalRow) => row.run.state === 'done' && row.run.verdict === 'REVISION' && !row.fixSent;
/** Sending one more fix would go past the limit, so the owner confirms it first. */
export const fixPastLimit = (row: QaLocalRow) => row.fixRound >= MAX_FIX_ROUNDS;
