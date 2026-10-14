import React, { memo, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, Lock, Minus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ROWS_PER_PAGE, capRows, durationOf, formatDuration, hasRunning, isDropped, sameTree, statusText, stepsText, type ActivityNode, type ChatActivity } from './activity';
import { ActivityDetail } from './ActivityDetail';
import type { DetailStore } from './detailStore';

const TONE: Record<string, string> = {
  running: 'text-secondary-foreground',
  ok: 'text-status-merged',
  error: 'text-status-conflict',
  denied: 'text-amber-200',
  stopped: 'text-muted-foreground',
};

export const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 12 }) => {
  const className = cn('mt-[0.2rem] flex-none', TONE[status] ?? 'text-muted-foreground');
  if (status === 'running') return <Loader2 size={size} className={cn(className, 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />;
  if (status === 'ok') return <Check size={size} className={className} aria-hidden="true" />;
  if (status === 'error') return <X size={size} className={className} aria-hidden="true" />;
  if (status === 'denied') return <Lock size={size} className={className} aria-hidden="true" />;
  return <Minus size={size} className={className} aria-hidden="true" />;
};

const KIND_TAG: Record<string, string> = { agent: 'agent', skill: 'skill', hook: 'hook' };

const RowHead: React.FC<{ event: ChatActivity; now: number; steps?: number; open?: boolean }> = ({ event, now, steps = 0, open }) => {
  const elapsed = durationOf(event, now);
  const failed = event.status === 'error' || event.status === 'denied';
  return (
    <span className="flex min-w-0 items-start gap-2">
      <StatusIcon status={event.status} />
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words [overflow-wrap:anywhere]', failed ? TONE[event.status] : 'text-foreground')}>
          {event.label || event.name}
          {KIND_TAG[event.kind] && <> <span className="ml-1.5 text-[0.58rem] uppercase text-muted-foreground">{KIND_TAG[event.kind]}</span></>}
          {failed ? <> <span className="ml-1.5 text-[0.58rem] font-bold uppercase">{statusText(event.status)}</span></> : <span className="sr-only"> ({statusText(event.status)})</span>}
        </span>
        {event.summary && <span className="block truncate text-muted-foreground">{event.summary}</span>}
      </span>
      {steps > 0 && <span className="flex-none text-muted-foreground">{stepsText(steps)}</span>}
      {elapsed !== null && <span className="flex-none tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>}
      {open !== undefined && <ChevronRight size={12} className={cn('mt-[0.2rem] flex-none text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" />}
    </span>
  );
};

const rowTone = (status: string) => (status === 'error' ? 'bg-status-conflict/10' : status === 'denied' ? 'bg-amber-300/10' : '');

const countSteps = (node: ActivityNode): number => node.children.reduce((total, child) => total + (child.event.kind === 'note' ? 0 : 1) + countSteps(child), 0);

interface RowProps { node: ActivityNode; store: DetailStore; now: number }

const DisclosureRow: React.FC<RowProps> = ({ node, store, now }) => {
  const { event, children } = node;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = (keyEvent: React.KeyboardEvent) => {
    if (keyEvent.key !== 'Escape' || !open) return;
    keyEvent.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <li className={rowTone(event.status)} onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="min-h-8 w-full px-2.5 py-1.5 text-left hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 max-[900px]:min-h-11"
        onClick={() => setOpen((current) => !current)}
      >
        <RowHead event={event} now={now} steps={countSteps(node)} open={open} />
      </button>
      <div id={panelId} className={open ? 'mb-1 ml-4 min-w-0 border-l border-border pl-2' : undefined}>
        {open && event.hasDetail && <ActivityDetail id={event.id} version={event.kind === 'agent' ? `${event.status}:${event.seq}` : event.status} store={store} />}
        {open && children.length > 0 && <NodeList nodes={children} store={store} now={now} />}
      </div>
    </li>
  );
};

export const ActivityRow = memo(function ActivityRow({ node, store, now }: RowProps) {
  const { event, children } = node;
  if (isDropped(event)) return <li className="px-2.5 py-1.5 text-muted-foreground">{event.label}</li>;
  if (event.kind === 'note' && !event.hasDetail) return <li className="px-2.5 py-1 text-[0.64rem] text-muted-foreground/80">{event.label || event.name}{event.summary ? ` · ${event.summary}` : ''}</li>;
  if (event.hasDetail || children.length > 0) return <DisclosureRow node={node} store={store} now={now} />;
  return <li className={cn('px-2.5 py-1.5', rowTone(event.status))}><RowHead event={event} now={now} /></li>;
}, (previous, next) => previous.store === next.store && sameTree(previous.node, next.node) && (previous.now === next.now || !hasRunning(next.node)));

export const NodeList: React.FC<{ nodes: ActivityNode[]; store: DetailStore; now: number }> = ({ nodes, store, now }) => {
  const [shown, setShown] = useState(ROWS_PER_PAGE);
  const { visible, hidden } = capRows(nodes, shown);
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-border/60 font-mono text-[0.68rem]">
      {visible.map((node) => <ActivityRow key={node.event.eventId} node={node} store={store} now={now} />)}
      {hidden > 0 && (
        <li>
          <button type="button" className="min-h-8 w-full px-2.5 py-1.5 text-left text-muted-foreground hover:bg-surface-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 max-[900px]:min-h-11" onClick={() => setShown((current) => current + ROWS_PER_PAGE)}>
            Show {Math.min(hidden, ROWS_PER_PAGE)} more ({hidden} not shown)
          </button>
        </li>
      )}
    </ul>
  );
};
