import { useState, type MouseEvent } from 'react';
import { cn } from '../lib/cn';
import { formatCost, formatTokens, type ClaudeUsageDay } from '../lib/claudeUsage';

/** Tokens per day as an area line chart; hovering picks the nearest day. */
export const UsageLineChart = ({ days }: { days: ClaudeUsageDay[] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...days.map((day) => day.totalTokens));
  const x = (index: number) => (days.length === 1 ? 50 : (index / (days.length - 1)) * 100);
  const y = (tokens: number) => 100 - (tokens / peak) * 92;
  const line = days.map((day, index) => `${x(index)},${y(day.totalTokens)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const active = hover === null ? null : days[hover];
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(Math.round(ratio * (days.length - 1)));
  };

  return (
    <figure className="border-b border-border px-4 pb-2 pt-3">
      <figcaption className="mb-1.5 flex justify-between gap-3 font-mono text-[0.62rem] text-muted-foreground tabular-nums">
        <span>Tokens per day</span>
        <span>peak {formatTokens(peak)}</span>
      </figcaption>
      <div className="relative h-36 touch-none" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <g className="text-border">{[25, 50, 75].map((at) => <line key={at} x1="0" x2="100" y1={at} y2={at} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}</g>
          <g className="text-accent">
            <polygon points={`${x(0)},100 ${line} ${x(days.length - 1)},100`} fill="currentColor" fillOpacity="0.15" />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
          {hover !== null && <line className="text-muted-foreground" x1={x(hover)} x2={x(hover)} y1="0" y2="100" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {days.map((day, index) => (hover === index || days.length === 1) && <span key={day.date} className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface-0" style={{ left: `${x(index)}%`, top: `${y(day.totalTokens)}%` }} />)}
        {active && hover !== null && <div role="tooltip" className={cn('pointer-events-none absolute z-10 min-w-[128px] rounded-md border border-border-glow bg-surface-1 px-2.5 py-1.5 font-mono text-[0.66rem] tabular-nums shadow-lg', x(hover) > 70 ? '-translate-x-[calc(100%+10px)]' : 'translate-x-[10px]', y(active.totalTokens) < 35 ? 'translate-y-[8px]' : '-translate-y-[calc(100%+8px)]')} style={{ left: `${x(hover)}%`, top: `${y(active.totalTokens)}%` }}>
          <div className="text-muted-foreground">{active.date}</div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Tokens</span><strong className="text-foreground">{formatTokens(active.totalTokens)}</strong></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Cost</span><strong className="text-foreground">{formatCost(active.cost)}</strong></div>
        </div>}
        <ol className="sr-only" aria-label="Usage per day">
          {days.map((day) => <li key={day.date}>{`${day.date}: ${formatTokens(day.totalTokens)} tokens, ${formatCost(day.cost)}`}</li>)}
        </ol>
      </div>
      <div className="relative mt-1 h-3 font-mono text-[0.58rem] text-muted-foreground tabular-nums" aria-hidden="true">
        {days.map((day, index) => index % labelEvery === 0 && <span key={day.date} className={cn('absolute whitespace-nowrap', index === 0 && days.length > 1 ? 'translate-x-0' : x(index) > 90 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${x(index)}%` }}>{day.date.slice(5)}</span>)}
      </div>
    </figure>
  );
};
