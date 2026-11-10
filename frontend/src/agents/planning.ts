// The pure side of Agents > Sprint > Planning: shapes of the draft the BFF returns and what the panel derives from it.

export interface PlanningSprint { id: number; name: string; state: string; startDate: string | null; endDate: string | null }
export interface DraftDecision { action: string; note: string | null; by: string | null; at: string }
export interface QaPrediction { prediction: string; reasons: string[]; fix: string | null }
export interface StoryboardFlag { version: number; frames: string[]; held: boolean; checked: DraftDecision | null }
export interface DraftTc { id: string; ac: number; title: string; steps: string[]; expected: string }
export interface DraftTicket {
  key: string; summary: string; dev: string | null; jiraDev: string | null; sp: number | null;
  /** SP still to do by status once the sprint is under way; null before day 1 or on a published plan. */
  left?: number | null;
  wave: number; waveSet: boolean; status: string;
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
  loadedAt: string; publishedAt: string | null; qaReason: string | null; devs: string[]; blockers: string[]; canPublish: boolean; landed: number; today: number | null;
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
const DEV_COLOR_COUNT = 8;
const UNASSIGNED_COLOR = 'var(--color-muted-foreground)';
/** DOCK's calendar is +08:00, as on the sprint dashboard. */
const OFFSET_MS = 8 * 3_600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** The day a ticket lands on: a ticket ending at 2.5 lands on D3. */
export const dayOf = (end: number) => `D${Math.max(1, Math.ceil(end))}`;

/** The days the schedule spans: the sprint, or longer when backlog runs past it. */
export const spanOf = (draft: Pick<SprintDraft, 'sprintDays' | 'tickets'>) => Math.max(draft.sprintDays, Math.ceil(Math.max(0, ...draft.tickets.map((ticket) => ticket.end))));

/** Dates of the working days from day 1 on the +08:00 calendar: "Tue 27 Oct". Empty when the sprint has no start. */
export function workingDayLabels(startDate: string | null, count: number): string[] {
  const time = startDate ? Date.parse(startDate) : NaN;
  if (Number.isNaN(time)) return [];
  const labels: string[] = [];
  const day = new Date(time + OFFSET_MS);
  day.setUTCHours(0, 0, 0, 0);
  while (labels.length < count) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) labels.push(`${WEEKDAYS[weekday]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return labels;
}

const nameHash = (name: string) => [...name.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);

/**
 * A colour per developer from the --color-dev-N tokens: each name keeps its own slot, and when two names of the team
 * want the same slot the later one in name order takes the next free one, so the colour stays put while the team does.
 */
export function devColors(names: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  for (const name of [...new Set(names)].filter((name) => name !== UNASSIGNED).sort((a, b) => a.localeCompare(b))) {
    let slot = nameHash(name) % DEV_COLOR_COUNT;
    for (let tries = 0; taken.has(slot) && tries < DEV_COLOR_COUNT; tries++) slot = (slot + 1) % DEV_COLOR_COUNT;
    taken.add(slot);
    colors.set(name, `var(--color-dev-${slot + 1})`);
  }
  return colors;
}

/** A colour's soft fill for a card. */
export const softColor = (color: string) => `color-mix(in oklch, ${color} 16%, transparent)`;

export interface Lane { dev: string; color: string; sp: number; left: number; tickets: DraftTicket[]; backlog: number; inSprintSp: number; end: number }

/** One lane per developer, in the draft's order, and an Unassigned lane last when a ticket has no developer. */
export function lanes(draft: Pick<SprintDraft, 'devs' | 'tickets'>): Lane[] {
  const names = [...draft.devs, ...(draft.tickets.some((ticket) => !ticket.dev) ? [UNASSIGNED] : [])];
  const colors = devColors(draft.devs);
  return names.map((dev) => {
    const tickets = draft.tickets.filter((ticket) => (ticket.dev ?? UNASSIGNED) === dev).sort((a, b) => a.start - b.start || a.key.localeCompare(b.key, undefined, { numeric: true }));
    return {
      dev, color: colors.get(dev) ?? UNASSIGNED_COLOR, sp: sum(tickets.map((ticket) => ticket.sp)), left: sum(tickets.map((ticket) => ticket.left ?? ticket.sp)), tickets, backlog: tickets.filter((ticket) => !ticket.inSprint).length,
      inSprintSp: sum(tickets.filter((ticket) => ticket.inSprint).map((ticket) => ticket.sp)), end: Math.max(0, ...tickets.map((ticket) => ticket.end)),
    };
  });
}

/** Each ticket's place in its developer's order of work, 1-based: #3 is that person's third card. */
export function ranks(tickets: DraftTicket[]): Map<string, number> {
  const rank = new Map<string, number>();
  const next = new Map<string, number>();
  for (const ticket of [...tickets].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key, undefined, { numeric: true }))) {
    const lane = ticket.dev ?? UNASSIGNED;
    const value = (next.get(lane) ?? 0) + 1;
    next.set(lane, value);
    rank.set(ticket.key, value);
  }
  return rank;
}

/** The plan's tickets waiting on each ticket. */
export function waitersOf(tickets: DraftTicket[]): Map<string, DraftTicket[]> {
  const waiters = new Map<string, DraftTicket[]>();
  for (const ticket of tickets) for (const dep of ticket.dependsOn) waiters.set(dep, [...(waiters.get(dep) ?? []), ticket]);
  return waiters;
}

/** The unanswered questions of each ticket, from the planning chat. */
export function openQuestionsOf(questions: DraftQuestion[]): Map<string, DraftQuestion[]> {
  const open = new Map<string, DraftQuestion[]>();
  for (const question of questions) if (question.key && !question.answered) open.set(question.key, [...(open.get(question.key) ?? []), question]);
  return open;
}

export interface HandOff { from: string; fromDev: string; to: string; toDev: string; lands: number; float: number }

/**
 * A dependency finished by one developer that unblocks a ticket of another. Float is how many days the finishing
 * ticket can slip before the waiting one starts late: the waiting ticket's start minus the dependency's end.
 */
export function handOffs(tickets: DraftTicket[]): HandOff[] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const rows: HandOff[] = [];
  for (const ticket of tickets) {
    for (const dep of ticket.dependsOn) {
      const from = byKey.get(dep);
      if (!from || !from.dev || !ticket.dev || from.dev === ticket.dev) continue;
      rows.push({ from: from.key, fromDev: from.dev, to: ticket.key, toDev: ticket.dev, lands: from.end, float: Math.max(0, Math.round((ticket.start - from.end) * 1000) / 1000) });
    }
  }
  return rows.sort((a, b) => a.lands - b.lands || a.from.localeCompare(b.from, undefined, { numeric: true }) || a.to.localeCompare(b.to, undefined, { numeric: true }));
}

/** The numbers the team map opens with; developers, target and spread leave the Unassigned lane out. */
export function teamStats(draft: Pick<SprintDraft, 'devs' | 'tickets'>) {
  const named = lanes({ devs: draft.devs, tickets: draft.tickets.filter((ticket) => ticket.dev) });
  const sp = sum(draft.tickets.map((ticket) => ticket.sp));
  const inSprint = draft.tickets.filter((ticket) => ticket.inSprint);
  const loads = named.map((lane) => lane.sp);
  return {
    cards: draft.tickets.length, sp, devs: named.length, target: named.length ? Math.round((sp / named.length) * 10) / 10 : 0,
    landCards: inSprint.length, landSp: sum(inSprint.map((ticket) => ticket.sp)), spread: loads.length ? Math.max(...loads) - Math.min(...loads) : 0,
  };
}

/** The 1-based day a ticket ending at `end` lands on: ending at 2.5 lands on day 3, at 3 on day 3. */
export const landingDay = (end: number) => Math.max(1, Math.ceil(end - 1e-9));

/** True when the BFF counted the work left by status: an active sprint after day 1. */
export const underWay = (draft: Pick<SprintDraft, 'tickets'>) => draft.tickets.some((ticket) => ticket.left !== null && ticket.left !== undefined);

/** Working days the forecast lands after the due day: positive is late, negative early, 0 on time. */
export const lateDays = (dueDay: number, forecastDay: number) => forecastDay - dueDay;

/** "3 working days late", "on time" or "2 days early". */
export function lateText(late: number): string {
  if (late === 0) return 'on time';
  const n = Math.abs(late);
  return late > 0 ? `${n} working ${n === 1 ? 'day' : 'days'} late` : `${n} ${n === 1 ? 'day' : 'days'} early`;
}

export interface Forecast { due: number; day: number; end: number; late: number }

/** The sprint's due day, the day the last lane lands and how late that is, in working days of the plan. */
export function forecastOf(draft: Pick<SprintDraft, 'sprintDays' | 'tickets'>): Forecast {
  const end = Math.max(0, ...draft.tickets.map((ticket) => ticket.end));
  const day = landingDay(end);
  return { due: draft.sprintDays, day, end, late: lateDays(draft.sprintDays, day) };
}

/** "Wed 11 Nov" as "11 Nov". */
export const shortDate = (label: string) => label.replace(/^[A-Z][a-z]{2} /, '');

/** Where a bar sits on a lane, in percent of the span. */
export const barPlace = (ticket: Pick<DraftTicket, 'start' | 'dur'>, span: number) => ({
  left: `${(ticket.start / span) * 100}%`,
  width: `${(Math.max(ticket.dur, 0.25) / span) * 100}%`,
});

export interface WaveRow { wave: number; count: number; sp: number; closes: number; late: boolean; tickets: DraftTicket[] }

/** Each wave with its tickets and the day its last ticket lands; late when that is after the sprint. */
export function waveRows(draft: Pick<SprintDraft, 'sprintDays' | 'tickets'>): WaveRow[] {
  const waves = [...new Set(draft.tickets.map((ticket) => ticket.wave))].sort((a, b) => a - b);
  return waves.map((wave) => {
    const tickets = draft.tickets.filter((ticket) => ticket.wave === wave);
    const closes = Math.max(0, ...tickets.map((ticket) => ticket.end));
    return { wave, count: tickets.length, sp: sum(tickets.map((ticket) => ticket.sp)), closes, late: closes > draft.sprintDays, tickets };
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
