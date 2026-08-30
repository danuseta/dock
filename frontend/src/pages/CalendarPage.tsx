import React, { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import { GET_CALENDAR, GET_SETTINGS } from '../graphql/queries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button, Card, Page, PageHeader } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';

interface CalendarPageProps { onNavigate: (path: string) => void }

const CalendarPage: React.FC<CalendarPageProps> = ({ onNavigate }) => {
  const { data: settingsData } = useQuery(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  const { data, loading, error, refetch } = useQuery(GET_CALENDAR, { ...CACHED_QUERY_OPTIONS, variables: { maxResults: 50 } });
  const connected = settingsData?.settings?.googleCalendarConnected;
  const groups = useMemo(() => {
    const result: Record<string, any[]> = {};
    for (const event of data?.calendarEvents || []) {
      const key = new Date(event.start).toLocaleDateString('en-CA');
      (result[key] ||= []).push(event);
    }
    return result;
  }, [data]);

  if (isInitialQueryLoading(loading, data)) return <Page width="medium"><LoadingSkeleton /></Page>;

  return (
    <Page width="medium">
      <PageHeader>
        <div className="flex items-center gap-3">
          <CalendarDays size={28} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-balance font-display text-3xl font-black">Calendar</h1>
            <p className="mt-1 text-pretty text-muted-foreground">Your next 30 days from Google Calendar.</p>
          </div>
        </div>
        <Button onClick={() => refetch()}>Refresh agenda</Button>
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
      ) : Object.keys(groups).length === 0 ? (
        <Card><p className="text-muted-foreground">No events in the next 30 days.</p></Card>
      ) : Object.entries(groups).map(([date, events]) => (
        <section key={date} className="mb-5 grid grid-cols-[180px_1fr] gap-4 max-md:grid-cols-1">
          <div><strong className="font-display text-[1.05rem]">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></div>
          <div className="flex flex-col gap-2">
            {events.map((event: any) => (
              <Card className="border-l-4 border-l-accent p-4" key={event.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="mb-1 font-mono text-xs text-accent tabular-nums">{event.allDay ? 'ALL DAY' : new Date(event.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    <h3 className="text-balance font-display font-bold">{event.title}</h3>
                  </div>
                  {event.url && <a className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-secondary-foreground transition-colors duration-150 hover:border-border-glow hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" href={event.url} target="_blank" rel="noreferrer" aria-label={`Open ${event.title} in Google Calendar`}><ExternalLink size={15} aria-hidden="true" /></a>}
                </div>
                {event.location && <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground"><MapPin size={13} aria-hidden="true" /> {event.location}</div>}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
};

export default CalendarPage;
