import { cn } from '../lib/cn';
import { calendarDateKey, calendarEventTime, type CalendarEvent } from '../lib/calendar';

interface MonthCalendarProps {
  month: Date;
  events: CalendarEvent[];
  variant?: 'compact' | 'full';
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthCalendar({ month, events, variant = 'compact' }: MonthCalendarProps) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const todayKey = calendarDateKey(new Date());
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((result, event) => {
    const key = calendarDateKey(new Date(event.start));
    (result[key] ||= []).push(event);
    return result;
  }, {});
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = calendarDateKey(date);
    return { date, key, currentMonth: date.getMonth() === month.getMonth(), events: eventsByDate[key] || [] };
  });
  const full = variant === 'full';

  return (
    <div className={cn(full && 'mx-auto max-w-[720px]')}>
      <div className={cn('mb-[5px] grid grid-cols-7', full ? 'gap-2' : 'gap-[3px]')} aria-hidden="true">
        {weekdays.map((day) => <span className={cn('text-center font-bold text-muted-foreground', full ? 'py-1 text-xs' : 'text-[0.56rem]')} key={day}>{day}</span>)}
      </div>
      <div className={cn('grid grid-cols-7', full ? 'gap-2' : 'gap-[3px]')} aria-label={`${monthLabel} calendar`}>
        {days.map((cell) => {
          const isToday = cell.key === todayKey;
          const popoverId = `${variant}-calendar-events-${cell.key}`;
          const label = `${cell.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${isToday ? ', today' : ''}${cell.events.length ? `, ${cell.events.length} ${cell.events.length === 1 ? 'event' : 'events'}` : ''}`;
          return (
            <button
              type="button"
              key={cell.key}
              className={cn(
                'group relative grid aspect-square w-full min-w-0 place-items-center border border-border bg-surface-1 p-0 text-secondary-foreground tabular-nums transition-colors duration-150 ease-out hover:z-20 hover:border-border-glow hover:bg-surface-hover hover:text-foreground focus-visible:z-20',
                full ? 'rounded-md text-sm' : 'rounded-[5px] text-[0.56rem]',
                !cell.currentMonth && 'text-muted-foreground opacity-55',
                isToday && 'border-accent bg-accent font-extrabold text-black hover:border-accent hover:bg-accent hover:text-black',
              )}
              aria-label={label}
              aria-describedby={cell.events.length ? popoverId : undefined}
            >
              {cell.date.getDate()}
              {cell.events.length > 0 && <>
                <span className={cn('absolute rounded-full bg-amber-500', full ? 'bottom-2 size-1.5' : 'bottom-[3px] size-[3px]', isToday && 'bg-black')} aria-hidden="true" />
                <span id={popoverId} className="invisible pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 w-[min(260px,80vw)] translate-x-[-50%] translate-y-1 rounded-md border border-border-glow bg-surface-0 p-3 text-left text-foreground opacity-0 shadow-card transition-[opacity,transform] duration-150 ease-out group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none" role="tooltip">
                  {cell.events.map((event, index) => <span className={cn('block', index > 0 && 'mt-2 border-t border-border pt-2')} key={event.id}><strong className="mb-0.5 block text-xs leading-[1.35]">{event.title}</strong><small className="block text-[0.68rem] leading-[1.45] text-muted-foreground">{calendarEventTime(event)}</small></span>)}
                </span>
              </>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
