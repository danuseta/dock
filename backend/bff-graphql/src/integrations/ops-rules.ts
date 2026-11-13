// The Ops rules of Settings › Sous flow › Aturan that are not cron settings: what happens to a ticket after its pull
// requests merge, and what DOCK does with worktrees whose branch merged. Each is one AppSettings key holding JSON.

export class OpsRulesInputError extends Error {}

export const STATUS_AFTER_MERGE_KEY = 'statusAfterMerge';
export const WORKTREE_MERGED_KEY = 'worktreeMerged';

export interface StatusAfterMerge {
  /** Move the Jira status once every pull request of a ticket in PR Review merged. */
  enabled: boolean;
  /** The status the ticket moves to. */
  next: string;
  /** A docs-sync pull request the bot opens after a merge never holds the move. */
  ignoreDocsSync: boolean;
  /** The laptop DOCK moves tickets too; the workspace DOCK always does. */
  laptop: boolean;
}

export const WORKTREE_MODES = ['notify', 'auto', 'off'] as const;
export type WorktreeMode = typeof WORKTREE_MODES[number];

export interface WorktreeMerged {
  /** notify: listed on Workspace and Home, never deleted by DOCK; auto: merged ones older than `days` are removed; off: not checked. */
  mode: WorktreeMode;
  days: number;
}

export const DEFAULT_STATUS_AFTER_MERGE: StatusAfterMerge = { enabled: true, next: 'UAT MERGED', ignoreDocsSync: true, laptop: false };
export const DEFAULT_WORKTREE_MERGED: WorktreeMerged = { mode: 'notify', days: 3 };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function objectOf(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new OpsRulesInputError('The setting is not valid JSON'); }
  if (!isRecord(input)) throw new OpsRulesInputError('The setting must be an object');
  return input;
}

function flag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new OpsRulesInputError(`${name} must be true or false`);
  return value;
}

/** The saved rule with missing fields from the defaults; a wrong value is an error. */
export function parseStatusAfterMerge(raw: string | null | undefined): StatusAfterMerge {
  const merged = { ...DEFAULT_STATUS_AFTER_MERGE, ...objectOf(raw) };
  const next = typeof merged.next === 'string' ? merged.next.replace(/\s+/g, ' ').trim() : '';
  if (!next || next.length > 60) throw new OpsRulesInputError('next must be a Jira status name');
  return { enabled: flag(merged.enabled, 'enabled'), next, ignoreDocsSync: flag(merged.ignoreDocsSync, 'ignoreDocsSync'), laptop: flag(merged.laptop, 'laptop') };
}

export function parseWorktreeMerged(raw: string | null | undefined): WorktreeMerged {
  const merged = { ...DEFAULT_WORKTREE_MERGED, ...objectOf(raw) };
  if (!WORKTREE_MODES.includes(merged.mode as WorktreeMode)) throw new OpsRulesInputError(`mode must be one of ${WORKTREE_MODES.join(', ')}`);
  if (!Number.isInteger(merged.days) || Number(merged.days) < 1 || Number(merged.days) > 90) throw new OpsRulesInputError('days must be a whole number from 1 to 90');
  return { mode: merged.mode as WorktreeMode, days: Number(merged.days) };
}

/** A saved value that no longer parses falls back to the defaults, so a broken row never stops a tick. */
export function readStatusAfterMerge(raw: string | null | undefined): StatusAfterMerge {
  try { return parseStatusAfterMerge(raw); } catch { return DEFAULT_STATUS_AFTER_MERGE; }
}

export function readWorktreeMerged(raw: string | null | undefined): WorktreeMerged {
  try { return parseWorktreeMerged(raw); } catch { return DEFAULT_WORKTREE_MERGED; }
}
