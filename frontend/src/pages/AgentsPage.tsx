import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Bot, Building2, ExternalLink, EyeOff, Hand, Moon, Play, Square, Table2 } from 'lucide-react';
import { GET_ORCHESTRATION, GET_ORCHESTRATIONS } from '../graphql/queries';
import { DISMISS_ORCHESTRATION } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Badge, Button, Card, Dialog, Page, PageHeader } from '../components/ui';
import { apiOrigin } from '../lib/apollo';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { STATUS_LABEL, formatAge, runStatus, stageColor, stageLabel, type AgentEvent, type AgentRun, type RunStatus } from '../agents/runs';
import { sampleRuns } from '../agents/sampleRuns';

const AgentsOffice = lazy(() => import('../components/AgentsOffice'));

interface AgentsPageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void; }

type View = 'office' | 'table';

const POLL_MS = 5000;
const sectionLabel = 'font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const statusTone: Record<RunStatus, string> = {
  waiting: 'border-amber-300/50 bg-amber-300/10 text-amber-200',
  failed: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  stalled: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  working: 'border-status-merged/40 bg-status-merged-bg text-status-merged',
  thinking: 'border-border-glow bg-surface-2 text-secondary-foreground',
  asleep: 'border-border bg-surface-2 text-muted-foreground',
  done: 'border-status-merged/40 bg-status-merged-bg text-status-merged',
};

const acTone = (state: string) => state === 'PASS'
  ? 'border-status-merged bg-status-merged-bg text-status-merged'
  : state === 'FAIL'
    ? 'border-status-conflict bg-status-conflict-bg text-status-conflict'
    : 'border-border-glow text-secondary-foreground';

const eventLabel: Record<string, string> = {
  STAGE: 'Moved to', WAITING: 'Waiting on you', RESUMED: 'Resumed', ACTIVE: 'Working', IDLE: 'Idle',
};

const StageChip: React.FC<{ stage: string }> = ({ stage }) => (
  <span className="inline-flex items-center gap-1.5 rounded-xs border border-border-glow px-2 py-0.5 font-mono text-[0.66rem] font-bold text-secondary-foreground">
    <i className="size-1.5 rounded-full" style={{ background: stageColor(stage) }} aria-hidden="true" />
    {stageLabel(stage).toUpperCase()}
  </span>
);

const StatusChip: React.FC<{ status: RunStatus }> = ({ status }) => (
  <span className={cn('inline-flex items-center rounded-xs border px-2 py-0.5 font-mono text-[0.66rem] font-bold', statusTone[status])}>{STATUS_LABEL[status]}</span>
);

const AgentsPage: React.FC<AgentsPageProps> = ({ onTicketClick, onNavigate }) => {
  const { data, loading, error, refetch } = useQuery(GET_ORCHESTRATIONS, { ...CACHED_QUERY_OPTIONS, pollInterval: POLL_MS });
  const [dismissOrchestration, { loading: dismissing }] = useMutation(DISMISS_ORCHESTRATION);
  const [view, setView] = useState<View>('office');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sampleStartedAt, setSampleStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [dismissTarget, setDismissTarget] = useState<AgentRun | null>(null);
  const [actionError, setActionError] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const serverRuns: AgentRun[] | undefined = data?.orchestrations;
  useEffect(() => { setReceivedAt(Date.now() / 1000); }, [serverRuns]);

  const sampling = sampleStartedAt !== null;
  const sampleTick = sampling ? Math.floor(now - sampleStartedAt) : 0;
  const runs = useMemo<AgentRun[]>(
    () => (sampling ? sampleRuns(sampleTick) : serverRuns || []),
    [sampling, sampleTick, serverRuns],
  );
  const selected = runs.find((run) => run.key === selectedKey) || runs.find((run) => run.waiting) || runs[0] || null;

  const { data: detailData } = useQuery(GET_ORCHESTRATION, {
    ...CACHED_QUERY_OPTIONS,
    variables: { key: selected?.key },
    skip: !selected || sampling,
    pollInterval: POLL_MS * 2,
  });
  const events: AgentEvent[] = !sampling && detailData?.orchestration?.key === selected?.key ? detailData?.orchestration?.events || [] : [];

  // Ages keep counting between polls; the server only sends how old things were when it answered.
  const drift = sampling ? 0 : Math.max(0, now - receivedAt);
  const statusOf = (run: AgentRun) => runStatus({ ...run, idleSeconds: run.idleSeconds + drift }, now);
  const active = runs.filter((run) => run.stage !== 'done');
  const metrics = [
    { label: 'Tickets with an agent', value: active.length, className: 'text-accent' },
    { label: 'Waiting on you', value: active.filter((run) => run.waiting).length, className: 'text-amber-200' },
    { label: 'Working now', value: active.filter((run) => statusOf(run) === 'working').length, className: 'text-status-merged' },
    { label: 'Stalled or failed', value: active.filter((run) => run.stalled || run.acFailed > 0).length, className: 'text-status-conflict' },
  ];

  const handleDismiss = async () => {
    if (!dismissTarget) return;
    setActionError('');
    try {
      await dismissOrchestration({ variables: { key: dismissTarget.key } });
      setDismissTarget(null);
      setSelectedKey(null);
      await refetch();
    } catch (dismissError: any) {
      setActionError(dismissError.message || 'Failed to hide this run');
    }
  };

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const empty = runs.length === 0;

  return (
    <Page width="full">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">Agents</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">Where each ticket's agent is working, and which ones are waiting on you.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sampling && <Badge variant="draft" className="border-dashed">SAMPLE DATA</Badge>}
          <div className="flex rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="View">
            {([['office', 'Office', Building2], ['table', 'Table', Table2]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={cn('flex h-8 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', view === id && 'bg-accent text-black')}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={14} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          {sampling
            ? <Button size="sm" onClick={() => { setSampleStartedAt(null); setSelectedKey(null); }}><Square size={14} aria-hidden="true" />Stop sample</Button>
            : (serverRuns || []).length === 0 && <Button size="sm" variant="primary" onClick={() => { setSampleStartedAt(Date.now() / 1000); setSelectedKey('SAMPLE-2'); }}><Play size={14} aria-hidden="true" />Run a sample</Button>}
        </div>
      </PageHeader>

      {error && !data && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Agent runs failed to load: {error.message}</Card>}

      <section className="mb-4 grid grid-cols-4 overflow-hidden rounded-md border border-border bg-surface-1 max-[700px]:grid-cols-2 [&>div]:border-r [&>div]:border-border [&>div:last-child]:border-r-0 max-[700px]:[&>div:nth-child(2)]:border-r-0 max-[700px]:[&>div:nth-child(-n+2)]:border-b" aria-label="Agent overview">
        {metrics.map((metric) => (
          <div className="p-[18px]" key={metric.label}>
            <strong className={cn('block font-display text-[1.55rem] leading-none font-extrabold tabular-nums', metric.className)}>{metric.value}</strong>
            <span className="mt-[7px] block text-[0.68rem] text-muted-foreground">{metric.label}</span>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4 max-[1120px]:grid-cols-1">
        <Card className="p-0">
          {view === 'office' ? (
            <div className="relative">
              <Suspense fallback={<div className="grid h-[600px] place-items-center text-sm text-muted-foreground max-[900px]:h-[420px]" role="status">Opening the office...</div>}>
                <AgentsOffice className="h-[600px] max-[900px]:h-[420px]" runs={runs} selectedKey={selected?.key || null} onSelect={setSelectedKey} />
              </Suspense>
              <div className="pointer-events-none absolute bottom-3 left-3.5 flex flex-wrap gap-x-3.5 gap-y-1 rounded-[8px] border border-border bg-[rgb(12_12_12/0.78)] px-[11px] py-[7px] font-mono text-[0.7rem] font-semibold text-secondary-foreground">
                <span className="flex items-center gap-1.5"><Hand size={12} className="text-amber-200" aria-hidden="true" />raised hand = waiting on you</span>
                <span className="flex items-center gap-1.5"><Moon size={12} aria-hidden="true" />zzz = no activity</span>
              </div>
              <div className="pointer-events-none absolute top-3 right-3.5 rounded-[8px] border border-border bg-[rgb(12_12_12/0.7)] px-2.5 py-1.5 font-mono text-[0.7rem] text-muted-foreground max-[900px]:hidden">drag to orbit · scroll to zoom · click a character or card</div>
              {empty && (
                <div className="absolute inset-x-0 top-1/2 mx-auto w-[min(440px,calc(100%-2rem))] -translate-y-1/2 rounded-md border border-border bg-[rgb(12_12_12/0.9)] p-5 text-center">
                  <Bot size={28} className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                  <p className="font-display font-bold">The office is empty</p>
                  <p className="mt-1 text-pretty text-sm text-muted-foreground">No ticket has reported in yet. Create an ingest token, then let the orchestrator on your laptop push its ticket status here.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => onNavigate('/settings')}>Open System Settings</Button>
                    <Button size="sm" onClick={() => { setSampleStartedAt(Date.now() / 1000); setSelectedKey('SAMPLE-2'); }}><Play size={14} aria-hidden="true" />Run a sample</Button>
                  </div>
                </div>
              )}
            </div>
          ) : empty ? (
            <div className="py-12 text-center"><Bot size={34} className="mx-auto mb-2.5 text-muted-foreground" aria-hidden="true" /><p className="text-pretty text-muted-foreground">No ticket has reported in yet.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-surface-1 text-xs text-muted-foreground">
                  <tr><th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Stage</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">AC</th><th className="px-4 py-3 font-medium">Waiting on you</th><th className="px-4 py-3 font-medium">Last activity</th></tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.key} className={cn('cursor-pointer border-t border-border hover:bg-surface-1', selected?.key === run.key && 'bg-surface-1')} onClick={() => setSelectedKey(run.key)}>
                      <td className="px-4 py-3"><button type="button" className="border-0 bg-transparent p-0 text-left" onClick={() => setSelectedKey(run.key)}><span className="font-mono text-xs font-extrabold text-accent">{run.key}</span><span className="mt-0.5 block max-w-[320px] truncate text-[0.8rem] text-foreground">{run.title || 'Untitled'}</span></button></td>
                      <td className="px-4 py-3"><StageChip stage={run.stage} /></td>
                      <td className="px-4 py-3"><StatusChip status={statusOf(run)} /></td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">{run.acPassed}/{run.acTotal}{run.acFailed > 0 && <span className="ml-1.5 text-status-conflict">{run.acFailed} failed</span>}</td>
                      <td className="max-w-[280px] px-4 py-3 text-xs text-secondary-foreground"><span className="line-clamp-2">{run.waiting || '—'}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{formatAge(run.idleSeconds + drift)} ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="flex max-h-[600px] flex-col gap-3.5 overflow-y-auto bg-surface-0 p-[18px] max-[1120px]:max-h-none" aria-live="polite">
          {!selected ? (
            <p className="text-pretty text-sm text-muted-foreground">Select a character, a wall card or a table row to see that ticket's run.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xs border border-accent/30 bg-accent-dim px-[9px] py-[3px] font-mono text-sm font-extrabold text-accent">{selected.key}</span>
                <StageChip stage={selected.stage} />
                <StatusChip status={statusOf(selected)} />
              </div>
              <h2 className="text-pretty font-display text-base leading-snug font-bold">{selected.title || 'Untitled'}</h2>

              {selected.waiting && (
                <div className="rounded-[8px] border border-amber-300/50 bg-amber-300/10 px-3 py-2.5 text-sm">
                  <b className="mb-0.5 block font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-amber-200">Waiting on you</b>
                  <span className="text-pretty">{selected.waiting}</span>
                  <p className="mt-1.5 text-pretty text-xs text-muted-foreground">Answer in the Claude Code session on your laptop. DOCK only shows the gate.</p>
                </div>
              )}

              <div className="rounded-[8px] border border-border bg-surface-1 px-3 py-2.5">
                <p className={cn(sectionLabel, 'mb-1.5')}>Activity</p>
                <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
                  <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">State</dt>
                  <dd>{selected.activity === 'ACTIVE' ? `Active${selected.activityDetail ? ` · ${selected.activityDetail}` : ''}` : selected.activity === 'WAITING' ? 'Waiting' : 'Idle'}</dd>
                  <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Last event</dt>
                  <dd className="tabular-nums">{formatAge(selected.idleSeconds + drift)} ago</dd>
                  {selected.gate && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Gate</dt><dd>{selected.gate}</dd></>}
                  {selected.stalled && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Stalled</dt><dd className="text-status-conflict">No activity past the stale limit</dd></>}
                </dl>
              </div>

              <div>
                <p className={cn(sectionLabel, 'mb-1')}>Acceptance criteria · {selected.acPassed}/{selected.acTotal}</p>
                {selected.ac.length === 0 && <p className="text-sm text-muted-foreground">No acceptance criteria recorded yet.</p>}
                {selected.ac.map((item) => (
                  <div className="grid grid-cols-[46px_1fr] gap-[9px] border-b border-border py-1.5 text-[0.82rem] last:border-b-0" key={item.n}>
                    <span className={cn('h-fit rounded-xs border py-0.5 text-center font-mono text-[0.62rem] font-extrabold', acTone(item.state))}>{item.state}</span>
                    <span className="min-w-0"><span className="text-pretty">{item.text || `AC ${item.n}`}</span>{item.evidence && <span className="mt-0.5 block break-all font-mono text-[0.68rem] text-muted-foreground">{item.evidence}</span>}</span>
                  </div>
                ))}
              </div>

              {(selected.testsBe || selected.testsFe || selected.prBe || selected.prFe || selected.note) && (
                <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
                  {selected.testsBe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests BE</dt><dd className="break-words">{selected.testsBe}</dd></>}
                  {selected.testsFe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests FE</dt><dd className="break-words">{selected.testsFe}</dd></>}
                  {[['PR BE', selected.prBe], ['PR FE', selected.prFe]].map(([label, url]) => url && (
                    <React.Fragment key={label}><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">{label}</dt><dd className="min-w-0"><a className="flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={url} target="_blank" rel="noreferrer"><span className="truncate">{url}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></a></dd></React.Fragment>
                  ))}
                  {selected.note && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Note</dt><dd className="break-words">{selected.note}</dd></>}
                </dl>
              )}

              {events.length > 0 && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Recent events</p>
                  <ol className="flex flex-col">
                    {events.slice(0, 8).map((event) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={event.id}>
                        <span className="min-w-0 truncate"><span className="text-secondary-foreground">{eventLabel[event.kind] || event.kind}</span>{event.detail && <span className="text-foreground"> {event.kind === 'STAGE' ? stageLabel(event.detail) : event.detail}</span>}</span>
                        <time className="font-mono text-[0.68rem] text-muted-foreground tabular-nums" dateTime={event.at}>{new Date(event.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {!selected.sample && (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3.5">
                  <Button size="sm" variant="primary" onClick={() => onTicketClick(selected.key)}>Open ticket</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setActionError(''); setDismissTarget(selected); }}><EyeOff size={14} aria-hidden="true" />Hide run</Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border bg-surface-0 px-5 py-2.5">
          <h2 className="font-display text-[0.95rem] font-bold">Session flow</h2>
          {selected && <span className="font-mono text-xs font-bold text-accent">{selected.key}</span>}
          <span className="text-pretty text-[0.78rem] text-muted-foreground">The Claude Code session for this ticket, with secrets masked on the laptop before upload.</span>
        </div>
        {selected?.hasTranscript && !sampling
          ? <iframe key={selected.key} className="block h-[420px] w-full border-0 bg-[#0b0b0c]" title={`Session flow for ${selected.key}`} src={`${import.meta.env.BASE_URL}zoetrope/index.html?key=${encodeURIComponent(selected.key)}&api=${encodeURIComponent(apiOrigin)}`} />
          : <p className="px-5 py-8 text-center text-pretty text-sm text-muted-foreground">{sampling ? 'Sample tickets have no session to show.' : selected ? `No session has been uploaded for ${selected.key} yet.` : 'Select a ticket to see its session.'}</p>}
      </Card>

      <Dialog open={Boolean(dismissTarget)} onClose={() => !dismissing && setDismissTarget(null)} dismissible={!dismissing} labelledBy="hide-run-title" describedBy="hide-run-description">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <h2 id="hide-run-title" className="text-balance font-display text-xl font-bold">Hide this run?</h2>
          <p id="hide-run-description" className="mt-2 text-pretty text-sm text-muted-foreground">{dismissTarget?.key} leaves the office and Needs Attention. It comes back the next time the orchestrator pushes its status.</p>
          {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setDismissTarget(null)} disabled={dismissing}>Cancel</Button><Button variant="danger" onClick={handleDismiss} disabled={dismissing}>{dismissing ? 'Hiding...' : 'Hide run'}</Button></div>
        </Card>
      </Dialog>
    </Page>
  );
};

export default AgentsPage;
