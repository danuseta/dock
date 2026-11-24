export interface KitMergeConflict { path: string; kitNew: string; reason: string; at: string }
export interface KitMergeReport {
  machine: string;
  at: string | null;
  receivedAt: string;
  merged: Array<{ path: string; at: string }>;
  kept: Array<{ path: string; at: string }>;
  conflicts: KitMergeConflict[];
}
export interface KitConflictFile { path: string; local: string | null; kit: string; base: string | null; merged: string | null; clean: boolean }
export type KitConflictAction = 'local' | 'kit' | 'edit';

/** One row per open conflict, the chat machine's first; only those can be settled from here (Guild Master writes run there). */
export function openConflicts(reports: KitMergeReport[], chatMachine: string) {
  return [...reports]
    .sort((a, b) => Number(b.machine === chatMachine) - Number(a.machine === chatMachine) || a.machine.localeCompare(b.machine))
    .flatMap((report) => report.conflicts.map((conflict) => ({ ...conflict, machine: report.machine, actionable: report.machine === chatMachine })));
}

/** review-message for skills/review-message/SKILL.md, agent sous-verifier for agents/sous-verifier.md, else the path itself. */
export function conflictName(path: string): string {
  const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
  if (skill) return skill[1];
  const agent = /^agents\/([^/]+)\.md$/.exec(path);
  return agent ? `agent ${agent[1]}` : path.replace(/^skills\//, '');
}

export const hasConflictMarkers = (text: string) => /^(<{7}|>{7}) /m.test(text) || /^={7}$/m.test(text);

/** What the merge editor starts with: git's merge with conflict markers when there is one, else the local file. */
export const mergeStart = (file: KitConflictFile) => file.merged ?? file.local ?? file.kit;

/** Why the merged text cannot be saved yet, or null. */
export function mergeProblem(text: string): string | null {
  if (!text.trim()) return 'The merged file is empty';
  if (hasConflictMarkers(text)) return 'Remove every <<<<<<<, ======= and >>>>>>> line first';
  if (new TextEncoder().encode(text).length > 100 * 1024) return 'The file may be at most 100 KB';
  return null;
}
