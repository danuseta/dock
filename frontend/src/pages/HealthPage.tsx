import { useQuery } from '@apollo/client';
import { Check, RefreshCw, X } from 'lucide-react';
import { GET_DOCTOR_REPORTS } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { RackScene } from '../components/empty/scenes/RackScene';
import { Badge, Button, Card, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { reportAge } from '../lib/sousReport';

interface DoctorReport {
  machine: string;
  host: string;
  os: string;
  at: string;
  receivedAt: string;
  kitVersion?: string | null;
  checks: Array<{ name: string; ok: boolean; detail?: string | null }>;
}

/** The latest doctor report of each machine: what the kit needs on it, and whether it is there. */
const HealthPage = () => {
  const { data, loading, error, refetch } = useQuery(GET_DOCTOR_REPORTS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000 });

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const reports: DoctorReport[] = data?.doctorReports || [];

  return (
    <Page width="full">
      <PageHeader>
        <div><h1 className="text-balance font-display text-3xl font-black">Health</h1><p className="mt-1 text-pretty text-secondary-foreground">What each machine's doctor found the last time it ran: rtk, ffmpeg, the DOCK config, hooks, Playwright and the demo bucket.</p></div>
        <Button onClick={() => void refetch()} disabled={loading}><RefreshCw size={16} className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</Button>
      </PageHeader>

      {error && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{error.message}</Card>}

      {reports.length === 0 ? (
        <Card><EmptyState scene={<RackScene />} title="No report yet" description={<>Run <code className="font-mono">node doctor.cjs</code> from the kit on a machine; its report shows here.</>} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 max-[1000px]:grid-cols-1">
          {reports.map((report) => {
            const failing = report.checks.filter((check) => !check.ok).length;
            return (
              <Card key={report.machine} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <span className="min-w-0">
                    <span className="font-mono text-sm font-extrabold">{report.machine}</span>
                    <small className="block truncate font-mono text-[0.68rem] text-muted-foreground" title={new Date(report.at).toLocaleString('en-GB')}>
                      {[report.host, report.os, report.kitVersion ? `kit ${report.kitVersion}` : null, `checked ${reportAge(report.at)}`].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <Badge variant={failing ? 'danger' : 'success'}>{failing ? `${failing} not ok` : 'All ok'}</Badge>
                </div>
                <ul className="flex flex-col">
                  {report.checks.map((check) => (
                    <li key={check.name} className="grid grid-cols-[20px_120px_minmax(0,1fr)] items-baseline gap-2 border-b border-border px-4 py-1.5 text-sm last:border-b-0">
                      {check.ok ? <Check size={14} className="text-status-merged" aria-hidden="true" /> : <X size={14} className="text-status-conflict" aria-hidden="true" />}
                      <span className="font-mono text-xs font-semibold"><span className="sr-only">{check.ok ? 'ok: ' : 'not ok: '}</span>{check.name}</span>
                      <span className={cn('min-w-0 break-words text-xs', check.ok ? 'text-muted-foreground' : 'text-status-conflict')}>{check.detail || (check.ok ? 'ok' : 'not ok')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
};

export default HealthPage;
