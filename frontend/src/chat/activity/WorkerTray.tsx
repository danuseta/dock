import React, { useMemo, useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { agentTask, agentType, capRows, durationOf, formatDuration, statusText, stepsText, trayWorkers, type ChatActivity, type TrayWorker } from './activity';
import { StatusIcon } from './ActivityRow';
import { useNow } from './useNow';

const SHOWN = 3;

interface WorkerTrayProps {
  events: ChatActivity[];
  activeId?: string | null;
  /** Filters the thread to one worker; picking the active one again clears the filter. Without it the rows only show. */
  onSelect?: (workerId: string | null) => void;
}

/** The subagents of the session, kept above the composer so they stay in view while the lead goes on talking. */
export const WorkerTray: React.FC<WorkerTrayProps> = ({ events, activeId, onSelect }) => {
  const workers = useMemo(() => trayWorkers(events), [events]);
  const [open, setOpen] = useState(true);
  const running = workers.filter((worker) => worker.agent.status === 'running').length;
  const now = useNow(running > 0);
  if (workers.length === 0) return null;
  const { visible, hidden } = capRows(workers, open ? SHOWN : 0);
  const pick = (worker: TrayWorker) => onSelect?.(activeId === worker.agent.eventId ? null : worker.agent.eventId);

  return (
    <section className="flex flex-none flex-col gap-1 border-t border-border bg-surface-0 px-3.5 py-2" aria-label="Subagents of this session">
      <button type="button" className="flex items-center gap-1.5 self-start font-mono text-[0.66rem] text-muted-foreground hover:text-foreground max-[900px]:min-h-11" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {running > 0 ? `${running} running` : 'No worker running'}{workers.length > running && ` · ${workers.length - running} finished`}
        <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />
      </button>
      {visible.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {visible.map((worker) => {
            const { agent } = worker;
            const elapsed = durationOf(agent, now);
            const step = agent.status === 'running' ? (worker.last ? worker.last.label || worker.last.name : 'Starting...') : `${statusText(agent.status)} · ${stepsText(worker.steps)}`;
            const body = (
              <>
                <Bot size={13} aria-hidden="true" className="mt-[0.15rem] flex-none text-secondary-foreground" />
                <span className="flex flex-none items-center gap-1.5 text-[0.7rem] font-bold text-foreground">{agentType(agent.name)}<StatusIcon status={agent.status} size={11} /></span>
                <span className="min-w-0 flex-1 truncate text-[0.76rem] text-secondary-foreground max-[900px]:basis-[calc(100%-6rem)]" title={agentTask(agent)}>{agentTask(agent)}</span>
                <span className="min-w-0 max-w-[40%] truncate font-mono text-[0.66rem] text-muted-foreground max-[900px]:max-w-none max-[900px]:flex-1 max-[900px]:pl-5" title={step}>{step}</span>
                {elapsed !== null && <span className="flex-none font-mono text-[0.66rem] tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>}
              </>
            );
            const rowClass = cn('flex w-full min-w-0 items-start gap-2 rounded-xs border border-border bg-surface-1 px-2.5 py-1.5 text-left max-[900px]:flex-wrap', agent.status !== 'running' && 'opacity-60');
            return (
              <li key={agent.eventId}>
                {onSelect ? (
                  <button type="button" className={cn(rowClass, 'hover:bg-surface-2 max-[900px]:min-h-11', activeId === agent.eventId && 'border-border-glow')} aria-pressed={activeId === agent.eventId} onClick={() => pick(worker)}>{body}</button>
                ) : <div className={rowClass}>{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
          {workers.slice(visible.length).map((worker) => {
            const chipClass = cn('inline-flex items-center gap-1 rounded-pill border border-border bg-surface-1 px-2 py-0.5 font-mono text-[0.64rem] text-secondary-foreground', worker.agent.status !== 'running' && 'opacity-60');
            const label = <>{agentType(worker.agent.name)}<StatusIcon status={worker.agent.status} size={10} /></>;
            return (
              <li key={worker.agent.eventId}>
                {onSelect ? (
                  <button type="button" className={cn(chipClass, 'hover:bg-surface-2 max-[900px]:min-h-11', activeId === worker.agent.eventId && 'border-border-glow')} aria-pressed={activeId === worker.agent.eventId} title={agentTask(worker.agent)} onClick={() => pick(worker)}>{label}</button>
                ) : <span className={chipClass} title={agentTask(worker.agent)}>{label}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
