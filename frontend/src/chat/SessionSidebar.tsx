import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { GET_CHAT_SESSION_WORKERS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { IconButton } from '../components/ui';
import { agentType } from './activity/activity';
import { useNow } from './activity/useNow';
import { SLOW_POLL_MS, relativeTime, sessionTitle, type ChatSession } from './messages';
import { groupSessions, sessionGroupKey, type SessionGroupKey } from './sessionGroups';

export type SidebarWorker = { id: string; name: string; label: string; status: string };

const DOT: Record<SessionGroupKey, string> = {
  'needs-you': 'bg-amber-300',
  running: 'animate-pulse bg-status-merged',
  done: 'bg-muted-foreground',
};

const Dot: React.FC<{ className: string }> = ({ className }) => <i className={cn('size-2 flex-none rounded-full', className)} aria-hidden="true" />;

const workerDot = (status: string) => (status === 'running' || status === 'queued' ? DOT.running : DOT.done);

interface SessionWorkersProps {
  sessionId: string;
  activeWorkerId: string | null;
  onSelectWorker: (sessionId: string, workerId: string | null) => void;
}

const SessionWorkers: React.FC<SessionWorkersProps> = ({ sessionId, activeWorkerId, onSelectWorker }) => {
  const { data } = useQuery<{ chatSessionWorkers: SidebarWorker[] }>(GET_CHAT_SESSION_WORKERS, { variables: { sessionId }, pollInterval: SLOW_POLL_MS });
  const workers = data?.chatSessionWorkers ?? [];
  return (
    <ul className="m-0 mb-1 ml-5 list-none border-l border-border p-0 pl-1.5">
      {workers.map((worker) => (
        <li key={worker.id}>
          <button type="button" className={cn('flex w-full items-center gap-2 rounded-xs border border-transparent px-2 py-1.5 text-left hover:bg-surface-1', activeWorkerId === worker.id && 'border-border-glow bg-surface-1')} aria-current={activeWorkerId === worker.id ? 'true' : undefined} onClick={() => onSelectWorker(sessionId, worker.id)}>
            <Dot className={workerDot(worker.status)} />
            <span className="min-w-0 flex-1 truncate text-[0.76rem]">{agentType(worker.name)}</span>
            <span className="max-w-[40%] flex-none truncate font-mono text-[0.64rem] text-muted-foreground">{worker.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeId: string | null;
  activeWorkerId: string | null;
  onSelect: (sessionId: string) => void;
  onSelectWorker: (sessionId: string, workerId: string | null) => void;
  onNew: () => void;
  limits: React.ReactNode;
  results?: React.ReactNode;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({ sessions, activeId, activeWorkerId, onSelect, onSelectWorker, onNew, limits, results }) => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const now = useNow(true);
  const toggle = (sessionId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(sessionId)) next.add(sessionId);
    return next;
  });
  return (
    <nav className="flex h-full min-h-0 w-full flex-col border-r border-border bg-surface-0" aria-label="Sessions">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="font-display text-[0.8rem] font-bold">Sessions</span>
        <IconButton variant="ghost" aria-label="New session" onClick={onNew}><Plus size={16} aria-hidden="true" /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {results ?? groupSessions(sessions).map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h3 className="px-2 pb-1 pt-3 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">{group.label} <span className="tabular-nums">{group.sessions.length}</span></h3>
            {group.sessions.map((session) => {
              const active = session.id === activeId;
              const nested = (session.workerCount ?? 0) > 0;
              const open = expanded.has(session.id);
              return (
                <div key={session.id}>
                  <div className={cn('flex items-center rounded-xs border border-transparent hover:bg-surface-1', active && activeWorkerId === null && 'border-border-glow bg-surface-1')}>
                    {nested && (
                      <button type="button" className="flex size-7 flex-none items-center justify-center text-muted-foreground hover:text-foreground" aria-expanded={open} aria-label={open ? 'Hide workers' : 'Show workers'} onClick={() => toggle(session.id)}>
                        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      </button>
                    )}
                    <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-2 py-2 pr-2.5 text-left', !nested && 'pl-2.5')} aria-current={active ? 'true' : undefined} onClick={() => (active ? onSelectWorker(session.id, null) : onSelect(session.id))}>
                      <Dot className={DOT[sessionGroupKey(session)]} />
                      <span className="min-w-0 flex-1 truncate font-display text-[0.8rem] font-semibold">{sessionTitle(session)}</span>
                      <span className="flex-none font-mono text-[0.64rem] text-muted-foreground tabular-nums">{relativeTime(session.lastMessageAt, now)}</span>
                    </button>
                  </div>
                  {nested && open && <SessionWorkers sessionId={session.id} activeWorkerId={active ? activeWorkerId : null} onSelectWorker={onSelectWorker} />}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className="border-t border-border px-3 py-2.5">{limits}</div>
    </nav>
  );
};
