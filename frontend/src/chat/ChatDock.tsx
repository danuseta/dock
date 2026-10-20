import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, MessagesSquare, Minus, PanelBottom, PictureInPicture2, Plus } from 'lucide-react';
import { CREATE_CHAT_SESSION } from '../graphql/mutations';
import { GET_CHAT_MESSAGES, GET_CHAT_SESSION, GET_CHAT_SESSIONS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { EmptyState } from '../components/EmptyState';
import { FloatingScene } from '../components/empty/scenes/FloatingScene';
import { ChatThread } from './ChatThread';
import { useFullViewport } from './useFullViewport';
import { SLOW_POLL_MS, machineOf, newestAssistantId, sessionTitle, type ChatMessage, type ChatSession } from './messages';
import { useNow } from './activity/useNow';
import { SessionRow } from './SessionRow';
import { LimitsLine } from './StatusLine';
import { chatStore, useChatState } from './store';

interface ChatDockProps {
  /** Space the navigation takes on screens of 761 px and wider, in pixels. */
  inset: { left: number; right: number; bottom: number };
}

const control = 'grid size-7 flex-none place-items-center max-[699px]:size-11 rounded-xs border border-transparent bg-transparent text-secondary-foreground transition-colors duration-150 hover:border-border hover:bg-surface-1 hover:text-foreground';

/** Watches one open tab that is not on screen for an assistant message newer than the last one read. */
const UnreadProbe: React.FC<{ sessionId: string; lastSeen: number; onChange: (sessionId: string, unread: boolean) => void }> = ({ sessionId, lastSeen, onChange }) => {
  const { data } = useQuery<{ chatMessages: ChatMessage[] }>(GET_CHAT_MESSAGES, {
    variables: { sessionId, limit: 30 },
    fetchPolicy: 'network-only',
    pollInterval: SLOW_POLL_MS,
  });
  const unread = newestAssistantId(data?.chatMessages || []) > lastSeen;
  useEffect(() => {
    onChange(sessionId, unread);
    return () => onChange(sessionId, false);
  }, [sessionId, unread, onChange]);
  return null;
};

export const ChatDock: React.FC<ChatDockProps> = ({ inset }) => {
  const state = useChatState();
  const { data: activeData } = useQuery<{ chatSession: ChatSession | null }>(GET_CHAT_SESSION, { variables: { id: state.active }, skip: !state.active, fetchPolicy: 'cache-first' });
  const [createSession, { loading: creating }] = useMutation<{ createChatSession: ChatSession }>(CREATE_CHAT_SESSION);
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [showList, setShowList] = useState(true);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const refocusLauncher = useRef(false);
  const open = state.mode !== 'closed';
  const drawer = state.mode === 'drawer';
  useFullViewport(open, '(max-width: 699px)');
  const anyUnread = state.tabs.some((id) => unread[id]);
  const listing = showList || !state.active;
  const now = useNow(open && listing);
  const { data: listData } = useQuery<{ chatSessions: ChatSession[] }>(GET_CHAT_SESSIONS, { variables: { limit: 300 }, skip: !open || !listing, pollInterval: SLOW_POLL_MS });
  const sessions = listData?.chatSessions ?? [];

  const reportUnread = useCallback((sessionId: string, value: boolean) => {
    setUnread((current) => (Boolean(current[sessionId]) === value ? current : { ...current, [sessionId]: value }));
  }, []);

  const previousActive = useRef(state.active);
  useEffect(() => {
    if (state.active && state.active !== previousActive.current) setShowList(false);
    previousActive.current = state.active;
  }, [state.active]);

  useEffect(() => {
    if (open || !refocusLauncher.current) return;
    refocusLauncher.current = false;
    launcherRef.current?.focus();
  }, [open]);

  const minimise = () => {
    refocusLauncher.current = true;
    chatStore.setMode('closed');
  };

  const newSession = async () => {
    setError('');
    try {
      const result = await createSession();
      const created = result.data?.createChatSession;
      if (!created) throw new Error('DOCK did not return a session');
      chatStore.openSession(created.id);
    } catch (createError) {
      setError(createError instanceof Error && createError.message ? createError.message : 'A new session could not be started');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    minimise();
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const bottom = panel.getBoundingClientRect().bottom;
    const move = (moveEvent: PointerEvent) => chatStore.setDrawerHeight(bottom - moveEvent.clientY);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const handleResizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    chatStore.setDrawerHeight(state.drawerHeight + (event.key === 'ArrowUp' ? 24 : -24));
  };

  const vars = {
    '--chat-left': `${inset.left}px`,
    '--chat-right': `${inset.right}px`,
    '--chat-bottom': `${inset.bottom}px`,
    '--chat-height': `${state.drawerHeight}px`,
  } as React.CSSProperties;

  return (
    <div style={vars}>
      {state.tabs.map((id) => (open && id === state.active ? null : <UnreadProbe key={id} sessionId={id} lastSeen={state.lastSeen[id] ?? 0} onChange={reportUnread} />))}

      {open && (
        <section
          ref={panelRef}
          className={cn(
            'fixed z-30 flex flex-col overflow-hidden border border-border-glow bg-surface-0 shadow-card',
            // Narrow screens: both shapes are one sheet across the bottom, over the navigation bar.
            'max-[699px]:inset-x-0 max-[699px]:top-[var(--vv-top,0px)] max-[699px]:z-[45] max-[699px]:h-[var(--vv-h,100dvh)] max-[699px]:rounded-none max-[699px]:border-0',
            drawer
              ? 'min-[700px]:inset-x-0 min-[700px]:bottom-[82px] min-[700px]:h-[min(var(--chat-height),80dvh)] min-[700px]:rounded-t-md min-[700px]:border-b-0 min-[761px]:right-[var(--chat-right)] min-[761px]:bottom-[var(--chat-bottom)] min-[761px]:left-[var(--chat-left)]'
              : 'min-[700px]:right-5 min-[700px]:bottom-[150px] min-[700px]:h-[min(520px,calc(100dvh-170px))] min-[700px]:w-[420px] min-[700px]:rounded-md min-[761px]:right-[calc(var(--chat-right)+20px)] min-[761px]:bottom-[calc(var(--chat-bottom)+84px)] min-[761px]:h-[min(520px,calc(100dvh-104px-var(--chat-bottom)))]',
          )}
          aria-label="Chat with Claude Code"
          onKeyDown={handleKeyDown}
        >
          {drawer && (
            <div
              className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize touch-none hover:bg-accent/40 focus-visible:bg-accent/40 max-[699px]:hidden"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the chat drawer"
              aria-valuenow={state.drawerHeight}
              tabIndex={0}
              onPointerDown={handleResizeStart}
              onKeyDown={handleResizeKey}
            />
          )}
          <header className="flex flex-none items-center gap-1 border-b border-border bg-surface-0 px-2 py-1.5 max-[699px]:pt-[max(0.375rem,env(safe-area-inset-top))]">
            {!listing && <button type="button" className={control} aria-label="Back to sessions" title="Back to sessions" onClick={() => setShowList(true)}><ArrowLeft size={14} aria-hidden="true" /></button>}
            <span className="min-w-0 flex-1 truncate px-1.5 font-display text-xs font-bold">{listing || !activeData?.chatSession ? 'Sessions' : sessionTitle(activeData.chatSession)}</span>
            <button type="button" className={control} aria-label="New session" title="New session" disabled={creating} onClick={() => void newSession()}><Plus size={14} aria-hidden="true" /></button>
            <button type="button" className={cn(control, 'max-[699px]:hidden')} aria-label={drawer ? 'Pop out' : 'Dock to bottom'} title={drawer ? 'Pop out' : 'Dock to bottom'} onClick={() => chatStore.setMode(drawer ? 'float' : 'drawer')}>
              {drawer ? <PictureInPicture2 size={14} aria-hidden="true" /> : <PanelBottom size={14} aria-hidden="true" />}
            </button>
            <button type="button" className={control} aria-label="Minimise chat" title="Minimise" onClick={minimise}><Minus size={14} aria-hidden="true" /></button>
          </header>
          <LimitsLine machine={activeData?.chatSession ? machineOf(activeData.chatSession) : undefined} className="flex-none border-b border-border bg-surface-0 px-3.5 py-1.5" />
          {error && <p className="flex-none border-b border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">A new session could not be started: {error}</p>}
          {!listing && state.active
            ? <ChatThread key={state.active} sessionId={state.active} className="min-h-0 flex-1" />
            : sessions.length > 0
              ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-2" role="list" aria-label="Sessions">
                  {sessions.map((session) => (
                    <div key={session.id} role="listitem">
                      <SessionRow
                        session={session}
                        selected={session.id === state.active}
                        now={now}
                        onSelect={() => { chatStore.openSession(session.id); setShowList(false); }}
                      />
                    </div>
                  ))}
                </div>
              )
              : (
                <div className="grid min-h-0 flex-1 place-items-center p-6">
                  <EmptyState
                    size="panel"
                    scene={<FloatingScene />}
                    title="No session open"
                    description="Start a new one here, or pick one on the Sessions page."
                    action={<button type="button" className="dock-empty-pulse inline-flex h-8 max-[699px]:h-11 items-center gap-1.5 rounded-sm border border-accent bg-accent px-3 font-display text-xs font-semibold text-black hover:bg-accent-hover disabled:opacity-50" disabled={creating} onClick={() => void newSession()}><Plus size={14} aria-hidden="true" />New session</button>}
                  />
                </div>
              )}
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={cn(
          'fixed right-4 bottom-[86px] z-30 grid size-12 place-items-center rounded-full border border-accent bg-accent text-black shadow-card transition-colors duration-150 hover:bg-accent-hover',
          'min-[761px]:right-[calc(var(--chat-right)+20px)] min-[761px]:bottom-[calc(var(--chat-bottom)+20px)]',
          drawer && 'hidden',
          open && 'max-[699px]:hidden',
        )}
        aria-label={open ? 'Minimise chat' : anyUnread ? 'Open chat, new reply' : 'Open chat'}
        aria-expanded={open}
        onClick={() => chatStore.setMode(open ? 'closed' : state.openMode)}
      >
        {open ? <Minus size={20} aria-hidden="true" /> : <MessagesSquare size={20} aria-hidden="true" />}
        {!open && anyUnread && <i className="absolute top-0 right-0 size-3 rounded-full border-2 border-background bg-status-conflict" aria-hidden="true" />}
      </button>
    </div>
  );
};
