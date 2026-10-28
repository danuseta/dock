export interface RetroNumbers {
  tickets: number;
  medianHours: number | null;
  fixRounds: number;
  replans: number;
  ownerIssues: number;
  medianOwnerWaitHours: number | null;
  reviews: number;
  requestChanges: number;
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
