import React, { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '../../lib/cn';
import { agentTask, agentType, durationOf, formatDuration, runningLanes, type ChatActivity } from './activity';
import { StatusIcon } from './ActivityRow';
import { useNow } from './useNow';

/** One column per subagent still running, its newest steps live, beside the main conversation. */
export const AgentLanes: React.FC<{ events: ChatActivity[]; className?: string }> = ({ events, className }) => {
  const lanes = useMemo(() => runningLanes(events), [events]);
  const now = useNow(lanes.length > 0);
  if (lanes.length === 0) return null;
  return (
    <div className={cn('grid min-h-0 auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2 overflow-x-auto border-l border-border bg-surface-0 p-2', className)} aria-label="Running subagents">
      {lanes.map(({ agent, steps }) => {
        const elapsed = durationOf(agent, now);
        return (
          <section key={agent.eventId} className="flex min-h-0 min-w-0 flex-col rounded-xs border border-border bg-surface-1" aria-label={`Subagent ${agentType(agent.name)}`}>
            <header className="flex flex-none flex-col gap-0.5 border-b border-border px-2.5 py-2 font-mono text-[0.68rem]">
              <span className="flex items-center gap-1.5 font-bold text-foreground"><Bot size={12} aria-hidden="true" />{agentType(agent.name)}<StatusIcon status={agent.status} size={11} />{elapsed !== null && <span className="ml-auto font-normal tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>}</span>
              <span className="truncate font-body text-[0.74rem] text-secondary-foreground" title={agentTask(agent)}>{agentTask(agent)}</span>
            </header>
            <ol className="flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-y-auto font-mono text-[0.66rem]" aria-live="off">
              {steps.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">Starting...</li>}
              {steps.map((step) => (
                <li key={step.eventId} className="flex min-w-0 items-start gap-1.5 px-2.5 py-1.5">
                  <StatusIcon status={step.status} size={11} />
                  <span className="min-w-0 flex-1 break-words text-foreground [overflow-wrap:anywhere]">{step.label || step.name}</span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
};
