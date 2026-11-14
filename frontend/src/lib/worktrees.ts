/** The Worktrees tab on Workspace and the Home reminder: rows as the worktrees query returns them. */

export interface WorktreeRow {
  repo: string;
  path: string;
  branch: string | null;
  ticketKey: string | null;
  merge: string;
  pulls: string[];
  dirty: boolean;
  changes: string[];
  session: boolean;
  devServer: boolean;
  mergedSince: string | null;
  refusals: string[];
}

export interface WorktreeCleanResult { path: string; ok: boolean; output: string; at: string | null; by: string | null }
export interface WorktreeList { root: string; mode: 'notify' | 'auto' | 'off'; days: number; error: string | null; rows: WorktreeRow[]; history: WorktreeCleanResult[] }

export type WorktreeFilter = 'all' | 'merged' | 'open';

export const isMerged = (row: Pick<WorktreeRow, 'merge'>) => row.merge === 'merged';
/** Merged with nothing that refuses it: the rows "Bersihin yang merged" sends. */
export const cleanable = (row: Pick<WorktreeRow, 'merge' | 'refusals'>) => isMerged(row) && row.refusals.length === 0;

export function filterWorktrees(rows: WorktreeRow[], filter: WorktreeFilter): WorktreeRow[] {
  return rows.filter((row) => filter === 'all' || (filter === 'merged' ? isMerged(row) : !isMerged(row)));
}

/** The folder name under ROOT, for a short label. */
export const folderOf = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? path;

/** Home's daily line: merged worktrees still on disk, unless the rule is off. Null when there is nothing to say. */
export function reminderText(list: Pick<WorktreeList, 'mode' | 'rows'> | null | undefined): string | null {
  if (!list || list.mode === 'off') return null;
  const merged = list.rows.filter(isMerged);
  if (!merged.length) return null;
  const ready = merged.filter(cleanable).length;
  const waits = list.mode === 'auto' ? ' Mode auto bakal hapus yang udah lewat batas hari.' : '';
  return `${merged.length} worktree udah merged, ${ready} bisa dibersihin sekarang.${waits}`;
}
