import React from 'react';
import { cn } from '../lib/cn';
import { MachineChip } from './MachineControls';
import { relativeTime, sessionTitle, type ChatSession } from './messages';

const chip = 'inline-flex flex-none items-center rounded-xs border px-1.5 py-px font-mono text-[0.62rem] font-bold';

export const SourceChip: React.FC<{ source: string }> = ({ source }) => (
  <span className={cn(chip, source === 'dock' ? 'border-accent/30 bg-accent-dim text-accent' : 'border-border-glow text-secondary-foreground')}>{source === 'dock' ? 'DOCK' : 'CLI'}</span>
);

export const ReadOnlyChip: React.FC = () => <span className={cn(chip, 'border-border text-muted-foreground')}>READ-ONLY</span>;

export const TicketChip: React.FC<{ ticketKey: string }> = ({ ticketKey }) => (
  <span className={cn(chip, 'border-accent/30 bg-accent-dim text-accent')}>{ticketKey}</span>
);

interface SessionRowProps {
  session: ChatSession;
  machine: string;
  online: boolean | undefined;
  selected: boolean;
  now: number;
  onSelect: () => void;
  /** A search hit shows the matching snippet and its time instead of the last message. */
  snippet?: string;
  snippetAt?: string;
  /** Live status lines, under the preview. */
  children?: React.ReactNode;
}

export const SessionRow: React.FC<SessionRowProps> = ({ session, machine, online, selected, now, onSelect, snippet, snippetAt, children }) => {
  const working = session.status === 'queued' || session.status === 'running';
  const preview = snippet ?? session.lastText;
  return (
    <button type="button" className={cn('mb-1 block w-full rounded-xs border border-transparent px-2.5 py-2 text-left hover:bg-surface-1', selected && 'border-border-glow bg-surface-1')} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <span className="flex items-center gap-1.5">
        <SourceChip source={session.source} />
        <MachineChip name={machine} online={online} />
        <span className="min-w-0 flex-1 truncate font-display text-[0.8rem] font-semibold">{sessionTitle(session)}</span>
        {session.waiting && <span className="flex-none rounded-xs border border-amber-300/50 bg-amber-300/10 px-1.5 py-px font-mono text-[0.62rem] font-bold text-amber-200">waiting</span>}
        {working && <i className="size-1.5 flex-none animate-pulse rounded-full bg-status-merged" title="Working" aria-hidden="true" />}
        {session.status === 'error' && <i className="size-1.5 flex-none rounded-full bg-status-conflict" title="The last turn failed" aria-hidden="true" />}
      </span>
      {preview && <span className={cn('mt-1 text-[0.76rem] text-secondary-foreground', snippet === undefined ? 'block truncate' : 'line-clamp-2 break-words')}>{preview}</span>}
      {children}
      <span className="mt-1 flex items-center gap-2 font-mono text-[0.64rem] text-muted-foreground tabular-nums">
        {session.ticketKey && <TicketChip ticketKey={session.ticketKey} />}
        <span>{relativeTime(snippetAt ?? session.lastMessageAt, now)}</span>
        <span className="ml-auto">{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</span>
      </span>
    </button>
  );
};
