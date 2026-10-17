import React from 'react';
import { cn } from '../lib/cn';
import type { AgentRun } from './runs';

/** A review run's outcome: N blocker when one is recorded, LGTM when it was approved, nothing before the reviewer says. */
export const VerdictBadge: React.FC<{ run: Pick<AgentRun, 'kind' | 'verdict' | 'blockers'>; className?: string }> = ({ run, className }) => {
  if (run.kind !== 'review') return null;
  const blockers = run.blockers ?? 0;
  if (!blockers && run.verdict !== 'approve') return null;
  return (
    <span className={cn('inline-flex flex-none items-center rounded-xs border px-1.5 py-px font-mono text-[0.62rem] font-bold', blockers ? 'border-status-conflict text-status-conflict' : 'border-status-merged text-status-merged', className)}>
      {blockers ? `${blockers} blocker${blockers > 1 ? 's' : ''}` : 'LGTM'}
    </span>
  );
};
