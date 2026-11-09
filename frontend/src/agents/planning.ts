// The pure side of Agents > Sprint > Planning: shapes of the draft the BFF returns and what the panel derives from it.

export interface PlanningSprint { id: number; name: string; state: string; startDate: string | null; endDate: string | null }
export interface DraftDecision { action: string; note: string | null; by: string | null; at: string }
export interface QaPrediction { prediction: string; reasons: string[]; fix: string | null }
export interface StoryboardFlag { version: number; frames: string[]; held: boolean; checked: DraftDecision | null }
export interface DraftTc { id: string; ac: number; title: string; steps: string[]; expected: string }
export interface DraftTicket {
  key: string; summary: string; dev: string | null; jiraDev: string | null; sp: number | null; wave: number; waveSet: boolean; status: string;
  ac: string[]; dependsOn: string[]; start: number; dur: number; end: number; inSprint: boolean; split: number[] | null;
  prediction: QaPrediction | null; qaDecision: DraftDecision | null; epic: string | null; frames: string[]; storyboard: StoryboardFlag | null;
  tcs: DraftTc[]; tcStale: boolean; tcPending: boolean;
}
export interface StoryboardState {
  epic: string; version: number | null; previous: number | null; path: string | null; page: string | null; frames: number; changed: string[];
  changedAt: string | null; checkedAt: string; error: string | null;
}
export interface DraftFinding {
  id: string; key: string; line: number; text: string; refKey: string; kind: string; refEnd: number | null; ownEnd: number | null; decision: DraftDecision | null;
}
export interface SprintDraft {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: string | null; spPerDay: number; createdBy: string | null;
  loadedAt: string; publishedAt: string | null; qaReason: string | null; devs: string[]; blockers: string[]; canPublish: boolean; landed: number;
  tickets: DraftTicket[]; findings: DraftFinding[]; storyboards: StoryboardState[]; questions: DraftQuestion[];
}
export interface DraftQuestion { id: string; text: string; key: string | null; askedAt: string; answered: boolean; answeredBy: string | null; answeredAt: string | null }

/** The chat session Planning opens for a sprint; the planning agent and the kit find it by this title. */
export const planningChatTitle = (sprint: string) => `Planning-${sprint}`;

/** "3/9 answered", or null when the chat raised none. */
export function questionsLine(questions: DraftQuestion[]): string | null {
  if (!questions.length) return null;
  return `${questions.filter((question) => question.answered).length}/${questions.length} answered`;
}
export interface DraftChange { key: string; assigneeFrom: string | null; assigneeTo: string | null; acRemoved: string[]; acAdded: string[]; refused: string | null }
export interface PublishResult { key: string; kind: string; status: string; detail: string | null }

export type PlanningPanel = 'team' | 'scope' | 'ac' | 'qa' | 'tc' | 'storyboard';
export const UNASSIGNED = 'Unassigned';
const LANE_COLORS = ['--color-accent', '--color-status-merged', '--color-status-discord', '--color-status-warn', '--color-status-open', '--color-status-draft', '--color-status-conflict'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** The day a ticket lands on: a ticket ending at 2.5 lands on D3. */
export const dayOf = (end: number) => `D${Math.max(1, Math.ceil(end))}`;

/** The days the schedule spans: the sprint, or longer when backlog runs past it. */
export const spanOf = (draft: Pick<SprintDraft, 'sprintDays' | 'tickets'>) => Math.max(draft.sprintDays, Math.ceil(Math.max(0, ...draft.tickets.map((ticket) => ticket.end))));

/** Short dates of the working days from the sprint start: "27 Oct". Empty when the sprint has no start. */
export function workingDayLabels(startDate: string | null, count: number): string[] {
  const start = startDate ? new Date(startDate) : null;
  if (!start || Number.isNaN(start.getTime())) return [];
  const labels: string[] = [];
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (labels.length < count) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) labels.push(`${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return labels;
}

export interface Lane { dev: string; color: string; sp: number; tickets: DraftTicket[]; backlog: number }

/** One lane per developer, in the draft's order, and an Unassigned lane last when a ticket has no developer. */
export function lanes(draft: Pick<SprintDraft, 'devs' | 'tickets'>): Lane[] {
  const names = [...draft.devs, ...(draft.tickets.some((ticket) => !ticket.dev) ? [UNASSIGNED] : [])];
  return names.map((dev, index) => {
    const tickets = draft.tickets.filter((ticket) => (ticket.dev ?? UNASSIGNED) === dev).sort((a, b) => a.start - b.start);
    return { dev, color: `var(${LANE_COLORS[index % LANE_COLORS.length]})`, sp: sum(tickets.map((ticket) => ticket.sp)), tickets, backlog: tickets.filter((ticket) => !ticket.inSprint).length };
  });
}

/** Where a bar sits on a lane, in percent of the span. */
export const barPlace = (ticket: Pick<DraftTicket, 'start' | 'dur'>, span: number) => ({
  left: `${(ticket.start / span) * 100}%`,
  width: `${(Math.max(ticket.dur, 0.25) / span) * 100}%`,
});

export interface WaveRow { wave: number; count: number; sp: number; closes: number; late: boolean }

/** Each wave with the day its last ticket lands; late when that is after the sprint. */
export function waveRows(draft: Pick<SprintDraft, 'sprintDays' | 'tickets'>): WaveRow[] {
  const waves = [...new Set(draft.tickets.map((ticket) => ticket.wave))].sort((a, b) => a - b);
  return waves.map((wave) => {
    const tickets = draft.tickets.filter((ticket) => ticket.wave === wave);
    const closes = Math.max(0, ...tickets.map((ticket) => ticket.end));
    return { wave, count: tickets.length, sp: sum(tickets.map((ticket) => ticket.sp)), closes, late: closes > draft.sprintDays };
  });
}

export function scopeSummary(draft: Pick<SprintDraft, 'tickets'>) {
  const inSprint = draft.tickets.filter((ticket) => ticket.inSprint);
  const backlog = draft.tickets.filter((ticket) => !ticket.inSprint);
  return { inSprint: inSprint.length, inSprintSp: sum(inSprint.map((ticket) => ticket.sp)), backlog: backlog.length, backlogSp: sum(backlog.map((ticket) => ticket.sp)) };
}

export const findingKindLabel = (kind: string) => (kind === 'after-it' ? 'after it' : kind === 'lands-first' ? 'lands first' : 'outside plan');

export function decisionLabel(decision: DraftDecision | null, refKey?: string): string | null {
  if (!decision) return null;
  switch (decision.action) {
    case 'move': return refKey ? `Moved to ${refKey}` : 'Moved';
    case 'wait': return 'Kept, waits';
    case 'drop': return 'Dropped';
    case 'accept': return 'Risk accepted';
    case 'fix': return decision.note ? `Fixed: ${decision.note}` : 'Fixed';
    default: return decision.action;
  }
}

/** The tone of a QA chip: ok for LOLOS, conflict for ESCALATED, warn for REVISION-RISK. */
export const predictionTone = (prediction: string | null | undefined) => (prediction === 'LOLOS' ? 'ok' : prediction === 'ESCALATED' ? 'conflict' : prediction ? 'warn' : 'none');

/** Findings that need the planner, after-it first. */
export const sortFindings = (findings: DraftFinding[]) => [...findings].sort((a, b) => Number(b.kind === 'after-it') - Number(a.kind === 'after-it') || a.key.localeCompare(b.key, undefined, { numeric: true }) || a.line - b.line);

export function publishHint(draft: Pick<SprintDraft, 'canPublish' | 'blockers' | 'tickets'>): string {
  if (draft.tickets.length === 0) return 'No tickets in this sprint';
  if (draft.canPublish) return 'Every AC line and QA prediction that needs a call has one';
  const n = draft.blockers.length;
  return `${n} ${n === 1 ? 'item needs' : 'items need'} a decision before publish`;
}

export const changeCount = (changes: DraftChange[]) => changes.filter((change) => !change.refused).length;

/** A number input's text as a whole wave: 0 resets to the wave the dependencies give; null when it is not a whole number. */
export function parseWave(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 50 ? value : null;
}

/** The id a storyboard check is recorded under, as the BFF builds it. */
export const storyboardDecisionId = (key: string, version: number) => `sb|${key}|v${version}`;

/** One line on a storyboard: its version and what changed, or why there is none. */
export function storyboardLine(board: StoryboardState): string {
  if (board.error) return board.error;
  if (board.version === null) return 'Not read yet';
  const changed = board.previous === null ? 'first version saved' : board.changed.length ? `${board.changed.length} ${board.changed.length === 1 ? 'frame' : 'frames'} changed since v${board.previous}: ${board.changed.join(', ')}` : `no frame changed since v${board.previous}`;
  return `v${board.version} · ${board.frames} frames · ${changed}`;
}

/** Tickets whose AC needs a check after a storyboard change and nobody marked it checked. */
export const uncheckedStoryboard = (draft: Pick<SprintDraft, 'tickets'>) => draft.tickets.filter((ticket) => ticket.storyboard && !ticket.storyboard.checked);

/** Test cases as the planner edits them: "TC-1 · AC 2 · Title", "- step" lines, "Expected: ...", a blank line between. */
export function tcsToText(tcs: DraftTc[]): string {
  return tcs.map((tc) => [`${tc.id} · AC ${tc.ac} · ${tc.title}`, ...tc.steps.map((step) => `- ${step}`), `Expected: ${tc.expected}`].join('\n')).join('\n\n');
}

/** The text back into test cases; an error names the block that does not read. */
export function textToTcs(text: string): { tcs: DraftTc[]; error: string | null } {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const tcs: DraftTc[] = [];
  for (const [index, block] of blocks.entries()) {
    const [head, ...rest] = block.split('\n').map((line) => line.trim());
    const match = /^(TC-\d+)\s*[·|-]\s*AC\s*(\d+)\s*[·|-]\s*(.+)$/i.exec(head);
    if (!match) return { tcs, error: `Test case ${index + 1}: the first line reads "TC-1 · AC 1 · Title"` };
    const steps = rest.filter((line) => /^[-*]\s+/.test(line)).map((line) => line.replace(/^[-*]\s+/, ''));
    const expected = rest.filter((line) => !/^[-*]\s+/.test(line)).join(' ').replace(/^expected:\s*/i, '').trim();
    if (!expected) return { tcs, error: `${match[1].toUpperCase()}: add an "Expected: ..." line` };
    tcs.push({ id: match[1].toUpperCase(), ac: Number(match[2]), title: match[3].trim(), steps, expected });
  }
  return { tcs, error: null };
}
