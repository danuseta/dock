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
}
export interface QaLocalRuns { available: boolean; hidden: number; rows: QaLocalRow[] }

export type QaLocalFilter = 'all' | 'running' | 'action' | 'lolos';

/** A run under way: tests going, or a QA session still preparing the stack and test cases. */
export const isLive = (row: Pick<QaLocalRow, 'run'>) => row.run.state === 'running' || row.run.state === 'preparing';

/** A run that needs the owner or the author: REVISION, ESCALATED, or a run whose process died. */
export const needsAction = (row: QaLocalRow) => row.run.state === 'failed' || (row.run.state === 'done' && (row.run.verdict === 'REVISION' || row.run.verdict === 'ESCALATED'));

export const matchesFilter = (row: QaLocalRow, filter: QaLocalFilter) =>
  filter === 'all' || (filter === 'running' ? isLive(row) : filter === 'action' ? needsAction(row) : row.run.state === 'done' && row.run.verdict === 'LOLOS');

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
