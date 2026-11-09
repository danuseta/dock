import React from 'react';
import { cn } from '../lib/cn';
import { readyForQaChip, type AgentRun } from './runs';

const badge = 'inline-flex flex-none items-center rounded-xs border px-1.5 py-px font-mono text-[0.62rem] font-bold';

/** Ready for QA, or "Pass · not ready for QA" with the reasons on hover and on tap. */
export const ReadyForQaChip: React.FC<{ run: Pick<AgentRun, 'kind' | 'verdict' | 'readyForQa'>; className?: string }> = ({ run, className }) => {
  const chip = readyForQaChip(run);
  if (!chip) return null;
  const tone = chip.ready ? 'border-status-merged text-status-merged' : 'border-status-warn text-status-warn';
  if (!chip.reasons.length) return <span className={cn(badge, tone, className)}>{chip.text}</span>;
  return (
    <details className={cn('inline-block max-w-full align-middle', className)} onClick={(event) => event.stopPropagation()}>
      <summary className={cn(badge, tone, 'cursor-pointer list-none')} title={chip.reasons.join('\n')}>{chip.text}</summary>
      <ul className="mt-1 grid gap-0.5 whitespace-normal text-pretty text-[0.7rem] font-normal text-muted-foreground">{chip.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </details>
  );
};

/** A review run's outcome: N blocker when one is recorded, LGTM when it was approved, nothing before the reviewer says; then its QA readiness. */
export const VerdictBadge: React.FC<{ run: Pick<AgentRun, 'kind' | 'verdict' | 'blockers' | 'readyForQa'>; className?: string }> = ({ run, className }) => {
  if (run.kind !== 'review') return null;
  const blockers = run.blockers ?? 0;
  const verdict = blockers || run.verdict === 'approve'
    ? <span className={cn(badge, blockers ? 'border-status-conflict text-status-conflict' : 'border-status-merged text-status-merged', className)}>{blockers ? `${blockers} blocker${blockers > 1 ? 's' : ''}` : 'LGTM'}</span>
    : null;
  return <>{verdict}<ReadyForQaChip run={run} className={cn(verdict && 'ml-1', className)} /></>;
};
