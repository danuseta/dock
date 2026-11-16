export interface RetroNumbers {
  tickets: number;
  medianHours: number | null;
  fixRounds: number;
  replans: number;
  ownerIssues: number;
  medianOwnerWaitHours: number | null;
  ownerWaitHours: number;
  reviews: number;
  requestChanges: number;
  blockedWaits: number;
  mergeConflicts: number;
  stackedRebases: number;
}
export interface RetroItem { id: string; kind: string; text: string; evidence: string[]; dest: string; status: string; sessionId: string | null; source?: string; updatedAt: string }
export interface RetroTicket { key: string; title: string; kind: string; hours: number | null; rounds: number; issues: number; findings: number; ownerWaitHours: number | null; result: string }
export interface Retro {
  sprint: string;
  sprintId: number;
  previous: string | null;
  numbers: RetroNumbers;
  previousNumbers: RetroNumbers | null;
  problems: Array<{ label: string; count: number; tickets: string[] }>;
  tickets: RetroTicket[];
  items: RetroItem[];
  escalations: RetroEscalations;
}

/** The numbers shown, in order, with their label and unit. */
export const RETRO_NUMBERS: Array<[keyof RetroNumbers, string, string]> = [
  ['tickets', 'tickets built by agents', ''],
  ['reviews', 'review', ''],
  ['fixRounds', 'fix rounds per ticket', ''],
  ['ownerIssues', 'escalations to you', ''],
  ['ownerWaitHours', 'total waiting on you', ' h'],
  ['medianHours', 'time to finish a ticket', ' h'],
  ['blockedWaits', 'waiting on another ticket', ''],
  ['mergeConflicts', 'PRs with merge conflicts', ''],
  ['stackedRebases', 'stacked rebase', ''],
  ['replans', 'replans per ticket', ''],
  ['requestChanges', 'reviews requesting changes', ''],
];

/** A number the Indonesian way: 1,7 not 1.7. */
export const idNumber = (value: number) => String(value).replace('.', ',');

/** The numbers worth a tile: a number that is zero or empty in this sprint and the one before says nothing. */
export function shownNumbers(now: RetroNumbers, before: RetroNumbers | null) {
  return RETRO_NUMBERS.filter(([field]) => !!now[field] || !!before?.[field]);
}

/** "8,5 di QRD Sprint 26", or null when there is no sprint before. */
export function beforeText(before: RetroNumbers | null, field: keyof RetroNumbers, unit: string, previous: string | null): string | null {
  if (!before || !previous) return null;
  const value = before[field];
  return `${value == null ? '—' : `${idNumber(value)}${unit}`} in ${previous}`;
}

const FAILURE_LABEL: Record<string, string> = { transient: 'Transient failure', defect: 'Failed on a defect', spec: 'Failed on the spec', env: 'Failed on the environment', permission: 'Failed on permissions' };

/** A recurring problem in Indonesian: "Failure: env" reads "Gagal karena environment". */
export function problemLabel(label: string): string {
  const [kind, value = ''] = label.split(': ');
  if (kind === 'Failure') return FAILURE_LABEL[value] ?? `Failed: ${value}`;
  if (kind === 'Review finding') return `Review finding ${value}`;
  if (kind === 'Escalated to the owner') return `${value} escalated to you`;
  return label;
}

export const SHOWN_PROBLEMS = 5;
const SHOWN_KEYS = 3;

/** The first three keys and how many more: "QRD-1, QRD-2, QRD-3 +4". */
export const keyList = (keys: string[]) => `${keys.slice(0, SHOWN_KEYS).join(', ')}${keys.length > SHOWN_KEYS ? ` +${keys.length - SHOWN_KEYS}` : ''}`;

const STAGE_LABEL: Record<string, string> = { done: 'done', pr: 'in PR', gate: 'at gate', build: 'building', verify: 'verifying', review: 'in review', parked: 'parked' };

/** A built ticket's state, with its hours once done: "selesai · 26,3 j". */
export const buildResult = (ticket: Pick<RetroTicket, 'result' | 'hours'>) => `${STAGE_LABEL[ticket.result] ?? ticket.result}${ticket.result === 'done' && ticket.hours != null ? ` · ${idNumber(ticket.hours)} h` : ''}`;

/** The folded line of a sprint's reviews: "5 review · semua approve · 20 temuan". */
export function reviewSummary(reviews: RetroTicket[]): string {
  const approved = reviews.filter((review) => review.result === 'approve').length;
  const verdict = approved === reviews.length ? 'all approved' : `${approved} approved, ${reviews.length - approved} other`;
  return `${reviews.length} reviews · ${verdict} · ${reviews.reduce((sum, review) => sum + review.findings, 0)} findings`;
}

export interface RetroEscalations {
  tickets: number; planned: boolean;
  causes: Array<{ cause: string; label: string; count: number; tickets: string[] }>;
  unpredicted: Array<{ key: string; summary: string; causes: string[]; prediction: string | null }>;
}

export const CAUSE_LABEL: Record<string, string> = { dependency: 'Waiting on another ticket', access: 'Access', data: 'Test data', environment: 'Environment', unspecified: 'No reason given' };

/** The bar width of a cause against the largest one, in percent. */
export const causeShare = (count: number, causes: Array<{ count: number }>) => Math.round((count / Math.max(1, ...causes.map((item) => item.count))) * 100);
