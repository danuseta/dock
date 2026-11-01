import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { RefreshCw } from 'lucide-react';
import { GET_DOCTOR_REPORTS } from '../graphql/queries';
import { REQUEST_DOCTOR_RUN } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { RackScene } from '../components/empty/scenes/RackScene';
import { Badge, Button, Card, Page, PageHeader, PhoneCards } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { reportAge } from '../lib/sousReport';
import { STALE_HOURS, groupChecks, isStale, workspaceReport, type DoctorReport } from '../lib/doctorReport';

const PUSH_COMMAND = 'node doctor.cjs --push';
const RUN_POLL_MS = 3000;
const RUN_TIMEOUT_MS = 90000;

/** The latest doctor report of the workspace: what the kit needs on it, and whether it is there. */
const HealthPage = () => {
  const { data, loading, error, refetch } = useQuery(GET_DOCTOR_REPORTS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000 });
  const [requestRun] = useMutation(REQUEST_DOCTOR_RUN);
  // Refresh asks the workspace bridge to run the doctor; it is done when a report with a new receivedAt arrives.
  const [running, setRunning] = useState<{ before: string | null } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const report = workspaceReport((data?.doctorReports || []) as DoctorReport[]);
  const receivedAt = report?.receivedAt ?? null;

  useEffect(() => {
    if (running && receivedAt !== running.before) setRunning(null);
  }, [running, receivedAt]);

  useEffect(() => {
    if (!running) return undefined;
    const poll = setInterval(() => void refetch(), RUN_POLL_MS);
    const giveUp = setTimeout(() => {
      setRunning(null);
      setRunError(`The workspace sent no new report within ${RUN_TIMEOUT_MS / 1000} seconds. Is its DOCK chat bridge running?`);
    }, RUN_TIMEOUT_MS);
    return () => { clearInterval(poll); clearTimeout(giveUp); };
  }, [running, refetch]);

  const runDoctor = () => {
    setRunError(null);
    setRunning({ before: receivedAt });
    requestRun({ variables: { machine: 'workspace' } }).catch((e: Error) => { setRunning(null); setRunError(e.message); });
  };

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const failing = report ? report.checks.filter((check) => !check.ok).length : 0;
  const stale = report ? isStale(report.at) : false;

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Health</h1><p className="mt-1 text-pretty text-secondary-foreground">What the workspace doctor found the last time it ran: rtk, ffmpeg, the DOCK config, hooks, Playwright and the demo bucket.</p></div>
        <Button onClick={runDoctor} disabled={Boolean(running)}><RefreshCw size={16} className={cn(running && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />{running ? 'Running doctor' : 'Refresh'}</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}
      {runError && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{runError}</Card>}

      {!report ? (
        <Card><EmptyState scene={<RackScene />} title="No report yet" description={<>Run <code className="font-mono">{PUSH_COMMAND}</code> from the kit on the workspace; its report shows here.</>} /></Card>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="min-w-0">
              <span className="font-mono text-sm font-extrabold">{report.machine}</span>
              <small className="ml-2 font-mono text-[0.7rem] text-muted-foreground max-[760px]:text-xs">{[report.host, report.os, report.kitVersion ? `kit ${report.kitVersion}` : null].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={failing ? 'danger' : 'success'}>{failing ? `${failing} of ${report.checks.length} not ok` : 'All ok'}</Badge>
              <Badge variant={stale ? 'warn' : 'neutral'} title={new Date(report.at).toLocaleString('en-GB')}>checked {reportAge(report.at)}{stale ? ' · stale' : ''}</Badge>
            </span>
          </div>
          {stale && <p className="border-b border-border px-4 py-2 text-pretty text-xs text-status-warn">The report is older than {STALE_HOURS} hours. Run <code className="font-mono">{PUSH_COMMAND}</code> on the workspace to update it.</p>}
          <PhoneCards>
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="bg-surface-1 text-xs text-muted-foreground">
                <tr><th className="w-[140px] px-4 py-2.5 font-medium">Check</th><th className="w-[90px] px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Detail</th></tr>
              </thead>
              {groupChecks(report.checks).map((group) => (
                <tbody key={group.name}>
                  <tr><th colSpan={3} scope="colgroup" className="border-t border-border bg-surface-0 px-4 py-1.5 font-mono text-[0.66rem] font-semibold uppercase max-[760px]:text-xs tracking-[0.08em] text-muted-foreground">{group.name}</th></tr>
                  {group.checks.map((check) => (
                    <tr key={check.name} className={cn('border-t border-border', !check.ok && 'bg-status-conflict-bg')}>
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{check.name}</td>
                      <td className={cn('px-4 py-2 text-xs font-semibold', check.ok ? 'text-status-merged' : 'text-status-conflict')}>{check.ok ? 'ok' : 'not ok'}</td>
                      <td className={cn('break-words px-4 py-2 text-xs', check.ok ? 'text-secondary-foreground' : 'text-status-conflict')}>{check.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </PhoneCards>
        </Card>
      )}
    </Page>
  );
};

export default HealthPage;
