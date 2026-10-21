import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@apollo/client';
import { ArrowLeft, FileCode, X } from 'lucide-react';
import { GET_CHAT_SESSION_WORKERS } from '../graphql/queries';
import { cn } from '../lib/cn';
import { agentTask, agentType, durationOf, formatDuration, statusText, type ChatActivity } from './activity/activity';
import { StatusIcon } from './activity/ActivityRow';
import { AgentThreadBody } from './activity/AgentThread';
import { AgentAvatar } from './activity/TranscriptParts';
import { agentDetail, descendantsOf, shortAgent, threadFiles, treeStats } from './activity/transcript';
import { useAgentThread } from './activity/useAgentThread';
import { useNow } from './activity/useNow';
import { SLOW_POLL_MS } from './messages';
import type { SidebarWorker } from './SessionSidebar';

type Tab = 'thread' | 'detail' | 'files';

const NEAR_BOTTOM_PX = 80;

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

interface PaneProps {
  sessionId: string;
  threadId: string;
  onOpen: (eventId: string) => void;
  onClose: () => void;
  className?: string;
}

/** One agent's thread beside the conversation, like a thread in a chat app; its workers open in the same place, with a way back. */
export const AgentThreadPane: React.FC<PaneProps> = ({ sessionId, threadId, onOpen, onClose, className }) => {
  const { data, loading } = useQuery<{ chatSessionWorkers: SidebarWorker[] }>(GET_CHAT_SESSION_WORKERS, { variables: { sessionId }, pollInterval: SLOW_POLL_MS });
  const workers = data?.chatSessionWorkers ?? [];
  const worker = workers.find((item) => item.id === threadId);
  const { rows, state, store } = useAgentThread(sessionId, worker?.turnId ?? null, worker?.status === 'running');
  const agent = rows.find((row) => row.eventId === threadId);
  const running = (agent?.status ?? worker?.status) === 'running';
  const now = useNow(running);
  const [tab, setTab] = useState<Tab>('thread');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const shownRef = useRef<string | null>(null);

  const own = agent ? descendantsOf(rows, agent.eventId) : [];
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (shownRef.current !== threadId) {
      shownRef.current = threadId;
      stickRef.current = running;
      element.scrollTop = running ? element.scrollHeight : 0;
    } else if (stickRef.current) element.scrollTop = element.scrollHeight;
  }, [threadId, own.length, running]);

  const parentWorker = worker?.parentId ? workers.find((item) => item.id === worker.parentId) : undefined;
  const parentName = parentWorker?.name ?? 'lead';
  const chain: SidebarWorker[] = [];
  for (let cursor = worker; cursor; cursor = cursor.parentId ? workers.find((item) => item.id === cursor?.parentId) : undefined) chain.unshift(cursor);
  const files = threadFiles([...(agent ? [agent] : []), ...own]);
  const stats = treeStats(own.filter((row) => row.parentId === threadId));
  const status = agent?.status ?? worker?.status ?? 'running';
  const elapsed = agent ? durationOf(agent, now) : null;
  const name = agent?.name ?? worker?.name ?? '';

  const handleScroll = () => {
    const element = scrollRef.current;
    if (element) stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  };

  let body: React.ReactNode;
  if (!worker && !loading) body = <p className="p-4 text-sm text-muted-foreground">This worker is no longer in this session.</p>;
  else if (state === 'failed') body = <p className="p-4 text-sm text-status-conflict" role="alert">The thread could not be loaded.</p>;
  else if (!agent) body = <p className="p-4 text-sm text-muted-foreground" role="status">Loading the thread...</p>;
  else if (tab === 'thread') body = <ul className="flex min-w-0 flex-col gap-3.5 p-3"><AgentThreadBody agent={agent} rows={rows} parentName={parentName} store={store} now={now} onOpenChild={onOpen} /></ul>;
  else if (tab === 'detail') body = <ThreadDetail agent={agent} rows={own} parentName={parentName} store={store} now={now} />;
  else body = files.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No file read or changed yet.</p> : (
    <ul className="flex flex-col gap-1 p-3 font-mono text-[0.72rem] text-secondary-foreground">
      {files.map((file) => (
        <li key={file.path} className="flex min-w-0 items-center gap-2" title={file.path}>
          <FileCode size={12} aria-hidden="true" className="flex-none text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{file.path.split('/').pop()}</span>
          <span className={cn('flex-none', file.changed ? 'text-status-merged' : 'text-muted-foreground')}>{file.changed ? 'changed' : 'read'}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className={cn('flex min-h-0 flex-col bg-surface-0', className)} aria-label={`Thread of ${agentType(name)}`}>
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        {parentWorker && (
          <button type="button" className="flex size-7 flex-none items-center justify-center rounded-xs border border-border-glow bg-surface-1 hover:bg-surface-hover max-[900px]:size-11" aria-label={`Back to ${agentType(parentWorker.name)}`} onClick={() => onOpen(parentWorker.id)}>
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
        )}
        {name && <AgentAvatar name={name} />}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 font-display text-[0.9rem] font-bold">
            <span className="truncate">{agentType(name)}</span>
            {agentType(name) === 'sous-ticket-runner' && <span className="flex-none rounded-[3px] border border-border-glow px-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted-foreground">runner</span>}
          </p>
          <p className="flex min-w-0 items-center gap-1 truncate font-mono text-[0.66rem] text-muted-foreground">
            <span className="truncate">{chain.length > 1 ? chain.slice(0, -1).map((item) => shortAgent(item.name)).join(' › ') : 'called by lead'} · {clock(worker?.startedAt ?? null)}{worker?.endedAt ? `–${clock(worker.endedAt)}` : ''}</span>
            <StatusIcon status={status} size={10} />
            <span className="flex-none">{running && elapsed !== null ? formatDuration(elapsed) : statusText(status)}</span>
          </p>
        </div>
        <button type="button" className="flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-surface-1 hover:text-foreground max-[900px]:size-11" aria-label="Close the thread" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </div>
      <div className="flex flex-none gap-4 border-b border-border px-3 text-[0.78rem] text-muted-foreground" role="tablist">
        {(['thread', 'detail', 'files'] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} className={cn('py-2 capitalize hover:text-foreground max-[900px]:min-h-11', tab === item && 'text-foreground shadow-[inset_0_-2px_0_var(--color-accent)]')} onClick={() => setTab(item)}>
            {item}{item === 'files' && files.length > 0 ? ` · ${files.length}` : ''}
          </button>
        ))}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
      <p className="flex flex-none items-center gap-2 border-t border-border px-3 py-2 text-[0.74rem] text-muted-foreground">
        {running ? <><StatusIcon status="running" size={11} />Running{elapsed !== null && ` · ${formatDuration(elapsed)}`}</> : agent ? <>Finished {clock(agent.endedAt)} · {stats.steps} steps</> : null}
        {parentWorker && <button type="button" className="ml-auto text-status-open hover:underline" onClick={() => onOpen(parentWorker.id)}>Back to {shortAgent(parentWorker.name)}</button>}
      </p>
    </aside>
  );
};

const ThreadDetail: React.FC<{ agent: ChatActivity; rows: readonly ChatActivity[]; parentName: string; store: ReturnType<typeof useAgentThread>['store']; now: number }> = ({ agent, rows, parentName, store, now }) => {
  const entry = useSyncExternalStore(store.subscribe, () => store.get(agent.id));
  const version = `${agent.status}:${agent.seq}`;
  useEffect(() => {
    if (agent.hasDetail) store.load(agent.id, version);
  }, [store, agent.id, agent.hasDetail, version]);
  const detail = agentDetail(entry.text);
  const direct = treeStats(rows.filter((row) => row.parentId === agent.eventId));
  const elapsed = durationOf(agent, now);
  const items: Array<[string, string]> = [
    ['Agent', agentType(agent.name)],
    ['Task', agentTask(agent)],
    ['Called by', agentType(parentName)],
    ['Started', new Date(agent.startedAt).toLocaleTimeString('en-GB')],
    ['Ended', agent.endedAt ? new Date(agent.endedAt).toLocaleTimeString('en-GB') : '-'],
    ['Duration', elapsed !== null ? formatDuration(elapsed) : '-'],
    ['Status', statusText(agent.status)],
    ['Steps', String(direct.steps)],
    ['Failed', String(direct.failed)],
    ['Blocked', String(direct.denied)],
    ['Workers', String(direct.workers)],
    ['Tokens', detail.tokens !== null ? `${(detail.tokens / 1000).toFixed(1)}k` : '-'],
  ];
  return (
    <div className="flex flex-col gap-3 p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[0.72rem]">
        {items.map(([label, value]) => <React.Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-right text-secondary-foreground [overflow-wrap:anywhere]">{value}</dd></React.Fragment>)}
      </dl>
      {detail.prompt && (
        <div>
          <p className="mb-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Task as sent</p>
          <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-xs border border-border bg-surface-1 p-2 font-mono text-[0.68rem] text-secondary-foreground">{detail.prompt}</pre>
        </div>
      )}
    </div>
  );
};
