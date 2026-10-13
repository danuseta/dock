import { useMemo, useState } from 'react';
import { useLazyQuery, useQuery } from '@apollo/client';
import { Box, Eye, RefreshCw, Search, Terminal, X } from 'lucide-react';
import { GET_DOCKER_CONTAINER_LOGS, GET_DOCKER_RUNTIME, GET_SETTINGS } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Card, Dialog, IconButton, Input, Page, PageHeader, PhoneCards, Select } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { dockerStatusTone, formatBytes, type DockerContainer, type DockerRuntime } from '../lib/dockerRuntime';
import { normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';

const DockerServicesPage = () => {
  const { data: settingsData } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const refreshSeconds = normalizeServiceHealthRefreshSeconds(settingsData?.settings?.serviceHealthRefreshSeconds);
  const { data, loading, error, refetch } = useQuery(GET_DOCKER_RUNTIME, {
    ...CACHED_QUERY_OPTIONS,
    variables: { includeStats: true },
    pollInterval: refreshSeconds * 1000,
  });
  const [loadLogs, { data: logsData, loading: logsLoading, error: logsError }] = useLazyQuery(GET_DOCKER_CONTAINER_LOGS, { fetchPolicy: 'network-only' });
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [inspectTarget, setInspectTarget] = useState<DockerContainer | null>(null);
  const [logsTarget, setLogsTarget] = useState<DockerContainer | null>(null);
  const runtime: DockerRuntime | undefined = data?.dockerRuntime;

  const projects = useMemo(() => Array.from(new Set((runtime?.containers || []).map((item) => item.project).filter(Boolean) as string[])).sort(), [runtime]);
  const containers = useMemo(() => (runtime?.containers || []).filter((container) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [container.name, container.image, container.project, ...container.ports].some((value) => value?.toLowerCase().includes(needle));
    return matchesSearch && (stateFilter === 'all' || container.state === stateFilter) && (projectFilter === 'all' || container.project === projectFilter);
  }), [projectFilter, runtime, search, stateFilter]);

  const openLogs = (container: DockerContainer) => {
    setLogsTarget(container);
    void loadLogs({ variables: { id: container.id, tail: 100 } });
  };

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const metrics = [
    { label: 'Containers', value: runtime?.total || 0 },
    { label: 'Running', value: runtime?.running || 0, tone: 'text-status-merged' },
    { label: 'Stopped', value: runtime?.stopped || 0 },
    { label: 'Images', value: runtime?.images || 0, tone: 'text-accent' },
  ];

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Docker services</h1><p className="mt-1 text-pretty text-secondary-foreground">Read-only container inventory from {runtime?.serverName || 'the Docker host'}{runtime?.engineVersion ? ` · Engine ${runtime.engineVersion}` : ''}. Auto-refreshes every {refreshSeconds} seconds.</p></div>
        <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh inventory</Button>
      </PageHeader>

      <section className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3" aria-label="Docker summary">
        {metrics.map((metric) => <Card key={metric.label}><strong className={cn('font-display text-3xl tabular-nums', metric.tone)}>{metric.value}</strong><div className="text-xs text-muted-foreground">{metric.label}</div></Card>)}
      </section>

      {(error || runtime?.error) && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{runtime?.error || error?.message}</Card>}

      <Card className="mb-4 grid grid-cols-[minmax(220px,1fr)_180px_220px] gap-3 max-[760px]:grid-cols-1">
        <label className="relative"><span className="sr-only">Search containers</span><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, image, project, or port" /></label>
        <Select value={stateFilter} onValueChange={setStateFilter} aria-label="Filter by container state" options={[{ value: 'all', label: 'All states' }, { value: 'running', label: 'Running' }, { value: 'exited', label: 'Exited' }, { value: 'paused', label: 'Paused' }, { value: 'restarting', label: 'Restarting' }]} />
        <Select value={projectFilter} onValueChange={setProjectFilter} aria-label="Filter by Compose project" options={[{ value: 'all', label: 'All projects' }, ...projects.map((project) => ({ value: project, label: project }))]} />
      </Card>

      <Card className="overflow-hidden p-0">
        <PhoneCards>
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="bg-surface-1 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Container</th><th className="px-4 py-3 font-medium">Image</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Ports</th><th className="px-4 py-3 font-medium">Uptime</th><th className="px-4 py-3 font-medium">CPU</th><th className="px-4 py-3 font-medium">Memory</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
            <tbody>
              {containers.map((container) => <tr className="border-t border-border hover:bg-surface-1" key={container.id}>
                <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className={cn('size-2.5 shrink-0 rounded-full', dockerStatusTone(container.state))} aria-hidden="true" /><span className="min-w-0"><strong className="block max-w-[220px] truncate font-display">{container.name}</strong><small className="font-mono text-[0.65rem] text-muted-foreground">{container.project || 'standalone'}</small></span></div></td>
                <td className="max-w-[250px] px-4 py-3 font-mono text-xs"><span className="block truncate" title={container.image}>{container.image}</span></td>
                <td className="px-4 py-3"><span className="block font-mono text-xs font-bold uppercase">{container.state}</span><small className="block max-w-[180px] truncate text-muted-foreground" title={container.status}>{container.status}</small></td>
                <td className="px-4 py-3 font-mono text-[0.68rem] text-muted-foreground">{container.ports.length ? container.ports.map((port) => <span className="block whitespace-nowrap" key={port}>{port}</span>) : '—'}</td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums">{container.uptime}</td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums">{container.cpuPercent == null ? '—' : `${container.cpuPercent.toFixed(2)}%`}</td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums">{formatBytes(container.memoryUsageBytes)}{container.memoryPercent != null ? <small className="ml-1 text-muted-foreground">({container.memoryPercent.toFixed(1)}%)</small> : null}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1"><IconButton variant="ghost" aria-label={`Inspect ${container.name}`} title="Inspect metadata" onClick={() => setInspectTarget(container)}><Eye size={15} aria-hidden="true" /></IconButton><IconButton variant="ghost" aria-label={`View logs for ${container.name}`} title="View last 100 log lines" onClick={() => openLogs(container)}><Terminal size={15} aria-hidden="true" /></IconButton></div></td>
              </tr>)}
            </tbody>
          </table>
        </PhoneCards>
        {containers.length === 0 && <div className="py-12 text-center"><Box className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="text-pretty text-sm text-muted-foreground">{runtime?.available ? 'No containers match these filters.' : 'Docker inventory is unavailable.'}</p></div>}
      </Card>

      <p className="mt-3 text-right font-mono text-[0.68rem] text-muted-foreground tabular-nums">Last refreshed {runtime?.refreshedAt ? new Date(runtime.refreshedAt).toLocaleString('en-GB') : '—'}</p>

      <Dialog open={Boolean(inspectTarget)} onClose={() => setInspectTarget(null)} labelledBy="docker-inspect-title" describedBy="docker-inspect-description">
        <Card className="w-[min(680px,calc(100vw-2rem))] p-0 shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5"><div><h2 id="docker-inspect-title" className="text-balance font-display text-xl font-bold">Container metadata</h2><p id="docker-inspect-description" className="mt-1 text-pretty text-sm text-muted-foreground">Read-only details reported by Docker.</p></div><IconButton variant="ghost" aria-label="Close container metadata" onClick={() => setInspectTarget(null)}><X size={18} aria-hidden="true" /></IconButton></div>
          {inspectTarget && <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-3 p-5 text-sm max-[520px]:grid-cols-1 max-[520px]:gap-y-1">{[
            ['Name', inspectTarget.name], ['Container ID', inspectTarget.id], ['Project', inspectTarget.project || 'standalone'], ['Image', inspectTarget.image], ['Command', inspectTarget.command || '—'], ['State', inspectTarget.state], ['Created', new Date(inspectTarget.createdAt).toLocaleString('en-GB')], ['Ports', inspectTarget.ports.join('\n') || '—'],
          ].map(([label, value]) => <div className="contents" key={label}><dt className="font-medium text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-all font-mono text-xs">{value}</dd></div>)}</dl>}
        </Card>
      </Dialog>

      <Dialog open={Boolean(logsTarget)} onClose={() => setLogsTarget(null)} labelledBy="docker-logs-title" describedBy="docker-logs-description">
        <Card className="w-[min(900px,calc(100vw-2rem))] p-0 shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5"><div><h2 id="docker-logs-title" className="text-balance font-display text-xl font-bold">{logsTarget?.name} logs</h2><p id="docker-logs-description" className="mt-1 text-pretty text-sm text-muted-foreground">The latest 100 stdout and stderr lines. Output is capped at 128 KB.</p></div><IconButton variant="ghost" aria-label="Close container logs" onClick={() => setLogsTarget(null)}><X size={18} aria-hidden="true" /></IconButton></div>
          <div className="p-5">{logsLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading logs...</div> : logsError ? <p className="text-pretty text-sm text-status-conflict" role="alert">{logsError.message}</p> : <pre className="max-h-[60vh] overflow-auto rounded-sm border border-border bg-background p-4 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-secondary-foreground">{logsData?.dockerContainerLogs || 'No logs returned.'}</pre>}</div>
        </Card>
      </Dialog>
    </Page>
  );
};

export default DockerServicesPage;
