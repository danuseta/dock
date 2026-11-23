import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { OrchestratorInputError } from './orchestrator';

const TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 60_000;
const MAX_RANGE_DAYS = 366;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const DAY_MS = 86_400_000;

export interface ClaudeTokens { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number; cost: number }
export interface ClaudeUsageDay { date: string; totalTokens: number; cost: number }
export interface ClaudeUsageModel extends ClaudeTokens { model: string }
export interface ClaudeUsage { available: boolean; totals: ClaudeTokens | null; days: ClaudeUsageDay[]; models: ClaudeUsageModel[]; error: string | null }
export interface ClaudeAgentUsage { agentId: string; name: string; model: string | null; totalTokens: number; peakContext: number; cost: number }
export interface ClaudeSessionUsage { available: boolean; found: boolean; totalTokens: number; totalCost: number; mainTokens: number; agents: ClaudeAgentUsage[]; error: string | null }
export interface ClaudeTicketUsage { available: boolean; sessions: number; totalTokens: number; totalCost: number; mainTokens: number; agents: ClaudeAgentUsage[]; error: string | null }
export interface AgentTranscript { agentId: string; name: string; models: Map<string, number>; totalTokens: number; peakContext: number }
interface CcusageSession { totalTokens: number; totalCost: number; models: Map<string, { tokens: number; cost: number }>; from: string | null; to: string | null }

type Run = (bin: string, args: string[]) => Promise<{ stdout: string }>;

const runFile = promisify(execFile);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const none = (error: string | null = null): ClaudeUsage => ({ available: false, totals: null, days: [], models: [], error });

const dayStart = (value: string) => {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time;
};

/** Both dates as YYYY-MM-DD and a range of at most 366 days; the dates reach the ccusage command line only after this. */
export function validateRange(from: string, to: string): void {
  const start = dayStart(from);
  const end = dayStart(to);
  if (start === null || end === null) throw new OrchestratorInputError('Dates must be real dates as YYYY-MM-DD');
  if (end < start) throw new OrchestratorInputError('The end date is before the start date');
  if ((end - start) / DAY_MS + 1 > MAX_RANGE_DAYS) throw new OrchestratorInputError(`The range is at most ${MAX_RANGE_DAYS} days`);
}

const sum = (rows: ClaudeTokens[]): ClaudeTokens => {
  const total: ClaudeTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, cost: 0 };
  for (const row of rows) {
    total.inputTokens += row.inputTokens; total.outputTokens += row.outputTokens;
    total.cacheCreationTokens += row.cacheCreationTokens; total.cacheReadTokens += row.cacheReadTokens;
    total.totalTokens += row.totalTokens; total.cost += row.cost;
  }
  return total;
};

const tokensOf = (raw: Record<string, unknown>, cost: unknown): ClaudeTokens => {
  const inputTokens = num(raw.inputTokens), outputTokens = num(raw.outputTokens), cacheCreationTokens = num(raw.cacheCreationTokens), cacheReadTokens = num(raw.cacheReadTokens);
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens, cost: num(cost) };
};

/** The JSON of `ccusage claude daily --json`: totals from the day rows, the day list, and the model breakdowns of all days added up by model. */
export function parseClaudeUsage(json: unknown): ClaudeUsage {
  if (!isRecord(json) || !Array.isArray(json.daily)) throw new Error('ccusage printed no daily list');
  const days: ClaudeUsageDay[] = [];
  const perDay: ClaudeTokens[] = [];
  const models = new Map<string, ClaudeTokens[]>();
  for (const item of json.daily) {
    if (!isRecord(item) || typeof item.date !== 'string') continue;
    const day = tokensOf(item, item.totalCost);
    perDay.push(day);
    days.push({ date: item.date, totalTokens: day.totalTokens, cost: day.cost });
    for (const breakdown of Array.isArray(item.modelBreakdowns) ? item.modelBreakdowns : []) {
      if (!isRecord(breakdown) || typeof breakdown.modelName !== 'string') continue;
      models.set(breakdown.modelName, [...(models.get(breakdown.modelName) ?? []), tokensOf(breakdown, breakdown.cost)]);
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    available: true,
    totals: sum(perDay),
    days,
    models: [...models].map(([model, rows]) => ({ model, ...sum(rows) })).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens),
    error: null,
  };
}

const SESSION_ID = /^[A-Za-z0-9-]{1,80}$/;
const AGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
const noSession = (available: boolean, error: string | null = null): ClaudeSessionUsage => ({ available, found: false, totalTokens: 0, totalCost: 0, mainTokens: 0, agents: [], error });
const contextOf = (usage: Record<string, unknown>) => num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);

export function parseSessionUsage(json: unknown): CcusageSession | null {
  if (json === null) return null;
  if (!isRecord(json) || !Array.isArray(json.entries)) throw new Error('ccusage printed no session entries');
  const models = new Map<string, { tokens: number; cost: number }>();
  const days: string[] = [];
  for (const entry of json.entries) {
    if (!isRecord(entry) || typeof entry.model !== 'string') continue;
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    if (!Number.isNaN(at)) days.push(new Date(at).toISOString().slice(0, 10));
    const row = models.get(entry.model) ?? { tokens: 0, cost: 0 };
    row.tokens += tokensOf(entry, 0).totalTokens;
    row.cost += num(entry.costUSD);
    models.set(entry.model, row);
  }
  days.sort();
  return { totalTokens: num(json.totalTokens), totalCost: num(json.totalCost), models, from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

export function readAgentTranscript(agentId: string, name: string, text: string, seen: Set<string>): AgentTranscript {
  const agent: AgentTranscript = { agentId, name, models: new Map(), totalTokens: 0, peakContext: 0 };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { continue; }
    const message = isRecord(row) ? row.message : null;
    const usage = isRecord(message) ? message.usage : null;
    if (!isRecord(row) || !isRecord(message) || !isRecord(usage)) continue;
    if (typeof message.id === 'string' && typeof row.requestId === 'string') {
      const key = `${message.id}:${row.requestId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const tokens = contextOf(usage) + num(usage.output_tokens);
    const model = typeof message.model === 'string' ? message.model : 'unknown';
    agent.models.set(model, (agent.models.get(model) ?? 0) + tokens);
    agent.totalTokens += tokens;
    agent.peakContext = Math.max(agent.peakContext, contextOf(usage));
  }
  return agent;
}

export function sessionUsage(session: CcusageSession, transcripts: AgentTranscript[], rates: Map<string, number> = new Map()): ClaudeSessionUsage {
  const listed = [...session.models.values()].some((row) => row.cost > 0);
  const priced = [...session.models.keys()].every((model) => rates.has(model));
  const weight = (model: string, row: { tokens: number; cost: number }) => (listed ? row.cost : priced ? row.tokens * (rates.get(model) ?? 0) : row.tokens);
  const weights = [...session.models].reduce((total, [model, row]) => total + weight(model, row), 0);
  const perToken = (model: string) => {
    const row = session.models.get(model);
    if (!row || row.tokens === 0 || weights === 0) return 0;
    return (session.totalCost * weight(model, row)) / weights / row.tokens;
  };
  const agents = transcripts.filter((agent) => agent.totalTokens > 0).map((agent): ClaudeAgentUsage => {
    let cost = 0, model: string | null = null, most = 0;
    for (const [name, count] of agent.models) {
      cost += count * perToken(name);
      if (count > most) { most = count; model = name; }
    }
    return { agentId: agent.agentId, name: agent.name, model, totalTokens: agent.totalTokens, peakContext: agent.peakContext, cost };
  }).sort((a, b) => b.totalTokens - a.totalTokens);
  const subagents = agents.reduce((total, agent) => total + agent.totalTokens, 0);
  return { available: true, found: true, totalTokens: session.totalTokens, totalCost: session.totalCost, mainTokens: Math.max(0, session.totalTokens - subagents), agents, error: null };
}

export function ticketUsage(sessions: ClaudeSessionUsage[]): ClaudeTicketUsage {
  const found = sessions.filter((session) => session.found);
  const failed = sessions.find((session) => !session.available);
  return {
    available: !failed,
    sessions: found.length,
    totalTokens: found.reduce((total, session) => total + session.totalTokens, 0),
    totalCost: found.reduce((total, session) => total + session.totalCost, 0),
    mainTokens: found.reduce((total, session) => total + session.mainTokens, 0),
    agents: found.flatMap((session) => session.agents),
    error: failed?.error ?? null,
  };
}

/** Claude Code usage of this workspace from the ccusage CLI (CCUSAGE_BIN, else `ccusage` on PATH), asynchronous so the event loop never waits for it. */
export class ClaudeUsageService {
  private readonly cache = new Map<string, { at: number; value: ClaudeUsage }>();
  private readonly sessionCache = new Map<string, { at: number; value: ClaudeSessionUsage }>();

  constructor(
    private readonly bin: () => string = () => process.env.CCUSAGE_BIN?.trim() || 'ccusage',
    private readonly run: Run = (file, args) => (/\.[cm]?js$/i.test(file)
      ? runFile(process.execPath, [file, ...args], { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true })
      : runFile(file, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true })),
    private readonly now: () => number = Date.now,
    private readonly projects: () => string = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'),
  ) {}

  async session(id: string): Promise<ClaudeSessionUsage> {
    if (!SESSION_ID.test(id)) throw new OrchestratorInputError('A session id is letters, digits and dashes');
    const hit = this.sessionCache.get(id);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.readSession(id);
    for (const [saved, entry] of this.sessionCache) if (this.now() - entry.at >= CACHE_TTL_MS) this.sessionCache.delete(saved);
    if (value.available) this.sessionCache.set(id, { at: this.now(), value });
    return value;
  }

  async ticket(ids: string[]): Promise<ClaudeTicketUsage> {
    const sessions: ClaudeSessionUsage[] = [];
    for (const id of ids.filter((item) => SESSION_ID.test(item))) sessions.push(await this.session(id));
    return ticketUsage(sessions);
  }

  private async readSession(id: string): Promise<ClaudeSessionUsage> {
    let session: CcusageSession | null;
    try {
      const { stdout } = await this.run(this.bin(), ['claude', 'session', '--json', '--id', id]);
      session = parseSessionUsage(JSON.parse(stdout));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return noSession(false);
      return noSession(false, error instanceof Error ? error.message.slice(0, 300) : 'ccusage failed');
    }
    if (!session) return noSession(true);
    return sessionUsage(session, await this.transcripts(id), await this.rates(session));
  }

  private async rates(session: CcusageSession): Promise<Map<string, number>> {
    if (!session.from || !session.to) return new Map();
    const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
    const daily = await this.usage(shift(session.from, -1), shift(session.to, 1)).catch(() => null);
    return new Map((daily?.models ?? []).filter((row) => row.totalTokens > 0).map((row) => [row.model, row.cost / row.totalTokens]));
  }

  private async transcripts(id: string): Promise<AgentTranscript[]> {
    const root = this.projects();
    for (const folder of await readdir(root).catch(() => [] as string[])) {
      const dir = path.join(root, folder, id, 'subagents');
      const files = await readdir(dir).catch(() => null);
      if (!files) continue;
      const seen = new Set<string>();
      const agents: AgentTranscript[] = [];
      for (const file of files.sort()) {
        const agentId = AGENT_FILE.exec(file)?.[1];
        if (!agentId) continue;
        const meta: unknown = await readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8').then(JSON.parse).catch(() => null);
        const name = isRecord(meta) && typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : 'agent';
        agents.push(readAgentTranscript(agentId, name, await readFile(path.join(dir, file), 'utf8').catch(() => ''), seen));
      }
      return agents;
    }
    return [];
  }

  async usage(from: string, to: string): Promise<ClaudeUsage> {
    validateRange(from, to);
    const key = `${from}|${to}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.read(from, to);
    for (const [saved, entry] of this.cache) if (this.now() - entry.at >= CACHE_TTL_MS) this.cache.delete(saved);
    if (value.available) this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private async read(from: string, to: string): Promise<ClaudeUsage> {
    try {
      const { stdout } = await this.run(this.bin(), ['claude', 'daily', '--json', '--since', from.replaceAll('-', ''), '--until', to.replaceAll('-', '')]);
      return parseClaudeUsage(JSON.parse(stdout));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return none();
      return none(error instanceof Error ? error.message.slice(0, 300) : 'ccusage failed');
    }
  }
}

export const claudeUsage = new ClaudeUsageService();
