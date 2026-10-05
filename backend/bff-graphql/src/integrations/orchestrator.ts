import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateIngestToken, hashIngestToken } from '../auth/ingest-token';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { buildTimeline } from './orchestrator-timeline';

export const ORCHESTRATOR_STAGES = [
  'gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done', 'blocked',
] as const;
export type OrchestratorStage = typeof ORCHESTRATOR_STAGES[number];
export type AcState = 'PASS' | 'FAIL' | 'TODO';
export type Activity = 'IDLE' | 'ACTIVE' | 'WAITING';

export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'Notification', 'PermissionRequest', 'UserPromptSubmit',
] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

// Idle / Active / Waiting and these windows follow pixtuoid's reducer
// (state/reducer/mod.rs, MIT, (c) 2026 Ivan Wang): an Active agent falls back
// to Idle 1.5 s after its tool ends, and each state goes stale on its own clock.
export const ACTIVE_GRACE_MS = 1500;
export const STALE_ACTIVE_MS = 10 * 60 * 1000;
export const STALE_IDLE_MS = 30 * 60 * 1000;

const TICKET_KEY = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d{0,9}$/;
const MAX_AC = 50;
const MAX_EVENTS_KEPT = 60;
const EVENTS_RETURNED = 20;
const MAX_TOOL_EVENTS_KEPT = 300;
const MAX_BATCH_EVENTS = 100;
// Tools that are plumbing between agents rather than work worth drawing.
const HIDDEN_TOOLS = new Set(['SubagentHandback']);
const SPAWN_TOOLS = new Set(['Agent', 'Task']);
const MAX_TOKENS = 5;
const MAX_TRANSCRIPT_FILES = 40;
export const MAX_TRANSCRIPT_BYTES = 12 * 1024 * 1024;
const TRANSCRIPT_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,3}$/;

export class OrchestratorInputError extends Error {}

export interface LedgerAc { n: number; state: AcState; text: string; evidence: string | null }
export const RUN_KINDS = ['build', 'review'] as const;
export type RunKind = typeof RUN_KINDS[number];

export interface Ledger {
  key: string;
  kind: RunKind;
  title: string;
  stage: OrchestratorStage;
  waiting: string;
  gate: string | null;
  ac: LedgerAc[];
  testsBe: string | null;
  testsFe: string | null;
  prBe: string | null;
  prFe: string | null;
  note: string | null;
  updatedAt: string;
}

export interface TranscriptFile { path: string; text: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | null {
  return text(value, max) || null;
}

function httpUrl(value: unknown): string | null {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeTicketKey(value: unknown): string {
  const key = String(value ?? '').trim().toUpperCase();
  if (!TICKET_KEY.test(key)) throw new OrchestratorInputError('A valid ticket key is required');
  return key;
}

/**
 * The ledger is written by a script on the laptop. Only the fields DOCK shows
 * are kept: local directories and ports stay on the laptop.
 */
export function parseLedger(input: unknown, now = new Date()): Ledger {
  if (!isRecord(input)) throw new OrchestratorInputError('A ticket status object is required');
  const key = normalizeTicketKey(input.key);
  const stage = text(input.stage, 20) as OrchestratorStage;
  if (!ORCHESTRATOR_STAGES.includes(stage)) {
    throw new OrchestratorInputError(`Stage must be one of ${ORCHESTRATOR_STAGES.join(', ')}`);
  }

  const rawAc = Array.isArray(input.ac) ? input.ac : [];
  if (rawAc.length > MAX_AC) throw new OrchestratorInputError(`A maximum of ${MAX_AC} acceptance criteria is supported`);
  const ac = rawAc.filter(isRecord).map((item, index): LedgerAc => {
    const state = text(item.state, 10).toUpperCase();
    return {
      n: Number.isInteger(item.n) && Number(item.n) > 0 ? Number(item.n) : index + 1,
      state: state === 'PASS' || state === 'FAIL' ? state : 'TODO',
      text: text(item.text, 500),
      evidence: optionalText(item.evidence, 500),
    };
  });

  const tests = isRecord(input.tests) ? input.tests : {};
  const pr = isRecord(input.pr) ? input.pr : {};
  const updatedAt = new Date(text(input.updatedAt, 40));

  return {
    key,
    kind: text(input.kind, 20) === 'review' ? 'review' : 'build',
    title: text(input.title, 300),
    stage,
    waiting: text(input.waiting, 500),
    gate: optionalText(input.gate, 40),
    ac,
    testsBe: optionalText(tests.be, 200),
    testsFe: optionalText(tests.fe, 200),
    prBe: httpUrl(pr.be),
    prFe: httpUrl(pr.fe),
    note: optionalText(input.note, 500),
    updatedAt: (Number.isNaN(updatedAt.getTime()) || updatedAt > now ? now : updatedAt).toISOString(),
  };
}

export function parseHookEvent(input: unknown): { key: string; event: HookEvent; detail: string | null } {
  if (!isRecord(input)) throw new OrchestratorInputError('An event object is required');
  const event = text(input.event, 40) as HookEvent;
  if (!HOOK_EVENTS.includes(event)) throw new OrchestratorInputError(`Event must be one of ${HOOK_EVENTS.join(', ')}`);
  return { key: normalizeTicketKey(input.key), event, detail: optionalText(input.detail, 80) };
}

export interface BatchEvent {
  event: HookEvent;
  at: Date;
  tool: string | null;
  agentId: string | null;
  agentType: string | null;
  spawnType: string | null;
  spawnName: string | null;
  detail: string | null;
}

/** A queue of hook events flushed from the laptop every few seconds. */
export function parseEventBatch(input: unknown, now = new Date()): { key: string; events: BatchEvent[] } {
  if (!isRecord(input)) throw new OrchestratorInputError('An event batch object is required');
  const raw = Array.isArray(input.events) ? input.events : [];
  if (raw.length === 0 || raw.length > MAX_BATCH_EVENTS) {
    throw new OrchestratorInputError(`Between 1 and ${MAX_BATCH_EVENTS} events are required`);
  }
  const events = raw.map((item): BatchEvent => {
    if (!isRecord(item)) throw new OrchestratorInputError('Each event must be an object');
    const event = text(item.event, 40) as HookEvent;
    if (!HOOK_EVENTS.includes(event)) throw new OrchestratorInputError(`Event must be one of ${HOOK_EVENTS.join(', ')}`);
    const at = new Date(text(item.at, 40));
    return {
      event,
      at: Number.isNaN(at.getTime()) || at > now ? now : at,
      tool: optionalText(item.tool, 60),
      agentId: optionalText(item.agentId, 64),
      agentType: optionalText(item.agentType, 80),
      spawnType: optionalText(item.spawnType, 80),
      spawnName: optionalText(item.spawnName, 32),
      detail: optionalText(item.detail, 80),
    };
  });
  return { key: normalizeTicketKey(input.key), events };
}

export function parseTranscript(input: unknown): { key: string; files: TranscriptFile[]; stats: Record<string, number> } {
  if (!isRecord(input)) throw new OrchestratorInputError('A transcript object is required');
  const rawFiles = Array.isArray(input.files) ? input.files : [];
  if (rawFiles.length === 0 || rawFiles.length > MAX_TRANSCRIPT_FILES) {
    throw new OrchestratorInputError(`Between 1 and ${MAX_TRANSCRIPT_FILES} transcript files are required`);
  }
  let bytes = 0;
  const files = rawFiles.map((item): TranscriptFile => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.text !== 'string') {
      throw new OrchestratorInputError('Each transcript file needs a path and text');
    }
    if (!TRANSCRIPT_PATH.test(item.path) || item.path.includes('..')) {
      throw new OrchestratorInputError('Transcript paths must be relative file names');
    }
    bytes += Buffer.byteLength(item.text);
    return { path: item.path, text: item.text };
  });
  if (bytes > MAX_TRANSCRIPT_BYTES) throw new OrchestratorInputError('Transcript is too large');

  const rawStats = isRecord(input.stats) ? input.stats : {};
  const stats: Record<string, number> = { files: files.length, bytes };
  for (const name of ['masked', 'blobs', 'lines']) {
    const value = Number(rawStats[name]);
    if (Number.isFinite(value) && value >= 0) stats[name] = Math.floor(value);
  }
  return { key: normalizeTicketKey(input.key), files, stats };
}

interface ActivityState {
  activity: Activity;
  activityDetail: string | null;
  activityEndedAt: Date | null;
}

/** Hook event -> state change, after pixtuoid's source/decoder.rs. */
export function reduceHookEvent(current: ActivityState, event: HookEvent, detail: string | null, now: Date): ActivityState {
  switch (event) {
    case 'PreToolUse':
      return { activity: 'ACTIVE', activityDetail: detail || 'tool', activityEndedAt: null };
    case 'UserPromptSubmit':
      return { activity: 'ACTIVE', activityDetail: 'prompt', activityEndedAt: null };
    case 'PostToolUse':
    case 'Stop':
    case 'SubagentStop':
      return current.activity === 'ACTIVE' ? { ...current, activityEndedAt: now } : current;
    case 'Notification':
      return { activity: 'WAITING', activityDetail: detail || 'waiting', activityEndedAt: null };
    case 'PermissionRequest':
      return { activity: 'WAITING', activityDetail: 'permission', activityEndedAt: null };
  }
}

interface RunRow {
  key: string;
  title: string;
  stage: string;
  waiting: string;
  payload: string;
  activity: string;
  activityDetail: string | null;
  activityEndedAt: Date | null;
  lastEventAt: Date | null;
  ledgerUpdatedAt: Date;
  transcriptAt: Date | null;
  dismissedAt: Date | null;
}

const FINISHED_STAGES = new Set<string>(['done', 'blocked']);

export type PullRequestStatus = 'open' | 'draft' | 'merged' | 'closed';
export interface RunPullRequest { url: string; number: number; repo: string; status: PullRequestStatus }
export type PullRequestLookup = (key: string) => Promise<RunPullRequest[]>;

const PR_LOOKUP_INTERVAL_MS = 5 * 60 * 1000;
const PR_LOOKUP_STAGES = new Set<string>(['pr', 'commit', 'evidence']);

function ledgerPullRequest(url: string): RunPullRequest {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return { url, number: match ? Number(match[2]) : 0, repo: match ? match[1] : url, status: 'open' };
}

function reviewState(pullRequests: RunPullRequest[]): 'open' | 'merged' | null {
  if (pullRequests.some((pr) => pr.status === 'open' || pr.status === 'draft')) return 'open';
  if (pullRequests.length > 0 && pullRequests.every((pr) => pr.status === 'merged')) return 'merged';
  return null;
}

// Cache-only GitHub lookup for the 5 s polled list: asks at most once per ticket
// per window and serves the last answer in between.
export function throttledPullRequestLookup(
  search: PullRequestLookup,
  intervalMs = PR_LOOKUP_INTERVAL_MS,
  clock: () => number = Date.now,
): PullRequestLookup {
  const last = new Map<string, { at: number; pullRequests: RunPullRequest[] }>();
  return async (key) => {
    const seen = last.get(key);
    if (seen && clock() - seen.at < intervalMs) return seen.pullRequests;
    const entry = { at: clock(), pullRequests: seen?.pullRequests ?? [] };
    last.set(key, entry);
    try { entry.pullRequests = await search(key); } catch { /* a failing GitHub lookup keeps the previous answer */ }
    return entry.pullRequests;
  };
}

export function toOrchestration(row: RunRow, now: Date, githubPullRequests: RunPullRequest[] = []) {
  let ledger: Partial<Ledger> = {};
  try { ledger = JSON.parse(row.payload); } catch { /* an unreadable payload still shows the row's own columns */ }
  const ac = Array.isArray(ledger.ac) ? ledger.ac : [];
  const lastSeen = row.lastEventAt && row.lastEventAt > row.ledgerUpdatedAt ? row.lastEventAt : row.ledgerUpdatedAt;
  const idleMs = Math.max(0, now.getTime() - lastSeen.getTime());

  // The ledger's "waiting" is a gate only the owner can open, so it wins over
  // whatever the hooks last reported.
  let activity: Activity = row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE';
  let activityDetail = row.activityDetail;
  let endedMs: number | null = row.activityEndedAt ? Math.max(0, now.getTime() - row.activityEndedAt.getTime()) : null;
  if (activity === 'ACTIVE' && endedMs !== null && endedMs >= ACTIVE_GRACE_MS) {
    activity = 'IDLE'; activityDetail = null; endedMs = null;
  }
  if (row.waiting) { activity = 'WAITING'; activityDetail = 'gate'; endedMs = null; }
  if (FINISHED_STAGES.has(row.stage) && !row.waiting) { activity = 'IDLE'; activityDetail = null; endedMs = null; }

  const pullRequests = githubPullRequests.length > 0
    ? githubPullRequests
    : [ledger.prBe, ledger.prFe].filter((url): url is string => typeof url === 'string' && url.length > 0).map(ledgerPullRequest);
  const review = FINISHED_STAGES.has(row.stage) ? null : reviewState(pullRequests);
  if (review && activity === 'ACTIVE' && idleMs > STALE_ACTIVE_MS) { activity = 'IDLE'; activityDetail = null; endedMs = null; }

  const stalled = !FINISHED_STAGES.has(row.stage)
    && activity !== 'WAITING'
    && review === null
    && idleMs > (activity === 'ACTIVE' ? STALE_ACTIVE_MS : STALE_IDLE_MS);

  return {
    key: row.key,
    kind: ledger.kind === 'review' ? 'review' : 'build',
    title: row.title,
    stage: row.stage,
    waiting: row.waiting || null,
    gate: ledger.gate ?? null,
    ac,
    acPassed: ac.filter((item) => item.state === 'PASS').length,
    acFailed: ac.filter((item) => item.state === 'FAIL').length,
    acTotal: ac.length,
    testsBe: ledger.testsBe ?? null,
    testsFe: ledger.testsFe ?? null,
    prBe: ledger.prBe ?? null,
    prFe: ledger.prFe ?? null,
    pullRequests,
    review,
    note: ledger.note ?? null,
    activity,
    activityDetail,
    idleSeconds: Math.floor(idleMs / 1000),
    endedSeconds: endedMs === null ? null : endedMs / 1000,
    stalled,
    hasTranscript: Boolean(row.transcriptAt),
    updatedAt: row.ledgerUpdatedAt.toISOString(),
  };
}

export type Orchestration = ReturnType<typeof toOrchestration>;

function minutes(seconds: number): string {
  const value = Math.round(seconds / 60);
  return value < 90 ? `${value} min` : `${Math.round(value / 60)} h`;
}

export function attentionItems(runs: Orchestration[]) {
  return runs.flatMap((run) => {
    const items: Array<{ id: string; type: string; message: string; ticketKey: string }> = [];
    if (run.waiting) {
      items.push({ id: `agent-waiting-${run.key}`, type: 'AGENT_WAITING', message: `Waiting on you: ${run.waiting}`, ticketKey: run.key });
    }
    if (run.acFailed > 0) {
      const failed = run.ac.filter((item) => item.state === 'FAIL').map((item) => `AC${item.n}`).join(', ');
      items.push({ id: `agent-ac-failed-${run.key}`, type: 'AGENT_AC_FAILED', message: `Acceptance check failed: ${failed}`, ticketKey: run.key });
    }
    if (run.stalled) {
      items.push({ id: `agent-stalled-${run.key}`, type: 'AGENT_STALLED', message: `No agent activity for ${minutes(run.idleSeconds)} in ${run.stage}`, ticketKey: run.key });
    }
    return items;
  });
}

function defaultTranscriptDirectory(): string {
  return path.join(path.resolve(process.env.JIDIS_DATA_DIR || 'data'), 'transcripts');
}

export class OrchestratorService {
  constructor(
    private readonly storage = new StorageService(),
    private readonly transcriptDirectory = defaultTranscriptDirectory(),
    private readonly lookupPullRequests: PullRequestLookup | null = null,
  ) {}

  private async present(row: RunRow, now: Date) {
    const run = toOrchestration(row, now);
    if (!this.lookupPullRequests || row.stage === 'done') return run;
    if (!PR_LOOKUP_STAGES.has(row.stage) && !run.stalled) return run;
    const pullRequests = await this.lookupPullRequests(row.key).catch(() => []);
    return pullRequests.length > 0 ? toOrchestration(row, now, pullRequests) : run;
  }

  async list(now = new Date()) {
    const rows = await this.storage.getOrchestratorRuns();
    return Promise.all(rows.filter((row) => !row.dismissedAt).map((row) => this.present(row, now)));
  }

  async get(keyInput: string, now = new Date()) {
    let key: string;
    try { key = normalizeTicketKey(keyInput); } catch { return null; }
    const row = await this.storage.getOrchestratorRun(key);
    return row && !row.dismissedAt ? this.present(row, now) : null;
  }

  async events(key: string) {
    const events = await this.storage.getOrchestratorEvents(key, EVENTS_RETURNED);
    return events.map((event) => ({ id: event.id, kind: event.kind, detail: event.detail, at: event.createdAt.toISOString() }));
  }

  async timeline(keyInput: string, now = new Date()) {
    const run = await this.get(keyInput, now);
    if (!run) return null;
    const [stageEvents, toolEvents] = await Promise.all([
      this.storage.getOrchestratorEvents(run.key, MAX_EVENTS_KEPT),
      this.storage.getOrchestratorToolEvents(run.key, MAX_TOOL_EVENTS_KEPT),
    ]);
    return buildTimeline(run, stageEvents, toolEvents, now);
  }

  /** The agents the main session has spawned for the stage the ticket is in. */
  async members(keyInput: string, now = new Date()) {
    const timeline = await this.timeline(keyInput, now);
    return timeline ? timeline.agents.filter((agent) => agent.parentId) : [];
  }

  async needsAttention(now = new Date()) {
    return attentionItems(await this.list(now));
  }

  async ingestLedger(input: unknown, now = new Date()) {
    const ledger = parseLedger(input, now);
    const previous = await this.storage.getOrchestratorRun(ledger.key);
    const row = await this.storage.upsertOrchestratorRun(ledger.key, {
      title: ledger.title,
      stage: ledger.stage,
      waiting: ledger.waiting,
      payload: JSON.stringify(ledger),
      ledgerUpdatedAt: new Date(ledger.updatedAt),
    });

    if (!previous || previous.stage !== ledger.stage) {
      await this.storage.addOrchestratorEvent(ledger.key, 'STAGE', ledger.stage, MAX_EVENTS_KEPT);
    }
    if (ledger.waiting && previous?.waiting !== ledger.waiting) {
      await this.storage.addOrchestratorEvent(ledger.key, 'WAITING', ledger.waiting, MAX_EVENTS_KEPT);
    } else if (!ledger.waiting && previous?.waiting) {
      await this.storage.addOrchestratorEvent(ledger.key, 'RESUMED', null, MAX_EVENTS_KEPT);
    }
    return toOrchestration(row, now);
  }

  /**
   * Hooks fire on every tool call, so this path is one read and one write.
   * The event log only grows when the state actually changes.
   */
  async ingestHookEvent(input: unknown, now = new Date()) {
    const { key, event, detail } = parseHookEvent(input);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return null;

    const current: ActivityState = {
      activity: row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE',
      activityDetail: row.activityDetail,
      activityEndedAt: row.activityEndedAt,
    };
    const next = reduceHookEvent(current, event, detail, now);
    const updated = await this.storage.updateOrchestratorRun(key, { ...next, lastEventAt: now });
    if (next.activity !== current.activity) {
      await this.storage.addOrchestratorEvent(key, `AGENT_${next.activity}`, next.activityDetail, MAX_EVENTS_KEPT);
    }
    return toOrchestration(updated, now);
  }

  /**
   * The batched path the hook uses: one read, one state write and one insert
   * for up to a hundred events, however many tools ran in the window.
   */
  async ingestEventBatch(input: unknown, now = new Date()) {
    const { key, events } = parseEventBatch(input, now);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return null;

    const initial: ActivityState = {
      activity: row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE',
      activityDetail: row.activityDetail,
      activityEndedAt: row.activityEndedAt,
    };
    let state = initial;
    let lastEventAt = row.lastEventAt ?? new Date(0);
    const rows: Array<{ kind: string; agentId: string; agentType: string | null; name: string; detail: string | null; at: Date }> = [];

    for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const fromSubagent = Boolean(event.agentId);
      // A subagent finishing a turn is not the ticket going quiet; only the main session's own stop is.
      if (event.event !== 'SubagentStop' && !(fromSubagent && event.event === 'Stop')) {
        state = reduceHookEvent(state, event.event, event.tool || event.detail, event.at);
      }
      if (event.at > lastEventAt) lastEventAt = event.at;

      if (event.event === 'PreToolUse' && event.tool && !HIDDEN_TOOLS.has(event.tool)) {
        const agent = { agentId: event.agentId || 'main', agentType: event.agentType };
        rows.push({ kind: 'tool', ...agent, name: event.tool, detail: null, at: event.at });
        if (SPAWN_TOOLS.has(event.tool)) {
          // On a spawn row agentType carries the name the spawner gave its member, when it gave one.
          rows.push({ kind: 'spawn', agentId: agent.agentId, agentType: event.spawnName, name: event.spawnType || 'agent', detail: event.detail, at: event.at });
        }
      } else if (event.event === 'SubagentStop' && event.agentId) {
        rows.push({ kind: 'stop', agentId: event.agentId, agentType: event.agentType, name: event.agentType || 'agent', detail: null, at: event.at });
      }
    }

    const updated = await this.storage.updateOrchestratorRun(key, { ...state, lastEventAt });
    await this.storage.addOrchestratorToolEvents(key, rows, MAX_TOOL_EVENTS_KEPT);
    if (state.activity !== initial.activity) {
      await this.storage.addOrchestratorEvent(key, `AGENT_${state.activity}`, state.activityDetail, MAX_EVENTS_KEPT);
    }
    return toOrchestration(updated, now);
  }

  async dismiss(keyInput: string) {
    const key = normalizeTicketKey(keyInput);
    if (!await this.storage.getOrchestratorRun(key)) return false;
    await this.storage.updateOrchestratorRun(key, { dismissedAt: new Date() });
    return true;
  }

  private transcriptFile(key: string) {
    return path.join(this.transcriptDirectory, `${key}.json`);
  }

  async saveTranscript(input: unknown, now = new Date()) {
    const { key, files, stats } = parseTranscript(input);
    if (!await this.storage.getOrchestratorRun(key)) return null;
    await mkdir(this.transcriptDirectory, { recursive: true });
    const target = this.transcriptFile(key);
    const pending = `${target}.${process.pid}.tmp`;
    await writeFile(pending, JSON.stringify({ files, stats: { ...stats, receivedAt: now.toISOString() } }));
    await rename(pending, target);
    await this.storage.updateOrchestratorRun(key, { transcriptAt: now });
    return stats;
  }

  async readTranscript(keyInput: string): Promise<string | null> {
    let key: string;
    try { key = normalizeTicketKey(keyInput); } catch { return null; }
    const target = this.transcriptFile(key);
    try {
      await stat(target);
      return await readFile(target, 'utf8');
    } catch {
      return null;
    }
  }

  async tokens() {
    const tokens = await this.storage.getIngestTokens();
    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async createToken(nameInput: string) {
    const name = text(nameInput, 60);
    if (!name) throw new OrchestratorInputError('Token name is required');
    if (await this.storage.countIngestTokens() >= MAX_TOKENS) {
      throw new OrchestratorInputError(`A maximum of ${MAX_TOKENS} ingest tokens is supported`);
    }
    const generated = generateIngestToken();
    const record = await this.storage.createIngestToken({ name, prefix: generated.prefix, tokenHash: generated.tokenHash });
    return {
      token: generated.token,
      record: { id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt.toISOString(), lastUsedAt: null },
    };
  }

  async revokeToken(id: string) {
    if (!id) return false;
    return (await this.storage.revokeIngestToken(id)).count > 0;
  }

  async authenticate(token: string, now = new Date()) {
    const record = await this.storage.findIngestToken(hashIngestToken(token));
    if (!record) return false;
    // lastUsedAt is informational; once a minute is enough and keeps hook traffic to one write.
    if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > 60_000) {
      await this.storage.touchIngestToken(record.id, now).catch(() => undefined);
    }
    return true;
  }
}

const githubAPI = new GitHubAPI();
export const orchestratorService = new OrchestratorService(undefined, undefined, throttledPullRequestLookup(async (key) => {
  const found = await githubAPI.getPullRequestsForTicket(key, { staleWhileRevalidate: true });
  return found.map((pr) => ({
    url: pr.url,
    number: pr.number,
    repo: `${pr.owner}/${pr.repo}`,
    status: (['open', 'draft', 'merged', 'closed'].includes(pr.status) ? pr.status : 'open') as PullRequestStatus,
  }));
}));
