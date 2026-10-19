import React from 'react';
import { CheckCircle2, ExternalLink, Hand, MessageSquare, MessagesSquare, Server, Timer, User } from 'lucide-react';
import type { AgentRun } from '../../agents/runs';
import { machineOf, machinePlace } from '../../chat/messages';
import { cn } from '../../lib/cn';
import { RUN_STATE_LABEL, TICKET_STEPS, runState, stepIndex } from '../../lib/ticketDetail';
import { PRBadge } from '../PRBadge';
import { Badge, Button, Card } from '../ui';

interface TicketHeaderProps {
  ticket: {
    key: string;
    title: string;
    url?: string | null;
    status?: string | null;
    storyPoints?: number | null;
    sprintName?: string | null;
    workManual?: boolean | null;
  };
  run?: AgentRun | null;
  approvalLabels: string[];
  assignee?: string | null;
  oldSprint: boolean;
  broadcastLabel: string;
  broadcastTitle: string;
  sessionOpening: boolean;
  onBroadcast: () => void;
  onSession: () => void;
}

const RUN_TONE: Record<ReturnType<typeof runState>, string> = {
  none: 'border-border text-secondary-foreground',
  waiting: 'border-status-warn/45 text-status-warn',
  stalled: 'border-status-conflict/45 text-status-conflict',
  running: 'border-status-warn/45 text-status-warn',
  finished: 'border-status-merged/40 text-status-merged',
};

/** Status, machine and how the ticket gets worked, read as one label. */
export const RunLabel: React.FC<{ run?: AgentRun | null; manual: boolean }> = ({ run, manual }) => {
  const state = runState(run);
  return (
    <span className={cn('inline-flex h-7 items-stretch overflow-hidden rounded-pill border text-xs', RUN_TONE[state])}>
      <span className="flex items-center gap-1.5 px-2.5 font-semibold">
        <i className={cn('size-1.5 rounded-full bg-current', state === 'running' && 'animate-pulse motion-reduce:animate-none')} aria-hidden="true" />
        {RUN_STATE_LABEL[state]}
      </span>
      {run && (
        <span className="flex items-center gap-1 border-l border-border px-2.5 text-secondary-foreground" title={`Runs on ${machinePlace(machineOf(run))}`}>
          <Server size={12} aria-hidden="true" />{machineOf(run)}
        </span>
      )}
      <span className="flex items-center gap-1 border-l border-border bg-surface-2 px-2.5 font-semibold text-foreground" title={manual ? 'Worked by hand: the cron does not take or resume it' : 'In the cron queue'}>
        {manual ? <Hand size={12} aria-hidden="true" /> : <Timer size={12} aria-hidden="true" />}
        {manual ? 'Manual' : 'Cron'}
      </span>
    </span>
  );
};

/** The top of the ticket page: identity, where the run is, and every action. */
export const TicketHeader: React.FC<TicketHeaderProps> = ({ ticket, run, approvalLabels, assignee, oldSprint, broadcastLabel, broadcastTitle, sessionOpening, onBroadcast, onSession }) => {
  const current = stepIndex(run?.stage);
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" className="h-7 border-accent bg-accent px-3 text-sm font-extrabold text-black">{ticket.key}</Badge>
          {ticket.storyPoints != null && <Badge className="h-7 border-orange-300/35 bg-orange-300/10 text-orange-200">{ticket.storyPoints} SP</Badge>}
          <span className="h-4 w-px bg-border max-[760px]:hidden" aria-hidden="true" />
          {ticket.status && <PRBadge status={ticket.status} />}
          {approvalLabels.map((label) => <Badge key={label} variant="success" className="h-7 gap-1"><CheckCircle2 size={12} aria-hidden="true" />{label}</Badge>)}
          <span className="h-4 w-px bg-border max-[760px]:hidden" aria-hidden="true" />
          <RunLabel run={run} manual={Boolean(ticket.workManual)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ticket.url && <a href={ticket.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-border-glow max-[760px]:h-11"><ExternalLink size={15} aria-hidden="true" />Jira</a>}
          <Button className="max-[760px]:h-11" onClick={onSession} disabled={sessionOpening}><MessagesSquare size={15} aria-hidden="true" />{sessionOpening ? 'Opening...' : 'Session'}</Button>
          <Button className="border-status-discord bg-status-discord text-white hover:bg-status-discord/80 max-[760px]:h-11" title={broadcastTitle} onClick={onBroadcast}><MessageSquare size={15} aria-hidden="true" />{broadcastLabel}</Button>
        </div>
      </div>

      <h1 className="text-balance font-display text-[1.65rem] leading-snug font-bold">{ticket.title}</h1>

      {run && (
        <ol className="grid grid-cols-7 gap-1" aria-label="Agent stage">
          {TICKET_STEPS.map((step, index) => (
            <li
              key={step.id}
              aria-current={index === current ? 'step' : undefined}
              className={cn(
                'rounded-xs py-1.5 text-center font-mono text-[0.66rem] font-extrabold uppercase',
                index === current ? 'bg-accent text-black' : index < current || run.finished ? 'bg-status-merged-bg text-status-merged' : 'bg-surface-2 text-muted-foreground',
              )}
            >
              {step.name}
            </li>
          ))}
        </ol>
      )}
      {run?.stage === 'blocked' && <p className="text-pretty text-xs text-status-conflict">The run is blocked: {run.note || run.waiting || 'see the session for the reason'}.</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
        {assignee && <span className="flex items-center gap-1.5"><User size={13} aria-hidden="true" />Assignee <strong className="text-secondary-foreground">{assignee}</strong></span>}
        {ticket.sprintName && ticket.sprintName !== 'No Sprint' && <span className={cn('font-semibold', oldSprint ? 'text-muted-foreground' : 'text-status-merged')}>{ticket.sprintName}</span>}
      </div>
    </Card>
  );
};
