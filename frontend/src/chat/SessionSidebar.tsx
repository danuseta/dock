import React, { useCallback, useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Bot, ChevronDown, ChevronUp, Compass, Hammer, Plus, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import { GET_CHAT_SESSION_WORKERS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { IconButton } from '../components/ui';
import { agentType } from './activity/activity';
import { useNow } from './activity/useNow';
import { delayedMinutes } from './headerState';
import { SLOW_POLL_MS, machineOf, machineOnline, relativeTime, sessionTitle, type ChatMachine, type ChatSession } from './messages';
import { groupSessions, sidebarDot } from './sessionGroups';
import type { ChatSessionStatus } from './status';
import { SessionMenu, type SessionMenuTarget } from './SessionMenu';
import { StatusDot } from './StatusDot';

export type SidebarWorker = { id: string; name: string; label: string; status: string };

const LONG_PRESS_MS = 500;

const ROLE_ICON: Record<string, LucideIcon> = { planner: Compass, executor: Hammer, verifier: ShieldCheck };

const ENDED: Record<string, { text: string; className: string }> = {
  ok: { text: 'done', className: 'border-status-merged/40 text-status-merged' },
  error: { text: 'failed', className: 'border-status-conflict/40 text-status-conflict' },
  denied: { text: 'blocked', className: 'border-status-conflict/40 text-status-conflict' },
  stopped: { text: 'stopped', className: 'border-border text-muted-foreground' },
};

const Pill: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={cn('flex-none rounded-pill border px-1.5 font-mono text-[0.6rem] leading-4', className)}>{children}</span>
);

interface SessionWorkersProps {
  sessionId: string;
  activeWorkerId: string | null;
  onSelectWorker: (sessionId: string, workerId: string | null) => void;
}

const SessionWorkers: React.FC<SessionWorkersProps> = ({ sessionId, activeWorkerId, onSelectWorker }) => {
  const { data } = useQuery<{ chatSessionWorkers: SidebarWorker[] }>(GET_CHAT_SESSION_WORKERS, { variables: { sessionId }, pollInterval: SLOW_POLL_MS });
  const workers = data?.chatSessionWorkers ?? [];
  return (
    <ul className="m-0 mb-1 ml-3.5 list-none border-l border-border p-0 pl-1.5">
      {workers.map((worker) => {
        const role = agentType(worker.name);
        const Icon = ROLE_ICON[role] ?? Bot;
        const ended = ENDED[worker.status];
        return (
          <li key={worker.id}>
            <button type="button" className={cn('flex w-full items-center gap-2 rounded-xs border border-transparent px-2 py-1.5 text-left hover:bg-surface-1 max-[900px]:min-h-11', activeWorkerId === worker.id && 'border-border-glow bg-surface-1')} aria-current={activeWorkerId === worker.id ? 'true' : undefined} onClick={() => onSelectWorker(sessionId, worker.id)}>
              <Icon size={13} aria-hidden="true" className="flex-none text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[0.76rem]">{role}</span>
              {ended ? <Pill className={ended.className}>{ended.text}</Pill> : (
                <>
                  <span className="max-w-[45%] flex-none truncate font-mono text-[0.64rem] text-muted-foreground">{worker.label}</span>
                  <StatusDot state={worker.status === 'running' ? 'running' : 'done'} className="size-2" />
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

interface SessionSidebarProps {
  sessions: ChatSession[];
  live: readonly ChatSessionStatus[];
  machines: ChatMachine[] | null | undefined;
  activeId: string | null;
  activeWorkerId: string | null;
  onSelect: (sessionId: string) => void;
  onSelectWorker: (sessionId: string, workerId: string | null) => void;
  onNew: () => void;
  onRename: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  search: React.ReactNode;
  limits: React.ReactNode;
  results?: React.ReactNode;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ sessions, live, machines, activeId, activeWorkerId, onSelect, onSelectWorker, onNew, onRename, onDelete, searchOpen, onToggleSearch, search, limits, results }) => {
  const [openOverride, setOpenOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const now = useNow(true);
  const liveById = new Map(live.map((item) => [item.sessionId, item]));
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
  return (
    <nav className="flex h-full min-h-0 w-full flex-col bg-surface-0" aria-label="Sessions">
      <div className="flex flex-none items-center gap-1 border-b border-border px-3 py-2">
        <span className="flex-1 font-display text-[0.8rem] font-bold">Sessions</span>
        <IconButton variant="ghost" aria-label={searchOpen ? 'Close search' : 'Search messages'} aria-pressed={searchOpen} className={cn('max-[900px]:size-11', searchOpen && 'bg-surface-1 text-foreground')} onClick={onToggleSearch}><Search size={15} aria-hidden="true" /></IconButton>
        <IconButton variant="ghost" aria-label="New session" className="max-[900px]:size-11" onClick={onNew}><Plus size={16} aria-hidden="true" /></IconButton>
      </div>
      {searchOpen && <div className="flex-none border-b border-border p-2">{search}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {results ?? groupSessions(sessions).map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h3 className={cn('flex items-center justify-between px-2 pb-1 pt-3 font-mono text-[0.62rem] font-bold uppercase tracking-wider', group.key === 'needs-you' ? 'text-amber-300' : 'text-muted-foreground')}>{group.label} <span className="tabular-nums text-muted-foreground">{group.sessions.length}</span></h3>
            {group.sessions.map((session) => {
              const active = session.id === activeId;
              const workers = session.workerCount ?? 0;
              const open = workers > 0 && (openOverride.get(session.id) ?? active);
              const status = liveById.get(session.id);
              const dot = sidebarDot(session, { bridgeUp: machineOnline(machines, machineOf(session)), stale: Boolean(status?.stale) });
              let meta: React.ReactNode = <span className="flex-none font-mono text-[0.64rem] text-muted-foreground tabular-nums">{relativeTime(session.lastMessageAt, now)}</span>;
              if (group.key === 'needs-you') meta = <Pill className="border-amber-300/50 text-amber-300">answer</Pill>;
              else if (dot === 'delayed' && status) meta = <span className="flex-none font-mono text-[0.64rem] text-amber-300 tabular-nums">delayed {delayedMinutes(status.receivedAt, now)}m</span>;
              else if (group.key === 'running' && workers > 0) meta = <span className="flex-none font-mono text-[0.64rem] text-muted-foreground tabular-nums">team {workers}</span>;
              return (
                <div key={session.id}>
                  <div className={cn('flex items-center rounded-xs border border-transparent hover:bg-surface-1', active && activeWorkerId === null && 'border-border-glow bg-surface-1')}>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1.5 text-left max-[900px]:min-h-11" aria-current={active ? 'true' : undefined} title={dot === 'delayed' ? 'The workspace has not sent a status for a while' : undefined} {...rowHandlers(session)} onClick={() => { if (pressed()) return; if (active) onSelectWorker(session.id, null); else onSelect(session.id); }}>
                      <StatusDot state={dot} className="size-2" />
                      <span className="min-w-0 flex-1 truncate font-display text-[0.8rem] font-semibold">{sessionTitle(session)}</span>
                      {meta}
                    </button>
                    {workers > 0 && (
                      <button type="button" className="mr-1 flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground hover:text-foreground max-[900px]:size-11" aria-expanded={open} aria-label={open ? 'Hide workers' : 'Show workers'} title={open ? 'Hide workers' : 'Show workers'} onClick={() => setOpenOverride((current) => new Map(current).set(session.id, !open))}>
                        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                  {open && <SessionWorkers sessionId={session.id} activeWorkerId={active ? activeWorkerId : null} onSelectWorker={onSelectWorker} />}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className="flex-none border-t border-border px-3 py-2.5">{limits}</div>
      {menu && <SessionMenu target={menu} onRename={onRename} onDelete={onDelete} onClose={closeMenu} />}
    </nav>
  );
};
