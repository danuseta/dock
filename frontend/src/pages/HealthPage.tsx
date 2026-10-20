import { useQuery } from '@apollo/client';
import { RefreshCw } from 'lucide-react';
import { GET_DOCTOR_REPORTS } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { RackScene } from '../components/empty/scenes/RackScene';
import { Badge, Button, Card, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { reportAge } from '../lib/sousReport';
import { STALE_HOURS, groupChecks, isStale, workspaceReport, type DoctorReport } from '../lib/doctorReport';

const PUSH_COMMAND = 'node doctor.cjs --push';

/** The latest doctor report of the workspace: what the kit needs on it, and whether it is there. */
const HealthPage = () => {
  const { data, loading, error, refetch } = useQuery(GET_DOCTOR_REPORTS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000 });

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const report = workspaceReport((data?.doctorReports || []) as DoctorReport[]);
  const failing = report ? report.checks.filter((check) => !check.ok).length : 0;
  const stale = report ? isStale(report.at) : false;

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Health</h1><p className="mt-1 text-pretty text-secondary-foreground">What the workspace doctor found the last time it ran: rtk, ffmpeg, the DOCK config, hooks, Playwright and the demo bucket.</p></div>
        <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}

      {!report ? (
        <Card><EmptyState scene={<RackScene />} title="No report yet" description={<>Run <code className="font-mono">{PUSH_COMMAND}</code> from the kit on the workspace; its report shows here.</>} /></Card>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="min-w-0">
              <span className="font-mono text-sm font-extrabold">{report.machine}</span>
              <small className="ml-2 font-mono text-[0.7rem] text-muted-foreground">{[report.host, report.os, report.kitVersion ? `kit ${report.kitVersion}` : null].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={failing ? 'danger' : 'success'}>{failing ? `${failing} of ${report.checks.length} not ok` : 'All ok'}</Badge>
              <Badge variant={stale ? 'warn' : 'neutral'} title={new Date(report.at).toLocaleString('en-GB')}>checked {reportAge(report.at)}{stale ? ' · stale' : ''}</Badge>
            </span>
          </div>
          {stale && <p className="border-b border-border px-4 py-2 text-pretty text-xs text-status-warn">The report is older than {STALE_HOURS} hours. Run <code className="font-mono">{PUSH_COMMAND}</code> on the workspace to update it.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="bg-surface-1 text-xs text-muted-foreground">
                <tr><th className="w-[140px] px-4 py-2.5 font-medium">Check</th><th className="w-[90px] px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Detail</th></tr>
              </thead>
              {groupChecks(report.checks).map((group) => (
                <tbody key={group.name}>
                  <tr><th colSpan={3} scope="colgroup" className="border-t border-border bg-surface-0 px-4 py-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{group.name}</th></tr>
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
          </div>
        </Card>
      )}
    </Page>
  );
};

export default HealthPage;
