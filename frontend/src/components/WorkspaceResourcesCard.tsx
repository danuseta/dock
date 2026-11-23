import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { AlertTriangle, Square } from 'lucide-react';
import { GET_SETTINGS, GET_WORKSPACE_RESOURCES, STOP_WORKTREE_SERVERS } from '../graphql/queries';
import { Button } from './ui';
import { cn } from '../lib/cn';
import { announce } from '../lib/notificationEvents';
import { parseNotificationPrefs } from '../lib/notificationPrefs';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { RESOURCES_POLL_MS, breakdown, gb, memoryPercent, memoryTight, newOomKills, sparkline, type WorkspaceResources } from '../lib/workspaceResources';

const head = 'font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';
const metric = 'min-w-0 rounded-sm border border-border bg-surface-1 px-3 py-2.5';

const Bar: React.FC<{ percent: number; tight?: boolean; label: string }> = ({ percent, tight = false, label }) => (
  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    <div className={cn('h-full rounded-full', tight ? 'bg-status-conflict' : 'bg-accent')} style={{ width: `${percent}%` }} />
  </div>
);

/** True while the page is in view; Home stops polling when the tab is in the background or the phone is locked. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const check = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  return visible;
}

/** Home › Workspace resources: memory against the workspace limit with 15 minutes of history, CPU, disk, OOM kills and where the memory goes. Workspace DOCK only. */
export const WorkspaceResourcesCard: React.FC<{ className?: string; onTicketClick: (key: string) => void }> = ({ className, onTicketClick }) => {
  const visible = usePageVisible();
  const { data, refetch } = useQuery<{ workspaceResources: WorkspaceResources | null }>(GET_WORKSPACE_RESOURCES, { fetchPolicy: 'network-only', pollInterval: visible ? RESOURCES_POLL_MS : 0, skip: !visible });
  const { data: settings } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const prefs = useMemo(() => parseNotificationPrefs(settings?.settings?.notificationPrefs), [settings]);
  const [stop, stopping] = useMutation(STOP_WORKTREE_SERVERS);
  const [notice, setNotice] = useState<string | null>(null);
  const oomSeen = useRef<number | null>(null);
  const view = data?.workspaceResources ?? null;

  useEffect(() => {
    if (!view) return;
    const { seen, events } = newOomKills(oomSeen.current, view.oom.today);
    oomSeen.current = seen;
    void announce(events, prefs);
  }, [view, prefs]);

  if (!view) return null;
  const { memory, cpu, disk, oom } = view;
  const percent = memoryPercent(memory);
  const spark = sparkline(memory);
  const onStop = (ticketKey: string) => {
    setNotice(null);
    stop({ variables: { ticketKey } })
      .then((result) => { setNotice(`${result.data?.stopWorktreeServers ?? 0} dev ${result.data?.stopWorktreeServers === 1 ? 'server' : 'servers'} of ${ticketKey} told to stop.`); return refetch(); })
      .catch((failure: unknown) => setNotice(failure instanceof Error ? failure.message : 'The servers could not be stopped'));
  };

  return (
    <article className={cn('min-w-0 rounded-md border border-border bg-surface-0', className)} aria-label="Workspace resources">
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-[17px] py-[15px]">
        <h2 className="text-balance font-display text-[0.82rem] font-bold">Workspace resources <span className="ml-1.5 font-mono text-[0.62rem] font-medium text-muted-foreground">live · 5 s</span></h2>
        <span className={cn('inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 font-mono text-[0.64rem] font-bold tabular-nums', oom.today > 0 ? 'border-status-warn text-status-warn' : 'border-border text-muted-foreground')} title={`${oom.total} OOM kills since the workspace started`}>
          {oom.today > 0 && <AlertTriangle size={11} aria-hidden="true" />}{oom.today} OOM {oom.today === 1 ? 'kill' : 'kills'} today
        </span>
      </header>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 p-3.5 max-[760px]:grid-cols-1">
        <div className={metric}>
          <p className={head}>Memory</p>
          <p className="mt-1 font-mono text-[0.95rem] font-bold tabular-nums">{gb(memory.current)}<span className="text-[0.72rem] font-medium text-muted-foreground"> / {memory.max ? `${gb(memory.max)} GB` : 'no limit'}</span></p>
          {percent !== null && <Bar percent={percent} tight={memoryTight(memory)} label="Memory used" />}
          <svg className="mt-2 block h-[38px] w-full" viewBox="0 0 200 38" preserveAspectRatio="none" role="img" aria-label="Memory, last 15 minutes">
            {memory.max && <line x1="0" x2="200" y1={spark.limitY} y2={spark.limitY} className="stroke-status-conflict" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
            <polyline points={spark.points} fill="none" className="stroke-accent" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <p className="mt-1 text-[0.62rem] text-muted-foreground">last 15 min · scale {gb(spark.low)} to {gb(spark.high)} GB{memory.max ? ' · red line = limit' : ''}</p>
        </div>
        <div className={metric}>
          <p className={head}>CPU</p>
          <p className="mt-1 font-mono text-[0.95rem] font-bold tabular-nums">{cpu.percent == null ? '-' : `${Math.round(cpu.percent)} %`}</p>
          {cpu.percent != null && <Bar percent={Math.min(100, Math.round(cpu.percent))} tight={cpu.percent > 93} label="CPU used" />}
          <p className="mt-2 text-[0.7rem] text-muted-foreground">Load {cpu.load1 ?? '-'}{cpu.limit ? ` · limit ${cpu.limit} CPU` : ''}</p>
        </div>
        <div className={metric}>
          <p className={head}>Disk</p>
          {disk ? (
            <>
              <p className="mt-1 font-mono text-[0.95rem] font-bold tabular-nums">{Math.round(disk.used / 1024 ** 3)}<span className="text-[0.72rem] font-medium text-muted-foreground"> / {Math.round(disk.total / 1024 ** 3)} GB</span></p>
              <Bar percent={disk.total ? Math.round((disk.used / disk.total) * 100) : 0} label="Disk used" />
            </>
          ) : <p className="mt-1 text-sm text-muted-foreground">-</p>}
          <p className="mt-2 text-[0.7rem] text-muted-foreground">{view.worktrees} {view.worktrees === 1 ? 'worktree' : 'worktrees'}</p>
        </div>
      </div>
      <section aria-label="Per ticket" className="border-t border-border px-4 py-2.5">
        <h3 className={head}>Per ticket (session + MCP + worktree servers + tests)</h3>
        <ul className="mt-1">
          {view.tickets.map((group) => (
            <li key={group.key} className="grid grid-cols-[52px_88px_minmax(0,1fr)] items-baseline gap-2 border-b border-border py-1.5 text-[0.76rem] last:border-b-0 max-[600px]:grid-cols-[48px_minmax(0,1fr)]">
              <span className="font-mono font-bold tabular-nums">{gb(group.bytes)}G</span>
              <button type="button" className="justify-self-start border-0 bg-transparent p-0 font-mono font-semibold text-accent hover:underline" onClick={() => onTicketClick(group.key!)}>{group.key}</button>
              <span className="min-w-0 truncate text-muted-foreground max-[600px]:col-span-2">{breakdown(group)}</span>
            </li>
          ))}
          <li className="grid grid-cols-[52px_88px_minmax(0,1fr)] items-baseline gap-2 py-1.5 text-[0.76rem] max-[600px]:grid-cols-[48px_minmax(0,1fr)]">
            <span className="font-mono font-bold tabular-nums">{gb(view.base.bytes)}G</span>
            <span className="font-mono font-semibold text-secondary-foreground">Base</span>
            <span className="min-w-0 truncate text-muted-foreground max-[600px]:col-span-2">{breakdown(view.base) || 'nothing outside a ticket'}</span>
          </li>
        </ul>
      </section>
      {view.leftovers.length > 0 && (
        <section aria-label="Left running" className="border-t border-border px-4 py-2.5">
          <h3 className={head}>Left running for a ticket not in progress</h3>
          <ul className="mt-1">
            {view.leftovers.map((item) => (
              <li key={item.ticketKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-1.5 text-[0.76rem] last:border-b-0">
                <span className="w-[52px] font-mono font-bold tabular-nums">{gb(item.bytes)}G</span>
                <span className="font-mono font-semibold">{item.ticketKey}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.status ?? 'not in your tickets'} · {item.worktrees.join(', ')} · {item.count} dev {item.count === 1 ? 'server' : 'servers'}</span>
                <Button size="sm" variant="danger" onClick={() => onStop(item.ticketKey)} disabled={stopping.loading}><Square size={12} aria-hidden="true" />Stop</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notice && <p className="border-t border-border px-4 py-2 text-[0.76rem] text-secondary-foreground" role="status">{notice}</p>}
    </article>
  );
};
