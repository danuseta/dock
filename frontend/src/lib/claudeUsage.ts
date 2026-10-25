export type UsagePeriod = 'today' | '7d' | '30d' | 'custom';

export const USAGE_PERIODS: Array<{ id: UsagePeriod; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
];

export interface ClaudeTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
}
export interface ClaudeUsageDay { date: string; totalTokens: number; cost: number }
export interface ClaudeUsageModel extends ClaudeTokens { model: string }
export interface ClaudeUsage { available: boolean; totals: ClaudeTokens | null; days: ClaudeUsageDay[]; models: ClaudeUsageModel[]; error: string | null }

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const pad = (value: number) => String(value).padStart(2, '0');
export const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The two dates (YYYY-MM-DD, local days) a preset covers; 7 days is today and the six days before. */
export function periodRange(period: Exclude<UsagePeriod, 'custom'>, now: Date): { from: string; to: string } {
  const back = period === 'today' ? 0 : period === '7d' ? 6 : 29;
  return { from: localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)), to: localDate(now) };
}

/** Whether the owner's custom dates make a range the BFF accepts: both set, in order, at most 366 days. */
export function validCustomRange(from: string, to: string): boolean {
  if (!from || !to || to < from) return false;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1 <= MAX_RANGE_DAYS;
}

export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

export const formatCost = (value: number) => `$${value.toFixed(2)}`;

/** Every day from `from` to `to`, with zero for a day ccusage did not report, so the chart keeps a true time axis. */
export function fillDays(from: string, to: string, days: ClaudeUsageDay[]): ClaudeUsageDay[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return days;
  const filled: ClaudeUsageDay[] = [];
  for (let at = start; at <= end; at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    filled.push(byDate.get(date) ?? { date, totalTokens: 0, cost: 0 });
  }
  return filled;
}
