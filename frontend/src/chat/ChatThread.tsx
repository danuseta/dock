import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { Loader2, SendHorizontal } from 'lucide-react';
import { SEND_CHAT_MESSAGE } from '../graphql/mutations';
import { GET_CHAT_MESSAGES, GET_CHAT_SESSION } from '../graphql/queries';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import {
  isOptimistic, isTurnInProgress, machineOf, machineOnline, machinePlace, mergeMessages, newestAssistantId, oldestId, pollCursor, pollInterval, sendBlocker,
  type ChatMachine, type ChatMessage, type ChatSession,
} from './messages';
import { MachineChip } from './MachineControls';
import { SessionStatusLine } from './StatusLine';
import { ActivityGroup } from './activity/ActivityGroup';
import { isThreadGroup } from './activity/activity';
import { useTurnActivity } from './activity/useTurnActivity';
import { chatStore } from './store';

interface ChatThreadProps {
  sessionId: string;
  className?: string;
  /** Shown beside the read-only line of a terminal session, for example a "Continue" button. */
  readOnlyAction?: React.ReactNode;
}

const NEWEST_PAGE = 200;
const OLDER_PAGE = 100;
const MAX_TEXT = 8000;
const NEAR_BOTTOM_PX = 80;

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const timeOf = (at: string) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const ChatThread: React.FC<ChatThreadProps> = ({ sessionId, className, readOnlyAction }) => {
  const client = useApolloClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [draft, setDraft] = useState('');
  const messagesRef = useRef(messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const heightBeforeOlder = useRef<number | null>(null);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const { data, error: sessionError, refetch, startPolling, stopPolling } = useQuery<{ chatSession: ChatSession | null; chatBridge: { online: boolean; lastSeenAt?: string | null }; chatMachines?: ChatMachine[] | null }>(
    GET_CHAT_SESSION,
    { variables: { id: sessionId }, fetchPolicy: 'cache-and-network' },
  );
  const session = data?.chatSession;
  const status = session?.status;
  const activity = useTurnActivity(sessionId, status, messages, scrollRef);
  const busy = isTurnInProgress(status, messages);
  const pollMs = pollInterval(busy);
  const machine = machineOf(session);
  const machineUp = machineOnline(data?.chatMachines, machine, data?.chatBridge?.online);
  const machineSeenAt = data?.chatMachines?.find((item) => item.name === machine)?.lastSeenAt ?? data?.chatBridge?.lastSeenAt;
  const machineHasToken = data?.chatMachines && data.chatMachines.length > 0 ? data.chatMachines.some((item) => item.name === machine) : undefined;
  const blocker = sendBlocker({ source: session?.source, busy, bridgeOnline: machineUp, machine, machineHasToken, lastSeenAt: machineSeenAt });
  const place = machinePlace(machine);
  const readOnly = session?.source === 'cli';

  useEffect(() => {
    startPolling(pollMs);
    return stopPolling;
  }, [pollMs, startPolling, stopPolling]);

  const fetchMessages = useCallback(async (variables: { afterId?: number; beforeId?: number; limit?: number }) => {
    const result = await client.query<{ chatMessages: ChatMessage[] }>({ query: GET_CHAT_MESSAGES, variables: { sessionId, ...variables }, fetchPolicy: 'no-cache' });
    return result.data.chatMessages;
  }, [client, sessionId]);

  // One poll at a time. It also runs at once when the session's status changes, so the last lines of a turn do not wait for the slow poll.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const cursor = pollCursor(messagesRef.current, status);
        const batch = await fetchMessages(cursor === undefined ? { limit: NEWEST_PAGE } : { afterId: cursor });
        if (cancelled) return;
        if (cursor === undefined) setHasOlder(batch.length >= NEWEST_PAGE);
        setMessages((current) => mergeMessages(current, batch));
        setLoaded(true);
        setLoadError('');
      } catch (error) {
        if (!cancelled) setLoadError(messageOf(error, 'The messages could not be loaded'));
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchMessages, pollMs, status]);

  const loadOlder = async () => {
    const before = oldestId(messagesRef.current);
    if (before === undefined || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const batch = await fetchMessages({ beforeId: before, limit: OLDER_PAGE });
      heightBeforeOlder.current = scrollRef.current?.scrollHeight ?? null;
      setHasOlder(batch.length >= OLDER_PAGE);
      setMessages((current) => mergeMessages(current, batch));
      setLoadError('');
    } catch (error) {
      setLoadError(messageOf(error, 'Older messages could not be loaded'));
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    if (element.scrollTop < 40) void loadOlder();
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (heightBeforeOlder.current !== null) {
      // Older messages were added above: keep the line the reader was on where it was.
      element.scrollTop += element.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    } else if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, activity.byTurn]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    if (element.lastElementChild) observer.observe(element.lastElementChild);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const newest = newestAssistantId(messages);
    if (newest > 0) chatStore.markSeen(sessionId, newest);
  }, [messages, sessionId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || blocker) return;
    const pending: ChatMessage = { id: -Date.now(), sessionId, role: 'user', text, state: 'queued', at: new Date().toISOString() };
    setSendError('');
    setDraft('');
    stickRef.current = true;
    setMessages((current) => mergeMessages(current, [pending]));
    try {
      const result = await client.mutate<{ sendChatMessage: ChatMessage }>({ mutation: SEND_CHAT_MESSAGE, variables: { sessionId, text } });
      const confirmed = result.data?.sendChatMessage;
      if (!confirmed) throw new Error('DOCK did not confirm the message');
      setMessages((current) => mergeMessages(current.filter((message) => message.id !== pending.id), [confirmed]));
      void refetch();
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== pending.id));
      setDraft((current) => current || text);
      setSendError(messageOf(error, 'The message could not be sent'));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  const missing = data !== undefined && data.chatSession === null;
  const blockerId = `chat-blocker-${sessionId}`;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {session && <div className="flex flex-none items-center gap-2 border-b border-border bg-surface-0 px-3.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground"><span>Runs on</span><MachineChip name={machine} online={machineUp} /></div>}
      <SessionStatusLine sessionId={sessionId} className="flex-none bg-surface-0" />
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3" role="log" aria-label="Conversation">
        {loadingOlder && <p className="pb-2 text-center font-mono text-[0.66rem] text-muted-foreground" role="status">Loading older messages...</p>}
        {!loaded && !loadError && !missing && <p className="py-6 text-center text-sm text-muted-foreground" role="status">Loading the conversation...</p>}
        {missing && <p className="py-6 text-center text-pretty text-sm text-muted-foreground">This session no longer exists. Close this tab or pick another session.</p>}
        {loaded && !missing && messages.length === 0 && (
          <p className="py-6 text-center text-pretty text-sm text-muted-foreground">{readOnly ? 'This session has no messages.' : session?.forkFrom ? 'Continued from a terminal session. Claude Code keeps that conversation; what you send from here is added below.' : `Nothing here yet. Your first message starts a Claude Code session on ${place}.`}</p>
        )}
        <ol className="flex flex-col gap-2">
          {activity.items.map((message) => (isThreadGroup(message) ? (
            <ActivityGroup key={message.key} group={message} live={message.last && message.turnId === activity.liveTurnId} turnRunning={message.turnId === activity.liveTurnId} store={activity.store} stickRef={stickRef} />
          ) : message.role === 'tool' ? (
            <li key={message.id} className="flex min-w-0 items-baseline gap-1.5 font-mono text-[0.68rem] text-muted-foreground" title={timeOf(message.at)}>
              <span aria-hidden="true">›</span><span className="min-w-0 break-words">{message.text}</span>
            </li>
          ) : (
            <li key={message.id} className={cn('flex min-w-0 max-w-[86%] flex-col', message.role === 'user' ? 'items-end self-end' : 'items-start self-start')}>
              <p
                className={cn(
                  'max-w-full whitespace-pre-wrap break-words rounded-[10px] border px-3 py-2 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]',
                  message.role === 'user' ? 'rounded-br-xs border-accent/30 bg-accent-dim' : 'rounded-bl-xs border-border bg-surface-1',
                  isOptimistic(message) && 'opacity-60',
                )}
                title={timeOf(message.at)}
              >
                <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Claude: '}</span>{message.text}
              </p>
              {isOptimistic(message) && <span className="mt-0.5 font-mono text-[0.62rem] text-muted-foreground">Sending...</span>}
              {message.state === 'failed' && <span className="mt-0.5 font-mono text-[0.62rem] text-status-conflict">Not answered</span>}
            </li>
          )))}
        </ol>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border bg-surface-0 px-3.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {status === 'queued' && <p className="flex items-center gap-1.5 font-mono text-[0.68rem] text-secondary-foreground" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Queued · waiting for the {machine} bridge to pick it up</p>}
        {status === 'running' && <p className="flex items-center gap-1.5 font-mono text-[0.68rem] text-status-merged" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" /><span className="min-w-0 break-words">Running{session?.statusDetail ? ` · ${session.statusDetail}` : ''}</span></p>}
        {status === 'error' && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">The last turn failed{session?.statusDetail ? `: ${session.statusDetail}` : '.'}</p>}
        {sendError && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">Not sent: {sendError}</p>}
        {loadError && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">{loadError}</p>}
        {sessionError && !data && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">The session could not be loaded: {sessionError.message}</p>}
        {blocker && !readOnly && machineUp === false && (
          <p id={blockerId} className="rounded-xs border border-amber-300/50 bg-amber-300/10 px-2.5 py-1.5 text-pretty text-xs text-amber-200" role="status">{blocker}</p>
        )}
        {readOnly && (
          <div id={blockerId} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="text-pretty">{blocker}</span>
            {readOnlyAction}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-40 min-h-[40px] min-w-0 max-[900px]:min-h-11 flex-1 resize-none rounded-sm border border-border bg-surface-1 px-3 py-2 font-body text-[0.82rem] text-foreground placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            rows={2}
            maxLength={MAX_TEXT}
            value={draft}
            disabled={readOnly || missing}
            placeholder={readOnly ? 'Continue as a DOCK session to type...' : `Message Claude Code on ${place}...`}
            aria-label="Message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button size="sm" variant="primary" className="h-10 max-[900px]:h-11 max-[900px]:min-w-11" disabled={Boolean(blocker) || missing || !draft.trim()} aria-label="Send message" aria-describedby={blocker ? blockerId : undefined} onClick={() => void send()}>
            <SendHorizontal size={14} aria-hidden="true" />Send
          </Button>
        </div>
      </div>
    </div>
  );
};
