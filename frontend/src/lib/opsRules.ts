/** Settings › Sous flow › Aturan: the rules kept as JSON in AppSettings, and the two that live in the cron config. */

export interface StatusAfterMerge { enabled: boolean; next: string; ignoreDocsSync: boolean; laptop: boolean }
export type WorktreeMode = 'notify' | 'auto' | 'off';
export interface WorktreeMerged { mode: WorktreeMode; days: number }
export type BlockedManualMode = 'tell' | 'stop' | 'off';
export interface CronRules { blockedManual: BlockedManualMode; stackedAllowed: boolean }

export const DEFAULT_STATUS_AFTER_MERGE: StatusAfterMerge = { enabled: true, next: 'UAT MERGED', ignoreDocsSync: true, laptop: false };
export const DEFAULT_WORKTREE_MERGED: WorktreeMerged = { mode: 'notify', days: 3 };
export const NEXT_STATUSES = ['UAT MERGED', 'UAT CHECK', 'READY FOR PRODUCTION'];

const object = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(json ?? '');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export function readStatusAfterMerge(json: string | null | undefined): StatusAfterMerge {
  const value = object(json);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_STATUS_AFTER_MERGE.enabled,
    next: typeof value.next === 'string' && value.next.trim() ? value.next : DEFAULT_STATUS_AFTER_MERGE.next,
    ignoreDocsSync: typeof value.ignoreDocsSync === 'boolean' ? value.ignoreDocsSync : DEFAULT_STATUS_AFTER_MERGE.ignoreDocsSync,
    laptop: typeof value.laptop === 'boolean' ? value.laptop : DEFAULT_STATUS_AFTER_MERGE.laptop,
  };
}

export function readWorktreeMerged(json: string | null | undefined): WorktreeMerged {
  const value = object(json);
  const mode = value.mode === 'auto' || value.mode === 'off' || value.mode === 'notify' ? value.mode : DEFAULT_WORKTREE_MERGED.mode;
  return { mode, days: Number.isInteger(value.days) ? Number(value.days) : DEFAULT_WORKTREE_MERGED.days };
}

export function readCronRules(configJson: string | null | undefined): CronRules {
  const value = object(configJson);
  const mode = value.blockedManual === 'stop' || value.blockedManual === 'off' ? value.blockedManual : 'tell';
  return { blockedManual: mode, stackedAllowed: value.stackedAllowed !== false };
}

/** The saved cron config with the Aturan fields changed and every other field as it was. */
export function withCronRules(configJson: string, rules: Partial<CronRules>): string {
  return JSON.stringify({ ...object(configJson), ...rules });
}
