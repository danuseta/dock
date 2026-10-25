import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Gauge } from 'lucide-react';
import { GET_CLAUDE_USAGE } from '../graphql/queries';
import { Input } from './ui';
import { cn } from '../lib/cn';
import { fillDays, formatCost, formatTokens, localDate, periodRange, USAGE_PERIODS, validCustomRange, type ClaudeUsage, type UsagePeriod } from '../lib/claudeUsage';

export const ClaudeUsageCard = () => {
  const [period, setPeriod] = useState<UsagePeriod>('7d');
  const [customFrom, setCustomFrom] = useState(() => periodRange('7d', new Date()).from);
  const [customTo, setCustomTo] = useState(() => localDate(new Date()));
  const customOk = validCustomRange(customFrom, customTo);
  const range = useMemo(() => (period === 'custom' ? { from: customFrom, to: customTo } : periodRange(period, new Date())), [period, customFrom, customTo]);
  const { data, loading, error } = useQuery<{ claudeUsage: ClaudeUsage }>(GET_CLAUDE_USAGE, { variables: range, skip: period === 'custom' && !customOk, fetchPolicy: 'network-only' });
  const usage = data?.claudeUsage;
  const days = useMemo(() => fillDays(range.from, range.to, usage?.days ?? []), [range.from, range.to, usage?.days]);
  const peak = Math.max(1, ...days.map((day) => day.totalTokens));
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  return (
    <article className="min-w-0 rounded-md border border-border bg-surface-0">
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-[17px] py-[15px]">
        <div className="flex items-center gap-2.5"><Gauge className="size-4 text-accent" aria-hidden="true" /><h2 className="text-balance font-display text-[0.82rem] font-bold">Claude usage</h2></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Usage period">
          {USAGE_PERIODS.map((item) => <button key={item.id} type="button" aria-pressed={period === item.id} className={cn('h-6 rounded-full border px-2 text-[0.7rem] max-[760px]:h-9', period === item.id ? 'border-border-glow bg-surface-2 text-foreground' : 'border-border text-muted-foreground')} onClick={() => setPeriod(item.id)}>{item.label}</button>)}
        </div>
      </header>
      {period === 'custom' && <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Input type="date" className="h-8 w-auto px-2 text-xs" aria-label="From date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" className="h-8 w-auto px-2 text-xs" aria-label="To date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} />
        {!customOk && <span className="text-xs text-muted-foreground">Pick a range of at most 366 days.</span>}
      </div>}
      {period === 'custom' && !customOk ? null : loading && !usage ? (
        <div className="px-4 py-5 text-pretty text-sm text-muted-foreground" role="status">Loading Claude usage...</div>
      ) : error ? (
        <div className="px-4 py-5 text-pretty text-sm text-status-conflict" role="alert">Claude usage failed to load: {error.message}</div>
      ) : usage && !usage.available ? (
        usage.error
          ? <div className="px-4 py-5 text-pretty text-sm text-status-conflict" role="alert">ccusage failed: {usage.error}</div>
          : <div className="px-4 py-5 text-pretty text-sm text-muted-foreground">ccusage is not installed on this workspace.</div>
      ) : usage?.totals ? (
        <>
          <div className="grid grid-cols-2 border-b border-border bg-surface-1 [&>div]:border-r [&>div]:border-border [&>div:last-child]:border-r-0">
            <div className="px-4 py-2.5"><strong className="block font-mono text-base tabular-nums">{formatTokens(usage.totals.totalTokens)}</strong><span className="text-[0.65rem] text-muted-foreground">Tokens</span></div>
            <div className="px-4 py-2.5"><strong className="block font-mono text-base tabular-nums">{formatCost(usage.totals.cost)}</strong><span className="text-[0.65rem] text-muted-foreground">Cost</span></div>
          </div>
          {usage.days.length === 0 ? <div className="px-4 py-5 text-sm text-muted-foreground">No Claude usage in this period.</div> : <>
            <figure className="border-b border-border px-4 pb-2 pt-3">
              <figcaption className="mb-1.5 flex justify-between font-mono text-[0.62rem] text-muted-foreground tabular-nums"><span>Tokens per day</span><span>peak {formatTokens(peak)}</span></figcaption>
              <ol className="flex h-36 items-end gap-[3px]" aria-label="Usage per day">
                {days.map((day) => <li className="group relative flex h-full min-w-[3px] flex-1 items-end" key={day.date} title={`${day.date}: ${formatTokens(day.totalTokens)} tokens, ${formatCost(day.cost)}`}>
                  <span className={cn('block w-full rounded-t-[2px]', day.totalTokens ? 'bg-accent group-hover:bg-foreground' : 'bg-surface-2')} style={{ height: `${day.totalTokens ? Math.max(3, (day.totalTokens / peak) * 100) : 1.5}%` }} />
                </li>)}
              </ol>
              <div className="mt-1 flex gap-[3px] font-mono text-[0.58rem] text-muted-foreground tabular-nums" aria-hidden="true">
                {days.map((day, index) => <span className="min-w-[3px] flex-1 overflow-visible whitespace-nowrap" key={day.date}>{index % labelEvery === 0 ? day.date.slice(5) : ''}</span>)}
              </div>
            </figure>
            <div className="overflow-x-auto"><table className="w-full text-[0.68rem]">
              <thead><tr className="text-left text-muted-foreground"><th className="px-4 py-2 font-medium">Model</th><th className="px-2 py-2 text-right font-medium">Input</th><th className="px-2 py-2 text-right font-medium">Output</th><th className="px-2 py-2 text-right font-medium">Cache</th><th className="px-4 py-2 text-right font-medium">Cost</th></tr></thead>
              <tbody>{usage.models.map((model) => <tr className="border-t border-border" key={model.model}>
                <td className="max-w-[160px] truncate px-4 py-1.5 font-mono">{model.model}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatTokens(model.inputTokens)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatTokens(model.outputTokens)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatTokens(model.cacheCreationTokens + model.cacheReadTokens)}</td>
                <td className="px-4 py-1.5 text-right font-mono tabular-nums">{formatCost(model.cost)}</td>
              </tr>)}</tbody>
            </table></div>
          </>}
        </>
      ) : null}
    </article>
  );
};
