import { createHash, randomBytes } from 'node:crypto';
import { OrchestratorInputError } from './orchestrator';

export const SESSION_MODES = ['work', 'gm'] as const;
export type SessionMode = typeof SESSION_MODES[number];
export const GM_TITLE = 'Guild Master';

/**
 * The settings a Guild Master may change. Secrets and connection settings stay with the owner, and so do the ones that widen what
 * agents do on their own: the default permission mode, auto LGTM and auto review.
 */
export const GM_SETTING_KEYS = [
  'reviewFindingsToTask', 'chatDefaultModel', 'chatDefaultEffort', 'chatRtk', 'chatCaveman',
  'chatParallelTurns', 'ownerReplySession', 'serviceHealthRefreshSeconds', 'planningPlanner',
] as const;
const GM_NONCE_MS = 2 * 60 * 1000;
const MAX_PENDING_CHARS = 120_000;
const GM_SECRETS = { jiraApiToken: 'hasJiraApiToken', githubToken: 'hasGithubToken', discordWebhookUrl: 'hasDiscordWebhookUrl', discordBotToken: 'hasDiscordBotToken', googleClientSecret: 'hasGoogleClientSecret', masterPin: 'hasMasterPin' } as const;
const MAX_VALUE = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function sessionMode(value: unknown): SessionMode {
  if (value === undefined || value === null || value === '') return 'work';
  if (value !== 'work' && value !== 'gm') throw new OrchestratorInputError('mode must be work or gm');
  return value;
}

/** The owner's "ya": the whole message, so "ya, tapi ..." is not a yes. */
export function isGmConfirm(text: string): boolean {
  return /^\s*(ya|yes|iya)\s*[.!]*\s*$/i.test(text);
}

/** What a Guild Master sees of the settings: plain values of the keys it may change, secrets only as set / not set. */
export function gmSettingsView(publicSettings: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const key of GM_SETTING_KEYS) values[key] = publicSettings[key] === null || publicSettings[key] === undefined ? '' : String(publicSettings[key]);
  const secrets: Record<string, string> = {};
  for (const [name, flag] of Object.entries(GM_SECRETS)) secrets[name] = publicSettings[flag] ? 'set' : 'not set';
  return { values, secrets };
}

export function parseGmSettings(input: unknown): Record<string, string> | null {
  if (!isRecord(input) || input.values === undefined) return null;
  if (!isRecord(input.values)) throw new OrchestratorInputError('values must be an object');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values)) {
    if (!(GM_SETTING_KEYS as readonly string[]).includes(key)) throw new OrchestratorInputError(`${key.slice(0, 60)} is not a setting Guild Master can change`);
    if (typeof value !== 'string' || value.length > MAX_VALUE) throw new OrchestratorInputError(`${key} must be text of at most ${MAX_VALUE} characters`);
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw new OrchestratorInputError('No setting to change');
  return out;
}

export interface GmProposal {
  sha256: string;
  summary: string;
  diff: string;
  /** The settings a settings proposal writes; null for an agent change or a rollback. */
  values: Record<string, string> | null;
  rollback: boolean;
  /** The newest owner message when the proposal came in: only a later "ya" can confirm it. */
  afterMessageId: number;
  at: string;
}

/** The pending change the bridge posts after a gm turn. DOCK hashes the very text it shows, and the kit checks that hash on apply. */
export function parseGmProposal(input: unknown) {
  if (!isRecord(input) || typeof input.sessionId !== 'string' || !Number.isInteger(input.replyTo)) throw new OrchestratorInputError('A proposal needs sessionId and replyTo');
  if (typeof input.pending !== 'string' || !input.pending || input.pending.length > MAX_PENDING_CHARS) throw new OrchestratorInputError('A proposal needs the pending change');
  let change: unknown;
  try { change = JSON.parse(input.pending); } catch { throw new OrchestratorInputError('The pending change is not JSON'); }
  if (!isRecord(change) || typeof change.diff !== 'string' || typeof change.summary !== 'string') throw new OrchestratorInputError('The pending change has no diff');
  return {
    sessionId: input.sessionId,
    replyTo: Number(input.replyTo),
    sha256: createHash('sha256').update(input.pending).digest('hex'),
    summary: change.summary.slice(0, 300),
    diff: change.diff.slice(0, 20_000),
    // A rollback of settings carries the backup values it restores, so the owner's "ya" binds them like any settings change.
    values: change.type === 'settings' || (change.type === 'rollback' && change.values !== undefined) ? parseGmSettings({ values: change.values }) : null,
    rollback: change.type === 'rollback',
  };
}

interface GmNonce { sessionId: string | null; sha256: string; values: Record<string, string> | null; rollback: boolean; exp: number }

/** One-use nonces DOCK mints for the owner's "ya" or a panel rollback. Every Guild Master write consumes one before it happens. */
export class GmNonces {
  private readonly nonces = new Map<string, GmNonce>();

  constructor(private readonly now: () => number = Date.now) {}

  mint(record: Omit<GmNonce, 'exp'>) {
    for (const [key, value] of this.nonces) if (value.exp <= this.now()) this.nonces.delete(key);
    const nonce = randomBytes(24).toString('hex');
    const exp = this.now() + GM_NONCE_MS;
    this.nonces.set(nonce, { ...record, exp });
    return { nonce, sha256: record.sha256, exp };
  }

  /** Consumes the nonce. A settings write, a rollback included, must carry exactly the values the owner confirmed. */
  consume(input: unknown, values: Record<string, string> | null = null) {
    if (!isRecord(input) || typeof input.nonce !== 'string') throw new OrchestratorInputError('This write needs DOCK\'s confirmation');
    const record = this.nonces.get(input.nonce);
    this.nonces.delete(input.nonce);
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
    if (!record || record.exp <= this.now() || record.sha256 !== input.sha256 || record.sessionId !== sessionId) {
      throw new OrchestratorInputError('The confirmation is unknown, used or expired');
    }
    if (values) {
      const same = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
      if (!record.values || !same(values, record.values)) throw new OrchestratorInputError('These are not the settings the owner confirmed');
    }
    return { ok: true };
  }
}

export interface GmLogEntry {
  id: number;
  at: string;
  by: string;
  sessionId: string | null;
  kind: string;
  target: string;
  summary: string;
  diff: string;
  backup: string;
  rollbackOf: number | null;
  rolledBack: boolean;
  /** The settings a rollback of this entry writes back (from its backup); null for an agent entry. Not sent to the page. */
  restoreValues: Record<string, string> | null;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export function parseGmEntry(input: unknown): GmLogEntry {
  if (!isRecord(input) || !Number.isInteger(input.id)) throw new Error('The bridge sent a manager log entry without an id');
  return {
    id: Number(input.id),
    at: text(input.at, 40),
    by: text(input.by, 80),
    sessionId: text(input.sessionId, 64) || null,
    kind: input.kind === 'rollback' ? 'rollback' : 'change',
    target: text(input.target, 200),
    summary: text(input.summary, 300),
    diff: text(input.diff, 20_000),
    backup: text(input.backup, 100),
    rollbackOf: Number.isInteger(input.rollbackOf) ? Number(input.rollbackOf) : null,
    rolledBack: input.rolledBack === true,
    restoreValues: isRecord(input.restoreValues) && Object.values(input.restoreValues).every((value) => typeof value === 'string')
      ? input.restoreValues as Record<string, string> : null,
  };
}

export function parseGmRollback(input: unknown): GmLogEntry {
  if (!isRecord(input) || input.ok !== true) throw new OrchestratorInputError((isRecord(input) && text(input.error, 300)) || 'The kit did not roll back');
  return parseGmEntry(input.entry);
}

export interface AskGmFacts {
  ticketKey: string | null;
  status: string | null;
  stage: string | null;
  verdict: string | null;
  model: string | null;
  contextTokens: number | null;
  contextSize: number | null;
  costUsd: number | null;
}

const word = (value: string | null) => (value && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,39}$/.test(value) ? value : null);
const count = (value: number | null) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * The summary "Ask Guild Master" sends from a Work session. It is built from structured fields only, each one checked, so no
 * transcript, ticket text or PR text can ride along.
 */
export function askGmSummary(facts: AskGmFacts): string {
  const key = facts.ticketKey && /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(facts.ticketKey) ? facts.ticketKey : null;
  const tokens = count(facts.contextTokens), size = count(facts.contextSize), cost = count(facts.costUsd);
  const lines = [
    `Summary written by DOCK from a Work session${key ? ` on ${key}` : ''}.`,
    word(facts.status) && `Session: ${word(facts.status)}`,
    word(facts.stage) && `Stage: ${word(facts.stage)}`,
    word(facts.verdict) && `Verdict: ${word(facts.verdict)}`,
    word(facts.model) && `Model: ${word(facts.model)}`,
    tokens !== null && `Context tokens: ${Math.round(tokens)}${size !== null ? ` of ${Math.round(size)}` : ''}`,
    cost !== null && `Cost: $${cost.toFixed(2)}`,
    'Only this summary came over; the transcript, the ticket text and the PR text stay in the Work session.',
  ];
  return lines.filter(Boolean).join('\n');
}
