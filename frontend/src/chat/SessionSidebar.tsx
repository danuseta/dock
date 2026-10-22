import React, { useCallback, useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Search } from 'lucide-react';
import { GET_CHAT_SESSION_WORKERS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { IconButton } from '../components/ui';
import { agentTask } from './activity/activity';
import { AgentAvatar } from './activity/TranscriptParts';
import { shortAgent, threadRoot } from './activity/transcript';
import { useNow } from './activity/useNow';
import { SLOW_POLL_MS, machineOf, machineOnline, relativeTime, sessionTitle, type ChatMachine, type ChatSession } from './messages';
import { groupSessions, sidebarDot } from './sessionGroups';
import { SessionMenu, type SessionMenuTarget } from './SessionMenu';
import { StatusDot } from './StatusDot';

export type SidebarWorker = { id: string; parentId: string | null; turnId: number; name: string; label: string; status: string; startedAt: string; endedAt: string | null };

const LONG_PRESS_MS = 500;

const ENDED: Record<string, { text: string; className: string }> = {
  ok: { text: 'done', className: 'border-status-merged/40 text-status-merged' },
  error: { text: 'failed', className: 'border-status-conflict/40 text-status-conflict' },
  denied: { text: 'blocked', className: 'border-status-conflict/40 text-status-conflict' },
  stopped: { text: 'stopped', className: 'border-border text-muted-foreground' },
};

const Pill: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={cn('flex-none rounded-pill border px-1.5 font-mono text-[0.6rem] leading-4', className)}>{children}</span>
);

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

interface SessionThreadsProps {
  sessionId: string;
  activeThreadId: string | null;
  onOpenThread: (sessionId: string, threadId: string | null) => void;
}

/** One line per agent the lead called, newest first; the open one lists the workers it called. */
const SessionThreads: React.FC<SessionThreadsProps> = ({ sessionId, activeThreadId, onOpenThread }) => {
  const { data } = useQuery<{ chatSessionWorkers: SidebarWorker[] }>(GET_CHAT_SESSION_WORKERS, { variables: { sessionId }, pollInterval: SLOW_POLL_MS });
  const workers = data?.chatSessionWorkers ?? [];
  const known = new Set(workers.map((worker) => worker.id));
  const threads = workers.filter((worker) => !worker.parentId || !known.has(worker.parentId)).reverse();
  const root = activeThreadId ? threadRoot(workers, activeThreadId) : null;
  const under = (id: string): SidebarWorker[] => workers.filter((worker) => worker.parentId === id).flatMap((worker) => [worker, ...under(worker.id)]);
  const line = (worker: SidebarWorker, nested: boolean) => {
    const ended = ENDED[worker.status];
    const workerCount = nested ? 0 : under(worker.id).length;
    return (
      <li key={worker.id}>
        <button type="button" className={cn('flex w-full items-center gap-2 rounded-xs border border-transparent px-2 py-1.5 text-left hover:bg-surface-1 max-[900px]:min-h-11', nested && 'pl-5', activeThreadId === worker.id && 'border-border-glow bg-surface-1')} aria-current={activeThreadId === worker.id ? 'true' : undefined} title={worker.label} onClick={() => onOpenThread(sessionId, worker.id)}>
          <AgentAvatar name={worker.name} small />
          <span className="min-w-0 flex-1 truncate text-[0.76rem]">{nested ? agentTask({ label: worker.label, name: worker.name }) : shortAgent(worker.name)}</span>
          {!nested && <span className="flex-none font-mono text-[0.62rem] text-muted-foreground tabular-nums">{clock(worker.startedAt)}{workerCount > 0 ? ` · ${workerCount}` : ''}</span>}
          {ended ? <Pill className={ended.className}>{ended.text}</Pill> : <StatusDot state="running" className="size-2" />}
        </button>
      </li>
    );
  };
  return (
    <ul className="m-0 mb-1 ml-3.5 list-none border-l border-border p-0 pl-1.5" aria-label="Threads">
      {threads.map((thread) => (
        <React.Fragment key={thread.id}>
          {line(thread, false)}
          {root === thread.id && under(thread.id).map((worker) => line(worker, true))}
        </React.Fragment>
      ))}
    </ul>
  );
};

interface SessionSidebarProps {
  sessions: ChatSession[];
  machines: ChatMachine[] | null | undefined;
  activeId: string | null;
  activeThreadId: string | null;
  onSelect: (sessionId: string) => void;
  onOpenThread: (sessionId: string, threadId: string | null) => void;
  onNew: () => void;
  onRename: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  search: React.ReactNode;
  limits: React.ReactNode;
  results?: React.ReactNode;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ sessions, machines, activeId, activeThreadId, onSelect, onOpenThread, onNew, onRename, onDelete, collapsed, onToggleCollapsed, searchOpen, onToggleSearch, search, limits, results }) => {
  const [openOverride, setOpenOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const now = useNow(true);
  const [menu, setMenu] = useState<SessionMenuTarget | null>(null);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const rowHandlers = (session: ChatSession): React.ButtonHTMLAttributes<HTMLButtonElement> => ({
    onContextMenu: (event) => {
      event.preventDefault();
      // A phone fires contextmenu for its own long press; that one opens the sheet too.
      if (press.current) {
        endPress();
        press.current.fired = true;
        setMenu({ session, x: 0, y: 0, sheet: true });
        return;
      }
      setMenu({ session, x: event.clientX, y: event.clientY, sheet: false });
    },
    onKeyDown: (event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({ session, x: box.left + 24, y: box.bottom, sheet: false });
    },
    onTouchStart: () => {
      endPress();
      const current = { timer: 0, fired: false };
      current.timer = window.setTimeout(() => {
        current.fired = true;
        setMenu({ session, x: 0, y: 0, sheet: true });
      }, LONG_PRESS_MS);
      press.current = current;
    },
    onTouchMove: endPress,
    onTouchEnd: endPress,
  });
  // The click that ends a long press must not also open the session.
  const pressed = () => {
    const fired = press.current?.fired === true;
    press.current = null;
    return fired;
  };
  // The rail is a wide-screen layout: a phone always shows the full list.
  const full = collapsed ? 'min-[901px]:hidden' : undefined;
  const CollapseIcon = collapsed ? ChevronRight : ChevronLeft;
  return (
    <nav className="flex h-full min-h-0 w-full flex-col bg-surface-0" aria-label="Sessions">
      <div className={cn('flex flex-none items-center gap-1 border-b border-border px-3 py-2', collapsed && 'min-[901px]:flex-col min-[901px]:px-0')}>
        <span className={cn('flex-1 font-display text-[0.8rem] font-bold', full)}>Sessions</span>
        <IconButton variant="ghost" aria-label={searchOpen ? 'Close search' : 'Search messages'} aria-pressed={searchOpen} className={cn('max-[900px]:size-11', searchOpen && 'bg-surface-1 text-foreground', full)} onClick={onToggleSearch}><Search size={15} aria-hidden="true" /></IconButton>
        <IconButton variant="ghost" aria-label="New session" className="max-[900px]:size-11" onClick={onNew}><Plus size={16} aria-hidden="true" /></IconButton>
        <IconButton variant="ghost" aria-label={collapsed ? 'Expand sessions' : 'Collapse sessions'} title={collapsed ? 'Expand sessions' : 'Collapse sessions'} aria-expanded={!collapsed} className="max-[900px]:hidden" onClick={onToggleCollapsed}><CollapseIcon size={16} aria-hidden="true" /></IconButton>
      </div>
      {searchOpen && <div className={cn('flex-none border-b border-border p-2', full)}>{search}</div>}
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-2', collapsed && 'min-[901px]:px-1')}>
        {results ?? groupSessions(sessions, now).map((group) => (
          <section key={group.key} aria-label={group.label} className={cn(collapsed && 'min-[901px]:mt-2 min-[901px]:border-t min-[901px]:border-border min-[901px]:pt-2 min-[901px]:first:mt-0 min-[901px]:first:border-t-0')}>
            <h3 className={cn('flex items-center justify-between px-2 pb-1 pt-3 font-mono text-[0.62rem] font-bold uppercase tracking-wider', group.key === 'needs-you' ? 'text-amber-300' : 'text-muted-foreground', full)}>{group.label} <span className="tabular-nums text-muted-foreground">{group.sessions.length}</span></h3>
            {group.sessions.map((session) => {
              const active = session.id === activeId;
              const workers = session.workerCount ?? 0;
              const open = workers > 0 && (openOverride.get(session.id) ?? active);
              const dot = sidebarDot(session, { bridgeUp: machineOnline(machines, machineOf(session)) });
              let meta: React.ReactNode = <span className="flex-none font-mono text-[0.64rem] text-muted-foreground tabular-nums">{relativeTime(session.lastMessageAt, now)}</span>;
              if (group.key === 'needs-you') meta = <Pill className="border-amber-300/50 text-amber-300">answer</Pill>;
              else if (session.status === 'queued') meta = <Pill className="border-amber-300/50 text-amber-200">queued</Pill>;
              else if ((session.status === 'queued' || session.status === 'running') && workers > 0) meta = <span className="flex-none font-mono text-[0.64rem] text-muted-foreground tabular-nums">team {workers}</span>;
              const hint = collapsed ? sessionTitle(session) : undefined;
              return (
                <div key={session.id}>
                  <div className={cn('flex items-center rounded-xs border border-transparent hover:bg-surface-1', active && activeThreadId === null && 'border-border-glow bg-surface-1')}>
                    <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1.5 text-left max-[900px]:min-h-11', collapsed && 'min-[901px]:justify-center min-[901px]:px-0')} aria-current={active ? 'true' : undefined} aria-label={collapsed ? sessionTitle(session) : undefined} title={hint} {...rowHandlers(session)} onClick={() => { if (pressed()) return; if (active) onOpenThread(session.id, null); else onSelect(session.id); }}>
                      <StatusDot state={dot} className="size-2" />
                      <span className={cn('min-w-0 flex-1 truncate font-display text-[0.8rem] font-semibold', full)}>{sessionTitle(session)}</span>
                      <span className={cn('contents', full)}>{meta}</span>
                    </button>
                    {workers > 0 && (
                      <button type="button" className={cn('mr-1 flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground hover:text-foreground max-[900px]:size-11', full)} aria-expanded={open} aria-label={open ? 'Hide threads' : 'Show threads'} title={open ? 'Hide threads' : 'Show threads'} onClick={() => setOpenOverride((current) => new Map(current).set(session.id, !open))}>
                        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                  {open && <div className={full}><SessionThreads sessionId={session.id} activeThreadId={active ? activeThreadId : null} onOpenThread={onOpenThread} /></div>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className={cn('flex-none border-t border-border px-3 py-2.5', full)}>{limits}</div>
      {menu && <SessionMenu target={menu} onRename={onRename} onDelete={onDelete} onClose={closeMenu} />}
    </nav>
  );
};
