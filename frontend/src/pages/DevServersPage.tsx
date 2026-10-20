import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Download, Play, RefreshCw, RotateCcw, Search, Server, Square, Terminal } from 'lucide-react';
import { GET_DEV_SERVER_LOG, GET_DEV_SERVERS } from '../graphql/queries';
import { RESTART_DEV_SERVER, START_ALL_DEV_SERVERS, START_DEV_SERVER, STOP_ALL_DEV_SERVERS, STOP_DEV_SERVER, STOP_WORKTREE_SERVER } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { RackScene } from '../components/empty/scenes/RackScene';
import { Button, Card, ConfirmDialog, IconButton, Input, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { canStop, filterLog, type DevServer, type DevServerAction } from '../lib/devServers';

const POLL_MS = 5000;

const DOT_CLASS: Record<DevServer['state'], string> = { running: 'bg-status-merged', starting: 'animate-pulse bg-amber-300 motion-reduce:animate-none', failed: 'bg-status-conflict', stopped: 'bg-muted-foreground/40' };

const StatusDot = ({ state }: { state: DevServer['state'] }) => <span className={cn('size-2.5 shrink-0 rounded-full', DOT_CLASS[state])} aria-hidden="true" />;

const DevServersPage = () => {
  const { data, loading, error, refetch } = useQuery(GET_DEV_SERVERS, { ...CACHED_QUERY_OPTIONS, pollInterval: POLL_MS });
  const [logApp, setLogApp] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { data: logData, error: logError } = useQuery(GET_DEV_SERVER_LOG, { variables: { name: logApp || '' }, skip: !logApp, pollInterval: POLL_MS, fetchPolicy: 'network-only' });
  const [startServer] = useMutation(START_DEV_SERVER);
  const [stopServer] = useMutation(STOP_DEV_SERVER);
  const [restartServer] = useMutation(RESTART_DEV_SERVER);
  const [startAll] = useMutation(START_ALL_DEV_SERVERS);
  const [stopAll] = useMutation(STOP_ALL_DEV_SERVERS);
  const [stopWorktree] = useMutation(STOP_WORKTREE_SERVER);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [confirmStopAll, setConfirmStopAll] = useState(false);

  const act = async (target: string, work: () => Promise<unknown>) => {
    setBusy(target);
    setActionError('');
    try {
      await work();
      await refetch();
    } catch (workError: any) {
      setActionError(workError.message || 'The action failed');
    } finally {
      setBusy(null);
    }
  };

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const main: DevServer[] = data?.devServers?.main || [];
  const secondary: DevServer[] = data?.devServers?.secondary || [];
  const actions: DevServerAction[] = data?.devServers?.actions || [];
  const log = filterLog(logData?.devServerLog || '', search);
  const download = () => {
    const url = URL.createObjectURL(new Blob([logData?.devServerLog || ''], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${logApp}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Dev servers</h1><p className="mt-1 text-pretty text-secondary-foreground">The apps of this workspace. Main runs from the main clones with qonflo-dev; secondary are the servers agents started in ticket worktrees.</p></div>
        <span className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void act('all', () => startAll())} disabled={busy !== null}><Play size={16} aria-hidden="true" />Start all</Button>
          <Button onClick={() => setConfirmStopAll(true)} disabled={busy !== null}><Square size={16} aria-hidden="true" />Stop all</Button>
          <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
        </span>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {actionError && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{actionError}</Card>}

      <h2 className="mb-2 font-display text-lg font-bold">Main</h2>
      <Card className="mb-6 overflow-hidden p-0">
        <ul className="flex flex-col">
          {main.map((app) => (
            <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0" key={app.name}>
              <span className="flex min-w-0 items-center gap-2.5"><StatusDot state={app.state} /><span className="min-w-0"><strong className="block font-display">{app.name}</strong><small className="font-mono text-[0.68rem] text-muted-foreground">{app.folder} · port {app.port} · {app.state}</small>{app.state === 'failed' && app.error && <small className="block max-w-xl whitespace-pre-wrap break-words text-pretty font-mono text-[0.7rem] text-status-conflict">{app.error}</small>}{app.running && !app.hasLog && <small className="block text-pretty text-[0.7rem] text-amber-300">Started outside DOCK, so there is no log. Restart it here to keep one.</small>}</span></span>
              <span className="flex items-center gap-1">
                {app.state === 'running' && <IconButton variant="ghost" aria-label={`Restart ${app.name}`} title="Restart" disabled={busy === app.name || busy === 'all'} onClick={() => void act(app.name, () => restartServer({ variables: { name: app.name } }))}><RotateCcw size={15} aria-hidden="true" /></IconButton>}
                {canStop(app.state)
                  ? <IconButton variant="ghost" className="text-status-conflict" aria-label={`Stop ${app.name}`} title="Stop" disabled={busy === app.name || busy === 'all'} onClick={() => void act(app.name, () => stopServer({ variables: { name: app.name } }))}><Square size={15} aria-hidden="true" /></IconButton>
                  : <IconButton variant="ghost" aria-label={`Start ${app.name}`} title="Start" disabled={busy === app.name || busy === 'all'} onClick={() => void act(app.name, () => startServer({ variables: { name: app.name } }))}><Play size={15} aria-hidden="true" /></IconButton>}
                <IconButton variant="ghost" aria-label={`Log of ${app.name}`} title={app.hasLog ? 'Log' : 'No log: DOCK did not start it'} disabled={!app.hasLog} onClick={() => setLogApp(app.name)}><Terminal size={15} aria-hidden="true" /></IconButton>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="mb-2 font-display text-lg font-bold">Secondary</h2>
      <Card className="mb-6 overflow-hidden p-0">
        {secondary.length === 0 ? <EmptyState size="panel" scene={<RackScene />} description="No server runs in a ticket worktree." /> : (
          <ul className="flex flex-col">
            {secondary.map((item) => (
              <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0" key={item.port}>
                <span className="flex min-w-0 items-center gap-2.5"><StatusDot state="running" /><span className="min-w-0"><strong className="block font-display">{item.ticketKey || item.folder}</strong><small className="font-mono text-[0.68rem] text-muted-foreground">{item.folder} · port {item.port}{item.pid ? ` · pid ${item.pid}` : ''}</small></span></span>
                <span className="flex items-center gap-1">
                <IconButton variant="ghost" aria-label={`Log of the server on port ${item.port}`} title={item.hasLog ? 'Log' : 'No log: not started with dev-server.cjs'} disabled={!item.hasLog} onClick={() => setLogApp(item.name)}><Terminal size={15} aria-hidden="true" /></IconButton>
                <IconButton variant="ghost" className="text-status-conflict" aria-label={`Stop the server on port ${item.port}`} title="Stop" disabled={busy === String(item.port)} onClick={() => void act(String(item.port), () => stopWorktree({ variables: { port: item.port } }))}><Square size={15} aria-hidden="true" /></IconButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {logApp && (
        <Card className="mb-6 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Server size={18} aria-hidden="true" />{logApp} log</h2>
            <span className="flex items-center gap-2">
              <label className="relative"><span className="sr-only">Search the log</span><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="h-8 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></label>
              <IconButton variant="ghost" aria-label="Download the log" title="Download" onClick={download}><Download size={15} aria-hidden="true" /></IconButton>
              <Button size="sm" onClick={() => setLogApp(null)}>Close</Button>
            </span>
          </div>
          {logError ? <p className="p-4 text-sm text-status-conflict" role="alert">{logError.message}</p> : <pre className="max-h-[60vh] overflow-auto p-4 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-secondary-foreground">{log || 'No output yet.'}</pre>}
        </Card>
      )}

      <h2 className="mb-2 font-display text-lg font-bold">Recent actions</h2>
      <Card className="overflow-hidden p-0">
        {actions.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing started or stopped from DOCK since it started.</p> : (
          <ul className="flex flex-col">
            {actions.map((item, index) => (
              <li className="grid grid-cols-[150px_140px_1fr] gap-3 border-b border-border px-4 py-2 text-xs last:border-b-0 max-[640px]:grid-cols-1" key={`${item.at}-${index}`}>
                <span className="font-mono text-muted-foreground tabular-nums">{new Date(item.at).toLocaleString('en-GB')}</span>
                <span className={cn('font-mono font-bold', item.ok ? 'text-status-merged' : 'text-status-conflict')}>{item.action} {item.target}</span>
                <span className="min-w-0 break-words font-mono text-muted-foreground">{item.output}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmStopAll}
        title="Stop all dev servers?"
        description="Every main app started with qonflo-dev stops. Servers in ticket worktrees keep running."
        confirmLabel="Stop all"
        busyLabel="Stopping..."
        busy={busy === 'all'}
        onCancel={() => setConfirmStopAll(false)}
        onConfirm={() => void act('all', () => stopAll()).then(() => setConfirmStopAll(false))}
      />
    </Page>
  );
};

export default DevServersPage;
