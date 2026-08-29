import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Activity, ExternalLink, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { GET_MONITORS } from '../graphql/queries';
import { ADD_MONITOR, CHECK_MONITORS, REMOVE_MONITOR, UPDATE_MONITOR } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Card, Dialog, IconButton, Input, Page, PageHeader } from '../components/ui';
import { cn } from '../lib/cn';
import { DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS, normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';

interface MonitorTarget {
  id: string;
  name: string;
  url: string;
  expectedStatus: number;
  timeoutMs: number;
  lastStatus?: string | null;
  lastStatusCode?: number | null;
  lastLatencyMs?: number | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

interface MonitorEditor {
  id?: string;
  name: string;
  url: string;
  expectedStatus: number;
  timeoutMs: number;
}

const createEmptyMonitor = (): MonitorEditor => ({ name: '', url: '', expectedStatus: 200, timeoutMs: 5000 });

const statusTone = (status?: string | null) => status === 'UP'
  ? { dot: 'bg-status-merged', text: 'text-status-merged' }
  : status === 'DOWN'
    ? { dot: 'bg-status-conflict', text: 'text-status-conflict' }
    : { dot: 'bg-muted-foreground', text: 'text-muted-foreground' };

const metricTones = ['text-accent', 'text-status-merged', 'text-status-conflict', 'text-muted-foreground'];

const MonitoringPage: React.FC = () => {
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS);
  const { data, loading, error, refetch } = useQuery(GET_MONITORS, {
    variables: { refresh: true },
    pollInterval: refreshSeconds * 1000,
    fetchPolicy: 'cache-and-network',
  });
  const [addMonitor, { loading: adding }] = useMutation(ADD_MONITOR);
  const [updateMonitor, { loading: updating }] = useMutation(UPDATE_MONITOR);
  const [removeMonitor, { loading: removing }] = useMutation(REMOVE_MONITOR);
  const [checkMonitors, { loading: checking }] = useMutation(CHECK_MONITORS);
  const [editor, setEditor] = useState<MonitorEditor | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MonitorTarget | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setRefreshSeconds(normalizeServiceHealthRefreshSeconds(data?.settings?.serviceHealthRefreshSeconds));
  }, [data?.settings?.serviceHealthRefreshSeconds]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setActionError('');
    const input = { name: editor.name, url: editor.url, expectedStatus: editor.expectedStatus, timeoutMs: editor.timeoutMs };

    try {
      if (editor.id) await updateMonitor({ variables: { id: editor.id, input } });
      else await addMonitor({ variables: { input } });
      setEditor(null);
      await refetch({ refresh: true });
    } catch (saveError: any) {
      setActionError(saveError.message || 'Failed to save service');
    }
  };

  const handleRefresh = async () => {
    setActionError('');
    try {
      await checkMonitors();
      await refetch({ refresh: false });
    } catch (refreshError: any) {
      setActionError(refreshError.message || 'Failed to refresh services');
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setActionError('');
    try {
      await removeMonitor({ variables: { id: removeTarget.id } });
      setRemoveTarget(null);
      await refetch({ refresh: false });
    } catch (removeError: any) {
      setActionError(removeError.message || 'Failed to remove service');
    }
  };

  if (loading && !data) return <Page width="wide"><LoadingSkeleton /></Page>;

  const monitors: MonitorTarget[] = data?.monitors || [];
  const up = monitors.filter((monitor) => monitor.lastStatus === 'UP').length;
  const down = monitors.filter((monitor) => monitor.lastStatus === 'DOWN').length;
  const metrics = [
    { label: 'Services', value: monitors.length }, { label: 'Up', value: up },
    { label: 'Down', value: down }, { label: 'Unchecked', value: monitors.length - up - down },
  ];
  const isSaving = adding || updating;

  return (
    <Page width="wide">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">Services</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">HTTP(S) health checks refresh every {refreshSeconds} seconds. Change the interval in System Settings.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleRefresh} disabled={checking}><RefreshCw size={16} className={cn(checking && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{checking ? 'Checking...' : 'Check now'}</Button>
          <Button variant="primary" onClick={() => { setActionError(''); setEditor(createEmptyMonitor()); }}><Plus size={16} aria-hidden="true" /> Add service</Button>
        </div>
      </PageHeader>

      <section className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3" aria-label="Service summary">
        {metrics.map((item, index) => <Card key={item.label}><strong className={cn('font-display text-3xl tabular-nums', metricTones[index])}>{item.value}</strong><div className="text-xs text-muted-foreground">{item.label}</div></Card>)}
      </section>

      {(error || actionError) && !editor && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">{actionError || error?.message}</Card>}

      {monitors.length === 0 ? <Card className="py-10 text-center"><Activity size={34} className="mx-auto mb-2.5 text-muted-foreground" aria-hidden="true" /><p className="text-pretty text-muted-foreground">No services yet.</p><Button variant="primary" className="mt-4" onClick={() => setEditor(createEmptyMonitor())}><Plus size={16} aria-hidden="true" />Add your first service</Button></Card> : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-surface-1 text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 font-medium">Endpoint</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">HTTP</th><th className="px-4 py-3 font-medium">Latency</th><th className="px-4 py-3 font-medium">Last checked</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => {
                  const tone = statusTone(monitor.lastStatus);
                  return <tr className="border-t border-border hover:bg-surface-1" key={monitor.id}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={cn('size-2.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" /><strong className="font-display">{monitor.name}</strong></div>{monitor.lastError && <p className="mt-1 max-w-[240px] truncate text-xs text-status-conflict" title={monitor.lastError}>{monitor.lastError}</p>}</td>
                    <td className="max-w-[320px] px-4 py-3"><a className="flex items-center gap-1.5 font-mono text-xs text-accent hover:underline" href={monitor.url} target="_blank" rel="noreferrer"><span className="truncate">{monitor.url}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></a></td>
                    <td className={cn('px-4 py-3 font-mono text-xs font-bold', tone.text)}>{monitor.lastStatus || 'UNKNOWN'}</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{monitor.lastStatusCode || '—'} / {monitor.expectedStatus}</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{monitor.lastLatencyMs == null ? '—' : `${monitor.lastLatencyMs} ms`}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).toLocaleString('en-US') : 'Not checked'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><IconButton variant="ghost" aria-label={`Edit ${monitor.name}`} title="Edit service" onClick={() => { setActionError(''); setEditor({ id: monitor.id, name: monitor.name, url: monitor.url, expectedStatus: monitor.expectedStatus, timeoutMs: monitor.timeoutMs }); }}><Pencil size={15} aria-hidden="true" /></IconButton><IconButton variant="ghost" className="text-status-conflict" aria-label={`Remove ${monitor.name}`} title="Remove service" onClick={() => { setActionError(''); setRemoveTarget(monitor); }}><Trash2 size={15} aria-hidden="true" /></IconButton></div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={Boolean(editor)} onClose={() => !isSaving && setEditor(null)} dismissible={!isSaving} labelledBy="service-editor-title" describedBy="service-editor-description">
        <Card className="w-[min(560px,calc(100vw-2rem))] p-0 shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div><h2 id="service-editor-title" className="text-balance font-display text-xl font-bold">{editor?.id ? 'Edit service' : 'Add service'}</h2><p id="service-editor-description" className="mt-1 text-pretty text-sm text-muted-foreground">Configure the health endpoint and expected response.</p></div>
            <IconButton variant="ghost" aria-label="Close service form" onClick={() => setEditor(null)} disabled={isSaving}><X size={18} aria-hidden="true" /></IconButton>
          </div>
          {editor && <form className="flex flex-col gap-4 p-5" onSubmit={handleSave}>
            <label><span className="mb-1.5 block text-sm font-medium">Service name</span><Input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="Portfolio" maxLength={80} autoFocus required /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Health check URL</span><Input className="font-mono" value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} placeholder="https://service.example/health" type="url" required /></label>
            <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
              <label><span className="mb-1.5 block text-sm font-medium">Expected HTTP status</span><Input type="number" min={100} max={599} value={editor.expectedStatus} onChange={(event) => setEditor({ ...editor, expectedStatus: Number(event.target.value) })} required /></label>
              <label><span className="mb-1.5 block text-sm font-medium">Timeout (milliseconds)</span><Input type="number" min={500} max={15000} step={500} value={editor.timeoutMs} onChange={(event) => setEditor({ ...editor, timeoutMs: Number(event.target.value) })} required /></label>
            </div>
            {actionError && <p className="text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-4"><Button onClick={() => setEditor(null)} disabled={isSaving}>Cancel</Button><Button type="submit" variant="primary" disabled={isSaving}>{isSaving ? 'Saving...' : editor.id ? 'Save changes' : 'Add service'}</Button></div>
          </form>}
        </Card>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onClose={() => !removing && setRemoveTarget(null)} dismissible={!removing} labelledBy="remove-service-title" describedBy="remove-service-description">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <h2 id="remove-service-title" className="text-balance font-display text-xl font-bold">Remove service?</h2>
          <p id="remove-service-description" className="mt-2 text-pretty text-sm text-muted-foreground">{removeTarget?.name} and its health history will be removed from JIDIS.</p>
          {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Button><Button variant="danger" onClick={handleRemove} disabled={removing}>{removing ? 'Removing...' : 'Remove service'}</Button></div>
        </Card>
      </Dialog>
    </Page>
  );
};

export default MonitoringPage;
