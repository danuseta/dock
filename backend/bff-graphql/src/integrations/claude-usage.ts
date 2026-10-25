import { execFile } from 'node:child_process';
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

/** Claude Code usage of this workspace from the ccusage CLI (CCUSAGE_BIN, else `ccusage` on PATH), asynchronous so the event loop never waits for it. */
export class ClaudeUsageService {
  private readonly cache = new Map<string, { at: number; value: ClaudeUsage }>();

  constructor(
    private readonly bin: () => string = () => process.env.CCUSAGE_BIN?.trim() || 'ccusage',
    private readonly run: Run = (file, args) => runFile(file, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }),
    private readonly now: () => number = Date.now,
  ) {}

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
