import assert from 'node:assert/strict';
import test from 'node:test';
import { dateTime, dayKey, dayLabel, stamp } from '../lib/logDays';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

test('a day is labelled in capitals', () => {
  assert.equal(dayLabel(at(12, 12)), 'THU, 12 NOV 2026');
});

test('two times of one day share a key and two days do not', () => {
  assert.equal(dayKey(at(12, 1)), dayKey(at(12, 23)));
  assert.notEqual(dayKey(at(12, 12)), dayKey(at(13, 12)));
});

test('the tooltip carries the full date and time', () => {
  assert.equal(stamp(at(12, 9, 5)), '12 Nov 2026 09:05');
});

test('the ticket list says Today for the current day and the date otherwise', () => {
  const now = new Date(2026, 10, 17, 18, 0);
  assert.equal(dateTime(at(17, 10, 12), now), 'Today 10:12');
  assert.equal(dateTime(at(16, 17, 5), now), '16 Nov 17:05');
});
