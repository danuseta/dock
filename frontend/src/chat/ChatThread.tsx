import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { Clock, Loader2, RefreshCw, SendHorizontal } from 'lucide-react';
import { SEND_CHAT_MESSAGE, STOP_CHAT_TURN } from '../graphql/mutations';
import { GET_CHAT_MESSAGES, GET_CHAT_SESSION } from '../graphql/queries';
import { Button } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { TerminalScene } from '../components/empty/scenes/TerminalScene';
import { cn } from '../lib/cn';
import {
  isOptimistic, isStopping, isTurnInProgress, machineCapabilities, machineOf, machineOnline, machinePlace, mergeMessages, newestAssistantId, oldestId, optimisticMessage, pollCursor, pollInterval, sendBlocker, sessionTurnOptions,
  type ChatMachine, type ChatMessage, type ChatSession,
} from './messages';
import { MachineChip } from './MachineControls';
import { SessionHeader } from './SessionHeader';
import { CopyButton } from './CopyButton';
import { Markdown } from './Markdown';
import { recallMessages, rememberMessages } from './messageCache';
import { ActivityGroup } from './activity/ActivityGroup';
import { isThreadGroup, type ChatActivity } from './activity/activity';
import { useTurnActivity } from './activity/useTurnActivity';
import { WorkerTray } from './activity/WorkerTray';
import { Composer } from './composer/Composer';
import { composerFeatures } from './composer/composerLogic';
import { useTurnOptions, type TurnOptionsControl } from './composer/useTurnOptions';
import { delayedMinutes, delayedText, dotState, workerGroups, type DotState } from './headerState';
import { useChatStatus } from './useChatStatus';
import type { ChatSessionStatus } from './status';
import type { SendPayload } from './composer/composerLogic';
import { InteractionCards } from './interactions/InteractionCards';
import { MessageAttachments } from './interactions/MessageAttachments';
import { useInteractionLog } from './interactions/useInteractionLog';
import { chatStore } from './store';

interface ChatThreadProps {
  sessionId: string;
  className?: string;
  /** Shown beside the read-only line of a terminal session, for example a "Continue" button. */
  readOnlyAction?: React.ReactNode;
  /** The Sessions page names the machine in its own header, so it leaves this thread's "Runs on" line out. */
  hideMachine?: boolean;
  /** Receives every activity row of the session whenever they change, for summaries outside the thread. */
  onActivity?: (events: ChatActivity[]) => void;
  renderHeader?: (context: HeaderContext) => React.ReactNode;
  workerId?: string | null;
  /** Lets a click on the worker tray filter the thread to that worker. */
  onSelectWorker?: (workerId: string | null) => void;
}

export interface HeaderContext { control: TurnOptionsControl; dot: DotState; delayed: boolean; status: ChatSessionStatus | undefined }

const NEWEST_PAGE = 200;
const OLDER_PAGE = 100;
const NEAR_BOTTOM_PX = 80;
const PROMPT_EXAMPLES = [
  { label: 'Build QRD-…', text: 'Pakai skill sous: kerjakan QRD-' },
  { label: 'Review PR …', text: 'Pakai skill sous: review ' },
  { label: 'Card …', text: 'Pakai skill sous: ' },
  { label: 'Explain this repo', text: 'Explain this repo' },
];

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const timeOf = (at: string) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const ChatThread: React.FC<ChatThreadProps> = ({ sessionId, className, readOnlyAction, hideMachine, onActivity, renderHeader, workerId, onSelectWorker }) => {
  const client = useApolloClient();
  const [recalled] = useState(() => recallMessages(sessionId));
  const [messages, setMessages] = useState<ChatMessage[]>(() => recalled?.messages ?? []);
  const [loaded, setLoaded] = useState(Boolean(recalled));
  const [hasOlder, setHasOlder] = useState(recalled?.hasOlder ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const [seed, setSeed] = useState<{ text: string } | null>(null);
  const messagesRef = useRef(messages);
  const statusRef = useRef<string | undefined>(undefined);
  const sessionRef = useRef(sessionId);
  const inFlightRef = useRef(false);
  const pollNowRef = useRef<() => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const heightBeforeOlder = useRef<number | null>(null);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    rememberMessages(sessionId, messages, hasOlder);
  }, [sessionId, messages, hasOlder]);

  const { data, error: sessionError, refetch, startPolling, stopPolling } = useQuery<{ chatSession: ChatSession | null; chatBridge: { online: boolean; lastSeenAt?: string | null }; chatMachines?: ChatMachine[] | null }>(
    GET_CHAT_SESSION,
    { variables: { id: sessionId }, fetchPolicy: 'cache-and-network' },
  );
  const session = data?.chatSession;
  const status = session?.status;
  useLayoutEffect(() => {
    statusRef.current = status;
  }, [status]);
  const activity = useTurnActivity(sessionId, status, messages, scrollRef);
  const onActivityRef = useRef(onActivity);
  useLayoutEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);
  const allEvents = useMemo(() => [...activity.byTurn.values()].flat(), [activity.byTurn]);
  useEffect(() => {
    onActivityRef.current?.(allEvents);
  }, [allEvents]);
  const busy = isTurnInProgress(status, messages);
  const pollMs = pollInterval(busy);
  const machine = machineOf(session);
  const machineUp = machineOnline(data?.chatMachines, machine, data?.chatBridge?.online);
  const machineSeenAt = data?.chatMachines?.find((item) => item.name === machine)?.lastSeenAt ?? data?.chatBridge?.lastSeenAt;
  const machineHasToken = data?.chatMachines && data.chatMachines.length > 0 ? data.chatMachines.some((item) => item.name === machine) : undefined;
  const blocker = sendBlocker({ source: session?.source, busy: false, bridgeOnline: machineUp, machine, machineHasToken, lastSeenAt: machineSeenAt });
  const place = machinePlace(machine);
  const capabilities = machineCapabilities(data?.chatMachines, machine);
  const interactions = useInteractionLog(session?.pending, session?.settled);
  const stopping = isStopping(stopRequested, status);
  const readOnly = session?.source === 'cli';
  const control = useTurnOptions(sessionId, machine, composerFeatures(capabilities), sessionTurnOptions(session));
  const { status: liveStatus, now: statusNow, refetch: recheckStatus } = useChatStatus(machine);
  const ownStatus = liveStatus?.sessions.find((item) => item.sessionId === sessionId);
  const delayed = Boolean(ownStatus?.stale) && busy;
  const dot = dotState({ bridgeUp: machineUp, waiting: interactions.cards.length > 0 || Boolean(session?.waiting), busy, delayed });
  const shownItems = workerId ? workerGroups(activity.byTurn, workerId) : activity.items;

  useEffect(() => {
    if (status !== 'queued' && status !== 'running') setStopRequested(false);
  }, [status]);

  useEffect(() => {
    startPolling(pollMs);
    return stopPolling;
  }, [pollMs, startPolling, stopPolling]);

  const fetchMessages = useCallback(async (variables: { afterId?: number; beforeId?: number; limit?: number }) => {
    const result = await client.query<{ chatMessages: ChatMessage[] }>({ query: GET_CHAT_MESSAGES, variables: { sessionId, ...variables }, fetchPolicy: 'no-cache' });
    return result.data.chatMessages;
  }, [client, sessionId]);

  useEffect(() => {
    sessionRef.current = sessionId;
    return () => {
      sessionRef.current = '';
    };
  }, [sessionId]);

  // One poll at a time. A batch that arrives is kept as long as the thread still shows the same session, even when the poll restarts meanwhile.
  useEffect(() => {
    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const requested = sessionId;
      try {
        const cursor = pollCursor(messagesRef.current, statusRef.current);
        const batch = await fetchMessages(cursor === undefined ? { limit: NEWEST_PAGE } : { afterId: cursor });
        if (sessionRef.current !== requested) return;
        if (cursor === undefined) setHasOlder(batch.length >= NEWEST_PAGE);
        setMessages((current) => mergeMessages(current, batch));
        setLoaded(true);
        setLoadError('');
      } catch (error) {
        if (sessionRef.current === requested) setLoadError(messageOf(error, 'The messages could not be loaded'));
      } finally {
        inFlightRef.current = false;
      }
    };
    pollNowRef.current = () => void poll();
    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);
    return () => window.clearInterval(timer);
  }, [fetchMessages, pollMs, sessionId]);

  // The session's status changed: poll at once, so the last lines of a turn do not wait for the slow poll.
  useEffect(() => {
    pollNowRef.current();
  }, [status]);

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

  const send = async (payload: SendPayload) => {
    const pending: ChatMessage = optimisticMessage(sessionId, payload, -Date.now(), new Date().toISOString());
    setSendError('');
    stickRef.current = true;
    setMessages((current) => mergeMessages(current, [pending]));
    try {
      const variables: Record<string, unknown> = { sessionId, text: payload.text };
      if (payload.attachmentIds.length > 0) variables.attachmentIds = payload.attachmentIds;
      if (payload.options) variables.options = payload.options;
      if (payload.mode) variables.mode = payload.mode;
      const result = await client.mutate<{ sendChatMessage: ChatMessage }>({ mutation: SEND_CHAT_MESSAGE, variables });
      const confirmed = result.data?.sendChatMessage;
      if (!confirmed) throw new Error('DOCK did not confirm the message');
      setMessages((current) => mergeMessages(current.filter((message) => message.id !== pending.id), [confirmed]));
      void refetch();
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== pending.id));
      setSendError(messageOf(error, 'The message could not be sent'));
      throw error;
    }
  };

  const stop = async () => {
    setStopRequested(true);
    setSendError('');
    try {
      await client.mutate({ mutation: STOP_CHAT_TURN, variables: { sessionId } });
      void refetch();
    } catch (error) {
      setStopRequested(false);
      setSendError(messageOf(error, 'The turn could not be stopped'));
    }
  };

  const missing = data !== undefined && data.chatSession === null;
  const blockerId = `chat-blocker-${sessionId}`;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {session && !hideMachine && <div className="flex flex-none items-center gap-2 border-b border-border bg-surface-0 px-3.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground"><span>Runs on</span><MachineChip name={machine} online={machineUp} /></div>}
      {session && <SessionHeader session={session} showTitle={!hideMachine} />}
      {session && renderHeader?.({ control, dot, delayed, status: ownStatus })}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-[6.5rem] flex-1 overflow-y-auto overscroll-contain px-3.5 py-3" role="log" aria-label="Conversation">
        {loadingOlder && <p className="pb-2 text-center font-mono text-[0.66rem] text-muted-foreground" role="status">Loading older messages...</p>}
        {!loaded && !loadError && !missing && <p className="py-6 text-center text-sm text-muted-foreground" role="status">Loading the conversation...</p>}
        {missing && <p className="py-6 text-center text-pretty text-sm text-muted-foreground">This session no longer exists. Close this tab or pick another session.</p>}
        {loaded && !missing && messages.length === 0 && (readOnly || session?.forkFrom ? (
          <p className="py-6 text-center text-pretty text-sm text-muted-foreground">{readOnly ? 'This session has no messages.' : 'Continued from a terminal session. Claude Code keeps that conversation; what you send from here is added below.'}</p>
        ) : (
          <EmptyState
            size="panel"
            scene={<TerminalScene />}
            title="Start the conversation"
            description={`Nothing here yet. Your first message starts a Claude Code session on ${place}.`}
            action={PROMPT_EXAMPLES.map((example) => (
              <button key={example.label} type="button" className="h-8 rounded-pill border border-border bg-surface-1 px-3 font-mono text-xs text-secondary-foreground hover:border-accent hover:text-accent max-[900px]:h-11" onClick={() => setSeed({ text: example.text })}>{example.label}</button>
            ))}
          />
        ))}
        <ol className="flex min-w-0 flex-col gap-2">
          {shownItems.map((message) => (isThreadGroup(message) ? (
            <ActivityGroup key={message.key} group={message} live={message.last && message.turnId === activity.liveTurnId} turnRunning={message.turnId === activity.liveTurnId} store={activity.store} stickRef={stickRef} />
          ) : message.role === 'tool' ? (
            <li key={message.id} className="flex min-w-0 items-baseline gap-1.5 font-mono text-[0.68rem] text-muted-foreground" title={timeOf(message.at)}>
              <span aria-hidden="true">›</span><span className="min-w-0 break-words">{message.text}</span>
            </li>
          ) : (
            <li key={message.id} className={cn('flex min-w-0 max-w-[86%] flex-col', message.role === 'user' ? 'items-end self-end' : 'items-start self-start')}>
              {(message.text || !message.attachments?.length) && (message.role === 'user' ? (
                <p
                  className={cn(
                    'max-w-full whitespace-pre-wrap break-words rounded-[10px] border px-3 py-2 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]',
                    'rounded-br-xs border-accent/30 bg-accent-dim',
                    isOptimistic(message) && 'opacity-60',
                  )}
                  title={timeOf(message.at)}
                >
                  <span className="sr-only">You: </span>{message.text}
                </p>
              ) : (
                <div
                  className="min-w-0 max-w-full break-words rounded-[10px] rounded-bl-xs border border-border bg-surface-1 px-3 py-2 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]"
                  title={timeOf(message.at)}
                >
                  <span className="sr-only">Claude: </span><Markdown text={message.text} />
                </div>
              ))}
              {message.role !== 'user' && message.text && <CopyButton text={message.text} />}
              {message.attachments && <MessageAttachments attachments={message.attachments} />}
              {isOptimistic(message) && <span className="mt-0.5 font-mono text-[0.62rem] text-muted-foreground">Sending...</span>}
              {message.stopped && message.state !== 'queued' && message.state !== 'taken' ? (
                <span className="mt-0.5 font-mono text-[0.62rem] text-muted-foreground">Stopped</span>
              ) : message.state === 'failed' ? <span className="mt-0.5 font-mono text-[0.62rem] text-status-conflict">Not answered</span>
                : message.state === 'held' ? <span className="mt-0.5 font-mono text-[0.62rem] text-muted-foreground">Waiting · sent when Claude finishes this turn</span>
                : message.state === 'steer' && <span className="mt-0.5 font-mono text-[0.62rem] text-muted-foreground">Steering · added to this turn</span>}
            </li>
          )))}
        </ol>
      </div>

      {!missing && <WorkerTray events={allEvents} activeId={workerId} onSelect={onSelectWorker} />}

      {!missing && <InteractionCards sessionId={sessionId} cards={interactions.cards} lines={interactions.lines} messages={messages} onSettled={interactions.record} />}

      <div className="flex flex-col gap-1.5 border-t border-border bg-surface-0 px-3.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {delayed && ownStatus && (
          <div className="flex items-center gap-2 rounded-xs border border-amber-300/50 bg-amber-300/10 px-2.5 py-1.5 text-xs text-amber-200" role="status">
            <Clock size={13} aria-hidden="true" className="flex-none" />
            <span className="min-w-0 flex-1 text-pretty">{delayedText(delayedMinutes(ownStatus.receivedAt, statusNow))}</span>
            <button type="button" className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-xs border border-amber-300/50 px-2 py-0.5 font-body text-[0.72rem] font-semibold hover:bg-amber-300/10 max-[900px]:min-h-11" onClick={recheckStatus}><RefreshCw size={12} aria-hidden="true" />Check again</button>
          </div>
        )}
        {status === 'queued' && !renderHeader && <p className="flex items-center gap-1.5 font-mono text-[0.68rem] text-secondary-foreground" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Queued · waiting for the {machine} bridge to pick it up</p>}
        {status === 'running' && !renderHeader && <p className="flex items-center gap-1.5 font-mono text-[0.68rem] text-status-merged" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" /><span className="min-w-0 break-words">Running{interactions.cards.length > 0 ? ' · waiting for your answer' : session?.statusDetail ? ` · ${session.statusDetail}` : ''}</span></p>}
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
        {readOnly || missing ? (
          <div className="flex items-end gap-2">
            <textarea
              className="max-h-40 min-h-[40px] min-w-0 max-[900px]:min-h-11 flex-1 resize-none rounded-sm border border-border bg-surface-1 px-3 py-2 font-body text-[0.82rem] text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              rows={2}
              value=""
              readOnly
              disabled
              placeholder={readOnly ? 'Continue as a DOCK session to type...' : `Message Claude Code on ${place}...`}
              aria-label="Message"
            />
            <Button size="sm" variant="primary" className="h-10 max-[900px]:h-11 max-[900px]:min-w-11" disabled aria-label="Send message">
              <SendHorizontal size={14} aria-hidden="true" />Send
            </Button>
          </div>
        ) : (
          <Composer
            sessionId={sessionId}
            machine={machine}
            capabilities={capabilities}
            blocker={blocker}
            busy={busy}
            stopping={stopping}
            control={control}
            onSend={send}
            onStop={() => void stop()}
            seed={seed}
          />
        )}
      </div>
    </div>
  );
};
