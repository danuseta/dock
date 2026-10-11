import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, List } from 'lucide-react';
import { GET_CALENDAR, GET_SETTINGS } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { MonthCalendar } from '../components/MonthCalendar';
import { Button, Card, IconButton, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { calendarEventTime, type CalendarEvent } from '../lib/calendar';

interface CalendarPageProps { onNavigate: (path: string) => void }
type CalendarView = 'calendar' | 'table';

const VIEW_STORAGE_KEY = 'dock-calendar-view';

const initialView = (): CalendarView => {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'calendar';
  } catch {
    return 'calendar';
  }
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const CalendarPage: React.FC<CalendarPageProps> = ({ onNavigate }) => {
  const [view, setView] = useState<CalendarView>(initialView);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const range = useMemo(() => ({
    timeMin: month.toISOString(),
    timeMax: new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString(),
  }), [month]);
  const { data: settingsData, refetch: refetchSettings } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const { data, loading, error, refetch } = useQuery(GET_CALENDAR, {
    ...CACHED_QUERY_OPTIONS,
    variables: { ...range, maxResults: 50 },
  });
  const connected = settingsData?.settings?.googleCalendarConnected;
  const calendarError: string | null = settingsData?.settings?.googleCalendarError || null;
  const events: CalendarEvent[] = data?.calendarEvents || [];
  useEffect(() => {
    if (data && connected) void refetchSettings();
  }, [data, connected, refetchSettings]);
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const selectView = (nextView: CalendarView) => {
    setView(nextView);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, nextView); } catch { /* Preference storage is optional. */ }
  };

  const moveMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  return (
    <Page width="full">
      <PageHeader>
        <div className="flex items-center gap-3">
          <CalendarDays size={28} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-balance font-display text-3xl font-black">Calendar</h1>
            <p className="mt-1 text-pretty text-muted-foreground">Browse your Google Calendar by month or switch to a compact table.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface-1 p-1" role="group" aria-label="Calendar view">
            <Button size="sm" variant={view === 'calendar' ? 'primary' : 'ghost'} aria-pressed={view === 'calendar'} onClick={() => selectView('calendar')}><CalendarDays size={15} aria-hidden="true" />Calendar</Button>
            <Button size="sm" variant={view === 'table' ? 'primary' : 'ghost'} aria-pressed={view === 'table'} onClick={() => selectView('table')}><List size={15} aria-hidden="true" />Table</Button>
          </div>
          <Button onClick={() => void refetch()}>Refresh agenda</Button>
        </div>
      </PageHeader>

      {!connected ? (
        <Card className="py-10 text-center">
          <CalendarDays size={42} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-balance font-display text-xl font-bold">Google Calendar is not connected</h2>
          <p className="mx-auto mt-2 max-w-2xl text-pretty text-muted-foreground">Add your OAuth Web credentials and connect the read-only calendar from Settings.</p>
          <Button variant="primary" className="mt-5" onClick={() => onNavigate('/settings')}>Open Settings</Button>
        </Card>
      ) : error ? (
        <Card className="border-status-conflict text-status-conflict" role="alert">Calendar failed to load: {error.message}</Card>
      ) : calendarError ? (
        <Card className="border-status-conflict py-10 text-center" role="alert">
          <h2 className="text-balance font-display text-xl font-bold text-status-conflict">Google Calendar is not loading</h2>
          <p className="mx-auto mt-2 max-w-2xl text-pretty text-muted-foreground">{calendarError}</p>
          <Button variant="primary" className="mt-5" onClick={() => onNavigate('/settings')}>Open Settings</Button>
        </Card>
      ) : <>
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2">
            <IconButton variant="ghost" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} aria-hidden="true" /></IconButton>
            <h2 className="min-w-44 text-center text-balance font-display text-lg font-bold">{monthLabel}</h2>
            <IconButton variant="ghost" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={17} aria-hidden="true" /></IconButton>
          </div>
          <Button size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        </Card>

        {view === 'calendar' ? (
          <Card className="overflow-visible"><MonthCalendar month={month} events={events} variant="full" />{events.length === 0 && <p className="mt-4 border-t border-border pt-4 text-center text-pretty text-sm text-muted-foreground">No events in {monthLabel}. Refresh the agenda after adding an event in Google Calendar.</p>}</Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-surface-1 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Event</th><th className="px-4 py-3 font-medium">Location</th><th className="px-4 py-3 text-right font-medium">Open</th></tr></thead>
                <tbody>
                  {events.map((event) => <tr className="border-t border-border hover:bg-surface-1" key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">{new Date(event.start).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">{event.allDay ? 'All day' : calendarEventTime(event).split(' · ')[0]}</td>
                    <td className="max-w-[420px] px-4 py-3"><strong className="block truncate font-display" title={event.title}>{event.title}</strong></td>
                    <td className="max-w-[260px] px-4 py-3 text-muted-foreground"><span className="block truncate" title={event.location || undefined}>{event.location || '—'}</span></td>
                    <td className="px-4 py-3 text-right">{event.url ? <a className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-surface-2 text-secondary-foreground transition-colors duration-150 hover:border-border-glow hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" href={event.url} target="_blank" rel="noreferrer" aria-label={`Open ${event.title} in Google Calendar`}><ExternalLink size={15} aria-hidden="true" /></a> : '—'}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {events.length === 0 && <div className="py-12 text-center"><CalendarDays className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="text-pretty text-sm text-muted-foreground">No events in {monthLabel}.</p><Button className="mt-4" onClick={() => void refetch()}>Refresh agenda</Button></div>}
          </Card>
        )}
      </>}
    </Page>
  );
};

export default CalendarPage;
