import type { PushMessage } from './push';
import { stalledNotice, waitingNotice } from './push-notices';
import { isSettledStatus } from './attention';
import { REVIEW_STATUS } from './broadcast-review';
import { ticketSessionTitle } from './session-titles';

export class CronInputError extends Error {}

export const CRON_MODES = ['auto', 'acceptEdits', 'manual'] as const;
export type CronMode = typeof CRON_MODES[number];
/** sous: the session runs the sous skill to a pull request; omc: the older build-ticket prompt that stops before the PR. */
export const CRON_ENGINES = ['sous', 'omc'] as const;
export type CronEngine = typeof CRON_ENGINES[number];

export interface CronSettings {
  enabled: boolean;
  machine: string;
  /** "Agents at once": cron tickets with a running turn, manual chats not counted. */
  parallel: number;
  /** Work window in WIB: new tickets are taken only when workStart <= hour < workEnd, on a work day, inside the active dates. */
  workStart: number;
  workEnd: number;
  /** 1 = Monday ... 7 = Sunday. */
  workDays: number[];
  activeFrom: string | null;
  activeUntil: string | null;
  /** New tickets started per WIB day; the same number caps the tickets parked per day. */
  maxPerDay: number;
  /** Null follows the chat default permission mode in System Settings. */
  mode: CronMode | null;
  /** Epic key → the base branch its tickets open their pull request against. */
  sprint: 'active' | 'any';
  labels: string[];
  todoStatuses: string[];
  inProgressStatus: string;
  model: string | null;
  effort: string | null;
  usageBrakePercent: number;
  engine: CronEngine;
}

export const DEFAULT_CRON_SETTINGS: CronSettings = {
  enabled: false,
  machine: 'workspace',
  parallel: 2,
  workStart: 9,
  workEnd: 17,
  workDays: [1, 2, 3, 4, 5],
  activeFrom: null,
  activeUntil: null,
  maxPerDay: 6,
  mode: null,
  sprint: 'active',
  labels: [],
  todoStatuses: ['To Do'],
  inProgressStatus: 'In Progress',
  model: null,
  effort: null,
  usageBrakePercent: 70,
  engine: 'sous',
};

const CONFIG_KEY = 'orchestratorCronConfig';
const CACHE = 'orchestrator-cron';
const TICK_MS = 60 * 1000;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const MAX_DEFERRED_LOGGED = 30;
/** The bridge's name for each cron mode. */
const BRIDGE_MODE: Record<CronMode, string> = { auto: 'auto', acceptEdits: 'acceptEdits', manual: 'default' };

export const PARKED_TEXT = 'No acceptance criteria on the ticket. Confirm to start anyway, or fill them in.';
export const START_FAILED_TEXT = 'The cron session ended before the agent answered. Fix the machine, then retry.';
export const PR_GATE_TEXT = "Ready for review: waiting for the owner";
export const MAX_RESUMES = 3;
export const RESUME_GAVE_UP_TEXT = `Stalled again after ${MAX_RESUMES} resumes by the cron. Look at the session and continue it by hand.`;

function ownerText(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || text.length > MAX_OWNER_TEXT) throw new CronInputError(`The text needs between 1 and ${MAX_OWNER_TEXT} characters`);
  return text;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new CronInputError(`${name} must be a whole number from ${min} to ${max}`);
  return Number(value);
}

function words(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new CronInputError(`${name} must be a list of text`);
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
}

function optionalDate(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new CronInputError(`${name} must be a date YYYY-MM-DD`);
  return value;
}

function optionalWord(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 80) throw new CronInputError(`${name} must be text`);
  return value.trim();
}

/** The saved config with every missing field filled from the defaults; a wrong value is an error, not a silent default. Keys from v1 are ignored. */
export function parseCronSettings(raw: string | null | undefined): CronSettings {
  if (!raw) return DEFAULT_CRON_SETTINGS;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new CronInputError('The config is not valid JSON'); }
  if (!isRecord(input)) throw new CronInputError('The config must be an object');
  const merged = { ...DEFAULT_CRON_SETTINGS, ...input };
  if (typeof merged.enabled !== 'boolean') throw new CronInputError('enabled must be true or false');
  const machine = typeof merged.machine === 'string' ? merged.machine.trim() : '';
  if (!machine) throw new CronInputError('machine is required');
  const workStart = integer(merged.workStart, 'workStart', 0, 23);
  const workEnd = integer(merged.workEnd, 'workEnd', 1, 24);
  if (workStart >= workEnd) throw new CronInputError('workStart must be before workEnd');
  if (!Array.isArray(merged.workDays) || merged.workDays.length === 0) throw new CronInputError('workDays needs at least one day');
  const workDays = [...new Set(merged.workDays.map((day) => integer(day, 'workDays', 1, 7)))].sort((a, b) => a - b);
  const activeFrom = optionalDate(merged.activeFrom, 'activeFrom');
  const activeUntil = optionalDate(merged.activeUntil, 'activeUntil');
  if (activeFrom && activeUntil && activeFrom > activeUntil) throw new CronInputError('activeFrom must not be after activeUntil');
  if (merged.mode !== null && !CRON_MODES.includes(merged.mode as CronMode)) throw new CronInputError(`mode must be one of ${CRON_MODES.join(', ')}`);
  if (merged.sprint !== 'active' && merged.sprint !== 'any') throw new CronInputError('sprint must be active or any');
  const todoStatuses = words(merged.todoStatuses, 'todoStatuses');
  if (todoStatuses.length === 0) throw new CronInputError('todoStatuses needs at least one status');
  const inProgressStatus = typeof merged.inProgressStatus === 'string' ? merged.inProgressStatus.trim() : '';
  if (!inProgressStatus) throw new CronInputError('inProgressStatus is required');
  if (!CRON_ENGINES.includes(merged.engine as CronEngine)) throw new CronInputError(`engine must be one of ${CRON_ENGINES.join(', ')}`);
  return {
    enabled: merged.enabled,
    machine,
    parallel: integer(merged.parallel, 'parallel', 1, 5),
    workStart,
    workEnd,
    workDays,
    activeFrom,
    activeUntil,
    maxPerDay: integer(merged.maxPerDay, 'maxPerDay', 1, 50),
    mode: merged.mode as CronMode | null,
    sprint: merged.sprint,
    labels: words(merged.labels, 'labels'),
    todoStatuses,
    inProgressStatus,
    model: optionalWord(merged.model, 'model'),
    effort: optionalWord(merged.effort, 'effort'),
    usageBrakePercent: integer(merged.usageBrakePercent, 'usageBrakePercent', 0, 100),
    engine: merged.engine as CronEngine,
  };
}

/** A heading "Acceptance criteria" with at least one criterion under it: a line of two words or more. A lone dot or "TBD" is not one. */
export function hasAcceptanceCriteria(description: string | null | undefined): boolean {
  const text = description || '';
  const at = text.search(/acceptance criteria/i);
  if (at < 0) return false;
  return text.slice(at).split('\n').slice(1).some((line) => (line.match(/[\p{L}\p{N}]+/gu) || []).length >= 2);
}

export interface CronTicket { key: string; title: string; description?: string | null; acceptanceCriteria?: string | null; status: string; sprintState?: string | null; labels?: string[]; parentKey?: string | null }

/** The Jira Acceptance Criteria field when it holds a criterion, else an "Acceptance criteria" heading in the description. */
export function ticketHasAcceptanceCriteria(ticket: Pick<CronTicket, 'description' | 'acceptanceCriteria'>): boolean {
  const field = (ticket.acceptanceCriteria || '').split('\n').some((line) => (line.match(/[\p{L}\p{N}]+/gu) || []).length >= 2);
  return field || hasAcceptanceCriteria(ticket.description);
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const ticketNumber = (key: string) => Number(key.split('-')[1]) || 0;

/**
 * A dependency that is not settled can still carry a stacked child: when its Jira status is PR Review, or its ledger
 * names a pull request that is not merged yet.
 */
export function isStackable(status: string, run?: Pick<CronRun, 'prBe' | 'prFe' | 'review'> | null): boolean {
  return sameText(status, REVIEW_STATUS) || Boolean(run && (run.prBe || run.prFe) && run.review !== 'merged');
}

/** The smallest Jira label of the form "#N", or null. */
export function labelOrder(labels: string[] | undefined): number | null {
  const numbers = (labels || []).map((label) => /^#(\d{1,4})$/.exec(label.trim())).filter(Boolean).map((match) => Number(match![1]));
  return numbers.length ? Math.min(...numbers) : null;
}

/** A ticket's work order: the number set in DOCK, else its "#N" Jira label, else none. */
export const orderOf = (ticket: CronTicket, dockOrder: Map<string, number>): number | null => dockOrder.get(ticket.key) ?? labelOrder(ticket.labels);

/**
 * The tickets the cron may take: still To Do, in scope, without a run and without an open dependency.
 * Tickets with an order come first, lowest number first; the rest follow by ticket number.
 */
export function candidates(tickets: CronTicket[], taken: Set<string>, blocked: Set<string>, settings: CronSettings, dockOrder: Map<string, number> = new Map(), manual: Set<string> = new Set()): CronTicket[] {
  const rank = (ticket: CronTicket) => orderOf(ticket, dockOrder) ?? Number.POSITIVE_INFINITY;
  return tickets
    .filter((ticket) => settings.todoStatuses.some((status) => sameText(status, ticket.status)))
    .filter((ticket) => !taken.has(ticket.key) && !blocked.has(ticket.key) && !manual.has(ticket.key))
    .filter((ticket) => settings.sprint === 'any' || String(ticket.sprintState || '').toUpperCase() === 'ACTIVE')
    .filter((ticket) => settings.labels.length === 0 || (ticket.labels || []).some((label) => settings.labels.some((wanted) => sameText(wanted, label))))
    .sort((a, b) => (rank(a) - rank(b)) || (ticketNumber(a.key) - ticketNumber(b.key)));
}

/** Date, hour and ISO weekday (1 = Monday) in WIB. */
export function wib(now: Date): { date: string; hour: number; day: number } {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours(), day: shifted.getUTCDay() || 7 };
}

/** Why no new ticket may be taken right now because of the work window, or null inside it. */
export function outsideWindow(now: Date, settings: CronSettings): string | null {
  const { date, hour, day } = wib(now);
  if (settings.activeFrom && date < settings.activeFrom) return `outside work hours: active from ${settings.activeFrom}`;
  if (settings.activeUntil && date > settings.activeUntil) return `outside work hours: active until ${settings.activeUntil}`;
  if (!settings.workDays.includes(day)) return 'outside work hours: not a work day';
  if (hour < settings.workStart || hour >= settings.workEnd) return `outside work hours: ${String(settings.workStart).padStart(2, '0')}:00-${String(settings.workEnd).padStart(2, '0')}:00 WIB`;
  return null;
}


const NO_PR_LINE = 'Do not push and do not open a pull request: the owner asks for it in this chat when the work is OK.';
const CONTRACT_LINE = 'Follow rules/ticket-contract.md: find and read the Confluence contract for this ticket before writing code; if a contract is found but cannot be read, stop and report why.';
const VAULT_LINE = 'Before you finish, save a session note with brain.py save.';
const LANES_LINE = 'Do not end your turn while a subagent you started is still running: run members in the foreground, or wait for the result of every member you started in the background before you end the turn.';
const TEAM_LINE = 'Run the ticket with the oh-my-claudecode:team skill: its members are your workers, and you stay the lead.';
const LANGUAGE_LINE = 'Write chat replies, reports and summaries in Bahasa Indonesia; code, comments, commit messages and pull request text stay in English.';

/** The prompt for a ticket with acceptance criteria: built without stopping to ask. */
export const startPrompt = (key: string) => [
  `Build ticket ${key} with the build-ticket skill.`,
  'The ticket has acceptance criteria: do not stop to ask. When something is ambiguous, take the reading closest to the AC,',
  `record it with status.cjs decide ${key} "<what and why>", and continue.`,
  CONTRACT_LINE,
  `Stop when the work is committed on the ticket branch and ready for review (set the ledger gate to "${PR_GATE_TEXT}"), or when you cannot go on without the owner:`,
  'missing access or token, the environment is down, a prerequisite ticket is not done. Say which. A question you still have goes in your last chat message.',
  'List every decision taken without the owner in your last chat message.',
  NO_PR_LINE,
  'Do not make the demo video until the owner approves in this chat.',
  VAULT_LINE,
  TEAM_LINE,
  LANES_LINE,
  LANGUAGE_LINE,
].join(' ');

/** The prompt for a parked ticket the owner confirmed: the AC are missing, so asking stays allowed. */
export const confirmedPrompt = (key: string) => [
  `Build ticket ${key} with the build-ticket skill.`,
  CONTRACT_LINE,
  `Stop when the work is committed on the ticket branch and ready for review: set the ledger gate to "${PR_GATE_TEXT}" and wait.`,
  NO_PR_LINE,
  'Do not make the demo video until the owner approves in this chat.',
  VAULT_LINE,
  TEAM_LINE,
  LANES_LINE,
  LANGUAGE_LINE,
].join(' ');

/** The message that continues a stalled run in its own session. */
export const resumePrompt = (key: string, engine: CronEngine = 'omc') => (engine === 'sous' ? [
  `Pakai skill sous. Lanjutkan tiket ${key} dari blackboard dan ledger (node $K/status.cjs show ${key}), jangan mulai dari awal.`,
  LANES_LINE,
  LANGUAGE_LINE,
] : [
  `Lanjutkan tiket ${key} dari ledger: cek status.cjs show ${key} dan worktree-nya, jangan mulai dari awal.`,
  TEAM_LINE,
  LANES_LINE,
  LANGUAGE_LINE,
]).join(' ');

const SOUS_CRON_LINE = 'Cron run: no GATE 1; work through to an opened pull request (draft when the ledger has draft=true) and make the demo video before the pull request.';

/** The line a ticket gets when its dependency is stackable: its pull requests stack on the parent's open ones. */
export const stackLine = (key: string, parent: string) => `Stack on ${parent}: base each repo on that ticket's open PR head branch (status.cjs set ${key} stackedOn=${parent}), open this PR against it, and say in the PR body that ${parent}'s PR merges first.`;

/** The cron start on engine sous: no GATE 1, the run goes as far as an opened pull request. */
export const sousStartPrompt = (key: string, stackOn: string | null = null) => [
  `Pakai skill sous: kerjakan ${key}.`,
  SOUS_CRON_LINE,
  ...(stackOn ? [stackLine(key, stackOn)] : []),
  CONTRACT_LINE,
  VAULT_LINE,
  LANES_LINE,
  LANGUAGE_LINE,
].join(' ');

/** A parked ticket the owner confirmed, on engine sous: the AC are missing, so GATE 1 stays. */
export const sousConfirmedPrompt = (key: string, stackOn: string | null = null) => [
  `Pakai skill sous: kerjakan ${key}.`,
  ...(stackOn ? [stackLine(key, stackOn)] : []),
  CONTRACT_LINE,
  VAULT_LINE,
  LANES_LINE,
  LANGUAGE_LINE,
].join(' ');

/** The first message of the new session an owner action on a sous ticket opens; `line` is the answer or the cancel. */
export const ownerReplyPrompt = (key: string, line: string) => [
  `Pakai skill sous. Lanjutkan tiket ${key} dari blackboard dan ledger (node $K/status.cjs show ${key}), jangan mulai dari awal.`,
  line,
].join('\n');

export interface DeferredTicket { key: string; reason: string }
export interface FillLog { at: string; day: string; skipped: string | null; started: string[]; parked: string[]; deferred: DeferredTicket[]; notMoved: string[]; failed: string[]; released: string[]; resumed?: string[] }
export interface CronSlots { busy: number; waiting: number }
export interface CronStatus { enabled: boolean; slots: CronSlots; parallel: number; startedToday: number; maxPerDay: number; lastFill: FillLog | null }

export interface CronRun {
  key: string; machine: string; title: string; waiting: string | null; activity: string; stalled?: boolean; stalledDetail?: string | null;
  engine?: string | null;
  prBe?: string | null;
  prFe?: string | null;
  review?: string | null;
  issues?: Array<{ n: number; level: string; status: string }>;
  decisions?: Array<{ n: number; status: string }>;
}

export interface OwnerAnswer { issue: number; text: string }
export interface OwnerChange { n: number; choice: string }

const CHANGEABLE = new Set(['SHOV', 'USULAN']);
const MAX_OWNER_TEXT = 4000;
export const OWNER_BUSY_TEXT = 'A session on this ticket has not finished its turn yet. Wait for it, then send again.';

export interface CronDeps {
  now(): Date;
  settingValue(key: string): Promise<string | null>;
  saveSetting(key: string, value: string, description: string): Promise<unknown>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  cacheDelete(key: string): Promise<unknown>;
  tickets(): Promise<CronTicket[]>;
  ticket(key: string): Promise<CronTicket | null>;
  moveTicket(key: string, statusName: string): Promise<boolean>;
  dependencies(): Promise<Array<{ ticketKey: string; dependsOnKey: string }>>;
  /** Work order numbers set in DOCK, by ticket key. */
  dockOrder(): Promise<Map<string, number>>;
  /** Tickets the owner works by hand: never picked, never resumed. */
  manualKeys(): Promise<Set<string>>;
  /** Cron sessions on the machine with a running turn (busy) and with a message waiting for a slot. */
  slots(machine: string): Promise<CronSlots>;
  machines(): Promise<string[]>;
  online(machine: string): boolean;
  fiveHourUsed(machine: string): { usedPercentage: number; resetsAt: string | null } | null;
  /** Every run that ever existed, dismissed ones too: a ticket is picked once. */
  takenKeys(): Promise<string[]>;
  /** Tickets whose latest cron session ended its first turn without a single reply from the agent. */
  deadStarts(): Promise<string[]>;
  runs(): Promise<CronRun[]>;
  saveRun(ledger: Record<string, unknown>, machine: string): Promise<unknown>;
  /** Sets the run's waiting text and keeps the rest of its ledger. */
  park(key: string, waiting: string): Promise<unknown>;
  /** The newest cron session of each ticket; `stopped` when the owner stopped its last turn, `otherActive` when another session of the ticket works or spoke after it. */
  cronSessions(keys: string[]): Promise<Map<string, { id: string; status: string; stopped: boolean; otherActive: boolean }>>;
  openSession(input: { ticketKey: string; machine: string; title: string; origin: 'cron'; options: Record<string, string> }): Promise<{ id: string }>;
  /** The turn options the machine takes: none when it never reported what it offers; throws when it refuses them. */
  machineOptions(machine: string, options: Record<string, string>): Promise<Record<string, string>>;
  deleteSession(sessionId: string): Promise<unknown>;
  /** True while an owner session of the ticket still has its first turn queued or running. */
  ownerSessionBusy(key: string): Promise<boolean>;
  send(sessionId: string, text: string, options: Record<string, string>): Promise<unknown>;
  runningSessions(): Promise<string[]>;
  stopTurn(sessionId: string): Promise<unknown>;
  hasPushDevices(): Promise<boolean>;
  push(message: PushMessage): Promise<unknown>;
}

interface DayCount { started: string[]; parked: string[] }

export class OrchestratorCron {
  private running: Promise<FillLog> | null = null;
  private readonly ownerOpening = new Set<string>();

  constructor(private readonly deps: CronDeps) {}

  async settings(): Promise<CronSettings> {
    return parseCronSettings(await this.deps.settingValue(CONFIG_KEY));
  }

  async getSettings() {
    return {
      config: JSON.stringify(await this.settings(), null, 2),
      lastFill: JSON.stringify(await this.lastFill()),
    };
  }

  async updateSettings(configJson: string): Promise<void> {
    const settings = parseCronSettings(configJson);
    if (!(await this.deps.machines()).includes(settings.machine)) throw new CronInputError(`Unknown machine ${settings.machine}`);
    await this.deps.saveSetting(CONFIG_KEY, JSON.stringify(settings, null, 2), 'Orchestrator cron config');
  }

  async lastFill(): Promise<FillLog | null> {
    const saved = await this.deps.cacheGet('lastFill');
    return isRecord(saved) ? saved as unknown as FillLog : null;
  }

  /** What the Agents page shows on its Cron row. */
  async status(): Promise<CronStatus> {
    const settings = await this.settings();
    const day = await this.dayCount(wib(this.deps.now()).date);
    return { enabled: settings.enabled, slots: await this.deps.slots(settings.machine), parallel: settings.parallel, startedToday: day.started.length, maxPerDay: settings.maxPerDay, lastFill: await this.lastFill() };
  }

  /** One fill at a time: a manual run during a scheduled one gets that fill's result. "Run now" ignores the work window, nothing else. */
  runFill(ignoreWindow = false): Promise<FillLog> {
    if (!this.running) this.running = this.fill(ignoreWindow).finally(() => { this.running = null; });
    return this.running;
  }

  private async dayCount(date: string): Promise<DayCount> {
    const saved = await this.deps.cacheGet(`day:${date}`);
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    return isRecord(saved) ? { started: list(saved.started), parked: list(saved.parked) } : { started: [], parked: [] };
  }

  private async fill(ignoreWindow: boolean): Promise<FillLog> {
    const now = this.deps.now();
    const settings = await this.settings();
    const { date } = wib(now);
    const log: FillLog = { at: now.toISOString(), day: date, skipped: null, started: [], parked: [], deferred: [], notMoved: [], failed: [], released: [] };
    log.released = await this.releaseDeadStarts(settings, now, date).catch((error) => {
      console.error('[Orchestrator cron] Release failed:', error instanceof Error ? error.message : 'unknown error');
      return [];
    });
    log.skipped = await this.reasonToSkip(settings, now, ignoreWindow);
    if (!log.skipped) {
      log.resumed = await this.resumeStalled(settings, log);
      if (log.resumed.length) log.skipped = `stalled runs are resumed first: ${log.resumed.join(', ')}`;
    }
    if (!log.skipped) {
      const day = await this.dayCount(date);
      await this.pick(settings, now, log, day);
      await this.deps.cacheSet(`day:${date}`, day);
    }
    await this.deps.cacheSet('lastFill', log);
    return log;
  }

  private async reasonToSkip(settings: CronSettings, now: Date, ignoreWindow: boolean): Promise<string | null> {
    if (!(await this.deps.machines()).includes(settings.machine)) return `machine ${settings.machine} has no ingest token`;
    if (!this.deps.online(settings.machine)) return `machine ${settings.machine} is offline`;
    const window = ignoreWindow ? null : outsideWindow(now, settings);
    if (window) return window;
    const used = this.deps.fiveHourUsed(settings.machine);
    // A limit whose window has already reset says nothing about now.
    const current = used && (!used.resetsAt || new Date(used.resetsAt) > now);
    if (used && current && used.usedPercentage >= settings.usageBrakePercent) return `usage brake: 5 hour usage is at ${Math.round(used.usedPercentage)}%, the brake is ${settings.usageBrakePercent}%`;
    return null;
  }

  /**
   * Parks tickets without acceptance criteria and starts the others while a slot and today's quota last.
   * A slot waited for by a queued message (an owner's answer, a confirmed ticket) is not free: that message goes first.
   */
  private async pick(settings: CronSettings, now: Date, log: FillLog, day: DayCount): Promise<void> {
    const [tickets, taken, { blocked, stacked }, dockOrder, slots, manual] = await Promise.all([
      this.deps.tickets(), this.deps.takenKeys(), this.dependencyState(settings), this.deps.dockOrder(), this.deps.slots(settings.machine), this.deps.manualKeys(),
    ]);
    let free = Math.max(0, settings.parallel - slots.busy - slots.waiting);
    const defer = (key: string, reason: string) => { if (log.deferred.length < MAX_DEFERRED_LOGGED) log.deferred.push({ key, reason }); };
    for (const ticket of candidates(tickets, new Set(taken), blocked, settings, dockOrder, manual)) {
      try {
        if (!ticketHasAcceptanceCriteria(ticket)) {
          if (day.parked.length >= settings.maxPerDay) { defer(ticket.key, `daily cap reached: ${settings.maxPerDay} parked today`); continue; }
          await this.saveRun(ticket, settings.machine, now, PARKED_TEXT);
          day.parked.push(ticket.key);
          log.parked.push(ticket.key);
        } else if (day.started.length >= settings.maxPerDay) {
          defer(ticket.key, `daily cap reached: ${settings.maxPerDay} started today`);
        } else if (free <= 0) {
          defer(ticket.key, `slots full: ${settings.parallel} of ${settings.parallel} in use`);
        } else {
          free -= 1;
          day.started.push(ticket.key);
          log.started.push(ticket.key);
          if (!(await this.start(ticket, settings, now, this.startPromptOf(settings, ticket.key, stacked.get(ticket.key))))) log.notMoved.push(ticket.key);
        }
      } catch (error) {
        console.error(`[Orchestrator cron] ${ticket.key} failed:`, error instanceof Error ? error.message : 'unknown error');
        log.failed.push(ticket.key);
      }
    }
  }

  /**
   * A cron session that died before the agent answered (a hook that blocks the prompt, a machine that is not ready) did no work.
   * Its run waits on the owner with a retry, it stops counting toward today's cap, and the ticket goes back to To Do.
   */
  private async releaseDeadStarts(settings: CronSettings, now: Date, date: string): Promise<string[]> {
    const dead = new Set(await this.deps.deadStarts());
    if (!dead.size) return [];
    const runs = (await this.deps.runs()).filter((run) => dead.has(run.key) && !run.waiting);
    if (!runs.length) return [];
    const day = await this.dayCount(date);
    for (const run of runs) {
      await this.saveRun(run, run.machine, now, START_FAILED_TEXT);
      day.started = day.started.filter((key) => key !== run.key);
      await this.deps.moveTicket(run.key, settings.todoStatuses[0]).catch(() => false);
    }
    await this.deps.cacheSet(`day:${date}`, day);
    return runs.map((run) => run.key);
  }

  /**
   * A stalled run gets a message to continue in its own cron session, and the fill takes no new ticket: when its lead left
   * subagents running, when the session failed, or when its idle session went quiet without a reason the bridge saw.
   * Never when the owner stopped it or works the ticket in another session.
   * After MAX_RESUMES the run waits on the owner instead. Returns the tickets resumed.
   */
  private async resumeStalled(settings: CronSettings, log: FillLog): Promise<string[]> {
    const [runs, manual] = await Promise.all([this.deps.runs(), this.deps.manualKeys()]);
    const sessions = await this.deps.cronSessions(runs.filter((run) => run.stalled).map((run) => run.key));
    const resumed: string[] = [];
    for (const run of runs) {
      const session = sessions.get(run.key);
      if (!run.stalled || run.waiting || manual.has(run.key) || !session || session.stopped || session.otherActive) continue;
      if (session.status !== 'error' && session.status !== 'idle') continue;
      // A quiet run's turns end cleanly, which resets the resumes count: it keeps its own count so it still parks.
      const counter = session.status === 'idle' && !run.stalledDetail ? `quietResumes:${run.key}` : `resumes:${run.key}`;
      try {
        const count = Number(await this.deps.cacheGet(counter)) || 0;
        if (count >= MAX_RESUMES) {
          await this.deps.park(run.key, RESUME_GAVE_UP_TEXT);
          log.parked.push(run.key);
          continue;
        }
        await this.deps.send(session.id, resumePrompt(run.key, run.engine === 'sous' ? 'sous' : settings.engine), this.turnOptions(settings));
        await this.deps.cacheSet(counter, count + 1);
        resumed.push(run.key);
      } catch (error) {
        console.error(`[Orchestrator cron] Resume of ${run.key} failed:`, error instanceof Error ? error.message : 'unknown error');
        log.failed.push(run.key);
      }
    }
    return resumed;
  }

  /** A cron turn that ended without leaving subagents running starts the count of resumes again. */
  resetResumes(key: string): Promise<unknown> {
    return this.deps.cacheDelete(`resumes:${key}`);
  }

  private turnOptions(settings: CronSettings): Record<string, string> {
    const options: Record<string, string> = {};
    if (settings.mode) options.permissionMode = BRIDGE_MODE[settings.mode];
    if (settings.model) options.model = settings.model;
    if (settings.effort) options.effort = settings.effort;
    return options;
  }

  /**
   * Tickets whose dependency is not settled yet are blocked, unless the dependency is stackable on engine sous:
   * then the ticket runs stacked on its parent, and `stacked` names that parent.
   */
  private async dependencyState(settings: CronSettings): Promise<{ blocked: Set<string>; stacked: Map<string, string> }> {
    const blocked = new Set<string>();
    const stacked = new Map<string, string>();
    const dependencies = await this.deps.dependencies();
    const runs = settings.engine === 'sous' && dependencies.length ? await this.deps.runs() : [];
    for (const { ticketKey, dependsOnKey } of dependencies) {
      const dependency = await this.deps.ticket(dependsOnKey).catch(() => null);
      if (dependency && isSettledStatus(dependency.status)) continue;
      if (dependency && settings.engine === 'sous' && isStackable(dependency.status, runs.find((run) => run.key === dependsOnKey))) stacked.set(ticketKey, dependsOnKey);
      else blocked.add(ticketKey);
    }
    return { blocked, stacked };
  }

  private saveRun(ticket: Pick<CronTicket, 'key' | 'title'>, machine: string, now: Date, waiting: string, engine?: CronEngine) {
    return this.deps.saveRun({ key: ticket.key, kind: 'build', title: ticket.title, stage: 'gate', waiting, note: 'Started by the orchestrator cron', ...(engine === 'sous' ? { engine } : {}), createdAt: now.toISOString(), updatedAt: now.toISOString() }, machine);
  }

  private startPromptOf(settings: CronSettings, key: string, stackOn: string | null = null) {
    return settings.engine === 'sous' ? sousStartPrompt(key, stackOn) : startPrompt(key);
  }

  /**
   * Opens the cron chat session that builds the ticket and queues its first message; the bridge takes it when a slot is free.
   * Resolves false when Jira would not move the ticket to In Progress.
   */
  private async start(ticket: CronTicket, settings: CronSettings, now: Date, prompt: string): Promise<boolean> {
    const options = this.turnOptions(settings);
    await this.resetResumes(ticket.key);
    await this.deps.cacheDelete(`quietResumes:${ticket.key}`);
    const session = await this.deps.openSession({ ticketKey: ticket.key, machine: settings.machine, title: ticketSessionTitle('Task', ticket.key), origin: 'cron', options });
    await this.deps.send(session.id, prompt, options);
    await this.saveRun(ticket, settings.machine, now, '', settings.engine);
    return this.deps.moveTicket(ticket.key, settings.inProgressStatus);
  }

  /**
   * The owner's answer to a parked ticket: start it although it has no acceptance criteria. It queues for a slot like an answer.
   * A ticket whose cron session died before the agent answered is started again with the normal prompt.
   */
  async confirm(key: string): Promise<void> {
    const run = (await this.deps.runs()).find((item) => item.key === key);
    if (!run || (run.waiting !== PARKED_TEXT && run.waiting !== START_FAILED_TEXT)) throw new CronInputError('This ticket is not waiting for a confirmation');
    const ticket = await this.deps.ticket(key);
    if (!ticket) throw new CronInputError('The ticket was not found in Jira');
    const settings = { ...(await this.settings()), machine: run.machine };
    const stackOn = (await this.dependencyState(settings)).stacked.get(ticket.key) ?? null;
    const confirmed = settings.engine === 'sous' ? sousConfirmedPrompt(ticket.key, stackOn) : confirmedPrompt(ticket.key);
    await this.start(ticket, settings, this.deps.now(), run.waiting === PARKED_TEXT ? confirmed : this.startPromptOf(settings, ticket.key, stackOn));
  }

  /** The run of a ticket the sous engine works, or null when the ticket runs the older flow. */
  async sousRun(key: string): Promise<CronRun | null> {
    const run = (await this.deps.runs()).find((item) => item.key === key);
    return run?.engine === 'sous' ? run : null;
  }

  /**
   * The owner's answer on a sous ticket opens a new session on the ticket's machine; the old one is never resumed.
   * It answers `issue`, else the I-n the ledger waits on, else the oldest open owner issue. Returns the issue answered.
   */
  async answer(key: string, textInput: string, issue?: number | null): Promise<number | null> {
    const run = await this.sousRun(key);
    if (!run) throw new CronInputError(`${key} does not run on the sous engine`);
    const answer = ownerText(textInput);
    const open = (run.issues ?? []).filter((item) => item.status === 'open');
    if (issue != null && !open.some((item) => item.n === issue)) throw new CronInputError(`I-${issue} is not an open issue of ${key}`);
    const waited = Number(/^I-(\d+):/.exec(run.waiting ?? '')?.[1]) || null;
    const n = issue ?? waited ?? open.find((item) => item.level === 'owner')?.n ?? null;
    await this.ownerSession(run, ownerReplyPrompt(key, n ? `Jawaban owner untuk I-${n}: ${answer}` : `Jawaban owner: ${answer}`));
    return n;
  }

  /**
   * The owner's answer sheet for one ticket: every answered issue and changed decision goes in one new session,
   * because a second owner session on the ticket is refused until the first finished its first turn.
   */
  async submit(key: string, answers: OwnerAnswer[], changes: OwnerChange[]): Promise<void> {
    const run = await this.sousRun(key);
    if (!run) throw new CronInputError(`${key} does not run on the sous engine`);
    if (!answers.length && !changes.length) throw new CronInputError('Nothing to send');
    const open = new Set((run.issues ?? []).filter((item) => item.status === 'open').map((item) => item.n));
    const changeable = new Set((run.decisions ?? []).filter((item) => CHANGEABLE.has(item.status)).map((item) => item.n));
    for (const answer of answers) if (!open.has(answer.issue)) throw new CronInputError(`I-${answer.issue} is not an open issue of ${key}`);
    for (const change of changes) if (!changeable.has(change.n)) throw new CronInputError(`D-${change.n} cannot be changed`);
    const lines = [
      ...answers.map((answer) => `Jawaban owner untuk I-${answer.issue}: ${ownerText(answer.text)}`),
      ...changes.map((change) => `Owner mengubah D-${change.n}: ${ownerText(change.choice)}`),
    ];
    await this.ownerSession(run, ownerReplyPrompt(key, lines.join('\n')));
  }

  /**
   * One owner session at a time per ticket, opened only with options its machine takes. A session whose first message
   * is refused is removed again, so no empty session is left behind.
   */
  private async ownerSession(run: CronRun, prompt: string) {
    if (this.ownerOpening.has(run.key)) throw new CronInputError(OWNER_BUSY_TEXT);
    this.ownerOpening.add(run.key);
    try {
      if (await this.deps.ownerSessionBusy(run.key)) throw new CronInputError(OWNER_BUSY_TEXT);
      const options = await this.deps.machineOptions(run.machine, this.turnOptions(await this.settings()));
      const session = await this.deps.openSession({ ticketKey: run.key, machine: run.machine, title: ticketSessionTitle('Task', run.key), origin: 'cron', options });
      try {
        await this.deps.send(session.id, prompt, options);
      } catch (error) {
        await this.deps.deleteSession(session.id).catch(() => undefined);
        throw error;
      }
    } finally {
      this.ownerOpening.delete(run.key);
    }
  }

  /**
   * A `Review-<key>` session on the cron's machine with the cron's options, so it waits for a cron slot like a ticket
   * does. Removed again when its first message is refused. Resolves to the session id.
   */
  async openReview(key: string, prompt: string): Promise<string> {
    const settings = await this.settings();
    const options = await this.deps.machineOptions(settings.machine, this.turnOptions(settings));
    const session = await this.deps.openSession({ ticketKey: key, machine: settings.machine, title: ticketSessionTitle('Review', key), origin: 'cron', options });
    try {
      await this.deps.send(session.id, prompt, options);
    } catch (error) {
      await this.deps.deleteSession(session.id).catch(() => undefined);
      throw error;
    }
    return session.id;
  }

  async stopAll(): Promise<number> {
    const sessions = await this.deps.runningSessions();
    await Promise.all(sessions.map((id) => this.deps.stopTurn(id).catch(() => undefined)));
    return sessions.length;
  }

  /**
   * One notice per run and reason it waits on the owner: a push to every phone that asked for one.
   * The first call after a phone is set up only remembers what waits already.
   */
  async notifyWaiting(runs?: CronRun[]): Promise<string[]> {
    if (!(await this.deps.hasPushDevices())) return [];
    const waiting = (runs ?? await this.deps.runs()).filter((run) => run.waiting);
    return this.ping('notified', waiting, (run) => `${run.key}
${run.waiting}`, (run) => waitingNotice({ key: run.key, waiting: String(run.waiting) }));
  }

  /** Like notifyWaiting, for a run that went stalled; one that waits on the owner is already announced as waiting. */
  async notifyStalled(runs?: CronRun[]): Promise<string[]> {
    if (!(await this.deps.hasPushDevices())) return [];
    const stalled = (runs ?? await this.deps.runs()).filter((run) => run.stalled && !run.waiting);
    return this.ping('notifiedStalled', stalled, (run) => `${run.key}
${run.stalledDetail ?? ''}`, stalledNotice);
  }

  /** Pushes the runs whose mark was not remembered; the remembered marks are rewritten only when they changed. */
  private async ping(cacheKey: string, runs: CronRun[], mark: (run: CronRun) => string, notice: (run: CronRun) => PushMessage): Promise<string[]> {
    const marks = runs.map(mark);
    const saved = await this.deps.cacheGet(cacheKey);
    const known = Array.isArray(saved) ? saved as string[] : null;
    const pinged: string[] = [];
    for (const run of known ? runs.filter((item) => !known.includes(mark(item))) : []) {
      await this.deps.push(notice(run));
      pinged.push(run.key);
    }
    if (!known || known.length !== marks.length || known.some((item, index) => item !== marks[index])) await this.deps.cacheSet(cacheKey, marks);
    return pinged;
  }

  /** Every minute: pings, then a fill when the cron is on. The work window and every limit are checked inside the fill. */
  async tick(): Promise<void> {
    try {
      if (await this.deps.hasPushDevices()) {
        const runs = await this.deps.runs();
        await this.notifyWaiting(runs);
        await this.notifyStalled(runs);
      }
    } catch (error) {
      console.error('[Orchestrator cron] Ping failed:', error instanceof Error ? error.message : 'unknown error');
    }
    if ((await this.settings()).enabled) await this.runFill();
  }
}

export function startOrchestratorCron(cron: OrchestratorCron): () => void {
  const timer = setInterval(() => {
    cron.tick().catch((error) => console.error('[Orchestrator cron] Tick failed:', error instanceof Error ? error.message : 'unknown error'));
  }, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export const CRON_CACHE = CACHE;
