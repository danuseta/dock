import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonthCalendar } from '../components/MonthCalendar';

test('renders the same accessible month grid for compact and full calendar surfaces', () => {
  const event = {
    id: 'event-1',
    title: 'Planning session',
    start: '2026-08-18T09:00:00+07:00',
    end: '2026-08-18T10:00:00+07:00',
    allDay: false,
    location: 'Google Meet',
    url: 'https://calendar.google.com/event?eid=event-1',
  };

  for (const variant of ['compact', 'full'] as const) {
    const markup = renderToStaticMarkup(<MonthCalendar month={new Date(2026, 7, 1)} events={[event]} variant={variant} />);
    assert.match(markup, /aria-label="August 2026 calendar"/);
    assert.match(markup, /18 August 2026, 1 event/);
    assert.match(markup, /Planning session/);
  }
});
