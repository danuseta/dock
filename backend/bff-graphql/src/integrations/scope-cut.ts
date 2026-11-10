// The per-developer schedule of a sprint draft, the algorithm the Sprint 26 plan was made with: wave first, then the
// ticket that unblocks the most, each ticket after its dependencies and after the developer's previous ticket.
// Days are working days from the sprint start; a ticket that ends past the last day is backlog.

export interface ScopeTicket {
  key: string;
  dev: string | null;
  sp: number | null;
  /** SP still to do, which sets the ticket's days on the lane; the full SP when left out. */
  left?: number | null;
  /** 1 for a ticket with no dependency in the plan; null computes it from the dependencies. */
  wave?: number | null;
  /** Keys of the plan's tickets this one waits for; keys outside the plan are ignored. */
  dependsOn: string[];
}

export interface ScheduledTicket {
  key: string;
  dev: string | null;
  wave: number;
  start: number;
  dur: number;
  end: number;
  inSprint: boolean;
  /** Parts of at most SPLIT_PART_SP each, for a ticket of SPLIT_FROM_SP or more; null otherwise. */
  split: number[] | null;
}

export const DEFAULT_SP_PER_DAY = 2;
export const DEFAULT_SPRINT_DAYS = 10;
export const SPLIT_FROM_SP = 5;
const SPLIT_PART_SP = 3;
const UNASSIGNED = '';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Each ticket's wave: 1 plus the highest wave among its dependencies in the plan. A loop is cut where it closes. */
export function computeWaves(tickets: ScopeTicket[]): Map<string, number> {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const waves = new Map<string, number>();
  const visiting = new Set<string>();
  const waveOf = (key: string): number => {
    const known = waves.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    const deps = (byKey.get(key)?.dependsOn || []).filter((dep) => byKey.has(dep));
    const wave = 1 + Math.max(0, ...deps.map(waveOf));
    visiting.delete(key);
    waves.set(key, wave);
    return wave;
  };
  for (const ticket of tickets) waveOf(ticket.key);
  return waves;
}

/** How many plan tickets wait on this one, directly or through another. */
function downstreamCounts(tickets: ScopeTicket[]): Map<string, number> {
  const keys = new Set(tickets.map((ticket) => ticket.key));
  const children = new Map<string, string[]>();
  for (const ticket of tickets) {
    for (const dep of ticket.dependsOn) if (keys.has(dep)) children.set(dep, [...(children.get(dep) || []), ticket.key]);
  }
  const counts = new Map<string, number>();
  for (const key of keys) {
    const seen = new Set<string>();
    const stack = [...(children.get(key) || [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (next === key || seen.has(next)) continue;
      seen.add(next);
      stack.push(...(children.get(next) || []));
    }
    counts.set(key, seen.size);
  }
  return counts;
}

/** Half a working day: what a ticket in review or in a UAT bug round still needs. */
const REVIEW_DAYS_LEFT = 0.5;
const letters = (status: string | null | undefined) => String(status ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * SP still to do on an open ticket of a sprint already under way, by its Jira status compared letters only: PR Review
 * and UAT BUG / Improvement need half a day, In Progress half its SP, To Do and anything else all of it. Null without SP.
 */
export function remainingSp(sp: number | null, status: string | null | undefined, spPerDay = DEFAULT_SP_PER_DAY): number | null {
  if (sp === null || !Number.isFinite(sp)) return null;
  const full = Math.max(0, sp);
  switch (letters(status)) {
    case 'prreview':
    case 'uatbugimprovement':
      return round(Math.min(full, REVIEW_DAYS_LEFT * (spPerDay > 0 ? spPerDay : DEFAULT_SP_PER_DAY)));
    case 'inprogress':
      return round(full / 2);
    default:
      return full;
  }
}

export function splitParts(sp: number | null): number[] | null {
  if (sp === null || sp < SPLIT_FROM_SP) return null;
  const parts: number[] = [];
  for (let rest = sp; rest > 0; rest = round(rest - SPLIT_PART_SP)) parts.push(Math.min(SPLIT_PART_SP, rest));
  return parts;
}

/**
 * Lays every ticket on its developer's lane. Order per developer: wave, then the ticket more tickets wait on, then the
 * larger one, then the key. A ticket starts when its developer is free and every dependency in the plan has ended.
 */
export function scheduleSprint(tickets: ScopeTicket[], options: { sprintDays?: number; spPerDay?: number; from?: number } = {}): ScheduledTicket[] {
  const sprintDays = options.sprintDays && options.sprintDays > 0 ? options.sprintDays : DEFAULT_SPRINT_DAYS;
  const spPerDay = options.spPerDay && options.spPerDay > 0 ? options.spPerDay : DEFAULT_SP_PER_DAY;
  const from = options.from && options.from > 0 ? options.from : 0;
  const computed = computeWaves(tickets);
  const waveOf = (ticket: ScopeTicket) => (ticket.wave && ticket.wave > 0 ? ticket.wave : computed.get(ticket.key) || 1);
  const downstream = downstreamCounts(tickets);
  const keys = new Set(tickets.map((ticket) => ticket.key));
  const order = [...tickets].sort((a, b) => waveOf(a) - waveOf(b)
    || (downstream.get(b.key) || 0) - (downstream.get(a.key) || 0)
    || (b.sp || 0) - (a.sp || 0)
    || a.key.localeCompare(b.key, undefined, { numeric: true }));

  const ends = new Map<string, number>();
  const free = new Map<string, number>();
  const placed = new Map<string, ScheduledTicket>();
  const queues = new Map<string, ScopeTicket[]>();
  for (const ticket of order) queues.set(ticket.dev || UNASSIGNED, [...(queues.get(ticket.dev || UNASSIGNED) || []), ticket]);
  const rank = new Map(order.map((ticket, index) => [ticket.key, index]));
  const ready = (ticket: ScopeTicket) => ticket.dependsOn.every((dep) => !keys.has(dep) || ends.has(dep) || dep === ticket.key);
  // Each lane keeps its order; the next ticket placed is the earliest lane head whose dependencies are placed.
  // A dependency loop, or a wave set below a dependency's, places the earliest head anyway.
  for (let left = order.length; left > 0; left--) {
    const heads = [...queues.values()].filter((queue) => queue.length).map((queue) => queue[0]).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
    const ticket = heads.find(ready) || heads[0];
    const lane = ticket.dev || UNASSIGNED;
    queues.get(lane)!.shift();
    const depsEnd = Math.max(0, ...ticket.dependsOn.map((dep) => ends.get(dep) ?? 0));
    const start = round(Math.max(free.get(lane) ?? from, depsEnd, from));
    const work = ticket.left ?? ticket.sp;
    const dur = round((work && work > 0 ? work : 0) / spPerDay);
    const end = round(start + dur);
    ends.set(ticket.key, end);
    free.set(lane, end);
    placed.set(ticket.key, { key: ticket.key, dev: ticket.dev, wave: waveOf(ticket), start, dur, end, inSprint: end <= sprintDays, split: splitParts(ticket.sp) });
  }
  return order.map((ticket) => placed.get(ticket.key)!);
}

/** DOCK's calendar is +08:00, as on the sprint dashboard: a day starts at 00:00 +08:00. */
export const CALENDAR_OFFSET_HOURS = 8;
const DAY_MS = 86_400_000;
const OFFSET_MS = CALENDAR_OFFSET_HOURS * 3_600_000;
/** How long after the previous sprint's end a late Start sprint click still counts from the day after that end. */
const LATE_START_DAYS = 4;

/** The +08:00 calendar day of an instant, as a day number (days since 1970-01-01). */
const calendarDay = (time: number) => Math.floor((time + OFFSET_MS) / DAY_MS);
const isWorkingDay = (day: number) => { const weekday = new Date(day * DAY_MS).getUTCDay(); return weekday !== 0 && weekday !== 6; };
const nextWorkingDay = (day: number) => { let next = day; while (!isWorkingDay(next)) next++; return next; };
const readTime = (value: string | null | undefined) => { const time = value ? Date.parse(value) : NaN; return Number.isNaN(time) ? null : time; };

/** Working days (Monday to Friday) on the +08:00 calendar from start to end, both included; null when either date is missing or unreadable. */
export function workingDays(startDate: string | null | undefined, endDate: string | null | undefined): number | null {
  const start = readTime(startDate);
  const end = readTime(endDate);
  if (start === null || end === null || end < start) return null;
  let count = 0;
  for (let day = calendarDay(start), last = calendarDay(end); day <= last; day++) if (isWorkingDay(day)) count++;
  return count || null;
}

/**
 * Day 1 of a sprint, as 00:00 +08:00 of that day. Jira's startDate is when someone pressed Start sprint, often the
 * morning after the previous sprint closed; the plan's day 1 is the first working day after the previous sprint's end
 * when that is earlier and at most a few days before the click. Null when the sprint has no start.
 */
export function planStart(startDate: string | null | undefined, previousEnd?: string | null): string | null {
  const start = readTime(startDate);
  if (start === null) return null;
  let day = nextWorkingDay(calendarDay(start));
  const end = readTime(previousEnd);
  if (end !== null) {
    const after = nextWorkingDay(calendarDay(end) + 1);
    if (after < day && day - after <= LATE_START_DAYS) day = after;
  }
  return new Date(day * DAY_MS - OFFSET_MS).toISOString();
}

/** The working day `now` falls on, counted from day 1 of the plan, 1-based; a weekend counts as the Monday after, or the Friday before when rollWeekend is false. Null before day 1. */
export function workingDayOf(startDate: string | null | undefined, now: Date, rollWeekend = true): number | null {
  const start = readTime(startDate);
  if (start === null || now.getTime() < start) return null;
  const first = calendarDay(start);
  const today = rollWeekend ? nextWorkingDay(calendarDay(now.getTime())) : calendarDay(now.getTime());
  let count = 0;
  for (let day = first; day <= today; day++) if (isWorkingDay(day)) count++;
  return count || null;
}
