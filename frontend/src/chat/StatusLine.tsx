import React from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from './messages';
import { limitTone, resetsIn, sessionStatusParts, toneClass, type ChatLimit, type ChatSessionStatus } from './status';
import { useChatStatus } from './useChatStatus';

const StaleMark: React.FC<{ receivedAt: string; now: number }> = ({ receivedAt, now }) => (
  <span className="rounded-xs border border-border px-1 text-[0.6rem] font-bold uppercase text-muted-foreground">stale · {relativeTime(receivedAt, now)}</span>
);

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

export const LimitsLine: React.FC<{ className?: string }> = ({ className }) => {
  const { status, now } = useChatStatus();
  const limits = status?.limits;
  if (!limits || (!limits.fiveHour && !limits.sevenDay)) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] tabular-nums', className)} aria-label="Claude usage limits">
      <LimitText label="5h" limit={limits.fiveHour} stale={limits.stale} now={now} />
      <LimitText label="7d" limit={limits.sevenDay} stale={limits.stale} now={now} />
      {limits.stale && <StaleMark receivedAt={limits.receivedAt} now={now} />}
    </p>
  );
};

export const SessionStatusView: React.FC<{ status: ChatSessionStatus; now: number; className?: string }> = ({ status, now, className }) => {
  const parts = sessionStatusParts(status);
  if (parts.length === 0) return null;
  return (
    <span className={cn('flex min-w-0 items-center gap-2 font-mono text-[0.66rem] tabular-nums', status.stale ? 'text-muted-foreground' : 'text-secondary-foreground', className)}>
      <span className="min-w-0 truncate">{parts.join(' · ')}</span>
      {status.stale && <StaleMark receivedAt={status.receivedAt} now={now} />}
    </span>
  );
};

export const SessionStatusLine: React.FC<{ sessionId: string; className?: string }> = ({ sessionId, className }) => {
  const { status, now } = useChatStatus();
  const own = status?.sessions.find((item) => item.sessionId === sessionId);
  return own ? <SessionStatusView status={own} now={now} className={cn('border-b border-border px-3.5 py-1.5', className)} /> : null;
};
