import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { BarChart3, CalendarDays, Gem, GitBranch, Globe, Link2, Paperclip, Plus, RefreshCw, TerminalSquare, Trash2, Workflow, X } from 'lucide-react';
import { GET_HOME } from '../graphql/queries';
import { ADD_QUICK_LINK, REMOVE_QUICK_LINK } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Card, Dialog, IconButton, Input, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS, normalizeServiceHealthRefreshSeconds } from '../lib/serviceHealthRefresh';

interface HomePageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void; }
interface CalendarEvent { id: string; title: string; start: string; end?: string | null; allDay: boolean; location?: string | null; url?: string | null; }

const highlightColors = [
  { value: '#60a5fa', label: 'Blue' },
  { value: '#34d399', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#a78bfa', label: 'Violet' },
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const panelClass = 'min-w-0 rounded-md border border-border bg-surface-0';
const panelHeaderClass = 'flex items-center justify-between gap-2.5 border-b border-border px-[17px] py-[15px]';
const panelTitleClass = 'text-balance font-display text-[0.82rem] font-bold';
const textActionClass = 'h-6 border-0 px-0 py-0 text-[0.68rem] text-muted-foreground hover:border-transparent hover:bg-transparent hover:text-foreground';
const dateKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

const quickLinkIcon = (title: string, url: string) => {
  const value = `${title} ${url}`.toLowerCase();
  if (value.includes('jira')) return Workflow;
  if (value.includes('github')) return GitBranch;
  if (value.includes('calendar')) return CalendarDays;
  if (value.includes('hermes') || value.includes('terminal')) return TerminalSquare;
  if (value.includes('paperclip')) return Paperclip;
  if (value.includes('obsidian')) return Gem;
  if (value.includes('grafana') || value.includes('monitor')) return BarChart3;
  if (value.includes('portfolio')) return Globe;
  return Link2;
};

const eventTime = (event: CalendarEvent) => {
  if (event.allDay) return `All day${event.location ? ` · ${event.location}` : ''}`;
  const start = new Date(event.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = event.end ? new Date(event.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  return `${start}${end ? `–${end}` : ''} · ${event.location || 'Google Calendar'}`;
};

const HomePage: React.FC<HomePageProps> = ({ onTicketClick, onNavigate }) => {
  const [healthRefreshSeconds, setHealthRefreshSeconds] = useState(DEFAULT_SERVICE_HEALTH_REFRESH_SECONDS);
  const { data, loading, error, refetch } = useQuery(GET_HOME, { pollInterval: healthRefreshSeconds * 1000, fetchPolicy: 'cache-and-network' });
  const [addQuickLink, { loading: adding }] = useMutation(ADD_QUICK_LINK, { refetchQueries: [{ query: GET_HOME }] });
  const [removeQuickLink] = useMutation(REMOVE_QUICK_LINK, { refetchQueries: [{ query: GET_HOME }] });
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
    setHealthRefreshSeconds(normalizeServiceHealthRefreshSeconds(data?.settings?.serviceHealthRefreshSeconds));
  }, [data?.settings?.serviceHealthRefreshSeconds]);

  const tickets = useMemo(() => (data?.dashboard || []).flatMap((group: any) => group.tickets || []), [data]);
  const activeTickets = tickets.filter((ticket: any) => !/done|merged|closed|resolved/i.test(ticket.status));
  const storyPoints = activeTickets.reduce((total: number, ticket: any) => total + (ticket.storyPoints || 0), 0);
  const monitors = data?.monitors || [];
  const healthyServices = monitors.filter((monitor: any) => monitor.lastStatus === 'UP').length;
  const calendarEvents: CalendarEvent[] = data?.calendarEvents || [];

  const calendarDays = useMemo(() => {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const gridStart = new Date(now.getFullYear(), now.getMonth(), 1 - ((first.getDay() + 6) % 7));
    const eventsByDate = calendarEvents.reduce<Record<string, CalendarEvent[]>>((result, event) => {
      const key = dateKey(new Date(event.start));
      (result[key] ||= []).push(event);
      return result;
    }, {});
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return { date, key: dateKey(date), currentMonth: date.getMonth() === now.getMonth(), events: eventsByDate[dateKey(date)] || [] };
    });
  }, [calendarEvents, now]);

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

  const refreshHealth = async () => { setHealthCountdown(healthRefreshSeconds); await refetch(); };

  if (loading && !data) return <div className="mx-auto w-full max-w-[1500px] p-6"><LoadingSkeleton /></div>;
  if (error) return <div className="mx-auto w-full max-w-[1500px] p-6"><div className="rounded-md border border-status-conflict bg-status-conflict-bg p-6 text-pretty text-sm text-status-conflict" role="alert">Home data failed to load: {error.message}</div></div>;

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const metrics = [
    { label: 'Active tickets', value: activeTickets.length },
    { label: 'Story points', value: storyPoints },
    { label: 'Needs attention', value: data?.needsAttention?.length || 0, className: 'text-status-conflict' },
    { label: 'Services healthy', value: `${healthyServices}/${monitors.length}`, className: 'text-status-merged' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] px-8 pt-6 pb-12 max-[1023px]:px-4 max-[1023px]:pt-4">
      <header className="mb-6 flex items-start justify-between gap-6 max-[600px]:items-end">
        <div>
          <h1 className="text-balance font-display text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] font-bold max-[600px]:text-[1.65rem]">{greeting}, Danu.</h1>
          <p className="mt-2 text-pretty text-secondary-foreground max-[600px]:text-[0.72rem]">Here is what needs your attention before you start working.</p>
        </div>
        <div className="flex-none text-right">
          <strong className="block font-mono text-[clamp(1.7rem,3vw,2.25rem)] leading-none font-extrabold tabular-nums max-[600px]:text-[1.15rem]">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          <span className="mt-2 block text-[0.72rem] text-muted-foreground max-[600px]:text-[0.6rem]">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-4 overflow-hidden rounded-md border border-border bg-surface-1 max-[600px]:grid-cols-2 [&>div]:border-r [&>div]:border-border [&>div:last-child]:border-r-0 max-[600px]:[&>div:nth-child(2)]:border-r-0 max-[600px]:[&>div:nth-child(-n+2)]:border-b" aria-label="Work overview">
        {metrics.map((metric) => (
          <div className="p-[18px]" key={metric.label}>
            <strong className={cn('block font-display text-[1.55rem] leading-none font-extrabold tabular-nums', metric.className)}>{metric.value}</strong>
            <span className="mt-[7px] block text-[0.68rem] text-muted-foreground">{metric.label}</span>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(340px,380px)] items-stretch gap-3.5 max-[900px]:grid-cols-1">
        <div className="grid grid-rows-[auto_minmax(0,1fr)] gap-3.5">
          <section className="min-w-0" aria-labelledby="quick-links-title">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="quick-links-title" className={panelTitleClass}>Quick links</h2>
              <IconButton variant="ghost" className="size-6" onClick={() => { setLinkError(''); setShowForm(true); }} aria-label="Add quick link" title="Add quick link"><Plus size={14} aria-hidden="true" /></IconButton>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(data?.quickLinks || []).map((link: any) => {
                const Icon = quickLinkIcon(link.title, link.url);
                return <span className="group relative" key={link.id}><a className="grid size-11 place-items-center rounded-[9px] border border-border bg-surface-0 text-accent transition-colors duration-150 ease-out hover:border-border-glow hover:bg-surface-1 hover:text-foreground" href={link.url} target="_blank" rel="noreferrer" aria-label={`Open ${link.title}`} title={link.title}><Icon size={20} aria-hidden="true" /></a><button className="absolute -top-[5px] -right-[5px] grid size-[17px] place-items-center rounded-full border border-border bg-surface-2 p-0 text-status-conflict opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100" type="button" aria-label={`Remove ${link.title}`} onClick={() => removeQuickLink({ variables: { id: link.id } })}><Trash2 size={10} aria-hidden="true" /></button></span>;
              })}
              {(data?.quickLinks || []).length === 0 && <button type="button" className="min-h-11 rounded-[9px] border border-dashed border-border bg-transparent px-3 text-muted-foreground" onClick={() => setShowForm(true)}>Add your first link</button>}
            </div>
          </section>

          <article className={cn(panelClass, 'h-full')}>
            <header className="flex items-center justify-between gap-2.5 border-b border-border px-3.5 py-[11px]"><h2 className={panelTitleClass}>Current work</h2><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/dashboard')}>Open board →</Button></header>
            {activeTickets.slice(0, 4).map((ticket: any) => <button className="grid w-full grid-cols-[82px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-0 border-b border-border bg-transparent px-3.5 py-2.5 text-left text-foreground transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-1 max-[600px]:grid-cols-[72px_minmax(0,1fr)_auto]" key={ticket.key} onClick={() => onTicketClick(ticket.key)}><span className="font-mono text-[0.69rem] font-bold text-accent">{ticket.key}</span><span className="truncate text-[0.8rem]">{ticket.title}</span><span className="whitespace-nowrap font-mono text-[0.63rem] font-bold text-muted-foreground tabular-nums">{ticket.storyPoints || 0} SP</span><span className="whitespace-nowrap rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[0.63rem] text-secondary-foreground max-[600px]:hidden">{ticket.status}</span></button>)}
            {activeTickets.length === 0 && <div className="px-3.5 py-5 text-[0.78rem] text-muted-foreground">No active Jira tickets.</div>}
          </article>
        </div>

        <div className="grid w-full max-w-[380px] justify-self-end gap-3.5 max-[900px]:justify-self-center max-[600px]:max-w-[360px]">
          <article className={cn(panelClass, 'relative z-10 overflow-visible')}>
            <header className={panelHeaderClass}><h2 className={panelTitleClass}>{monthLabel}</h2><Button variant="ghost" size="sm" className={textActionClass} onClick={() => onNavigate('/calendar')}>Google Calendar →</Button></header>
            <div className="px-2.5 pt-2 pb-2.5"><div className="mb-[5px] grid grid-cols-7 gap-[3px]" aria-hidden="true">{weekdays.map((day) => <span className="text-center text-[0.56rem] font-bold text-muted-foreground" key={day}>{day}</span>)}</div><div className="grid grid-cols-7 gap-[3px]" aria-label={`${monthLabel} calendar`}>
              {calendarDays.map((cell) => {
                const isToday = cell.key === dateKey(now);
                const popoverId = `home-events-${cell.key}`;
                const label = `${cell.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${isToday ? ', today' : ''}${cell.events.length ? `, ${cell.events.length} ${cell.events.length === 1 ? 'event' : 'events'}` : ''}`;
                return <button type="button" key={cell.key} className={cn('group relative grid aspect-square w-full min-w-0 place-items-center rounded-[5px] border border-border bg-surface-1 p-0 text-[0.56rem] text-secondary-foreground tabular-nums transition-colors duration-150 ease-out hover:z-20 hover:border-border-glow hover:bg-surface-hover hover:text-foreground focus-visible:z-20', !cell.currentMonth && 'text-muted-foreground opacity-55', isToday && 'border-accent bg-accent font-extrabold text-black hover:border-accent hover:bg-accent hover:text-black')} aria-label={label} aria-describedby={cell.events.length ? popoverId : undefined}>{cell.date.getDate()}{cell.events.length > 0 && <><span className={cn('absolute bottom-[3px] size-[3px] rounded-full bg-amber-500', isToday && 'bg-black')} aria-hidden="true" /><span id={popoverId} className="invisible pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 w-[218px] translate-x-[-50%] translate-y-1 rounded-[8px] border border-border-glow bg-surface-0 p-2.5 text-left text-foreground opacity-0 shadow-card transition-[opacity,transform] duration-150 ease-out group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none" role="tooltip">{cell.events.map((event, index) => <span className={cn('block', index > 0 && 'mt-2 border-t border-border pt-2')} key={event.id}><strong className="mb-0.5 block text-[0.69rem] leading-[1.35]">{event.title}</strong><small className="block text-[0.58rem] leading-[1.45] text-muted-foreground">{eventTime(event)}</small></span>)}</span></>}</button>;
              })}
            </div></div>
          </article>

          <article className={panelClass}>
            <header className={panelHeaderClass}><h2 className={panelTitleClass}>Service health</h2><div className="flex items-center gap-[7px]"><span className="font-mono text-[0.63rem] text-muted-foreground tabular-nums">Refresh {healthCountdown}s</span><IconButton variant="ghost" className="size-[26px] rounded-sm border-border" onClick={refreshHealth} aria-label="Refresh service health now"><RefreshCw size={13} aria-hidden="true" /></IconButton></div></header>
            {monitors.map((monitor: any) => <div className="flex items-center gap-[11px] border-b border-border px-[15px] py-3 last:border-b-0" key={monitor.id}><span className={cn('size-2 flex-none rounded-full bg-muted-foreground', monitor.lastStatus === 'UP' ? 'bg-status-merged' : 'bg-status-conflict')} /><span className="min-w-0 flex-1"><strong className="block truncate text-[0.75rem]">{monitor.name}</strong><small className="text-[0.68rem] text-muted-foreground">{monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : monitor.lastStatus || 'Not checked'}</small></span><span className="font-mono text-[0.68rem] text-muted-foreground tabular-nums">{monitor.lastLatencyMs == null ? '—' : `${monitor.lastLatencyMs} ms`}</span></div>)}
            {monitors.length === 0 && <button type="button" className="w-full border-0 bg-transparent p-4 text-accent" onClick={() => onNavigate('/monitoring')}>Add a service monitor</button>}
          </article>
        </div>
      </div>

      <Dialog open={showForm} onClose={() => !adding && setShowForm(false)} dismissible={!adding} labelledBy="quick-link-dialog-title" describedBy="quick-link-dialog-description">
        <Card className="w-[min(500px,calc(100vw-2rem))] p-0 shadow-card">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5"><div><h2 id="quick-link-dialog-title" className="text-balance font-display text-xl font-bold">Add quick link</h2><p id="quick-link-dialog-description" className="mt-1 text-pretty text-sm text-muted-foreground">Add a compact shortcut to your Home page.</p></div><IconButton variant="ghost" aria-label="Close quick link form" onClick={() => setShowForm(false)} disabled={adding}><X size={18} aria-hidden="true" /></IconButton></div>
          <form className="flex flex-col gap-4 p-5" onSubmit={handleAdd}>
            <label><span className="mb-1.5 block text-sm font-medium">Label</span><Input placeholder="GitHub" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={80} autoFocus /></label>
            <label><span className="mb-1.5 block text-sm font-medium">URL</span><Input className="font-mono" placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} required type="url" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Highlight color</span><Select value={color} onChange={(event) => setColor(event.target.value)} aria-label="Highlight color">{highlightColors.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
            {linkError && <p className="text-pretty text-sm text-status-conflict" role="alert">{linkError}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-4"><Button onClick={() => setShowForm(false)} disabled={adding}>Cancel</Button><Button type="submit" variant="primary" disabled={adding}>{adding ? 'Adding...' : 'Add link'}</Button></div>
          </form>
        </Card>
      </Dialog>
    </div>
  );
};

export default HomePage;
