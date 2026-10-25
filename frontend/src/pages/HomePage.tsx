import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { GET_DISCORD_THREADS, GET_HOME_CORE, GET_HOME_SECONDARY, GET_OWNER_NAME, GET_OWNER_QUESTIONS } from '../graphql/queries';
import { ADD_QUICK_LINK, REMOVE_QUICK_LINK } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { WebsiteIcon } from '../components/WebsiteIcon';
import { DockerRuntimeCard } from '../components/DockerRuntimeCard';
import { AgentRunStrip } from '../components/AgentRunStrip';
import { HomeAttention, type HomeAttentionItem } from '../components/HomeAttention';
import { ticketAttention, ticketQuestions } from '../lib/attention';
import { discordAttention } from '../lib/discordThreads';
import { isArchived, type AgentRunSummary } from '../agents/runs';
import { MonthCalendar } from '../components/MonthCalendar';
import { Button, Card, Dialog, IconButton, Input, Page, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { hasPage, useDockMode } from '../lib/dockMode';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS, normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';
import type { CalendarEvent } from '../lib/calendar';

interface HomePageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void; }

const highlightColors = [
  { value: '#60a5fa', label: 'Blue' },
  { value: '#34d399', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#a78bfa', label: 'Violet' },
];
const panelClass = 'min-w-0 rounded-md border border-border bg-surface-0';
const panelHeaderClass = 'flex items-center justify-between gap-2.5 border-b border-border px-[17px] py-[15px]';
const panelTitleClass = 'text-balance font-display text-[0.82rem] font-bold';
const MY_TICKETS = 5;
const textActionClass = 'h-6 max-[760px]:h-11 border-0 px-0 py-0 text-[0.68rem] text-muted-foreground hover:border-transparent hover:bg-transparent hover:text-foreground';

const HomePage: React.FC<HomePageProps> = ({ onTicketClick, onNavigate }) => {
  const mode = useDockMode();
  const showCalendar = hasPage(mode, '/calendar');
  const showDocker = hasPage(mode, '/docker');
  const showMonitors = hasPage(mode, '/monitoring');
  const [healthRefreshSeconds, setHealthRefreshSeconds] = useState(DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS);
  const { data: coreData, loading: coreLoading, error: coreError } = useQuery(GET_HOME_CORE, CACHED_QUERY_OPTIONS);
  const { data: secondaryData, loading: secondaryLoading, error: secondaryError, refetch: refetchSecondary } = useQuery(
    GET_HOME_SECONDARY,
    { ...CACHED_QUERY_OPTIONS, variables: { calendar: showCalendar, docker: showDocker, monitors: showMonitors }, pollInterval: healthRefreshSeconds * 1000 },
  );
  const { data: ownerData } = useQuery(GET_OWNER_NAME, CACHED_QUERY_OPTIONS);
  const { data: questionsData } = useQuery(GET_OWNER_QUESTIONS, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000 });
  const { data: discordData } = useQuery(GET_DISCORD_THREADS, { ...CACHED_QUERY_OPTIONS, pollInterval: 60000, skip: !hasPage(mode, '/discord') });
  const [addQuickLink, { loading: adding }] = useMutation(ADD_QUICK_LINK, { refetchQueries: [{ query: GET_HOME_CORE }] });
  const [removeQuickLink] = useMutation(REMOVE_QUICK_LINK, { refetchQueries: [{ query: GET_HOME_CORE }] });
  const [now, setNow] = useState(new Date());
  const [healthCountdown, setHealthCountdown] = useState(DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(highlightColors[0].value);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setHealthCountdown(healthRefreshSeconds);
    const timer = window.setInterval(() => setHealthCountdown((current) => (current <= 1 ? healthRefreshSeconds : current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [healthRefreshSeconds]);

  useEffect(() => {
    setHealthRefreshSeconds(normalizeServiceHealthRefreshSeconds(secondaryData?.settings?.serviceHealthRefreshSeconds));
  }, [secondaryData?.settings?.serviceHealthRefreshSeconds]);

  const tickets = useMemo(() => (coreData?.dashboard || []).flatMap((group: any) => group.tickets || []), [coreData]);
  const activeTickets = tickets.filter((ticket: any) => !/done|merged|closed|resolved/i.test(ticket.status));
  const storyPoints = activeTickets.reduce((total: number, ticket: any) => total + (ticket.storyPoints || 0), 0);
  const monitors = secondaryData?.monitors || [];
  const healthyServices = monitors.filter((monitor: any) => monitor.lastStatus === 'UP').length;
  const calendarEvents: CalendarEvent[] = secondaryData?.calendarEvents || [];
  const attention = ticketAttention<HomeAttentionItem>([...(secondaryData?.needsAttention ?? []), ...discordAttention(discordData?.discordThreads?.rows ?? [])], ticketQuestions(questionsData?.orchestrations ?? []));
  const agentRuns: Array<AgentRunSummary & { title: string }> = (secondaryData?.orchestrations || []).filter((run: AgentRunSummary) => !isArchived(run));
  const runOf = new Map(agentRuns.map((run) => [run.key, run]));
  const titleOf = (key: string) => tickets.find((ticket: any) => ticket.key === key)?.title;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setLinkError('');
    try {
      await addQuickLink({ variables: { input: { title, url, color } } });
      setTitle(''); setUrl(''); setColor(highlightColors[0].value); setShowForm(false);
    } catch (addError: any) {
      setLinkError(addError.message || 'Failed to add quick link');
    }
  };

  const refreshHealth = async () => { setHealthCountdown(healthRefreshSeconds); await refetchSecondary(); };

  if (isInitialQueryLoading(coreLoading, coreData)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (coreError && !coreData) return <Page width="full"><div className="rounded-md border border-status-conflict bg-status-conflict-bg p-6 text-pretty text-sm text-status-conflict" role="alert">Home data failed to load: {coreError.message}</div></Page>;

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const running = agentRuns.filter((run) => run.activity === 'ACTIVE').length;
  const summary = [
    attention.length === 0 ? 'Nothing needs you' : `${attention.length} ${attention.length === 1 ? 'ticket needs' : 'tickets need'} you`,
    `${running} ${running === 1 ? 'agent' : 'agents'} running`,
    ...(showMonitors && monitors.length > 0 ? [`${healthyServices}/${monitors.length} services healthy`] : []),
  ].join(' · ');
  const showSide = showCalendar || showMonitors;
  const quickLinks = coreData?.quickLinks || [];

  return (
    <Page width="full">
      <header className="mb-6 flex items-start justify-between gap-6 max-[600px]:flex-col max-[600px]:gap-4">
        <div>
          <h1 className="text-balance font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] font-bold max-[600px]:text-[1.65rem]">{greeting}{ownerData?.ownerName ? `, ${ownerData.ownerName}` : ''}.</h1>
          <p className="mt-2 text-pretty text-secondary-foreground max-[600px]:text-[0.72rem]">{summary}</p>
        </div>
        <div className="grid flex-none justify-items-end gap-3 max-[600px]:justify-items-start">
          <div className="text-right max-[600px]:text-left">
            <strong className="block font-mono text-[clamp(1.7rem,3vw,2.25rem)] leading-none font-extrabold tabular-nums max-[600px]:text-[1.15rem]">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
            <span className="mt-2 block text-[0.72rem] text-muted-foreground max-[600px]:text-[0.6rem]">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
          <nav className="flex flex-wrap justify-end gap-1.5 max-[600px]:justify-start" aria-label="Quick links">
            {quickLinks.map((link: any) => <span className="group relative" key={link.id}><a className="grid size-8 place-items-center rounded-[7px] border border-border bg-surface-0 transition-colors duration-150 ease-out hover:border-border-glow hover:bg-surface-1 max-[760px]:size-11" href={link.url} target="_blank" rel="noreferrer" aria-label={`Open ${link.title}`} title={link.title}><WebsiteIcon title={link.title} url={link.url} /></a><button className="absolute -top-[5px] -right-[5px] grid size-[17px] place-items-center rounded-full border border-border bg-surface-2 p-0 text-status-conflict opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100" type="button" aria-label={`Remove ${link.title}`} onClick={() => removeQuickLink({ variables: { id: link.id } })}><Trash2 size={10} aria-hidden="true" /></button></span>)}
            <IconButton variant="ghost" className="size-8 rounded-[7px] border-dashed border-border max-[760px]:size-11" onClick={() => { setLinkError(''); setShowForm(true); }} aria-label="Add quick link" title="Add quick link"><Plus size={14} aria-hidden="true" /></IconButton>
          </nav>
        </div>
      </header>

      <HomeAttention rows={attention} titleOf={titleOf} panelClass={panelClass} headerClass={panelHeaderClass} titleClass={panelTitleClass} onTicketClick={onTicketClick} onNavigate={onNavigate} />

      <div className={cn('grid items-start gap-3.5 max-[900px]:grid-cols-1', showSide ? 'grid-cols-[minmax(0,1fr)_minmax(340px,380px)]' : 'grid-cols-1')}>
        <div className="grid gap-3.5">
          <article className={panelClass}>
            <header className={panelHeaderClass}>
              <h2 className={panelTitleClass}>My tickets <span className="ml-1.5 font-mono text-[0.64rem] font-medium text-muted-foreground tabular-nums">{activeTickets.length} active · {storyPoints} SP</span></h2>
              <div className="flex items-center gap-3.5"><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/dashboard')}>Board →</Button><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/agents')}>Agents →</Button></div>
            </header>
            {activeTickets.slice(0, MY_TICKETS).map((ticket: any) => {
              const run = runOf.get(ticket.key);
              return <button className="grid w-full grid-cols-[82px_minmax(0,1fr)_minmax(0,auto)_auto_auto] items-center gap-2.5 border-0 border-b border-border bg-transparent px-4 py-2.5 text-left text-foreground transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-1 max-[760px]:grid-cols-[72px_minmax(0,1fr)_auto]" key={ticket.key} onClick={() => onTicketClick(ticket.key)}><span className="font-mono text-[0.69rem] font-bold text-accent">{ticket.key}</span><span className="truncate text-[0.8rem]">{ticket.title}</span>{run ? <AgentRunStrip run={run} className="max-[760px]:col-span-3 max-[760px]:row-start-2" /> : <span className="justify-self-end rounded-xs border border-border px-2 py-1 font-mono text-[0.62rem] text-muted-foreground max-[760px]:hidden">No agent</span>}<span className="whitespace-nowrap font-mono text-[0.63rem] font-bold text-muted-foreground tabular-nums">{ticket.storyPoints || 0} SP</span><span className="whitespace-nowrap rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[0.63rem] text-secondary-foreground max-[760px]:hidden">{ticket.status}</span></button>;
            })}
            {activeTickets.length === 0 && <div className="px-4 py-5 text-[0.78rem] text-muted-foreground">No active Jira tickets.</div>}
            {activeTickets.length > MY_TICKETS && <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[0.72rem] text-muted-foreground"><span>{activeTickets.length - MY_TICKETS} more on the board</span><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/dashboard')}>Open board →</Button></div>}
          </article>

          {showDocker && <DockerRuntimeCard runtime={secondaryData?.dockerRuntime} onNavigate={onNavigate} compact loading={secondaryLoading && !secondaryData} />}
        </div>

        {showSide && <div className="grid w-full max-w-[380px] justify-self-end gap-3.5 max-[900px]:justify-self-center max-[600px]:max-w-[360px]">
          {showCalendar && <article className={cn(panelClass, 'relative z-10 overflow-visible')}>
            <header className={panelHeaderClass}><h2 className={panelTitleClass}>{monthLabel}</h2><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/calendar')}>Google Calendar →</Button></header>
            <div className="px-2.5 pt-2 pb-2.5"><MonthCalendar month={now} events={calendarEvents} /></div>
          </article>}

          {showMonitors && <article className={panelClass}>
            <header className={panelHeaderClass}><h2 className={panelTitleClass}>Service health</h2><div className="flex items-center gap-[7px]"><span className="font-mono text-[0.63rem] text-muted-foreground tabular-nums">Refresh {healthCountdown}s</span><IconButton variant="ghost" className="size-[26px] rounded-sm border-border" onClick={refreshHealth} aria-label="Refresh service health now"><RefreshCw size={13} aria-hidden="true" /></IconButton></div></header>
            {secondaryError && !secondaryData ? <div className="p-4 text-sm text-status-conflict" role="alert">Service health unavailable. <button type="button" className="underline" onClick={() => void refetchSecondary()}>Retry</button></div> : secondaryLoading && !secondaryData ? <div className="p-4 text-sm text-muted-foreground" role="status">Checking services...</div> : monitors.map((monitor: any) => <div className="flex items-center gap-[11px] border-b border-border px-[15px] py-3 last:border-b-0" key={monitor.id}><span className={cn('size-2 flex-none rounded-full bg-muted-foreground', monitor.lastStatus === 'UP' ? 'bg-status-merged' : 'bg-status-conflict')} /><span className="min-w-0 flex-1"><strong className="block truncate text-[0.75rem]">{monitor.name}</strong><small className="text-[0.68rem] text-muted-foreground">{monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : monitor.lastStatus || 'Not checked'}</small></span><span className="font-mono text-[0.68rem] text-muted-foreground tabular-nums">{monitor.lastLatencyMs == null ? '—' : `${monitor.lastLatencyMs} ms`}</span></div>)}
            {!secondaryLoading && !secondaryError && monitors.length === 0 && <button type="button" className="w-full border-0 bg-transparent p-4 text-accent" onClick={() => onNavigate('/monitoring')}>Add a service monitor</button>}
          </article>}
        </div>}
      </div>

      <Dialog open={showForm} onClose={() => !adding && setShowForm(false)} dismissible={!adding} labelledBy="quick-link-dialog-title" describedBy="quick-link-dialog-description">
        <Card className="w-[min(500px,calc(100vw-2rem))] p-0 shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5"><div><h2 id="quick-link-dialog-title" className="text-balance font-display text-xl font-bold">Add quick link</h2><p id="quick-link-dialog-description" className="mt-1 text-pretty text-sm text-muted-foreground">Add a compact shortcut to your Home page.</p></div><IconButton variant="ghost" aria-label="Close quick link form" onClick={() => setShowForm(false)} disabled={adding}><X size={18} aria-hidden="true" /></IconButton></div>
          <form className="flex flex-col gap-4 p-5" onSubmit={handleAdd}>
            <label><span className="mb-1.5 block text-sm font-medium">Label</span><Input placeholder="GitHub" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={80} autoFocus /></label>
            <label><span className="mb-1.5 block text-sm font-medium">URL</span><Input className="font-mono" placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} required type="url" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Highlight color</span><Select value={color} onValueChange={setColor} aria-label="Highlight color" options={highlightColors} /></label>
            {linkError && <p className="text-pretty text-sm text-status-conflict" role="alert">{linkError}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-4"><Button onClick={() => setShowForm(false)} disabled={adding}>Cancel</Button><Button type="submit" variant="primary" disabled={adding}>{adding ? 'Adding...' : 'Add link'}</Button></div>
          </form>
        </Card>
      </Dialog>
    </Page>
  );
};

export default HomePage;
