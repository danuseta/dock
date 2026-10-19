import { ACTIVITY_ID, SERVER_DROPPED_ID, activityText, maskActivityText } from './chat-activity';
import { OrchestratorInputError } from './orchestrator';

export const CAPS_VERSION = 2;
export const CAPS_FEATURES = ['interactive', 'questions', 'plan', 'stop', 'attachments', 'commands', 'model', 'effort', 'fast', 'steer'] as const;
export type CapsFeature = typeof CAPS_FEATURES[number];
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];
export const INTERACTION_KINDS = ['permission', 'question', 'plan'] as const;
export type InteractionKind = typeof INTERACTION_KINDS[number];

export const MAX_CAPS_FEATURES = 16;
export const MAX_CAPS_TEXT = 40;
export const MAX_CATALOG_HASH = 80;
export const MAX_WAIT_SECONDS = 25;
export const MAX_WAIT_ACKS = 20;
export const MAX_PENDING_ASKS = 4;
export const MAX_ASKS_PER_TURN = 100;
export const ASK_TTL_SECONDS = { min: 30, max: 1800, fallback: 600 } as const;
export const MAX_ASK_BODY_BYTES = 8 * 1024;
export const MAX_ANSWER_BYTES = 4 * 1024;
export const MAX_ANSWER_TEXT = 500;
export const MAX_ASK_TITLE = 120;
export const TAKEN_HARD_MS = 90 * 60 * 1000;
export const TAKEN_HARD_TEXT = 'The turn ran too long';
export const WAIT_TOUCH_MS = 20 * 1000;
export const INTERACTION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_INTERACTION_ROWS = 5000;
export const PENDING_LIST_LIMIT = 4;
export const COMMANDS_LIMIT = { fallback: 30, max: 50 };
export const CATALOG_LIMITS = {
  commands: 2000, models: 40, name: 64, description: 100, argumentHint: 60, bytes: 300 * 1024,
  value: 80, label: 80, effort: 40, efforts: 10, reason: 80,
} as const;
export const ASK_LIMITS = {
  tool: 64, label: 120, summary: 200, detail: 2000, agent: 48, alwaysLabel: 160,
  question: 300, header: 40, optionLabel: 80, optionDescription: 200, questions: 4, options: 4,
} as const;
export const OPTION_TEXT_CHARS = 80;

export interface BridgeCaps {
  v: 2;
  kit: string;
  claude: string;
  features: CapsFeature[];
  modes: PermissionMode[];
  catalogHash: string | null;
}

export interface TurnOptions { model: string | null; effort: string | null; permissionMode: PermissionMode | null; fast: boolean | null }
export interface PermissionBody { tool: string; label: string; summary: string; detail: string; agent: string | null; alwaysLabel: string | null }
export interface QuestionBody {
  questions: Array<{ question: string; header: string; multiSelect: boolean; options: Array<{ label: string; description: string }> }>;
}
export interface PlanBody { planChars: number }
export interface PermissionAnswer { decision: 'allow' | 'allow_session' | 'deny'; note: string | null }
export interface QuestionAnswer { decision: 'answer' | 'deny'; answers: Array<{ index: number; labels: string[]; other: string | null }> }
export interface PlanAnswer { decision: 'approve' | 'approve_edits' | 'reject'; note: string | null }
export type InteractionAnswer = PermissionAnswer | QuestionAnswer | PlanAnswer;
export interface WaitAnswer { requestId: string; kind: InteractionKind; state: 'answered' | 'expired'; answer: InteractionAnswer | null }

export interface CatalogCommand { name: string; description: string; argumentHint: string; kind: 'builtin' | 'skill' }
export interface CatalogModel { value: string; label: string; efforts: string[]; fast: boolean }
export interface CatalogDefaults { model: string | null; effort: string | null; permissionMode: string | null }
export interface Catalog {
  hash: string;
  commands: CatalogCommand[];
  models: CatalogModel[];
  fast: { available: boolean; reason: string | null };
  defaults: CatalogDefaults;
}

export const NO_DEFAULTS: CatalogDefaults = { model: null, effort: null, permissionMode: null };
const DEFAULT_WORD = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const CHAT_ID = /^[A-Za-z0-9-]{1,64}$/;
const HASH = /^[A-Za-z0-9_-]{1,80}$/;

function chatId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !CHAT_ID.test(value)) throw new OrchestratorInputError(`${name} must be an id of letters, digits and dashes`);
  return value;
}

function messageId(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new OrchestratorInputError(`${name} must be a message id`);
  return Number(value);
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !ACTIVITY_ID.test(value) || value === SERVER_DROPPED_ID || maskActivityText(value) !== value) {
    throw new OrchestratorInputError('requestId must be an id of letters, digits, dashes and underscores');
  }
  return value;
}

function short(value: unknown, max: number): string {
  return activityText(value, max, true);
}

export function parseCaps(input: unknown): BridgeCaps | null {
  if (!isRecord(input) || input.v !== CAPS_VERSION) return null;
  const features = Array.isArray(input.features)
    ? [...new Set(input.features.filter((item): item is CapsFeature => CAPS_FEATURES.includes(item as CapsFeature)))].slice(0, MAX_CAPS_FEATURES)
    : [];
  const modes = Array.isArray(input.modes)
    ? [...new Set(input.modes.filter((item): item is PermissionMode => PERMISSION_MODES.includes(item as PermissionMode)))]
    : [];
  const catalogHash = typeof input.catalogHash === 'string' && HASH.test(input.catalogHash) ? input.catalogHash : null;
  return {
    v: CAPS_VERSION,
    kit: typeof input.kit === 'string' ? input.kit.trim().slice(0, MAX_CAPS_TEXT) : '',
    claude: typeof input.claude === 'string' ? input.claude.trim().slice(0, MAX_CAPS_TEXT) : '',
    features,
    modes,
    catalogHash,
  };
}

export function parseStoredCaps(value: string): BridgeCaps | null {
  if (!value) return null;
  try {
    return parseCaps(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseWait(input: unknown) {
  if (!isRecord(input)) throw new OrchestratorInputError('A wait object is required');
  const wait = input.wait === undefined || input.wait === null ? 0 : input.wait;
  if (typeof wait !== 'number' || !Number.isFinite(wait) || wait < 0 || wait > MAX_WAIT_SECONDS) {
    throw new OrchestratorInputError(`wait must be between 0 and ${MAX_WAIT_SECONDS} seconds`);
  }
  const ack = input.ack === undefined || input.ack === null ? [] : input.ack;
  if (!Array.isArray(ack)) throw new OrchestratorInputError('ack must be a list of request ids');
  if (ack.length > MAX_WAIT_ACKS) throw new OrchestratorInputError(`A maximum of ${MAX_WAIT_ACKS} acks per request is supported`);
  const cancelled = input.cancelled === undefined || input.cancelled === null ? [] : input.cancelled;
  if (!Array.isArray(cancelled)) throw new OrchestratorInputError('cancelled must be a list of request ids');
  if (cancelled.length > MAX_WAIT_ACKS) throw new OrchestratorInputError(`A maximum of ${MAX_WAIT_ACKS} cancelled ids per request is supported`);
  const steerSeen = input.steerSeen === undefined || input.steerSeen === null ? 0 : input.steerSeen;
  if (!Number.isInteger(steerSeen) || Number(steerSeen) < 0) throw new OrchestratorInputError('steerSeen must be a message id or 0');
  const steerAck = input.steerAck === undefined || input.steerAck === null ? [] : input.steerAck;
  if (!Array.isArray(steerAck)) throw new OrchestratorInputError('steerAck must be a list of message ids');
  if (steerAck.length > MAX_WAIT_ACKS) throw new OrchestratorInputError(`A maximum of ${MAX_WAIT_ACKS} steer acks per request is supported`);
  return {
    sessionId: chatId(input.sessionId, 'sessionId'),
    replyTo: messageId(input.replyTo, 'replyTo'),
    wait,
    ack: ack.map(requestId),
    cancelled: cancelled.map(requestId),
    steerSeen: Number(steerSeen),
    steerAck: steerAck.map((id) => messageId(id, 'steerAck')),
    caps: parseCaps(input.caps),
  };
}

function permissionBody(input: Record<string, unknown>): PermissionBody {
  return {
    tool: short(input.tool, ASK_LIMITS.tool),
    label: short(input.label, ASK_LIMITS.label),
    summary: short(input.summary, ASK_LIMITS.summary),
    detail: activityText(input.detail, ASK_LIMITS.detail),
    agent: short(input.agent, ASK_LIMITS.agent) || null,
    alwaysLabel: short(input.alwaysLabel, ASK_LIMITS.alwaysLabel) || null,
  };
}

function questionBody(input: Record<string, unknown>): QuestionBody {
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > ASK_LIMITS.questions) {
    throw new OrchestratorInputError(`A question needs between 1 and ${ASK_LIMITS.questions} questions`);
  }
  return {
    questions: input.questions.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.options) || item.options.length > ASK_LIMITS.options) {
        throw new OrchestratorInputError(`Each question needs a list of at most ${ASK_LIMITS.options} options`);
      }
      const options = item.options.map((option) => {
        if (!isRecord(option)) throw new OrchestratorInputError('Each option needs a label and a description');
        const label = short(option.label, ASK_LIMITS.optionLabel);
        if (!label) throw new OrchestratorInputError('An option needs a label');
        return { label, description: activityText(option.description, ASK_LIMITS.optionDescription) };
      });
      if (new Set(options.map((option) => option.label)).size !== options.length) {
        throw new OrchestratorInputError('The options of a question need different labels');
      }
      return {
        question: activityText(item.question, ASK_LIMITS.question),
        header: short(item.header, ASK_LIMITS.header),
        multiSelect: item.multiSelect === true,
        options,
      };
    }),
  };
}

function planBody(input: Record<string, unknown>): PlanBody {
  if (!Number.isInteger(input.planChars) || Number(input.planChars) < 0) throw new OrchestratorInputError('planChars must be a number of 0 or more');
  return { planChars: Number(input.planChars) };
}

export function parseAsk(input: unknown, now: Date) {
  if (!isRecord(input)) throw new OrchestratorInputError('An ask object is required');
  const kind = input.kind;
  if (typeof kind !== 'string' || !INTERACTION_KINDS.includes(kind as InteractionKind)) {
    throw new OrchestratorInputError(`kind must be one of ${INTERACTION_KINDS.join(', ')}`);
  }
  if (!isRecord(input.body)) throw new OrchestratorInputError('An ask needs a body');
  let ttl: number = ASK_TTL_SECONDS.fallback;
  if (input.ttlSeconds !== undefined && input.ttlSeconds !== null) {
    if (typeof input.ttlSeconds !== 'number' || !Number.isFinite(input.ttlSeconds)) throw new OrchestratorInputError('ttlSeconds must be a number');
    ttl = Math.min(Math.max(Math.round(input.ttlSeconds), ASK_TTL_SECONDS.min), ASK_TTL_SECONDS.max);
  }
  const body = kind === 'permission' ? permissionBody(input.body) : kind === 'question' ? questionBody(input.body) : planBody(input.body);
  const serialised = JSON.stringify(body);
  if (Buffer.byteLength(serialised) > MAX_ASK_BODY_BYTES) throw new OrchestratorInputError('The body is too large');
  return {
    sessionId: chatId(input.sessionId, 'sessionId'),
    replyTo: messageId(input.replyTo, 'replyTo'),
    requestId: requestId(input.requestId),
    kind: kind as InteractionKind,
    title: short(input.title, MAX_ASK_TITLE),
    body: serialised,
    expiresAt: new Date(now.getTime() + ttl * 1000),
  };
}

function parseEfforts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => short(item, CATALOG_LIMITS.effort)).filter(Boolean))].slice(0, CATALOG_LIMITS.efforts);
}

function defaultWord(value: unknown): string | null {
  return typeof value === 'string' && DEFAULT_WORD.test(value.trim()) ? value.trim() : null;
}

function parseDefaults(value: unknown): CatalogDefaults {
  if (!isRecord(value)) return NO_DEFAULTS;
  return { model: defaultWord(value.model), effort: defaultWord(value.effort), permissionMode: defaultWord(value.permissionMode) };
}

export function parseCatalog(input: unknown): Catalog {
  if (!isRecord(input)) throw new OrchestratorInputError('A catalog object is required');
  if (typeof input.hash !== 'string' || !HASH.test(input.hash)) throw new OrchestratorInputError('hash must be an id of letters, digits, dashes and underscores');
  if (!Array.isArray(input.commands) || input.commands.length > CATALOG_LIMITS.commands) {
    throw new OrchestratorInputError(`A maximum of ${CATALOG_LIMITS.commands} commands is supported`);
  }
  if (!Array.isArray(input.models) || input.models.length > CATALOG_LIMITS.models) {
    throw new OrchestratorInputError(`A maximum of ${CATALOG_LIMITS.models} models is supported`);
  }
  const commands = input.commands.flatMap((item): CatalogCommand[] => {
    if (!isRecord(item)) return [];
    const name = short(item.name, CATALOG_LIMITS.name);
    if (!name) return [];
    return [{
      name,
      description: short(item.description, CATALOG_LIMITS.description),
      argumentHint: short(item.argumentHint, CATALOG_LIMITS.argumentHint),
      kind: item.kind === 'skill' ? 'skill' : 'builtin',
    }];
  });
  const models = input.models.flatMap((item): CatalogModel[] => {
    if (!isRecord(item)) return [];
    const value = short(item.value, CATALOG_LIMITS.value);
    if (!value) return [];
    return [{ value, label: short(item.label, CATALOG_LIMITS.label) || value, efforts: parseEfforts(item.efforts), fast: item.fast === true }];
  });
  const fast = isRecord(input.fast)
    ? { available: input.fast.available === true, reason: short(input.fast.reason, CATALOG_LIMITS.reason) || null }
    : { available: false, reason: null };
  const catalog: Catalog = { hash: input.hash, commands, models, fast, defaults: parseDefaults(input.defaults) };
  if (Buffer.byteLength(JSON.stringify(catalog)) > CATALOG_LIMITS.bytes) throw new OrchestratorInputError('The catalog is too large');
  return catalog;
}

export function parseStoredCatalog(value: string): Catalog | null {
  if (!value) return null;
  try {
    return parseCatalog(JSON.parse(value));
  } catch {
    return null;
  }
}

export function searchCommands(commands: CatalogCommand[], queryInput: string | null | undefined, limitInput: number | null | undefined): CatalogCommand[] {
  const take = Number.isInteger(limitInput) && Number(limitInput) > 0 ? Math.min(Number(limitInput), COMMANDS_LIMIT.max) : COMMANDS_LIMIT.fallback;
  const query = typeof queryInput === 'string' ? queryInput.trim().toLowerCase() : '';
  if (!query) return commands.slice(0, take);
  const ranked: Array<{ command: CatalogCommand; rank: number }> = [];
  for (const command of commands) {
    const rank = commandRank(command, query);
    if (rank !== null) ranked.push({ command, rank });
  }
  return ranked.sort((first, second) => first.rank - second.rank).map((item) => item.command).slice(0, take);
}

function commandRank(command: CatalogCommand, query: string): number | null {
  const name = command.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  const at = name.indexOf(query);
  if (at > 0 && /[^a-z0-9]/.test(name[at - 1])) return 2;
  if (at > 0) return 3;
  return command.description.toLowerCase().includes(query) ? 4 : null;
}

function optionText(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new OrchestratorInputError(`${name} must be text`);
  const text = value.trim();
  if (text.startsWith('-')) throw new OrchestratorInputError(`${name} is not valid`);
  return text.slice(0, OPTION_TEXT_CHARS) || null;
}

export function parseTurnOptions(input: unknown): TurnOptions | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) throw new OrchestratorInputError('options must be an object');
  const permissionMode = input.permissionMode === undefined || input.permissionMode === null || input.permissionMode === '' ? null : input.permissionMode;
  if (permissionMode !== null && !PERMISSION_MODES.includes(permissionMode as PermissionMode)) {
    throw new OrchestratorInputError(`permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);
  }
  if (input.fast !== undefined && input.fast !== null && typeof input.fast !== 'boolean') throw new OrchestratorInputError('fast must be true or false');
  const options: TurnOptions = {
    model: optionText(input.model, 'model'),
    effort: optionText(input.effort, 'effort'),
    permissionMode: permissionMode as PermissionMode | null,
    fast: typeof input.fast === 'boolean' ? input.fast : null,
  };
  return options.model === null && options.effort === null && options.permissionMode === null && options.fast === null ? null : options;
}

export function parseStoredOptions(value: string | null | undefined): TurnOptions | null {
  if (!value) return null;
  try {
    return parseTurnOptions(JSON.parse(value));
  } catch {
    return null;
  }
}

/** The session's stored options, overlaid field by field by the ones sent with a message. */
export function mergeTurnOptions(base: TurnOptions | null, over: TurnOptions | null): TurnOptions | null {
  if (!base || !over) return over ?? base;
  return {
    model: over.model ?? base.model,
    effort: over.effort ?? base.effort,
    permissionMode: over.permissionMode ?? base.permissionMode,
    fast: over.fast ?? base.fast,
  };
}

/** What a machine can honour of options stored earlier; the rest is left out instead of refusing the message. */
export function usableTurnOptions(options: TurnOptions | null, caps: BridgeCaps | null, catalog: Catalog | null): TurnOptions | null {
  if (!options) return null;
  const fits = (part: Partial<TurnOptions>) => {
    try {
      checkTurnOptions({ model: null, effort: null, permissionMode: null, fast: null, ...part }, caps, catalog);
      return true;
    } catch {
      return false;
    }
  };
  const model = options.model !== null && fits({ model: options.model }) ? options.model : null;
  const effort = options.effort !== null && fits({ model, effort: options.effort }) ? options.effort : null;
  const permissionMode = options.permissionMode !== null && fits({ permissionMode: options.permissionMode }) ? options.permissionMode : null;
  const fast = options.fast !== null && fits({ fast: options.fast }) ? options.fast : null;
  return model === null && effort === null && permissionMode === null && fast === null ? null : { model, effort, permissionMode, fast };
}

export function checkTurnOptions(options: TurnOptions, caps: BridgeCaps | null, catalog: Catalog | null): void {
  const has = (feature: CapsFeature) => caps?.features.includes(feature) === true;
  if (options.model !== null) {
    if (!has('model')) throw new OrchestratorInputError('This machine cannot switch the model');
    if (!catalog?.models.some((model) => model.value === options.model)) throw new OrchestratorInputError('This model is not offered by the machine');
  }
  if (options.effort !== null) {
    if (!has('effort')) throw new OrchestratorInputError('This machine cannot set the effort');
    const model = options.model === null ? null : catalog?.models.find((item) => item.value === options.model);
    const efforts = model ? model.efforts : (catalog?.models ?? []).flatMap((item) => item.efforts);
    if (!efforts.includes(options.effort)) throw new OrchestratorInputError('This effort is not offered for the model');
  }
  if (options.permissionMode !== null && !caps?.modes.includes(options.permissionMode)) {
    throw new OrchestratorInputError('This machine does not offer that permission mode');
  }
  if (options.fast !== null && !has('fast')) throw new OrchestratorInputError('This machine cannot use fast mode');
}

export interface AnswerInput { index: number; labels: string[]; other?: string | null }

function answerNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new OrchestratorInputError('note must be text');
  if (value.length > MAX_ANSWER_TEXT) throw new OrchestratorInputError(`note must be at most ${MAX_ANSWER_TEXT} characters`);
  return value.trim() || null;
}

function parseBody<T>(body: string): T {
  return JSON.parse(body) as T;
}

export function checkAnswer(
  row: { kind: string; body: string },
  decision: string,
  answers: AnswerInput[] | null | undefined,
  noteInput: unknown,
): InteractionAnswer {
  let answer: InteractionAnswer;
  if (row.kind === 'permission') {
    if (decision !== 'allow' && decision !== 'allow_session' && decision !== 'deny') throw new OrchestratorInputError('decision must be allow, allow_session or deny');
    if (decision === 'allow_session' && !parseBody<PermissionBody>(row.body).alwaysLabel) {
      throw new OrchestratorInputError('This request has no session rule to allow');
    }
    answer = { decision, note: answerNote(noteInput) };
  } else if (row.kind === 'plan') {
    if (decision !== 'approve' && decision !== 'approve_edits' && decision !== 'reject') throw new OrchestratorInputError('decision must be approve, approve_edits or reject');
    answer = { decision, note: answerNote(noteInput) };
  } else if (row.kind === 'question') {
    if (decision !== 'answer' && decision !== 'deny') throw new OrchestratorInputError('decision must be answer or deny');
    answer = { decision, answers: decision === 'answer' ? questionAnswers(parseBody<QuestionBody>(row.body), answers) : [] };
  } else {
    throw new OrchestratorInputError('Unknown request kind');
  }
  if (Buffer.byteLength(JSON.stringify(answer)) > MAX_ANSWER_BYTES) throw new OrchestratorInputError('The answer is too large');
  return answer;
}

function questionAnswers(body: QuestionBody, answers: AnswerInput[] | null | undefined): QuestionAnswer['answers'] {
  if (!Array.isArray(answers) || answers.length !== body.questions.length) {
    throw new OrchestratorInputError('Answer every question');
  }
  const seen = new Set<number>();
  return answers.map((item) => {
    const question = body.questions[item.index];
    if (!question || seen.has(item.index)) throw new OrchestratorInputError('An answer points at an unknown question');
    seen.add(item.index);
    const labels = Array.isArray(item.labels) ? item.labels : [];
    const other = typeof item.other === 'string' ? item.other.trim() : '';
    if (other.length > MAX_ANSWER_TEXT) throw new OrchestratorInputError(`other must be at most ${MAX_ANSWER_TEXT} characters`);
    if (labels.some((label) => !question.options.some((option) => option.label === label))) {
      throw new OrchestratorInputError('A label is not one of the options');
    }
    const picked = labels.length + (other ? 1 : 0);
    if (picked < 1) throw new OrchestratorInputError('Answer every question');
    if (!question.multiSelect && picked > 1) throw new OrchestratorInputError('This question takes one answer');
    return { index: item.index, labels, other: other || null };
  });
}

export function parseStoredAnswer(value: string | null): InteractionAnswer | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as InteractionAnswer;
  } catch {
    return null;
  }
}

export class TurnNotifier {
  private readonly waiters = new Map<number, Set<() => void>>();

  wait(turnId: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const set = this.waiters.get(turnId) ?? new Set<() => void>();
      this.waiters.set(turnId, set);
      const release = () => {
        signal.removeEventListener('abort', release);
        set.delete(release);
        if (set.size === 0 && this.waiters.get(turnId) === set) this.waiters.delete(turnId);
        resolve();
      };
      set.add(release);
      signal.addEventListener('abort', release, { once: true });
    });
  }

  wake(turnId: number): void {
    for (const release of [...(this.waiters.get(turnId) ?? [])]) release();
  }

  size(): number {
    return [...this.waiters.values()].reduce((sum, set) => sum + set.size, 0);
  }
}
