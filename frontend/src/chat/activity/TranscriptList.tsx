import React from 'react';
import { cn } from '../../lib/cn';
import { CopyButton } from '../CopyButton';
import { Markdown } from '../Markdown';
import { MessageAttachments } from '../interactions/MessageAttachments';
import { isOptimistic, type ChatMessage } from '../messages';
import type { DetailStore } from './detailStore';
import { AgentCall } from './AgentThread';
import { FoldedList, MessageShell, MessageTime, TranscriptRow } from './TranscriptParts';
import type { LeadPart, TranscriptItem } from './transcript';
import { useNow } from './useNow';

const timeOf = (at: string) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const stateLine = (message: ChatMessage) => {
  if (isOptimistic(message)) return 'Sending...';
  if (message.stopped && message.state !== 'queued' && message.state !== 'taken') return 'Stopped';
  if (message.state === 'held') return 'Waiting · sent when Claude finishes this turn';
  if (message.state === 'steer') return 'Steering · added to this turn';
  return null;
};

/** Your message: a bubble on the right, its time under it. */
const UserBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const state = stateLine(message);
  return (
    <li className="flex min-w-0 max-w-[86%] flex-col items-end gap-0.5 self-end">
      {(message.text || !message.attachments?.length) && (
        <p className={cn('max-w-full whitespace-pre-wrap break-words rounded-[12px] rounded-br-xs border border-accent/30 bg-accent-dim px-3 py-2 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]', isOptimistic(message) && 'opacity-60')} title={timeOf(message.at)}>
          <span className="sr-only">You: </span>{message.text}
        </p>
      )}
      {message.attachments && <MessageAttachments attachments={message.attachments} />}
      <span className="flex gap-1.5 pr-0.5 font-mono text-[0.62rem] text-muted-foreground">
        {state && <span>{state} ·</span>}
        {message.state === 'failed' && <span className="text-status-conflict">Not answered ·</span>}
        <MessageTime at={message.at} />
      </span>
    </li>
  );
};

const LeadText: React.FC<{ message: ChatMessage }> = ({ message }) => {
  if (message.role === 'tool') {
    return <li className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground" title={timeOf(message.at)}><span aria-hidden="true">›</span><span className="min-w-0 break-words">{message.text}</span></li>;
  }
  return (
    <li className="group/text min-w-0 font-body text-[0.84rem] leading-relaxed text-foreground">
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        <span className="sr-only">Claude: </span>
        {message.text && <Markdown text={message.text} />}
        {message.attachments && <MessageAttachments attachments={message.attachments} />}
        {message.text && <CopyButton text={message.text} />}
      </div>
    </li>
  );
};

interface ListProps {
  items: TranscriptItem[];
  store: DetailStore;
  /** The thread open beside the conversation, if any. */
  threadId?: string | null;
  onOpenThread?: (eventId: string) => void;
}

/** The lead's conversation: your messages, the lead's messages with their steps, and one message per agent the lead called. */
export const TranscriptList: React.FC<ListProps> = ({ items, store, threadId, onOpenThread }) => {
  const running = items.some((item) => (item.kind === 'call' && (item.event.status === 'running' || item.rows.some((row) => row.status === 'running')))
    || (item.kind === 'lead' && item.parts.some((part) => part.kind === 'event' && part.event.status === 'running')));
  const now = useNow(running);
  const renderPart = (part: LeadPart) => (part.kind === 'text'
    ? <LeadText key={`m${part.message.id}`} message={part.message} />
    : <TranscriptRow key={part.event.eventId} event={part.event} store={store} now={now} />);
  return (
    <ol className="flex min-w-0 flex-col gap-3.5">
      {items.map((item) => {
        if (item.kind === 'user') return <UserBubble key={item.key} message={item.message} />;
        if (item.kind === 'call') {
          const open = Boolean(threadId) && (threadId === item.event.eventId || item.rows.some((row) => row.eventId === threadId));
          return <AgentCall key={item.key} event={item.event} rows={item.rows} store={store} now={now} open={open} onOpen={onOpenThread} />;
        }
        return (
          <MessageShell key={item.key} name="lead" at={item.at}>
            <FoldedList parts={item.parts} isStep={(part) => part.kind === 'event'} render={renderPart} />
          </MessageShell>
        );
      })}
    </ol>
  );
};
