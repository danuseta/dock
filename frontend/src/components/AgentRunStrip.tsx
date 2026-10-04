import React from 'react';
import { Bot, Hand } from 'lucide-react';
import { stageColor, stageLabel, type AgentRunSummary } from '../agents/runs';
import { cn } from '../lib/cn';

/** One line on a ticket card: where the agent is and whether it needs the owner. */
export const AgentRunStrip: React.FC<{ run: AgentRunSummary; className?: string }> = ({ run, className }) => {
  const trouble = run.acFailed > 0 || run.stalled;
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-xs border px-2 py-1 font-mono text-[0.68rem] font-bold',
        run.waiting ? 'border-amber-300/45 bg-amber-300/10 text-amber-200' : trouble ? 'border-status-conflict/45 bg-status-conflict-bg text-status-conflict' : 'border-border bg-surface-0 text-secondary-foreground',
        className,
      )}
      aria-label={`Agent: ${stageLabel(run.stage)}, ${run.acPassed} of ${run.acTotal} acceptance criteria passed${run.waiting ? ', waiting on you' : ''}`}
    >
      {run.waiting ? <Hand size={12} className="shrink-0" aria-hidden="true" /> : <Bot size={12} className="shrink-0" aria-hidden="true" />}
      <i className="size-1.5 shrink-0 rounded-full" style={{ background: stageColor(run.stage) }} aria-hidden="true" />
      <span className="shrink-0">{stageLabel(run.stage).toUpperCase()}</span>
      <span className="shrink-0 tabular-nums opacity-80">AC {run.acPassed}/{run.acTotal}</span>
      <span className="min-w-0 truncate font-semibold">{run.waiting ? 'Waiting on you' : run.acFailed > 0 ? 'AC failed' : run.stalled ? 'Stalled' : ''}</span>
    </div>
  );
};
