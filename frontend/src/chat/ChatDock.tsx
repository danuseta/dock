import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { MessagesSquare, Minus, PanelBottom, PictureInPicture2, Plus, X } from 'lucide-react';
import { CREATE_CHAT_SESSION } from '../graphql/mutations';
import { GET_CHAT_MESSAGES, GET_CHAT_SESSION } from '../graphql/queries';
import { cn } from '../lib/cn';
import { ChatThread } from './ChatThread';
import { MachinePicker, useMachineChoice } from './MachineControls';
import { SLOW_POLL_MS, machineOf, newestAssistantId, severalMachines, tabLabel, type ChatMessage, type ChatSession } from './messages';
import { LimitsLine } from './StatusLine';
import { chatStore, useChatState } from './store';

interface ChatDockProps {
  /** Space the navigation takes on screens of 761 px and wider, in pixels. */
  inset: { left: number; right: number; bottom: number };
}

const control = 'grid size-7 flex-none place-items-center rounded-xs border border-transparent bg-transparent text-secondary-foreground transition-colors duration-150 hover:border-border hover:bg-surface-1 hover:text-foreground';

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

const ChatTab: React.FC<{ sessionId: string; active: boolean; unread: boolean; multipleMachines: boolean; onMachine: (sessionId: string, machine: string) => void }> = ({ sessionId, active, unread, multipleMachines, onMachine }) => {
  const { data } = useQuery<{ chatSession: ChatSession | null }>(GET_CHAT_SESSION, { variables: { id: sessionId }, fetchPolicy: 'cache-first' });
  const session = data?.chatSession;
  const label = tabLabel(session, multipleMachines);
  const tabRef = useRef<HTMLDivElement>(null);
  const machine = session ? machineOf(session) : null;
  useEffect(() => {
    if (machine) onMachine(sessionId, machine);
  }, [sessionId, machine, onMachine]);
  useEffect(() => {
    if (active) tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [active]);
  const working = session?.status === 'queued' || session?.status === 'running';
  return (
    <div ref={tabRef} className={cn('flex h-7 max-w-[180px] flex-none items-center rounded-xs border border-transparent text-secondary-foreground', active ? 'border-border-glow bg-surface-2 text-foreground' : 'hover:bg-surface-1')}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="flex h-full min-w-0 items-center gap-1.5 border-0 bg-transparent pr-1 pl-2 font-display text-xs font-semibold"
        title={label}
        onClick={() => chatStore.setActive(sessionId)}
      >
        {(unread || working) && <i className={cn('size-1.5 flex-none rounded-full', unread ? 'bg-status-conflict' : 'animate-pulse bg-status-merged')} aria-hidden="true" />}
        <span className="truncate">{label}</span>
        {unread && <span className="sr-only"> (new reply)</span>}
      </button>
      <button type="button" className="grid size-6 flex-none place-items-center rounded-xs border-0 bg-transparent text-muted-foreground hover:text-foreground" aria-label={`Close ${label}`} onClick={() => chatStore.closeTab(sessionId)}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
};

export const ChatDock: React.FC<ChatDockProps> = ({ inset }) => {
  const state = useChatState();
  const { machines, machine, choose } = useMachineChoice();
  const { data: activeData } = useQuery<{ chatSession: ChatSession | null }>(GET_CHAT_SESSION, { variables: { id: state.active }, skip: !state.active, fetchPolicy: 'cache-first' });
  const [createSession, { loading: creating }] = useMutation<{ createChatSession: ChatSession }>(CREATE_CHAT_SESSION);
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [tabMachines, setTabMachines] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const refocusLauncher = useRef(false);
  const open = state.mode !== 'closed';
  const drawer = state.mode === 'drawer';
  const anyUnread = state.tabs.some((id) => unread[id]);

  const reportUnread = useCallback((sessionId: string, value: boolean) => {
    setUnread((current) => (Boolean(current[sessionId]) === value ? current : { ...current, [sessionId]: value }));
  }, []);

  const reportMachine = useCallback((sessionId: string, value: string) => {
    setTabMachines((current) => (current[sessionId] === value ? current : { ...current, [sessionId]: value }));
  }, []);

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
      const result = await createSession({ variables: { machine } });
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
            'max-[699px]:inset-x-0 max-[699px]:bottom-0 max-[699px]:z-[45] max-[699px]:h-[min(78dvh,640px)] max-[699px]:rounded-t-md max-[699px]:border-x-0 max-[699px]:border-b-0',
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
          <header className="flex flex-none items-center gap-1 border-b border-border bg-surface-0 px-2 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Open sessions">
              {state.tabs.length === 0 && <span className="px-1.5 font-display text-xs font-bold">Chat</span>}
              {state.tabs.map((id) => <ChatTab key={id} sessionId={id} active={id === state.active} multipleMachines={severalMachines(machines, state.tabs.flatMap((tab) => tabMachines[tab] ?? []))} unread={Boolean(unread[id]) && id !== state.active} onMachine={reportMachine} />)}
            </div>
            <MachinePicker machines={machines} value={machine} onChange={choose} disabled={creating} className="max-w-[220px] flex-none whitespace-nowrap" />
            <button type="button" className={control} aria-label="New session" title="New session" disabled={creating} onClick={() => void newSession()}><Plus size={14} aria-hidden="true" /></button>
            <button type="button" className={cn(control, 'max-[699px]:hidden')} aria-label={drawer ? 'Pop out' : 'Dock to bottom'} title={drawer ? 'Pop out' : 'Dock to bottom'} onClick={() => chatStore.setMode(drawer ? 'float' : 'drawer')}>
              {drawer ? <PictureInPicture2 size={14} aria-hidden="true" /> : <PanelBottom size={14} aria-hidden="true" />}
            </button>
            <button type="button" className={control} aria-label="Minimise chat" title="Minimise" onClick={minimise}><Minus size={14} aria-hidden="true" /></button>
          </header>
          <LimitsLine machine={activeData?.chatSession ? machineOf(activeData.chatSession) : undefined} className="flex-none border-b border-border bg-surface-0 px-3.5 py-1.5" />
          {error && <p className="flex-none border-b border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">A new session could not be started: {error}</p>}
          {state.active
            ? <ChatThread key={state.active} sessionId={state.active} className="min-h-0 flex-1" />
            : (
              <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                <div>
                  <MessagesSquare size={26} className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                  <p className="font-display text-sm font-bold">No session open</p>
                  <p className="mt-1 text-pretty text-xs text-muted-foreground">Start a new one here, or pick one on the Sessions page.</p>
                  <button type="button" className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent bg-accent px-3 font-display text-xs font-semibold text-black hover:bg-accent-hover disabled:opacity-50" disabled={creating} onClick={() => void newSession()}><Plus size={14} aria-hidden="true" />New session</button>
                </div>
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
