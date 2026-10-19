import React from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from './messages';
import { limitTone, resetsIn, toneClass, type ChatLimit } from './status';
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
