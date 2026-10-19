import React, { useId, useMemo, useState } from 'react';
import { Bot, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';
import { agentTask, agentType, durationOf, formatDuration, stepsText, turnHighlights, type AgentHighlight, type ChatActivity } from './activity';
import { ActivityDetail } from './ActivityDetail';
import { NodeList, StatusIcon } from './ActivityRow';
import type { DetailStore } from './detailStore';

const AgentCard: React.FC<{ agent: AgentHighlight; store: DetailStore; now: number }> = ({ agent, store, now }) => {
  const { event, children } = agent.node;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const elapsed = durationOf(event, now);
  return (
    <li className="min-w-0 rounded-xs border border-border bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-10 w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 max-[900px]:min-h-11"
        onClick={() => setOpen((current) => !current)}
      >
        <Bot size={13} className="mt-[0.15rem] flex-none text-secondary-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[0.7rem] font-bold text-foreground">{agentType(event.name)}<StatusIcon status={event.status} size={11} /></span>
          <span className="block truncate font-body text-[0.76rem] text-secondary-foreground">{agentTask(event)}</span>
          {event.status === 'running' && event.summary && event.summary !== agentTask(event) && <span className="block truncate text-muted-foreground">{event.summary}</span>}
        </span>
        <span className="flex-none text-muted-foreground">{stepsText(agent.steps)}</span>
        {elapsed !== null && <span className="flex-none tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>}
        <ChevronRight size={12} className={cn('mt-[0.15rem] flex-none text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" />
      </button>
      <div id={panelId} className={open ? 'min-w-0 border-t border-border' : undefined}>
        {open && event.hasDetail && <ActivityDetail id={event.id} version={`${event.status}:${event.seq}`} store={store} />}
        {open && children.length > 0 && <NodeList nodes={children} store={store} now={now} />}
      </div>
    </li>
  );
};

/** The skills a turn used and the subagents it spawned, shown above its step list. */
export const TurnHighlights: React.FC<{ events: ChatActivity[]; store: DetailStore; now: number }> = ({ events, store, now }) => {
  const { skills, agents } = useMemo(() => turnHighlights(events), [events]);
  if (skills.length === 0 && agents.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-2.5 py-2">
      {skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Skills used">
          {skills.map((skill) => <li key={skill} className="inline-flex items-center gap-1 rounded-xs border border-border bg-surface-2 px-1.5 py-0.5 text-[0.64rem] font-bold text-secondary-foreground"><Sparkles size={10} aria-hidden="true" />{skill}</li>)}
        </ul>
      )}
      {agents.length > 0 && <ul className="flex min-w-0 flex-col gap-1.5" aria-label="Subagents">{agents.map((agent) => <AgentCard key={agent.node.event.eventId} agent={agent} store={store} now={now} />)}</ul>}
    </div>
  );
};
