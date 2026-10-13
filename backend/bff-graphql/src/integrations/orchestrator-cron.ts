import axios from 'axios';
import { isSettledStatus } from './attention';

export class CronInputError extends Error {}

export interface CronSettings {
  enabled: boolean;
  hoursWib: number[];
  machine: string;
  parallel: number;
  perRound: number;
  sprint: 'active' | 'any';
  labels: string[];
  todoStatuses: string[];
  inProgressStatus: string;
  model: string | null;
  effort: string | null;
  usageBrakePercent: number;
  notifyUserId: string;
}

export const DEFAULT_CRON_SETTINGS: CronSettings = {
  enabled: false,
  hoursWib: [9],
  machine: 'workspace',
  parallel: 2,
  perRound: 3,
  sprint: 'active',
  labels: [],
  todoStatuses: ['To Do'],
  inProgressStatus: 'In Progress',
  model: null,
  effort: null,
  usageBrakePercent: 70,
  notifyUserId: '',
};

const CONFIG_KEY = 'orchestratorCronConfig';
const WEBHOOK_KEY = 'orchestratorCronWebhookUrl';
const CACHE = 'orchestrator-cron';
const TICK_MS = 60 * 1000;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const MAX_PING_CHARS = 1900;

export const PARKED_TEXT = 'No acceptance criteria on the ticket. Confirm to start anyway, or fill them in.';
export const PR_GATE_TEXT = "PR open: waiting for the owner's review";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new CronInputError(`${name} must be a whole number from ${min} to ${max}`);
  return Number(value);
}

function words(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new CronInputError(`${name} must be a list of text`);
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
}

function optionalWord(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 80) throw new CronInputError(`${name} must be text`);
  return value.trim();
}

/** The saved config with every missing field filled from the defaults; a wrong value is an error, not a silent default. */
export function parseCronSettings(raw: string | null | undefined): CronSettings {
  if (!raw) return DEFAULT_CRON_SETTINGS;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new CronInputError('The config is not valid JSON'); }
  if (!isRecord(input)) throw new CronInputError('The config must be an object');
  const merged = { ...DEFAULT_CRON_SETTINGS, ...input };
  if (typeof merged.enabled !== 'boolean') throw new CronInputError('enabled must be true or false');
  if (!Array.isArray(merged.hoursWib) || merged.hoursWib.length === 0) throw new CronInputError('hoursWib needs at least one hour');
  const machine = typeof merged.machine === 'string' ? merged.machine.trim() : '';
  if (!machine) throw new CronInputError('machine is required');
  if (merged.sprint !== 'active' && merged.sprint !== 'any') throw new CronInputError('sprint must be active or any');
  const todoStatuses = words(merged.todoStatuses, 'todoStatuses');
  if (todoStatuses.length === 0) throw new CronInputError('todoStatuses needs at least one status');
  const inProgressStatus = typeof merged.inProgressStatus === 'string' ? merged.inProgressStatus.trim() : '';
  if (!inProgressStatus) throw new CronInputError('inProgressStatus is required');
  const notifyUserId = typeof merged.notifyUserId === 'string' ? merged.notifyUserId.trim() : '';
  if (notifyUserId && !/^\d{5,25}$/.test(notifyUserId)) throw new CronInputError('notifyUserId must be a Discord user id (digits only)');
  return {
    enabled: merged.enabled,
    hoursWib: [...new Set(merged.hoursWib.map((hour) => integer(hour, 'hoursWib', 0, 23)))].sort((a, b) => a - b),
    machine,
    parallel: integer(merged.parallel, 'parallel', 1, 5),
    perRound: integer(merged.perRound, 'perRound', 1, 10),
    sprint: merged.sprint,
    labels: words(merged.labels, 'labels'),
    todoStatuses,
    inProgressStatus,
    model: optionalWord(merged.model, 'model'),
    effort: optionalWord(merged.effort, 'effort'),
    usageBrakePercent: integer(merged.usageBrakePercent, 'usageBrakePercent', 0, 100),
    notifyUserId,
  };
}

/** A heading "Acceptance criteria" with at least one criterion under it: a line of two words or more. A lone dot or "TBD" is not one. */
export function hasAcceptanceCriteria(description: string | null | undefined): boolean {
  const text = description || '';
  const at = text.search(/acceptance criteria/i);
  if (at < 0) return false;
  return text.slice(at).split('\n').slice(1).some((line) => (line.match(/[\p{L}\p{N}]+/gu) || []).length >= 2);
}

export interface CronTicket { key: string; title: string; description?: string | null; status: string; sprintState?: string | null; labels?: string[] }

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const ticketNumber = (key: string) => Number(key.split('-')[1]) || 0;

/** The tickets a round may pick, oldest ticket number first: still To Do, in scope, without a run and without an open dependency. */
export function candidates(tickets: CronTicket[], taken: Set<string>, blocked: Set<string>, settings: CronSettings): CronTicket[] {
  return tickets
    .filter((ticket) => settings.todoStatuses.some((status) => sameText(status, ticket.status)))
    .filter((ticket) => !taken.has(ticket.key) && !blocked.has(ticket.key))
    .filter((ticket) => settings.sprint === 'any' || String(ticket.sprintState || '').toUpperCase() === 'ACTIVE')
    .filter((ticket) => settings.labels.length === 0 || (ticket.labels || []).some((label) => settings.labels.some((wanted) => sameText(wanted, label))))
    .sort((a, b) => ticketNumber(a.key) - ticketNumber(b.key));
}

/** "2026-10-14T09" in WIB: one value per clock hour, used to run a scheduled hour once. */
export function hourKeyWib(now: Date): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 13);
}

export function isDue(now: Date, settings: CronSettings, lastHourKey: string | null): boolean {
  const key = hourKeyWib(now);
  return settings.enabled && settings.hoursWib.includes(Number(key.slice(11, 13))) && key !== lastHourKey;
}

export const startPrompt = (key: string) => [
  `Build ticket ${key} with the build-ticket skill.`,
  `Stop when the pull request is open: set the ledger gate to "${PR_GATE_TEXT}" and wait.`,
  'Do not make the demo video until the owner approves in this chat.',
].join(' ');

export interface RoundLog { at: string; hourKey: string; skipped: string | null; started: string[]; parked: string[]; notMoved: string[]; failed: string[] }

export interface CronRun { key: string; machine: string; title: string; waiting: string | null; activity: string }

export interface CronDeps {
  now(): Date;
  settingValue(key: string): Promise<string | null>;
  saveSetting(key: string, value: string, description: string): Promise<unknown>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  tickets(): Promise<CronTicket[]>;
  ticket(key: string): Promise<CronTicket | null>;
  moveTicket(key: string, statusName: string): Promise<boolean>;
  dependencies(): Promise<Array<{ ticketKey: string; dependsOnKey: string }>>;
  machines(): Promise<string[]>;
  online(machine: string): boolean;
  fiveHourUsed(machine: string): { usedPercentage: number; resetsAt: string | null } | null;
  /** Every run that ever existed, dismissed ones too: a ticket is picked once. */
  takenKeys(): Promise<string[]>;
  runs(): Promise<CronRun[]>;
  saveRun(ledger: Record<string, unknown>, machine: string): Promise<unknown>;
  openSession(input: { ticketKey: string; machine: string; title: string }): Promise<{ id: string }>;
  send(sessionId: string, text: string, options: Record<string, string>): Promise<unknown>;
  runningSessions(): Promise<string[]>;
  stopTurn(sessionId: string): Promise<unknown>;
  post(webhookUrl: string, body: unknown): Promise<unknown>;
}

export class OrchestratorCron {
  private running: Promise<RoundLog> | null = null;

  constructor(private readonly deps: CronDeps) {}

  async settings(): Promise<CronSettings> {
    return parseCronSettings(await this.deps.settingValue(CONFIG_KEY));
  }

  async getSettings() {
    return {
      config: JSON.stringify(await this.settings(), null, 2),
      webhookSet: Boolean(await this.deps.settingValue(WEBHOOK_KEY)),
      lastRound: JSON.stringify(await this.lastRound()),
    };
  }

  /** `webhookUrl` undefined or null keeps the saved one; an empty string clears it. */
  async updateSettings(configJson: string, webhookUrl?: string | null): Promise<void> {
    const settings = parseCronSettings(configJson);
    if (!(await this.deps.machines()).includes(settings.machine)) throw new CronInputError(`Unknown machine ${settings.machine}`);
    const url = typeof webhookUrl === 'string' ? webhookUrl.trim() : null;
    if (url && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) throw new CronInputError('The webhook must be a Discord webhook URL');
    await this.deps.saveSetting(CONFIG_KEY, JSON.stringify(settings, null, 2), 'Orchestrator cron config');
    if (url !== null) await this.deps.saveSetting(WEBHOOK_KEY, url, 'Discord webhook for orchestrator pings to the owner');
  }

  async lastRound(): Promise<RoundLog | null> {
    const saved = await this.deps.cacheGet('lastRound');
    return isRecord(saved) ? saved as unknown as RoundLog : null;
  }

  /** One round at a time: a manual run during a scheduled one gets that round's result. */
  runRound(): Promise<RoundLog> {
    if (!this.running) this.running = this.round().finally(() => { this.running = null; });
    return this.running;
  }

  private async round(): Promise<RoundLog> {
    const now = this.deps.now();
    const settings = await this.settings();
    const log: RoundLog = { at: now.toISOString(), hourKey: hourKeyWib(now), skipped: null, started: [], parked: [], notMoved: [], failed: [] };
    log.skipped = await this.reasonToSkip(settings, now);
    if (!log.skipped) await this.pick(settings, now, log);
    await this.deps.cacheSet('lastRound', log);
    return log;
  }

  private async reasonToSkip(settings: CronSettings, now: Date): Promise<string | null> {
    if (!(await this.deps.machines()).includes(settings.machine)) return `machine ${settings.machine} has no ingest token`;
    if (!this.deps.online(settings.machine)) return `machine ${settings.machine} is offline`;
    const used = this.deps.fiveHourUsed(settings.machine);
    // A limit whose window has already reset says nothing about now.
    const current = used && (!used.resetsAt || new Date(used.resetsAt) > now);
    if (used && current && used.usedPercentage >= settings.usageBrakePercent) return `5 hour usage is at ${Math.round(used.usedPercentage)}%, the brake is ${settings.usageBrakePercent}%`;
    return null;
  }

  private async pick(settings: CronSettings, now: Date, log: RoundLog): Promise<void> {
    const [tickets, taken, runs, blocked] = await Promise.all([this.deps.tickets(), this.deps.takenKeys(), this.deps.runs(), this.blockedKeys()]);
    const busy = runs.filter((run) => run.machine === settings.machine && run.activity === 'ACTIVE').length;
    let free = Math.max(0, settings.parallel - busy);
    for (const ticket of candidates(tickets, new Set(taken), blocked, settings).slice(0, settings.perRound)) {
      try {
        if (!hasAcceptanceCriteria(ticket.description)) {
          await this.saveRun(ticket, settings.machine, now, PARKED_TEXT);
          log.parked.push(ticket.key);
        } else if (free > 0) {
          free -= 1;
          if (!(await this.start(ticket, settings, now))) log.notMoved.push(ticket.key);
          log.started.push(ticket.key);
        }
      } catch (error) {
        console.error(`[Orchestrator cron] ${ticket.key} failed:`, error instanceof Error ? error.message : 'unknown error');
        log.failed.push(ticket.key);
      }
    }
  }

  /** Tickets whose dependency is not settled yet. */
  private async blockedKeys(): Promise<Set<string>> {
    const blocked = new Set<string>();
    for (const { ticketKey, dependsOnKey } of await this.deps.dependencies()) {
      const dependency = await this.deps.ticket(dependsOnKey).catch(() => null);
      if (!dependency || !isSettledStatus(dependency.status)) blocked.add(ticketKey);
    }
    return blocked;
  }

  private saveRun(ticket: CronTicket, machine: string, now: Date, waiting: string) {
    return this.deps.saveRun({ key: ticket.key, kind: 'build', title: ticket.title, stage: 'gate', waiting, note: 'Started by the orchestrator cron', updatedAt: now.toISOString() }, machine);
  }

  /** Opens the chat session that builds the ticket; resolves false when Jira would not move the ticket to In Progress. */
  private async start(ticket: CronTicket, settings: CronSettings, now: Date): Promise<boolean> {
    const session = await this.deps.openSession({ ticketKey: ticket.key, machine: settings.machine, title: `${ticket.key} (cron)` });
    const options: Record<string, string> = {};
    if (settings.model) options.model = settings.model;
    if (settings.effort) options.effort = settings.effort;
    await this.deps.send(session.id, startPrompt(ticket.key), options);
    await this.saveRun(ticket, settings.machine, now, '');
    return this.deps.moveTicket(ticket.key, settings.inProgressStatus);
  }

  /** The owner's answer to a parked ticket: start it although it has no acceptance criteria. */
  async confirm(key: string): Promise<void> {
    const run = (await this.deps.runs()).find((item) => item.key === key);
    if (!run || run.waiting !== PARKED_TEXT) throw new CronInputError('This ticket is not waiting for a confirmation');
    const ticket = await this.deps.ticket(key);
    if (!ticket) throw new CronInputError('The ticket was not found in Jira');
    await this.start(ticket, { ...(await this.settings()), machine: run.machine }, this.deps.now());
  }

  async stopAll(): Promise<number> {
    const sessions = await this.deps.runningSessions();
    await Promise.all(sessions.map((id) => this.deps.stopTurn(id).catch(() => undefined)));
    return sessions.length;
  }

  /** One Discord ping per run and reason it waits on the owner. The first call after a webhook is set only remembers what waits already. */
  async notifyWaiting(): Promise<string[]> {
    const webhookUrl = await this.deps.settingValue(WEBHOOK_KEY);
    if (!webhookUrl) return [];
    const { notifyUserId } = await this.settings();
    const waiting = (await this.deps.runs()).filter((run) => run.waiting);
    const marks = waiting.map((run) => `${run.key}\n${run.waiting}`);
    const saved = await this.deps.cacheGet('notified');
    const known = Array.isArray(saved) ? new Set(saved as string[]) : null;
    const pinged: string[] = [];
    for (const run of known ? waiting.filter((item) => !known.has(`${item.key}\n${item.waiting}`)) : []) {
      const mention = notifyUserId ? `<@${notifyUserId}> ` : '';
      const content = `${mention}**${run.key}** ${run.title}\n${run.waiting}`.slice(0, MAX_PING_CHARS);
      await this.deps.post(webhookUrl, { content, allowed_mentions: { users: notifyUserId ? [notifyUserId] : [] } });
      pinged.push(run.key);
    }
    await this.deps.cacheSet('notified', marks);
    return pinged;
  }

  async tick(): Promise<void> {
    await this.notifyWaiting().catch((error) => console.error('[Orchestrator cron] Ping failed:', error instanceof Error ? error.message : 'unknown error'));
    const last = await this.lastRound();
    if (isDue(this.deps.now(), await this.settings(), last ? last.hourKey : null)) await this.runRound();
  }
}

export function startOrchestratorCron(cron: OrchestratorCron): () => void {
  const timer = setInterval(() => {
    cron.tick().catch((error) => console.error('[Orchestrator cron] Tick failed:', error instanceof Error ? error.message : 'unknown error'));
  }, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export const postWebhook = (webhookUrl: string, body: unknown) => axios.post(webhookUrl, body, { timeout: 10000 });
export const CRON_CACHE = CACHE;
