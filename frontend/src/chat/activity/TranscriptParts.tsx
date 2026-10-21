import React, { memo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAgentLooksStore } from '../../stores/useAgentLooksStore';
import { durationOf, formatDuration, isDropped, statusText, type ChatActivity } from './activity';
import { ActivityDetail } from './ActivityDetail';
import type { DetailStore } from './detailStore';
import { agentLook, toolArg, toolName, toolOutcome } from './transcript';

/** Above this many steps a message shows the first and last few and folds the middle, like Claude Code's "+N tool uses". */
export const FOLD_AT = 14;
const KEEP = 6;

const BULLET: Record<string, string> = {
  ok: 'text-status-merged',
  running: 'text-status-open',
  error: 'text-status-conflict',
  denied: 'text-status-warn',
  stopped: 'text-muted-foreground',
};

const OUTCOME: Record<string, string> = { error: 'text-status-conflict', denied: 'text-status-warn' };

export const AgentAvatar: React.FC<{ name: string; small?: boolean; className?: string }> = ({ name, small, className }) => {
  const look = agentLook(name, useAgentLooksStore((state) => state.looks));
  return (
    <span
      aria-hidden="true"
      className={cn('grid flex-none place-items-center overflow-hidden font-mono font-extrabold text-background', small ? 'size-[18px] rounded-[5px] text-[0.5rem]' : 'size-[30px] rounded-[8px] text-[0.66rem]', className)}
      style={{ background: look.color }}
    >
      {look.avatarUrl ? <img src={look.avatarUrl} alt="" className="size-full object-cover" /> : look.initials}
    </span>
  );
};

export const MessageTime: React.FC<{ at: string }> = ({ at }) => {
  const date = new Date(at);
  return <time dateTime={at} title={date.toLocaleString('en-GB')} className="font-mono text-[0.66rem] font-normal text-muted-foreground">{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>;
};

/** A chat message from an agent: a header with avatar, who is speaking and when, then what it said or did from the left edge. */
export const MessageShell: React.FC<{ name: string; title?: React.ReactNode; at: string; className?: string; children: React.ReactNode }> = ({ name, title, at, className, children }) => (
  <li className={cn('min-w-0', className)}>
    <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[0.8rem] font-bold text-foreground"><AgentAvatar name={name} />{title ?? name}<MessageTime at={at} /></p>
    {children}
  </li>
);

export const LiveDuration: React.FC<{ event: ChatActivity; now: number }> = ({ event, now }) => {
  const elapsed = durationOf(event, now);
  return elapsed === null ? null : <span className="tabular-nums">{formatDuration(elapsed)}</span>;
};

/** One step in Claude Code's shape: a coloured bullet, the tool and its argument, and under it why it failed. Opening it shows the stored input and output. */
export const TranscriptRow = memo(function TranscriptRow({ event, store, now }: { event: ChatActivity; store: DetailStore; now: number }) {
  const [open, setOpen] = useState(false);
  if (isDropped(event)) {
    return (
      <li className="flex min-w-0 gap-2 text-muted-foreground">
        <span aria-hidden="true" className="w-3 flex-none">●</span>
        <span className="min-w-0">{event.label} <span className="text-[0.6rem] uppercase">kit limit</span></span>
      </li>
    );
  }
  const outcome = toolOutcome(event);
  const running = event.status === 'running';
  const head = (
    <>
      <span className="flex min-w-0 gap-2">
        <span aria-hidden="true" className={cn('w-3 flex-none', BULLET[event.status] ?? 'text-muted-foreground')}>●</span>
        <span className={cn('min-w-0 flex-1', open ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'truncate')}>
          <b className="font-extrabold text-foreground">{toolName(event)}</b>
          <span className="text-secondary-foreground">({toolArg(event)})</span>
          <span className="sr-only"> {statusText(event.status)}</span>
        </span>
      </span>
      {(running || outcome) && (
        <span className={cn('flex min-w-0 gap-2 pl-5', running ? 'text-muted-foreground' : OUTCOME[event.status] ?? 'text-muted-foreground')}>
          <span aria-hidden="true" className="flex-none">⎿</span>
          <span className={cn('min-w-0', open ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'truncate')}>
            {running ? <span className="inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><LiveDuration event={event} now={now} /></span> : outcome}
          </span>
        </span>
      )}
    </>
  );
  if (!event.hasDetail) return <li className="min-w-0">{head}</li>;
  return (
    <li className="min-w-0">
      <button type="button" aria-expanded={open} className={cn('block w-full min-w-0 rounded-xs text-left hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-[900px]:min-h-11', open && 'bg-surface-1')} onClick={() => setOpen((current) => !current)}>
        {head}
      </button>
      {open && <div className="mb-1 ml-5 min-w-0 border-l border-border pl-3"><ActivityDetail id={event.id} version={event.status} store={store} /></div>}
    </li>
  );
}, (previous, next) => previous.event === next.event && previous.store === next.store && (previous.now === next.now || previous.event.status !== 'running'));

/** Steps of one message with the middle folded once there are many. `render` draws a part; parts without a step (text) never fold. */
export function FoldedList<T>({ parts, isStep, render }: { parts: readonly T[]; isStep: (part: T) => boolean; render: (part: T) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const steps = parts.filter(isStep).length;
  const fold = !all && steps > FOLD_AT;
  const out: React.ReactNode[] = [];
  let index = 0;
  for (const part of parts) {
    if (!isStep(part)) {
      out.push(render(part));
      continue;
    }
    const position = index++;
    if (fold && position >= KEEP && position < steps - KEEP) {
      if (position === KEEP) {
        out.push(
          <li key="fold">
            <button type="button" className="pl-5 text-muted-foreground underline decoration-border-glow underline-offset-2 hover:text-foreground max-[900px]:min-h-11" onClick={() => setAll(true)}>
              +{steps - KEEP * 2} tool uses
            </button>
          </li>,
        );
      }
      continue;
    }
    out.push(render(part));
  }
  return <ul className="flex min-w-0 flex-col gap-0.5 font-mono text-[0.72rem] leading-relaxed">{out}</ul>;
}
