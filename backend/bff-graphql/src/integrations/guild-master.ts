import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ClaudeTicketUsage } from './claude-usage';
import { FAILURE_TYPES, OrchestratorInputError, type LedgerFailure, type LedgerRounds } from './orchestrator';

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

/** The orchestrator cron fields a Guild Master may change: when and how much it takes, never the permission mode, model, engine or machine. */
export const GM_CRON_KEYS = ['enabled', 'workStart', 'workEnd', 'workDays', 'parallel', 'maxPerDay', 'activeFrom', 'activeUntil', 'labels'] as const;
const MAX_CRON_VALUE = 200;

export function gmCronView(settings: object) {
  const source = settings as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const key of GM_CRON_KEYS) {
    const value = source[key];
    values[key] = Array.isArray(value) ? value.join(',') : value === null || value === undefined ? '' : String(value);
  }
  return { values };
}

export function parseGmCron(input: unknown): Record<string, string> | null {
  if (!isRecord(input) || input.values === undefined) return null;
  if (!isRecord(input.values)) throw new OrchestratorInputError('values must be an object');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values)) {
    if (!(GM_CRON_KEYS as readonly string[]).includes(key)) throw new OrchestratorInputError(`${key.slice(0, 60)} is not a cron field Guild Master can change`);
    if (typeof value !== 'string' || value.length > MAX_CRON_VALUE) throw new OrchestratorInputError(`${key} must be text of at most ${MAX_CRON_VALUE} characters`);
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw new OrchestratorInputError('No cron field to change');
  return out;
}

/** A Guild Master may not clear the labels (the cron would take any ticket); a rollback may put an empty value back. */
function gmCronAsked(values: Record<string, string> | null, rollback: boolean) {
  if (!rollback && values && values.labels !== undefined && values.labels.trim() === '') throw new OrchestratorInputError("Clearing the cron labels is the owner's to do");
  return values;
}

/** The cron config with the confirmed fields put in, as the cron's own parser reads them; that parser still checks every value. */
export function withGmCron(current: object, values: Record<string, string>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const [key, value] of Object.entries(values)) {
    if (key === 'enabled') {
      if (value !== 'true' && value !== 'false') throw new OrchestratorInputError('enabled must be true or false');
      next.enabled = value === 'true';
    } else if (key === 'workDays') next.workDays = list(value).map((day) => (/^\d+$/.test(day) ? Number(day) : day));
    else if (key === 'labels') next.labels = list(value);
    else if (key === 'activeFrom' || key === 'activeUntil') next[key] = value.trim() || null;
    else next[key] = /^\d+$/.test(value.trim()) ? Number(value) : value;
  }
  return next;
}

/** What the owner reads for an empty cron field: no labels takes any ticket, no end date runs on. */
export const gmCronShow = (key: string, value: string) => (value !== '' ? value : key === 'labels' ? '(any ticket)' : key === 'activeUntil' ? '(no end)' : key === 'activeFrom' ? '(no start)' : '');

export type GmWriteTarget = 'settings' | 'cron';

export interface GmProposal {
  sha256: string;
  summary: string;
  diff: string;
  /** The settings or cron fields a proposal writes; null for an agent, Party, allow-list or guard draft change, or their rollback. */
  values: Record<string, string> | null;
  target: GmWriteTarget;
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
  const cron = change.type === 'cron' || (change.type === 'rollback' && change.cron !== undefined);
  if (cron) {
    return {
      sessionId: input.sessionId,
      replyTo: Number(input.replyTo),
      sha256: createHash('sha256').update(input.pending).digest('hex'),
      summary: change.summary.slice(0, 300),
      diff: change.diff.slice(0, 20_000),
      values: gmCronAsked(parseGmCron({ values: change.type === 'cron' ? change.values : change.cron }), change.type === 'rollback'),
      target: 'cron' as GmWriteTarget,
      rollback: change.type === 'rollback',
    };
  }
  return {
    sessionId: input.sessionId,
    replyTo: Number(input.replyTo),
    sha256: createHash('sha256').update(input.pending).digest('hex'),
    summary: change.summary.slice(0, 300),
    diff: change.diff.slice(0, 20_000),
    // A rollback of settings carries the backup values it restores, so the owner's "ya" binds them like any settings change.
    values: change.type === 'settings' || (change.type === 'rollback' && change.values !== undefined) ? parseGmSettings({ values: change.values }) : null,
    target: 'settings' as GmWriteTarget,
    rollback: change.type === 'rollback',
  };
}

interface GmNonce { sessionId: string | null; sha256: string; values: Record<string, string> | null; target?: GmWriteTarget; rollback: boolean; exp: number }

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

  /**
   * Consumes the nonce. A settings or cron write, a rollback included, must carry exactly the values the owner confirmed, for that
   * target; a write the kit does itself (agent, Party, allow-list, guard draft) takes only a nonce minted without values.
   */
  consume(input: unknown, values: Record<string, string> | null = null, target: GmWriteTarget = 'settings') {
    if (!isRecord(input) || typeof input.nonce !== 'string') throw new OrchestratorInputError('This write needs DOCK\'s confirmation');
    const record = this.nonces.get(input.nonce);
    this.nonces.delete(input.nonce);
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : null;
    if (!record || record.exp <= this.now() || record.sha256 !== input.sha256 || record.sessionId !== sessionId) {
      throw new OrchestratorInputError('The confirmation is unknown, used or expired');
    }
    if (values) {
      const same = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
      if (!record.values || !same(values, record.values) || (record.target ?? 'settings') !== target) throw new OrchestratorInputError('These are not the settings the owner confirmed');
    } else if (record.values) throw new OrchestratorInputError('This confirmation is for a settings write');
    return { ok: true };
  }
}

export interface GmLogEntry {
  id: number;
  at: string;
  by: string;
  sessionId: string | null;
  kind: string;
  /** What the entry changed: agent, settings, cron, party, allow or guard-draft. */
  type: string;
  target: string;
  summary: string;
  diff: string;
  backup: string;
  rollbackOf: number | null;
  rolledBack: boolean;
  /** The kit could not verify the entry's signature with the log key. */
  unverified: boolean;
  /** The ticket and the signed Party lines of a party entry. */
  ticket: string | null;
  party: string[] | null;
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
    type: typeof input.type === 'string' && /^[a-z-]{1,20}$/.test(input.type) ? input.type : 'agent',
    target: text(input.target, 200),
    summary: text(input.summary, 300),
    diff: text(input.diff, 20_000),
    backup: text(input.backup, 100),
    rollbackOf: Number.isInteger(input.rollbackOf) ? Number(input.rollbackOf) : null,
    rolledBack: input.rolledBack === true,
    unverified: input.unverified !== false,
    ticket: typeof input.ticket === 'string' && /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(input.ticket) ? input.ticket : null,
    party: Array.isArray(input.party) && input.party.length <= 5 && input.party.every((line) => typeof line === 'string' && line.length <= 120) ? input.party as string[] : null,
    restoreValues: isRecord(input.restoreValues) && Object.values(input.restoreValues).every((value) => typeof value === 'string')
      ? input.restoreValues as Record<string, string> : null,
  };
}

/** The newest signed, not rolled back Party entry for a ticket, as the Contract may show it; null when there is none. */
export function gmVerifiedParty(entries: GmLogEntry[], key: string) {
  const newest = entries.filter((entry) => entry.type === 'party' && entry.kind === 'change' && entry.ticket === key).sort((a, b) => b.id - a.id)[0];
  return newest && !newest.rolledBack && !newest.unverified && newest.party ? { log: newest.id, lines: newest.party } : null;
}

/** Whether a manager log row carries the signature the kit makes with DOCK's log key; party-check.cjs asks before a runner trusts a Party. */
export function gmMacValid(key: string, row: unknown) {
  if (!isRecord(row) || typeof row.mac !== 'string' || !/^[0-9a-f]{64}$/.test(row.mac) || !Number.isInteger(row.id)) return false;
  const expected = createHmac('sha256', key).update(JSON.stringify({ ...row, mac: undefined })).digest('hex');
  return timingSafeEqual(Buffer.from(row.mac), Buffer.from(expected));
}

export function parseGmRollback(input: unknown): GmLogEntry {
  if (!isRecord(input) || input.ok !== true) throw new OrchestratorInputError((isRecord(input) && text(input.error, 300)) || 'The kit did not roll back');
  return parseGmEntry(input.entry);
}

export interface GmUsageRun { key: string; stage: string; failures: LedgerFailure[]; rounds: LedgerRounds | null; acFailed: number; blockers: number }

/**
 * One ticket's numbers for a Guild Master suggestion: tokens, cost, how much went to subagents, the agents that used the most, and the
 * gates that failed. Numbers and checked names only; no title, note or finding text.
 */
export function gmUsageRow(run: GmUsageRun, usage: ClaudeTicketUsage) {
  const agents = new Map<string, { name: string; model: string | null; tokens: number; cost: number }>();
  for (const agent of usage.agents) {
    const name = word(agent.name) ?? 'agent';
    const model = word(agent.model);
    const at = `${name}|${model}`;
    const row = agents.get(at) ?? { name, model, tokens: 0, cost: 0 };
    row.tokens += count(agent.totalTokens) ?? 0;
    row.cost += count(agent.cost) ?? 0;
    agents.set(at, row);
  }
  const total = count(usage.totalTokens) ?? 0;
  const failures = Object.fromEntries(FAILURE_TYPES.map((type) => [type, run.failures.filter((failure) => failure.type === type).length]));
  return {
    key: run.key,
    stage: word(run.stage),
    available: usage.available,
    sessions: usage.sessions,
    totalTokens: total,
    totalCost: Math.round((count(usage.totalCost) ?? 0) * 100) / 100,
    subagentShare: total > 0 ? Math.round(((total - (count(usage.mainTokens) ?? 0)) / total) * 100) / 100 : 0,
    top: [...agents.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 3).map((row) => ({ ...row, cost: Math.round(row.cost * 100) / 100 })),
    failures,
    rounds: run.rounds && Number.isInteger(run.rounds.used) ? { used: run.rounds.used, max: run.rounds.max } : null,
    acFailed: run.acFailed,
    blockers: run.blockers,
  };
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
