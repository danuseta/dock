export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  location?: string | null;
  url?: string | null;
}

export const calendarDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

export const calendarEventTime = (event: CalendarEvent) => {
  if (event.allDay) return `All day${event.location ? ` · ${event.location}` : ''}`;
  const start = new Date(event.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = event.end ? new Date(event.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  return `${start}${end ? `–${end}` : ''} · ${event.location || 'Google Calendar'}`;
};
