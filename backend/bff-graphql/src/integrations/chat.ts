import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/service';
import {
  ACTIVITY_DETAIL_KEEP_MS,
  ACTIVITY_ID,
  ACTIVITY_KINDS,
  ACTIVITY_LIMITS,
  ACTIVITY_PRUNE_INTERVAL_MS,
  ACTIVITY_ROWS_KEEP_MS,
  ACTIVITY_STATUSES,
  ACTIVITY_VERSION,
  MAX_ACTIVITY_EVENTS,
  MAX_ACTIVITY_PER_TURN,
  MAX_ACTIVITY_ROWS,
  SERVER_DROPPED_ID,
  activityText,
  fitActivityEvent,
  maskActivityText,
  toActivity,
  type ActivityEvent,
  type ActivityKind,
  type ActivityStatus,
} from './chat-activity';
import { ATTACHMENT_LIMITS, chatAttachmentService, type ChatAttachmentService } from './chat-attachments';
import {
  INTERACTION_KEEP_MS,
  MAX_ASKS_PER_TURN,
  MAX_INTERACTION_ROWS,
  MAX_PENDING_ASKS,
  PENDING_LIST_LIMIT,
  TAKEN_HARD_MS,
  TAKEN_HARD_TEXT,
  TurnNotifier,
  WAIT_TOUCH_MS,
  checkAnswer,
  checkTurnOptions,
  parseAsk,
  parseCaps,
  parseCatalog,
  parseStoredAnswer,
  parseStoredCaps,
  parseStoredCatalog,
  parseStoredOptions,
  parseTurnOptions,
  parseWait,
  searchCommands,
  type AnswerInput,
  type BridgeCaps,
  type Catalog,
  type InteractionKind,
  type WaitAnswer,
} from './chat-interactions';
import { DEFAULT_MACHINE, OrchestratorInputError, normalizeMachine, normalizeTicketKey } from './orchestrator';

export const CHAT_SOURCES = ['cli', 'dock'] as const;
export type ChatSource = typeof CHAT_SOURCES[number];
export const CHAT_ROLES = ['user', 'assistant', 'tool'] as const;
export type ChatRole = typeof CHAT_ROLES[number];

export const MAX_MESSAGE_CHARS = 16000;
export const CUT_SUFFIX = ' …[cut]';
export const MAX_MESSAGES_KEPT = 5000;
export const MAX_TITLE_CHARS = 120;
export const MAX_SYNC_MESSAGES = 500;
export const MAX_SEND_CHARS = 8000;
export const MAX_CLAIM_WAIT_SECONDS = 25;
export const CLAIM_POLL_MS = 500;
export const STALE_TAKEN_MS = 15 * 60 * 1000;
export const STALE_TEXT = 'The bridge stopped answering';
export const SILENT_TAKEN_MS = 2 * 60 * 1000;
export const SILENT_TEXT = 'The machine stopped responding';
export const STOP_GRACE_MS = 45 * 1000;
export const SETTLED_LIST_LIMIT = 5;
export const BRIDGE_ONLINE_MS = 60 * 1000;
export const BALLOON_MAX_AGE_MS = 30 * 60 * 1000;
export const STATUS_STALE_MS = 5 * 60 * 1000;
export const MAX_STATUS_SESSIONS = 200;
// Limits outlive a restart; after the 7 day window has passed they describe nothing.
const LIMITS_KEEP_SECONDS = 8 * 24 * 60 * 60;
export const STOPPED_TEXT = 'Stopped';
export const STOPPED_QUEUED_TEXT = 'Stopped before it started';
export const ATTACHMENT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
export const DRAFT_MAX_MS = 60 * 1000;
const MAX_DELTA_ITEMS = 200;
const MAX_DETAIL_CHARS = 200;
const MAX_ERROR_CHARS = 500;
const MAX_STATUS_TEXT_CHARS = 60;
const MAX_QUERY_CHARS = 200;
const MIN_QUERY_CHARS = 2;
const LAST_TEXT_CHARS = 160;
const SNIPPET_SIDE_CHARS = 60;
const CLAIM_CANDIDATES = 20;
const SESSIONS_LIMIT = { fallback: 100, max: 300 };
const MESSAGES_LIMIT = { fallback: 200, max: 500 };
const SEARCH_LIMIT = { fallback: 30, max: 100 };
const ACTIVITY_ROWS_LIMIT = { fallback: 200, max: 500 };

const CHAT_ID = /^[A-Za-z0-9-]{1,64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function chatId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !CHAT_ID.test(value)) throw new OrchestratorInputError(`${name} must be an id of letters, digits and dashes`);
  return value;
}

function optionalChatId(value: unknown, name: string): string | null {
  return value === undefined || value === null ? null : chatId(value, name);
}

function optionalTicketKey(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : normalizeTicketKey(value);
}

function isoDate(value: unknown, name: string, now: Date): Date {
  const date = typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new OrchestratorInputError(`${name} must be an ISO date`);
  return date > now ? now : date;
}

function flag(value: unknown, name: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new OrchestratorInputError(`${name} must be true or false`);
  return value;
}

function limit(value: unknown, { fallback, max }: { fallback: number; max: number }): number {
  return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
}

function cursor(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0) throw new OrchestratorInputError(`${name} must be a message id`);
  return Number(value);
}

export function cutMessageText(value: string): string {
  return value.length > MAX_MESSAGE_CHARS ? `${value.slice(0, MAX_MESSAGE_CHARS - CUT_SUFFIX.length)}${CUT_SUFFIX}` : value;
}

export interface ChatItem { role: ChatRole; text: string; at: Date }

function parseItems(input: unknown, roles: readonly ChatRole[], max: number, now: Date): ChatItem[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new OrchestratorInputError('Messages must be a list');
  if (input.length > max) throw new OrchestratorInputError(`A maximum of ${max} messages per request is supported`);
  return input.map((item): ChatItem => {
    if (!isRecord(item) || typeof item.text !== 'string') throw new OrchestratorInputError('Each message needs a role, text and time');
    const role = item.role as ChatRole;
    if (typeof role !== 'string' || !roles.includes(role)) throw new OrchestratorInputError(`Message role must be one of ${roles.join(', ')}`);
    return { role, text: cutMessageText(item.text), at: isoDate(item.at, 'Message time', now) };
  });
}

export function parseSessionSync(input: unknown, now = new Date()) {
  if (!isRecord(input) || !isRecord(input.session)) throw new OrchestratorInputError('A session object is required');
  const { session } = input;
  return {
    id: chatId(session.id, 'Session id'),
    title: text(session.title, MAX_TITLE_CHARS),
    ticketKey: optionalTicketKey(session.ticketKey),
    startedAt: isoDate(session.startedAt, 'startedAt', now),
    lastMessageAt: isoDate(session.lastMessageAt, 'lastMessageAt', now),
    replace: flag(input.replace, 'replace'),
    messages: parseItems(input.messages, CHAT_ROLES, MAX_SYNC_MESSAGES, now),
  };
}

export function parseClaim(input: unknown): { wait: number; caps?: BridgeCaps } {
  if (!isRecord(input)) throw new OrchestratorInputError('A claim object is required');
  const wait = input.wait === undefined || input.wait === null ? 0 : input.wait;
  if (typeof wait !== 'number' || !Number.isFinite(wait) || wait < 0 || wait > MAX_CLAIM_WAIT_SECONDS) {
    throw new OrchestratorInputError(`wait must be between 0 and ${MAX_CLAIM_WAIT_SECONDS} seconds`);
  }
  const caps = parseCaps(input.caps);
  return caps ? { wait, caps } : { wait };
}

export function parseDelta(input: unknown, now = new Date()) {
  if (!isRecord(input)) throw new OrchestratorInputError('A delta object is required');
  if (!Number.isInteger(input.replyTo) || Number(input.replyTo) < 1) throw new OrchestratorInputError('replyTo must be a message id');
  if (input.error !== undefined && input.error !== null && typeof input.error !== 'string') {
    throw new OrchestratorInputError('error must be text');
  }
  if (input.detail !== undefined && input.detail !== null && typeof input.detail !== 'string') {
    throw new OrchestratorInputError('detail must be text');
  }
  return {
    sessionId: chatId(input.sessionId, 'sessionId'),
    replyTo: Number(input.replyTo),
    claudeSessionId: optionalChatId(input.claudeSessionId, 'claudeSessionId'),
    items: parseItems(input.items, ['assistant', 'tool'], MAX_DELTA_ITEMS, now),
    detail: text(input.detail, MAX_DETAIL_CHARS) || null,
    done: flag(input.done, 'done'),
    error: text(input.error, MAX_ERROR_CHARS) || null,
    ...(input.stopped === undefined ? {} : { stopped: flag(input.stopped, 'stopped') }),
  };
}

function activityId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ACTIVITY_ID.test(value) || value === SERVER_DROPPED_ID || maskActivityText(value) !== value) {
    throw new OrchestratorInputError(`${name} must be an id of letters, digits, dashes and underscores`);
  }
  return value;
}

function parseActivityEvent(input: unknown, now: Date): ActivityEvent {
  if (!isRecord(input)) throw new OrchestratorInputError('Each event needs an id, kind, name, status and start time');
  if (typeof input.kind !== 'string' || !ACTIVITY_KINDS.includes(input.kind as ActivityKind)) {
    throw new OrchestratorInputError(`kind must be one of ${ACTIVITY_KINDS.join(', ')}`);
  }
  if (typeof input.status !== 'string' || !ACTIVITY_STATUSES.includes(input.status as ActivityStatus)) {
    throw new OrchestratorInputError(`status must be one of ${ACTIVITY_STATUSES.join(', ')}`);
  }
  const name = activityText(input.name, ACTIVITY_LIMITS.name, true);
  if (!name) throw new OrchestratorInputError('An event needs a name');
  return fitActivityEvent({
    eventId: activityId(input.id, 'id'),
    parentId: input.parentId === undefined || input.parentId === null ? null : activityId(input.parentId, 'parentId'),
    kind: input.kind as ActivityKind,
    agent: activityText(input.agent, ACTIVITY_LIMITS.agent, true) || 'main',
    name,
    label: activityText(input.label, ACTIVITY_LIMITS.label, true),
    summary: activityText(input.summary, ACTIVITY_LIMITS.summary, true),
    detail: activityText(input.detail, ACTIVITY_LIMITS.detail) || null,
    status: input.status as ActivityStatus,
    startedAt: isoDate(input.startedAt, 'startedAt', now),
    endedAt: input.endedAt === undefined || input.endedAt === null ? null : isoDate(input.endedAt, 'endedAt', now),
  });
}

export function parseActivity(input: unknown, now = new Date()) {
  if (!isRecord(input)) throw new OrchestratorInputError('An activity object is required');
  if (input.v !== ACTIVITY_VERSION) throw new OrchestratorInputError(`v must be ${ACTIVITY_VERSION}`);
  if (!Number.isInteger(input.replyTo) || Number(input.replyTo) < 1) throw new OrchestratorInputError('replyTo must be a message id');
  if (!Array.isArray(input.events)) throw new OrchestratorInputError('events must be a list');
  if (input.events.length > MAX_ACTIVITY_EVENTS) {
    throw new OrchestratorInputError(`A maximum of ${MAX_ACTIVITY_EVENTS} events per request is supported`);
  }
  return {
    sessionId: chatId(input.sessionId, 'sessionId'),
    replyTo: Number(input.replyTo),
    events: input.events.map((event) => parseActivityEvent(event, now)),
  };
}

function optionalNumber(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new OrchestratorInputError(`${name} must be a number of 0 or more`);
  return value;
}

function optionalFlag(value: unknown, name: string): boolean | null {
  return value === undefined || value === null ? null : flag(value, name);
}

function limitWindow(value: unknown, name: string) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new OrchestratorInputError(`${name} must be an object`);
  const usedPercentage = optionalNumber(value.usedPercentage, `${name}.usedPercentage`);
  if (usedPercentage === null) return null;
  const resetsAt = optionalNumber(value.resetsAt, `${name}.resetsAt`);
  return { usedPercentage, resetsAt: resetsAt === null ? null : new Date(resetsAt * 1000) };
}

export function parseStatus(input: unknown) {
  if (!isRecord(input)) throw new OrchestratorInputError('A status object is required');
  return {
    sessionId: chatId(input.sessionId, 'sessionId'),
    model: text(input.model, MAX_STATUS_TEXT_CHARS) || null,
    effort: text(input.effort, MAX_STATUS_TEXT_CHARS) || null,
    fastMode: optionalFlag(input.fastMode, 'fastMode'),
    contextPercentage: optionalNumber(input.contextPercentage, 'contextPercentage'),
    contextTokens: optionalNumber(input.contextTokens, 'contextTokens'),
    contextSize: optionalNumber(input.contextSize, 'contextSize'),
    costUsd: optionalNumber(input.costUsd, 'costUsd'),
    cacheWarm: optionalFlag(input.cacheWarm, 'cacheWarm'),
    cacheHitRatio: optionalNumber(input.cacheHitRatio, 'cacheHitRatio'),
    fiveHour: limitWindow(input.fiveHour, 'fiveHour'),
    sevenDay: limitWindow(input.sevenDay, 'sevenDay'),
  };
}

type ParsedStatus = ReturnType<typeof parseStatus>;
type LimitWindow = NonNullable<ReturnType<typeof limitWindow>>;
type LimitsSeen = { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; receivedAt: Date };

const presentWindow = (window: LimitWindow | null) => window && {
  usedPercentage: window.usedPercentage,
  resetsAt: window.resetsAt?.toISOString() ?? null,
};

/** About 60 characters either side of the first match, on one line. */
export function searchSnippet(value: string, query: string): string {
  const found = value.toLowerCase().indexOf(query.toLowerCase());
  const index = found < 0 ? 0 : found;
  const start = Math.max(0, index - SNIPPET_SIDE_CHARS);
  const end = Math.min(value.length, index + query.length + SNIPPET_SIDE_CHARS);
  return `${start > 0 ? '…' : ''}${value.slice(start, end).replace(/\s+/g, ' ')}${end < value.length ? '…' : ''}`;
}

interface SessionRow {
  id: string;
  source: string;
  machine: string;
  title: string;
  ticketKey: string | null;
  forkFrom: string | null;
  claudeSessionId: string | null;
  status: string;
  statusDetail: string | null;
  messageCount: number;
  startedAt: Date;
  lastMessageAt: Date;
  options?: string | null;
}

interface InteractionRow {
  id: number;
  sessionId: string;
  turnId: number;
  kind: string;
  title: string;
  body: string;
  state: string;
  createdAt: Date;
  expiresAt: Date;
  answeredAt: Date | null;
}

interface MachineInfo { caps: BridgeCaps | null; capsJson: string; catalog: Catalog | null; catalogHash: string }

interface MessageRow { id: number; sessionId: string; role: string; text: string; state: string; at: Date; stopRequestedAt?: Date | null }

function knownMachine(machine: string, machines: string[]) {
  if (typeof machine !== 'string' || !machines.includes(machine)) throw new OrchestratorInputError('Unknown machine');
}

function toInteraction(row: InteractionRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  };
}

function toSession(row: SessionRow, lastText: string | null, waiting = false) {
  return {
    id: row.id,
    source: row.source,
    machine: row.machine,
    title: row.title,
    ticketKey: row.ticketKey,
    forkFrom: row.forkFrom,
    status: row.status,
    statusDetail: row.statusDetail,
    messageCount: row.messageCount,
    startedAt: row.startedAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastText,
    waiting,
    options: parseStoredOptions(row.options),
  };
}

function toMessage(row: MessageRow) {
  return { id: row.id, sessionId: row.sessionId, role: row.role, text: row.text, state: row.state, at: row.at.toISOString(), stopped: Boolean(row.stopRequestedAt) };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export class ChatService {
  private readonly bridgeSeenAt = new Map<string, Date>();
  private activityWrites: Promise<unknown> = Promise.resolve();
  private readonly sessionStatus = new Map<string, Map<string, ParsedStatus & { receivedAt: Date }>>();
  private readonly limitsSeen = new Map<string, LimitsSeen>();
  private lastActivityPruneAt = 0;
  private lastAttachmentPruneAt = 0;
  private readonly notifier = new TurnNotifier();
  private readonly machineInfo = new Map<string, MachineInfo>();
  private readonly openWaits = new Map<number, AbortController>();

  constructor(
    private readonly storage = new StorageService(),
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
    private readonly attachments: Pick<ChatAttachmentService, 'attach' | 'release' | 'forMessages' | 'forClaim' | 'openForBridge' | 'deleteForSession' | 'prune'> = chatAttachmentService,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.activityWrites.then(work);
    this.activityWrites = run.catch(() => undefined);
    return run;
  }

  waiters() {
    return this.notifier.size();
  }

  private async present(rows: SessionRow[]) {
    const lastTexts = await this.storage.getChatLastTexts(rows.map((row) => row.id), LAST_TEXT_CHARS);
    const waiting = await this.storage.getWaitingChatSessionIds(rows.filter((row) => row.status === 'running').map((row) => row.id), this.now());
    return rows.map((row) => toSession(row, lastTexts.get(row.id) ?? null, waiting.has(row.id)));
  }

  /** A turn the bridge took and then went silent on is given up, so the session can be used again. */
  private async failStale() {
    const now = this.now().getTime();
    const stale = await this.storage.getStaleChatSessions(new Date(now - STALE_TAKEN_MS));
    const overdue = await this.storage.getOverdueChatSessions(new Date(now - TAKEN_HARD_MS));
    for (const draft of await this.storage.getStaleChatDrafts(new Date(now - DRAFT_MAX_MS))) await this.discardDraft(draft.id);
    const staleIds = new Set(stale.map((session) => session.id));
    for (const session of stale) await this.giveUp(session.id, STALE_TEXT);
    for (const session of overdue) if (!staleIds.has(session.id)) await this.giveUp(session.id, TAKEN_HARD_TEXT);
    const ended = new Set([...staleIds, ...overdue.map((session) => session.id)]);
    const quiet = await this.storage.getQuietChatTurns(new Date(now - SILENT_TAKEN_MS), new Date(now - STOP_GRACE_MS));
    for (const turn of quiet.unstopped) {
      if (ended.has(turn.sessionId)) continue;
      ended.add(turn.sessionId);
      await this.endStopped(turn.sessionId, turn.turnId);
    }
    const silent = quiet.silent.filter((turn) => !ended.has(turn.sessionId));
    const waiting = await this.storage.getWaitingChatSessionIds(silent.map((turn) => turn.sessionId), this.now());
    for (const turn of silent) if (!waiting.has(turn.sessionId)) await this.giveUp(turn.sessionId, SILENT_TEXT);
  }

  private async endStopped(sessionId: string, turnId: number) {
    if (!await this.storage.moveChatMessage(turnId, sessionId, 'taken', 'done')) return;
    await this.storage.updateChatSession(sessionId, { status: 'idle', statusDetail: STOPPED_TEXT });
    await this.closeActivity(sessionId, turnId);
    await this.serial(() => this.storage.cancelChatInteractions(sessionId, turnId));
    this.notifier.wake(turnId);
  }

  private async giveUp(sessionId: string, detail: string) {
    const turns = await this.storage.getChatMessageIdsInState(sessionId, ['taken']);
    await this.storage.moveChatMessages(sessionId, 'taken', 'failed');
    await this.storage.updateChatSession(sessionId, { status: 'error', statusDetail: detail });
    await this.closeActivity(sessionId, null);
    await this.serial(() => this.storage.cancelChatInteractions(sessionId, null));
    for (const turnId of turns) this.notifier.wake(turnId);
  }

  private async discardDraft(id: number) {
    if (await this.storage.deleteChatDraft(id)) await this.attachments.release(id);
  }

  private async closeTurn(sessionId: string, turnId: number) {
    if ((await this.storage.getPendingChatInteractions(sessionId, 1)).length > 0) {
      await this.serial(() => this.storage.cancelChatInteractions(sessionId, turnId));
    }
    this.notifier.wake(turnId);
  }

  private async isInteractive(machine: string) {
    return (await this.info(machine)).caps?.features.includes('interactive') === true;
  }

  private async expireOverdue(sessionId: string, now: Date) {
    if (await this.storage.hasOverdueChatInteractions(sessionId, now)) {
      await this.serial(() => this.storage.expireChatInteractions(sessionId, now));
    }
  }

  private async info(machine: string): Promise<MachineInfo> {
    const known = this.machineInfo.get(machine);
    if (known) return known;
    const row = await this.storage.getChatMachineInfo(machine);
    const info: MachineInfo = {
      caps: row ? parseStoredCaps(row.caps) : null,
      capsJson: row?.caps ?? '',
      catalog: row ? parseStoredCatalog(row.catalog) : null,
      catalogHash: row?.catalogHash ?? '',
    };
    this.machineInfo.set(machine, info);
    return info;
  }

  private async recordCaps(machine: string, caps: BridgeCaps) {
    const info = await this.info(machine);
    const json = JSON.stringify(caps);
    if (info.capsJson === json) return;
    info.caps = caps;
    info.capsJson = json;
    await this.serial(() => this.storage.upsertChatMachineInfo(machine, { caps: json }));
  }

  private async clearCaps(machine: string) {
    const info = await this.info(machine);
    if (!info.caps && info.capsJson === '') return;
    await this.serial(() => this.storage.upsertChatMachineInfo(machine, { caps: '' }));
    info.caps = null;
    info.capsJson = '';
  }

  async ingestCatalog(input: unknown, machine: string) {
    const catalog = parseCatalog(input);
    const info = await this.info(machine);
    await this.serial(() => this.storage.upsertChatMachineInfo(machine, { catalog: JSON.stringify(catalog), catalogHash: catalog.hash }));
    info.catalog = catalog;
    info.catalogHash = catalog.hash;
    return { hash: catalog.hash };
  }

  async commands(machine: string, query: string | null | undefined, limitInput: number | null | undefined, machines: string[]) {
    knownMachine(machine, machines);
    return searchCommands((await this.info(machine)).catalog?.commands ?? [], query, limitInput);
  }

  async machineOptions(machine: string, machines: string[]) {
    knownMachine(machine, machines);
    const { caps, catalog } = await this.info(machine);
    if (!caps && !catalog) return null;
    return {
      models: catalog?.models ?? [],
      modes: caps?.modes ?? [],
      fastAvailable: caps?.features.includes('fast') === true && catalog?.fast.available === true,
    };
  }

  async machinesWithInfo(names: string[]) {
    return Promise.all(this.machines(names).map(async (machine) => {
      const { caps } = await this.info(machine.name);
      return { ...machine, capabilities: caps?.features ?? [], claudeVersion: caps?.claude || null };
    }));
  }

  async pending(sessionId: string, status: string, machine: string) {
    if (status !== 'running' || !CHAT_ID.test(String(sessionId))) return [];
    try {
      if (!await this.isInteractive(machine)) return [];
      const now = this.now();
      await this.expireOverdue(sessionId, now);
      return (await this.storage.getPendingChatInteractions(sessionId, PENDING_LIST_LIMIT, now)).map(toInteraction);
    } catch (error) {
      console.error('[Chat] reading pending requests failed:', error instanceof Error ? error.message : 'unknown error');
      return [];
    }
  }

  async settled(sessionId: string, status: string, machine: string) {
    if (status !== 'running' || !CHAT_ID.test(String(sessionId))) return [];
    try {
      if (!await this.isInteractive(machine)) return [];
      const turn = await this.storage.getOpenChatMessage(sessionId);
      if (turn?.state !== 'taken') return [];
      return (await this.storage.getSettledChatInteractions(sessionId, turn.id, SETTLED_LIST_LIMIT)).map((row) => ({
        id: row.id,
        state: row.state,
        decision: row.state === 'answered' ? parseStoredAnswer(row.answer)?.decision ?? null : null,
      }));
    } catch (error) {
      console.error('[Chat] reading settled requests failed:', error instanceof Error ? error.message : 'unknown error');
      return [];
    }
  }

  async withAttachments<T extends { id: number; role: string }>(rows: T[]) {
    const ids = rows.filter((row) => row.role === 'user').map((row) => row.id);
    let byMessage: Awaited<ReturnType<ChatAttachmentService['forMessages']>> = new Map();
    if (ids.length > 0) {
      try {
        byMessage = await this.attachments.forMessages(ids);
      } catch (error) {
        console.error('[Chat] reading attachments failed:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    return rows.map((row) => ({ ...row, attachments: byMessage.get(row.id) ?? [] }));
  }

  openAttachment(input: unknown, machine: string) {
    return this.attachments.openForBridge(input, machine);
  }

  private async pruneAttachments(now: Date) {
    if (now.getTime() - this.lastAttachmentPruneAt < ATTACHMENT_PRUNE_INTERVAL_MS) return;
    this.lastAttachmentPruneAt = now.getTime();
    try {
      await this.attachments.prune(now);
    } catch (error) {
      console.error('[Chat] pruning attachments failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  private async closeActivity(sessionId: string, turnId: number | null) {
    try {
      await this.storage.closeRunningChatActivity(sessionId, turnId, 'stopped', this.now());
    } catch (error) {
      console.error('[Chat] closing activity failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  private async pruneActivity(now: Date) {
    if (now.getTime() - this.lastActivityPruneAt < ACTIVITY_PRUNE_INTERVAL_MS) return;
    this.lastActivityPruneAt = now.getTime();
    try {
      await this.storage.pruneChatActivity({
        detailBefore: new Date(now.getTime() - ACTIVITY_DETAIL_KEEP_MS),
        rowsBefore: new Date(now.getTime() - ACTIVITY_ROWS_KEEP_MS),
        maxRows: MAX_ACTIVITY_ROWS,
      });
      await this.storage.pruneChatInteractions({ before: new Date(now.getTime() - INTERACTION_KEEP_MS), maxRows: MAX_INTERACTION_ROWS });
    } catch (error) {
      console.error('[Chat] pruning activity failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  async sessions(sourceInput?: string | null, limitInput?: number | null) {
    const source = sourceInput === undefined || sourceInput === null ? null : sourceInput;
    if (source !== null && !CHAT_SOURCES.includes(source as ChatSource)) {
      throw new OrchestratorInputError(`Source must be one of ${CHAT_SOURCES.join(', ')}`);
    }
    await this.failStale();
    return this.present(await this.storage.getChatSessions(source, limit(limitInput, SESSIONS_LIMIT)));
  }

  async session(id: string) {
    if (!CHAT_ID.test(String(id))) return null;
    await this.failStale();
    const row = await this.storage.getChatSession(id);
    return row ? (await this.present([row]))[0] : null;
  }

  async messages(sessionId: string, afterId?: number | null, beforeId?: number | null, limitInput?: number | null) {
    if (!CHAT_ID.test(String(sessionId))) return [];
    const rows = await this.storage.getChatMessages(
      sessionId,
      { afterId: cursor(afterId, 'afterId'), beforeId: cursor(beforeId, 'beforeId') },
      limit(limitInput, MESSAGES_LIMIT),
    );
    return rows.map(toMessage);
  }

  async activityRows(
    sessionId: string,
    args: { afterSeq?: number | null; fromTurnId?: number | null; beforeTurnId?: number | null; limit?: number | null },
  ) {
    if (!CHAT_ID.test(String(sessionId))) return [];
    const rows = await this.storage.getChatActivity(
      sessionId,
      { afterSeq: cursor(args.afterSeq, 'afterSeq'), fromTurnId: cursor(args.fromTurnId, 'fromTurnId'), beforeTurnId: cursor(args.beforeTurnId, 'beforeTurnId') },
      limit(args.limit, ACTIVITY_ROWS_LIMIT),
    );
    return rows.map(toActivity);
  }

  async activityDetail(sessionId: string, id: number) {
    if (!CHAT_ID.test(String(sessionId)) || !Number.isInteger(id)) return null;
    return this.storage.getChatActivityDetail(sessionId, id);
  }

  async search(queryInput: string, limitInput?: number | null) {
    const query = text(queryInput, MAX_QUERY_CHARS);
    if (query.length < MIN_QUERY_CHARS) return [];
    const rows = await this.storage.searchChatMessages(query, limit(limitInput, SEARCH_LIMIT));
    const sessions = await this.present(await this.storage.getChatSessionsByIds([...new Set(rows.map((row) => row.sessionId))]));
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return rows.flatMap((row) => {
      const session = byId.get(row.sessionId);
      return session ? [{ session, messageId: row.id, snippet: searchSnippet(row.text, query), at: row.at.toISOString() }] : [];
    });
  }

  bridge(machine?: string) {
    const seen = machine === undefined
      ? [...this.bridgeSeenAt.values()].reduce<Date | null>((newest, at) => (!newest || at > newest ? at : newest), null)
      : this.bridgeSeenAt.get(machine) ?? null;
    return {
      online: Boolean(seen) && this.now().getTime() - seen!.getTime() <= BRIDGE_ONLINE_MS,
      lastSeenAt: seen?.toISOString() ?? null,
    };
  }

  machines(names: string[]) {
    return names.map((name) => ({ name, ...this.bridge(name) }));
  }

  statusSnapshot(machine?: string) {
    const now = this.now().getTime();
    const stale = (at: Date) => now - at.getTime() > STATUS_STALE_MS;
    const limits = machine === undefined
      ? [...this.limitsSeen.values()].reduce<LimitsSeen | null>((newest, seen) => (!newest || seen.receivedAt > newest.receivedAt ? seen : newest), null)
      : this.limitsSeen.get(machine) ?? null;
    return {
      limits: limits && {
        fiveHour: presentWindow(limits.fiveHour),
        sevenDay: presentWindow(limits.sevenDay),
        receivedAt: limits.receivedAt.toISOString(),
        stale: stale(limits.receivedAt),
      },
      sessions: [...this.sessionStatus]
        .filter(([name]) => machine === undefined || name === machine)
        .flatMap(([name, byId]) => [...byId.values()].map(({ fiveHour, sevenDay, receivedAt, ...status }) => ({
          ...status,
          machine: name,
          receivedAt: receivedAt.toISOString(),
          stale: stale(receivedAt),
        }))),
    };
  }

  async ingestStatus(input: unknown, machine: string) {
    const status = parseStatus(input);
    const known = await this.storage.getChatSession(status.sessionId);
    if (known && known.machine !== machine) return { sessionId: status.sessionId, ignored: true, owner: known.machine };
    const receivedAt = this.now();
    const mine = this.sessionStatus.get(machine) ?? new Map<string, ParsedStatus & { receivedAt: Date }>();
    this.sessionStatus.set(machine, mine);
    mine.delete(status.sessionId);
    mine.set(status.sessionId, { ...status, receivedAt });
    if (mine.size > MAX_STATUS_SESSIONS) mine.delete(mine.keys().next().value!);
    if (status.fiveHour || status.sevenDay) {
      this.limitsSeen.set(machine, { fiveHour: status.fiveHour, sevenDay: status.sevenDay, receivedAt });
      await this.storage.upsertCache('chat', 'limits', Object.fromEntries(this.limitsSeen), LIMITS_KEEP_SECONDS).catch(() => undefined);
    }
    return { sessionId: status.sessionId };
  }

  /** Reads the limits the last process saved, so a restart does not blank them until the next push. */
  async restoreLimits() {
    const saved = await this.storage.getCache('chat', 'limits').catch(() => null);
    if (!isRecord(saved)) return;
    const window = (value: any): LimitWindow | null => (value ? { usedPercentage: value.usedPercentage, resetsAt: value.resetsAt ? new Date(value.resetsAt) : null } : null);
    for (const [machine, seen] of Object.entries(saved as Record<string, any>)) {
      if (this.limitsSeen.has(machine)) continue;
      this.limitsSeen.set(machine, { fiveHour: window(seen.fiveHour), sevenDay: window(seen.sevenDay), receivedAt: new Date(seen.receivedAt) });
    }
  }

  async balloons() {
    const since = new Date(this.now().getTime() - BALLOON_MAX_AGE_MS);
    const sessions = await this.storage.getChatSessionsWithTicket('dock', since);
    const newest = await Promise.all(sessions.map((session) => this.storage.getNewestChatMessage(session.id, 'assistant')));
    return newest.flatMap((message) => (message && message.at >= since ? [toMessage(message)] : []));
  }

  async createSession(input: { title?: string | null; ticketKey?: string | null; forkFrom?: string | null; machine?: string | null }) {
    const forkFrom = optionalChatId(input.forkFrom, 'forkFrom');
    const source = forkFrom ? await this.storage.getChatSession(forkFrom) : null;
    if (forkFrom && source?.source !== 'cli') {
      throw new OrchestratorInputError('forkFrom must be an existing cli session');
    }
    const requested = input.machine === undefined || input.machine === null || input.machine === '' ? null : normalizeMachine(input.machine);
    const machine = requested ?? source?.machine ?? DEFAULT_MACHINE;
    if (source && machine !== source.machine) {
      throw new OrchestratorInputError('A fork stays on the machine that holds the transcript');
    }
    const now = this.now();
    const row = await this.storage.createChatSession({
      id: randomUUID(),
      source: 'dock',
      machine,
      title: text(input.title, MAX_TITLE_CHARS),
      ticketKey: optionalTicketKey(input.ticketKey),
      forkFrom,
      startedAt: now,
      lastMessageAt: now,
    });
    return toSession(row, null);
  }

  async sendMessage(
    sessionIdInput: string,
    textInput: string,
    machines: string[],
    extras: { attachmentIds?: string[] | null; options?: unknown } = {},
  ) {
    const sessionId = chatId(sessionIdInput, 'sessionId');
    const body = typeof textInput === 'string' ? textInput.trim() : '';
    const attachmentIds = [...new Set(extras.attachmentIds ?? [])];
    if (attachmentIds.length > ATTACHMENT_LIMITS.perMessage) {
      throw new OrchestratorInputError(`A maximum of ${ATTACHMENT_LIMITS.perMessage} attachments per message is supported`);
    }
    if ((body.length < 1 && attachmentIds.length < 1) || body.length > MAX_SEND_CHARS) {
      throw new OrchestratorInputError(`A message needs between 1 and ${MAX_SEND_CHARS} characters`);
    }
    const options = parseTurnOptions(extras.options);
    await this.failStale();
    const session = await this.storage.getChatSession(sessionId);
    if (!session) throw new OrchestratorInputError('Unknown chat session');
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session can be written to');
    if (!machines.includes(session.machine)) {
      throw new OrchestratorInputError(`No ingest token exists for the machine ${session.machine}, so nothing would answer this message`);
    }
    if (await this.storage.countChatMessagesInState(sessionId, ['draft', 'queued', 'taken']) > 0) {
      throw new OrchestratorInputError('This session is still working on the previous message');
    }
    if (attachmentIds.length > 0 || options) {
      const { caps, catalog } = await this.info(session.machine);
      if (attachmentIds.length > 0 && caps?.features.includes('attachments') !== true) {
        throw new OrchestratorInputError('This machine cannot receive attachments yet');
      }
      if (options) checkTurnOptions(options, caps, catalog);
    }
    const now = this.now();
    const optionsJson = options ? JSON.stringify(options) : null;
    let message = await this.storage.createChatMessage({
      sessionId, role: 'user', text: body, state: attachmentIds.length > 0 ? 'draft' : 'queued', at: now, options: optionsJson,
    });
    let attached: Awaited<ReturnType<ChatAttachmentService['attach']>> = [];
    if (attachmentIds.length > 0) {
      try {
        attached = await this.attachments.attach(sessionId, message.id, attachmentIds);
        if (!await this.storage.moveChatMessage(message.id, sessionId, 'draft', 'queued')) {
          throw new OrchestratorInputError('The message could not be sent. Try again.');
        }
      } catch (error) {
        await this.discardDraft(message.id).catch((cleanup) => {
          console.error('[Chat] removing a draft failed:', cleanup instanceof Error ? cleanup.message : 'unknown error');
        });
        throw error;
      }
      message = { ...message, state: 'queued' };
    }
    const messageCount = await this.storage.trimChatMessages(sessionId, MAX_MESSAGES_KEPT);
    await this.storage.updateChatSession(sessionId, {
      status: 'queued', statusDetail: null, messageCount, lastMessageAt: now, ...(optionsJson ? { options: optionsJson } : {}),
    });
    return { ...toMessage(message), ...(attached.length > 0 ? { attachments: attached } : {}) };
  }

  private async turnMessage(sessionId: string, id: number) {
    const message = await this.storage.getChatMessage(id);
    if (!message || message.sessionId !== sessionId || message.role !== 'user') {
      throw new OrchestratorInputError('replyTo is not a message of this session');
    }
    return message;
  }

  async stopTurn(sessionIdInput: string) {
    const sessionId = chatId(sessionIdInput, 'sessionId');
    await this.failStale();
    const session = await this.storage.getChatSession(sessionId);
    if (!session) throw new OrchestratorInputError('Unknown chat session');
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session can be stopped');
    let open = await this.storage.getOpenChatMessage(sessionId);
    if (open?.state === 'queued') {
      if (await this.storage.moveChatMessage(open.id, sessionId, 'queued', 'failed')) {
        const row = await this.storage.updateChatSession(sessionId, { status: 'idle', statusDetail: STOPPED_QUEUED_TEXT });
        return (await this.present([row]))[0];
      }
      open = await this.storage.getOpenChatMessage(sessionId);
    }
    if (open?.state === 'taken') {
      const turnId = open.id;
      await this.serial(() => this.storage.requestChatStop(turnId, sessionId, this.now()));
      this.notifier.wake(turnId);
    }
    return (await this.present([(await this.storage.getChatSession(sessionId))!]))[0];
  }

  async ask(input: unknown, machine: string) {
    const now = this.now();
    const request = parseAsk(input, now);
    this.bridgeSeenAt.set(machine, now);
    const session = await this.storage.getChatSession(request.sessionId);
    if (!session || session.machine !== machine) return null;
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session takes requests');
    const replyTo = await this.turnMessage(session.id, request.replyTo);
    if (replyTo.state !== 'taken') return { id: 0, expiresAt: now.toISOString(), closed: true };
    const created = await this.serial(() => this.storage.createChatInteraction({
      sessionId: session.id,
      turnId: replyTo.id,
      requestId: request.requestId,
      kind: request.kind,
      title: request.title,
      body: request.body,
      expiresAt: request.expiresAt,
    }, { pending: MAX_PENDING_ASKS, perTurn: MAX_ASKS_PER_TURN }, now));
    if (created.refused === 'pending') throw new OrchestratorInputError(`A maximum of ${MAX_PENDING_ASKS} pending requests per turn is supported`);
    if (created.refused === 'turn') throw new OrchestratorInputError(`A maximum of ${MAX_ASKS_PER_TURN} requests per turn is supported`);
    if (!session.lastDeltaAt || now.getTime() - session.lastDeltaAt.getTime() >= WAIT_TOUCH_MS) {
      await this.serial(() => this.storage.updateChatSession(session.id, { lastDeltaAt: now }));
    }
    return { id: created.row!.id, expiresAt: created.row!.expiresAt.toISOString(), closed: false };
  }

  private async turnState(sessionId: string, turnId: number, interactive: boolean) {
    const message = await this.storage.getChatMessage(turnId);
    if (interactive) await this.expireOverdue(sessionId, this.now());
    const rows = await this.storage.getUndeliveredChatInteractions(sessionId, turnId);
    const answers = rows.map((row): WaitAnswer => ({
      requestId: row.requestId,
      kind: row.kind as InteractionKind,
      state: row.state === 'expired' ? 'expired' : 'answered',
      answer: row.state === 'expired' ? null : parseStoredAnswer(row.answer),
    }));
    const stop = Boolean(message?.stopRequestedAt);
    const closed = message?.state !== 'taken';
    return { ready: stop || closed || answers.length > 0, result: { stop, answers, closed } };
  }

  async wait(input: unknown, signal: AbortSignal | undefined, machine: string) {
    const request = parseWait(input);
    const now = this.now();
    this.bridgeSeenAt.set(machine, now);
    const session = await this.storage.getChatSession(request.sessionId);
    if (!session || session.machine !== machine) return null;
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session takes waits');
    const replyTo = await this.turnMessage(session.id, request.replyTo);
    if (request.caps) await this.recordCaps(machine, request.caps);
    if (request.ack.length > 0) {
      await this.serial(() => this.storage.markChatInteractionsDelivered(session.id, replyTo.id, request.ack, now));
    }
    if (request.cancelled.length > 0) {
      await this.serial(() => this.storage.cancelChatInteractionsByRequest(session.id, replyTo.id, request.cancelled));
    }
    if (replyTo.state === 'taken') {
      if (replyTo.takenAt && now.getTime() - replyTo.takenAt.getTime() >= TAKEN_HARD_MS) {
        await this.giveUp(session.id, TAKEN_HARD_TEXT);
      } else if (!session.lastDeltaAt || now.getTime() - session.lastDeltaAt.getTime() >= WAIT_TOUCH_MS) {
        await this.serial(() => this.storage.updateChatSession(session.id, { lastDeltaAt: now }));
      }
    }
    const local = new AbortController();
    if (request.wait > 0) {
      this.openWaits.get(replyTo.id)?.abort();
      this.openWaits.set(replyTo.id, local);
    }
    const hangup = () => local.abort();
    if (signal?.aborted) local.abort();
    signal?.addEventListener('abort', hangup, { once: true });
    const woken = this.notifier.wait(replyTo.id, local.signal);
    try {
      const interactive = await this.isInteractive(machine);
      let state = await this.turnState(session.id, replyTo.id, interactive);
      if (!state.ready && request.wait > 0 && !local.signal.aborted) {
        await Promise.race([woken, this.sleep(request.wait * 1000, local.signal)]);
        state = await this.turnState(session.id, replyTo.id, interactive);
      }
      return state.result;
    } finally {
      local.abort();
      if (this.openWaits.get(replyTo.id) === local) this.openWaits.delete(replyTo.id);
      signal?.removeEventListener('abort', hangup);
    }
  }

  async answerInteraction(sessionIdInput: string, id: number, decision: string, answers: AnswerInput[] | null | undefined, note: unknown) {
    const sessionId = chatId(sessionIdInput, 'sessionId');
    const row = Number.isInteger(id) ? await this.storage.getChatInteraction(id) : null;
    if (!row || row.sessionId !== sessionId) throw new OrchestratorInputError('Unknown request');
    const now = this.now();
    if (row.state === 'pending' && row.expiresAt < now) {
      await this.serial(() => this.storage.expireChatInteractions(sessionId, now));
      throw new OrchestratorInputError('This request expired');
    }
    if (row.state === 'expired') throw new OrchestratorInputError('This request expired');
    if (row.state !== 'pending') throw new OrchestratorInputError('This request is no longer pending');
    if ((await this.storage.getChatMessage(row.turnId))?.state !== 'taken') {
      await this.serial(() => this.storage.cancelChatInteractions(sessionId, row.turnId));
      throw new OrchestratorInputError('This request is no longer pending');
    }
    const answer = JSON.stringify(checkAnswer(row, decision, answers, note));
    const saved = await this.serial(() => this.storage.answerChatInteraction(row.id, answer, now));
    if (!saved) throw new OrchestratorInputError('This request is no longer pending');
    this.notifier.wake(row.turnId);
    return toInteraction({ ...row, state: 'answered', answeredAt: now });
  }

  async renameSession(idInput: string, titleInput: string) {
    const id = chatId(idInput, 'id');
    if (typeof titleInput !== 'string') throw new OrchestratorInputError('A title is required');
    if (!await this.storage.getChatSession(id)) throw new OrchestratorInputError('Unknown chat session');
    const row = await this.storage.updateChatSession(id, { title: text(titleInput, MAX_TITLE_CHARS) });
    return (await this.present([row]))[0];
  }

  async deleteSession(id: string) {
    if (!CHAT_ID.test(String(id))) return false;
    const turns = await this.storage.getChatMessageIdsInState(id, ['taken']);
    const deleted = await this.storage.deleteChatSession(id);
    if (deleted) {
      for (const turnId of turns) this.notifier.wake(turnId);
      try {
        await this.attachments.deleteForSession(id);
      } catch (error) {
        console.error('[Chat] removing attachments failed:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    return deleted;
  }

  /** History of a terminal session, pushed from the laptop in batches. */
  async syncSession(input: unknown, machine: string) {
    const sync = parseSessionSync(input, this.now());
    const existing = await this.storage.getChatSession(sync.id);
    if (existing && existing.source !== 'cli') {
      throw new OrchestratorInputError('This id belongs to a DOCK session and cannot be overwritten');
    }
    if (existing && existing.machine !== machine) {
      throw new OrchestratorInputError('This session belongs to another machine');
    }
    const fields = { title: sync.title, ticketKey: sync.ticketKey, startedAt: sync.startedAt, lastMessageAt: sync.lastMessageAt };
    if (!existing) await this.storage.createChatSession({ id: sync.id, source: 'cli', machine, ...fields });
    if (existing && sync.replace) await this.storage.deleteChatMessages(sync.id);
    const messageCount = await this.storage.addChatMessages(sync.id, sync.messages, MAX_MESSAGES_KEPT);
    await this.storage.updateChatSession(sync.id, { ...fields, messageCount });
    return { id: sync.id, messageCount };
  }

  private async takeNext(machine: string, caps: BridgeCaps | null) {
    for (const message of await this.storage.getQueuedChatMessages(machine, CLAIM_CANDIDATES)) {
      if (await this.storage.countChatMessagesInState(message.sessionId, ['taken']) > 0) continue;
      const session = await this.storage.getChatSession(message.sessionId);
      if (!session) continue;
      const takenAt = this.now();
      if (!await this.storage.moveChatMessage(message.id, message.sessionId, 'queued', 'taken', caps ? { takenAt } : {})) continue;
      await this.storage.updateChatSession(session.id, { status: 'running', statusDetail: null, lastDeltaAt: takenAt });
      const taken = {
        id: message.id,
        sessionId: message.sessionId,
        text: message.text,
        claudeSessionId: session.claudeSessionId,
        forkFrom: session.forkFrom,
      };
      if (!caps) return taken;
      return {
        ...taken,
        attachments: caps.features.includes('attachments') ? await this.attachments.forClaim(message.id) : [],
        options: parseStoredOptions(message.options),
      };
    }
    return null;
  }

  /** Long poll: the oldest queued message, or `null` once `wait` seconds pass or the bridge hangs up. */
  async claim(input: unknown, signal: AbortSignal | undefined, machine: string) {
    const { wait, caps = null } = parseClaim(input);
    const deadline = this.now().getTime() + wait * 1000;
    await this.failStale();
    let extra: { wantCatalog?: true } = {};
    if (caps) {
      await this.recordCaps(machine, caps);
      if (caps.features.includes('attachments')) await this.pruneAttachments(this.now());
      if (caps.catalogHash !== null && (await this.info(machine)).catalogHash !== caps.catalogHash) extra = { wantCatalog: true };
    } else {
      await this.clearCaps(machine);
    }
    for (;;) {
      if (signal?.aborted) return { message: null, ...extra };
      this.bridgeSeenAt.set(machine, this.now());
      const message = await this.takeNext(machine, caps);
      if (message) return { message, ...extra };
      const left = deadline - this.now().getTime();
      if (left <= 0) return { message: null, ...extra };
      await this.sleep(Math.min(CLAIM_POLL_MS, left), signal);
    }
  }

  async delta(input: unknown, machine: string) {
    const now = this.now();
    const delta = parseDelta(input, now);
    this.bridgeSeenAt.set(machine, now);
    const session = await this.storage.getChatSession(delta.sessionId);
    if (!session) return null;
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session takes deltas');
    if (session.machine !== machine) throw new OrchestratorInputError('This session belongs to another machine');
    const replyTo = await this.storage.getChatMessage(delta.replyTo);
    if (!replyTo || replyTo.sessionId !== session.id || replyTo.role !== 'user') {
      throw new OrchestratorInputError('replyTo is not a message of this session');
    }

    const messageCount = await this.storage.addChatMessages(session.id, delta.items, MAX_MESSAGES_KEPT);
    const update: Parameters<StorageService['updateChatSession']>[1] = { messageCount };
    if (delta.items.length > 0) update.lastMessageAt = now;
    if (delta.claudeSessionId) update.claudeSessionId = delta.claudeSessionId;
    let ended = false;
    try {
      // A turn that was already given up as stale keeps its error; late output is still shown.
      if (replyTo.state === 'taken') {
        update.lastDeltaAt = now;
        if (delta.error) {
          await this.storage.moveChatMessage(replyTo.id, session.id, 'taken', 'failed');
          ended = true;
          update.status = 'error';
          update.statusDetail = delta.error;
        } else if (delta.done) {
          await this.storage.moveChatMessage(replyTo.id, session.id, 'taken', 'done');
          ended = true;
          update.status = 'idle';
          update.statusDetail = delta.stopped ? STOPPED_TEXT : null;
        } else if (delta.detail) {
          update.statusDetail = delta.detail;
        }
      }
      const updated = await this.storage.updateChatSession(session.id, update);
      return { id: updated.id, status: updated.status, messageCount };
    } finally {
      if (ended) await this.closeActivity(session.id, replyTo.id);
      if (ended || replyTo.state !== 'taken') await this.closeTurn(session.id, replyTo.id);
    }
  }

  async activity(input: unknown, machine: string) {
    const now = this.now();
    const request = parseActivity(input, now);
    this.bridgeSeenAt.set(machine, now);
    const session = await this.storage.getChatSession(request.sessionId);
    if (!session || session.machine !== machine) return null;
    if (session.source !== 'dock') throw new OrchestratorInputError('Only a DOCK session takes activity');
    const replyTo = await this.storage.getChatMessage(request.replyTo);
    if (!replyTo || replyTo.sessionId !== session.id || replyTo.role !== 'user') {
      throw new OrchestratorInputError('replyTo is not a message of this session');
    }
    const open = replyTo.state === 'taken';
    const write = this.activityWrites.then(async () => {
      const result = await this.storage.upsertChatActivity(
        session.id, replyTo.id, open ? request.events : [], MAX_ACTIVITY_PER_TURN, SERVER_DROPPED_ID, now,
      );
      if (open) await this.storage.updateChatSession(session.id, { lastDeltaAt: now });
      await this.pruneActivity(now);
      return result;
    });
    this.activityWrites = write.catch(() => undefined);
    const { accepted, dropped, seq } = await write;
    return { accepted, seq, dropped, closed: !open };
  }
}

export const chatService = new ChatService();
