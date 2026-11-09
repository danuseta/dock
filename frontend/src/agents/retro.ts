export interface RetroNumbers {
  tickets: number;
  medianHours: number | null;
  fixRounds: number;
  replans: number;
  ownerIssues: number;
  medianOwnerWaitHours: number | null;
  reviews: number;
  requestChanges: number;
  blockedWaits: number;
  mergeConflicts: number;
  stackedRebases: number;
}
export interface RetroItem { id: string; kind: string; text: string; evidence: string[]; dest: string; status: string; sessionId: string | null; updatedAt: string }
export interface Retro {
  sprint: string;
  sprintId: number;
  previous: string | null;
  numbers: RetroNumbers;
  previousNumbers: RetroNumbers | null;
  problems: Array<{ label: string; count: number; tickets: string[] }>;
  tickets: Array<{ key: string; title: string; kind: string; hours: number | null; rounds: number; issues: number; ownerWaitHours: number | null; result: string }>;
  items: RetroItem[];
  escalations: RetroEscalations;
}

/** The numbers shown, with their unit and which way is better. */
export const RETRO_NUMBERS: Array<[keyof RetroNumbers, string, string, 'up' | 'down' | null]> = [
  ['tickets', 'Tickets built by agents', '', null],
  ['medianHours', 'Median hours per ticket', ' h', 'down'],
  ['fixRounds', 'Fix rounds per ticket', '', 'down'],
  ['replans', 'Replans per ticket', '', 'down'],
  ['ownerIssues', 'Issues escalated to you', '', 'down'],
  ['medianOwnerWaitHours', 'Median wait on you', ' h', 'down'],
  ['reviews', 'Reviews done', '', null],
  ['requestChanges', 'Reviews asking for changes', '', null],
  ['blockedWaits', 'Tickets that waited on a dependency', '', 'down'],
  ['mergeConflicts', 'Pull requests with a merge conflict', '', 'down'],
  ['stackedRebases', 'Stacked rebases', '', 'down'],
];

/** "+1.2 vs before" and whether that is the better direction; null when there is nothing to compare. */
export function numberDelta(now: RetroNumbers, before: RetroNumbers | null, field: keyof RetroNumbers, better: 'up' | 'down' | null): { text: string; good: boolean } | null {
  const a = now[field];
  const b = before?.[field];
  if (a == null || b == null) return null;
  const diff = Math.round((a - b) * 10) / 10;
  if (diff === 0) return { text: 'same as before', good: false };
  return { text: `${diff > 0 ? '+' : ''}${diff} vs before`, good: better !== null && (better === 'up' ? diff > 0 : diff < 0) };
}

export interface RetroEscalations {
  tickets: number; planned: boolean;
  causes: Array<{ cause: string; label: string; count: number; tickets: string[] }>;
  unpredicted: Array<{ key: string; summary: string; causes: string[]; prediction: string | null }>;
}

/** The bar width of a cause against the largest one, in percent. */
export const causeShare = (count: number, causes: Array<{ count: number }>) => Math.round((count / Math.max(1, ...causes.map((item) => item.count))) * 100);
