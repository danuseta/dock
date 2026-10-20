import React from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from './messages';
import { limitTone, resetsIn, toneClass, type ChatLimit, type LimitTone } from './status';
import { useChatStatus } from './useChatStatus';

const LimitText: React.FC<{ label: string; limit: ChatLimit | null | undefined; stale: boolean; now: number }> = ({ label, limit, stale, now }) => {
  if (!limit) return null;
  const reset = limit.resetsAt ? resetsIn(limit.resetsAt, now) : '';
  return (
    <span className="whitespace-nowrap">
      <span className={stale ? 'text-muted-foreground' : toneClass[limitTone(limit.usedPercentage)]}>{label} {Math.round(limit.usedPercentage)}%</span>
      {reset && <span className="text-muted-foreground"> · {reset}</span>}
    </span>
  );
};

export const LimitsLine: React.FC<{ className?: string; machine?: string | null }> = ({ className, machine }) => {
  const { status, now } = useChatStatus(machine);
  const limits = status?.limits;
  if (!limits || (!limits.fiveHour && !limits.sevenDay)) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] tabular-nums', className)} aria-label="Claude usage limits">
      <LimitText label="5h" limit={limits.fiveHour} stale={limits.stale} now={now} />
      <LimitText label="7d" limit={limits.sevenDay} stale={limits.stale} now={now} />
      {limits.stale && <span className="text-muted-foreground">updated {relativeTime(limits.receivedAt, now)}</span>}
    </p>
  );
};

const meterClass: Record<LimitTone, string> = {
  ok: 'bg-status-merged',
  warn: 'bg-amber-200',
  danger: 'bg-status-conflict',
};

const LimitMeter: React.FC<{ label: string; limit: ChatLimit | null | undefined; stale: boolean; now: number }> = ({ label, limit, stale, now }) => {
  if (!limit) return null;
  const used = Math.min(100, Math.max(0, Math.round(limit.usedPercentage)));
  const tone = limitTone(used);
  const reset = limit.resetsAt ? resetsIn(limit.resetsAt, now) : '';
  return (
    <div className="flex items-center gap-2" title={reset || undefined}>
      <span className="w-5 flex-none text-muted-foreground">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2" role="meter" aria-label={`${label} limit used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
        <span className={cn('block h-full', stale ? 'bg-muted-foreground' : meterClass[tone])} style={{ width: `${used}%` }} />
      </span>
      <span className={cn('w-9 flex-none text-right', stale ? 'text-muted-foreground' : toneClass[tone])}>{used}%</span>
    </div>
  );
};

export const LimitMeters: React.FC<{ machine?: string | null }> = ({ machine }) => {
  const { status, now } = useChatStatus(machine);
  const limits = status?.limits;
  if (!limits || (!limits.fiveHour && !limits.sevenDay)) return null;
  return (
    <div className="flex flex-col gap-1.5 font-mono text-[0.68rem] tabular-nums" aria-label="Claude usage limits">
      <LimitMeter label="5h" limit={limits.fiveHour} stale={limits.stale} now={now} />
      <LimitMeter label="7d" limit={limits.sevenDay} stale={limits.stale} now={now} />
      {limits.stale && <span className="text-muted-foreground">updated {relativeTime(limits.receivedAt, now)}</span>}
    </div>
  );
};
