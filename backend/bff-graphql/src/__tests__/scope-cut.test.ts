import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeWaves, endDay, planStart, remainingSp, scheduleSprint, splitParts, suggestMoves, workingDayOf, workingDays, type ScopeTicket } from '../integrations/scope-cut';

interface PlanRow { key: string; dev: string; sp: number; wave: number; dep: string[]; st: number; dur: number }
const sprint26 = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/sprint26-plan.json'), 'utf8')) as { sprintDays: number; tasks: PlanRow[] };
const input = (rows: PlanRow[], withWave = true): ScopeTicket[] => rows.map((row) => ({ key: row.key, dev: row.dev, sp: row.sp, wave: withWave ? row.wave : null, dependsOn: row.dep }));

test('the Sprint 26 plan comes out with the same start and length for every ticket', () => {
  const schedule = new Map(scheduleSprint(input(sprint26.tasks), { sprintDays: sprint26.sprintDays }).map((row) => [row.key, row]));
  for (const row of sprint26.tasks) {
    const got = schedule.get(row.key)!;
    assert.deepEqual([row.key, got.start, got.dur], [row.key, row.st, row.dur]);
  }
});

test('the Sprint 26 cut keeps 45 tickets in the sprint and sends 27 to the backlog', () => {
  const schedule = scheduleSprint(input(sprint26.tasks), { sprintDays: 10 });
  assert.equal(schedule.filter((row) => row.inSprint).length, 45);
  assert.equal(schedule.filter((row) => !row.inSprint).length, 27);
  assert.equal(schedule.find((row) => row.key === 'QRD-1309')!.inSprint, true, 'a ticket that ends on the last day is in');
  assert.equal(schedule.find((row) => row.key === 'QRD-1490')!.inSprint, false);
});

test('waves computed from the dependencies match the Sprint 26 waves', () => {
  const waves = computeWaves(input(sprint26.tasks, false));
  for (const row of sprint26.tasks) assert.equal(waves.get(row.key), row.wave, row.key);
  const schedule = new Map(scheduleSprint(input(sprint26.tasks, false)).map((row) => [row.key, row]));
  for (const key of ['QRD-1275', 'QRD-1296', 'QRD-1490', 'QRD-1308', 'QRD-1310']) {
    const row = sprint26.tasks.find((task) => task.key === key)!;
    assert.deepEqual([schedule.get(key)!.start, schedule.get(key)!.dur], [row.st, row.dur], key);
  }
});

test('a ticket waits for a dependency on another lane, and the SP per day setting changes the length', () => {
  const tickets: ScopeTicket[] = [
    { key: 'QRD-1', dev: 'Ana', sp: 4, dependsOn: [] },
    { key: 'QRD-2', dev: 'Budi', sp: 1, dependsOn: ['QRD-1'] },
    { key: 'QRD-3', dev: 'Budi', sp: 2, dependsOn: ['QRD-99'] },
  ];
  const rows = new Map(scheduleSprint(tickets, { sprintDays: 2 }).map((row) => [row.key, row]));
  assert.deepEqual([rows.get('QRD-3')!.start, rows.get('QRD-3')!.end], [0, 1], 'a key outside the plan is not waited for');
  assert.deepEqual([rows.get('QRD-2')!.start, rows.get('QRD-2')!.end, rows.get('QRD-2')!.wave], [2, 2.5, 2]);
  assert.equal(rows.get('QRD-2')!.inSprint, false);
  assert.equal(scheduleSprint(tickets, { spPerDay: 4 }).find((row) => row.key === 'QRD-1')!.dur, 1);
});

test('a dependency loop or a wave set below its dependency still places every ticket once', () => {
  const rows = scheduleSprint([
    { key: 'QRD-1', dev: 'Ana', sp: 2, dependsOn: ['QRD-2'] },
    { key: 'QRD-2', dev: 'Ana', sp: 2, dependsOn: ['QRD-1'] },
    { key: 'QRD-3', dev: 'Budi', sp: 2, wave: 1, dependsOn: ['QRD-4'] },
    { key: 'QRD-4', dev: 'Ana', sp: 2, wave: 2, dependsOn: [] },
  ]);
  assert.deepEqual(rows.map((row) => row.key).sort(), ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4']);
  assert.equal(rows.find((row) => row.key === 'QRD-3')!.start, rows.find((row) => row.key === 'QRD-4')!.end);
});

test('tickets of 5 SP or more get a split into parts of at most 3 SP', () => {
  assert.equal(splitParts(3), null);
  assert.equal(splitParts(null), null);
  assert.deepEqual(splitParts(5), [3, 2]);
  assert.deepEqual(splitParts(8), [3, 3, 2]);
  assert.deepEqual(splitParts(6), [3, 3]);
});

test('working days count Monday to Friday', () => {
  assert.equal(workingDays('2026-10-27T01:00:00.000Z', '2026-11-09T10:00:00.000Z'), 10);
  assert.equal(workingDays(null, '2026-11-09'), null);
  assert.equal(workingDays('2026-11-10', '2026-11-09'), null);
});

test('days are +08:00 calendar days: an evening start in UTC is the next day here', () => {
  assert.equal(workingDays('2026-10-27T17:00:00.000Z', '2026-10-28T10:00:00.000Z'), 1);
  assert.equal(workingDays('2026-10-26T16:00:00.000Z', '2026-11-11T14:00:00.000Z'), 12);
});

test('day 1 of Sprint 26 is Tue 27 Oct although Start sprint was pressed on Wed 28 Oct', () => {
  // Jira: Sprint 25 ended 26 Oct 20:06 +08:00, Sprint 26 was started 28 Oct 10:06 +08:00.
  assert.equal(planStart('2026-10-28T02:06:29.812Z', '2026-10-26T12:06:00.000Z'), '2026-10-26T16:00:00.000Z');
  assert.equal(planStart('2026-10-28T02:06:29.812Z', null), '2026-10-27T16:00:00.000Z');
  assert.equal(planStart('2026-10-28T02:06:29.812Z', '2026-10-01T12:00:00.000Z'), '2026-10-27T16:00:00.000Z', 'an old previous sprint does not move day 1');
  assert.equal(planStart('2026-10-31T02:00:00.000Z'), '2026-11-01T16:00:00.000Z', 'a Saturday start counts from Monday');
  assert.equal(planStart(null, '2026-10-26T12:06:00.000Z'), null);
});

test('today on the plan: 1-based working day from day 1, a weekend rolls to Monday unless told not to', () => {
  const start = '2026-10-26T16:00:00.000Z';
  assert.equal(workingDayOf(start, new Date('2026-10-27T01:00:00Z')), 1);
  assert.equal(workingDayOf(start, new Date('2026-11-09T03:00:00Z')), 10);
  assert.equal(workingDayOf(start, new Date('2026-11-07T03:00:00Z')), 10);
  assert.equal(workingDayOf(start, new Date('2026-11-07T03:00:00Z'), false), 9);
  assert.equal(workingDayOf(start, new Date('2026-10-20T00:00:00Z')), null);
});

test('a schedule laid from a later day never starts a ticket before it', () => {
  const rows = scheduleSprint([
    { key: 'A', dev: 'Danu', sp: 2, dependsOn: [] },
    { key: 'B', dev: 'Danu', sp: 2, dependsOn: [] },
    { key: 'C', dev: 'Aken', sp: 2, dependsOn: ['A'] },
  ], { sprintDays: 10, from: 4 });
  assert.deepEqual(rows.map((row) => [row.key, row.start, row.end]), [['A', 4, 5], ['B', 5, 6], ['C', 5, 6]]);
});

test('work left by status, letters only: review and UAT bug half a day, In Progress half, To Do all', () => {
  assert.equal(remainingSp(8, 'PR Review', 2), 1);
  assert.equal(remainingSp(8, 'pr-review', 2), 1);
  assert.equal(remainingSp(8, 'UAT BUG / Improvement', 2), 1);
  assert.equal(remainingSp(3, 'UAT BUG / Improvement', 4), 2);
  assert.equal(remainingSp(0.5, 'PR Review', 2), 0.5, 'never more than the ticket holds');
  assert.equal(remainingSp(5, 'In Progress', 2), 2.5);
  assert.equal(remainingSp(5, 'IN-PROGRESS', 2), 2.5);
  assert.equal(remainingSp(5, 'To Do', 2), 5);
  assert.equal(remainingSp(5, 'Something new', 2), 5);
  assert.equal(remainingSp(null, 'In Progress', 2), null);
});

test('a ticket with work left takes only those days on its lane', () => {
  const rows = scheduleSprint([
    { key: 'A', dev: 'Danu', sp: 4, left: 1, dependsOn: [] },
    { key: 'B', dev: 'Danu', sp: 4, left: null, dependsOn: ['A'] },
  ], { sprintDays: 10, spPerDay: 2 });
  assert.deepEqual(rows.map((row) => [row.key, row.start, row.end]), [['A', 0, 0.5], ['B', 0.5, 2.5]]);
});

test('Sprint 26 on day 11: the To Do chain QRD-1278 and QRD-1290 moves from Shovian to the free lane and the forecast gets earlier', () => {
  const rows: Array<[string, string, string, number, string[]?]> = [
    ['QRD-1509', 'Shovian', 'In Progress', 5], ['QRD-1304', 'Shovian', 'PR Review', 1], ['QRD-1293', 'Shovian', 'PR Review', 1],
    ['QRD-1290', 'Shovian', 'To Do', 2, ['QRD-1278']], ['QRD-1278', 'Shovian', 'To Do', 3], ['QRD-1273', 'Shovian', 'To Do', 2],
    ['QRD-1490', 'Aken', 'In Progress', 8], ['QRD-1484', 'Aken', 'PR Review', 3], ['QRD-1303', 'Aken', 'UAT BUG / Improvement', 3], ['QRD-1350', 'Aken', 'To Do', 2],
    ['QRD-1427', 'Alvin', 'In Progress', 4], ['QRD-1424', 'Alvin', 'PR Review', 2], ['QRD-1308', 'Alvin', 'In Progress', 3], ['QRD-1306', 'Alvin', 'UAT BUG / Improvement', 3], ['QRD-1287', 'Alvin', 'In Progress', 2],
    ['QRD-1310', 'Dwi Indra', 'PR Review', 2], ['QRD-1309', 'Dwi Indra', 'UAT BUG / Improvement', 3],
    ['QRD-1515', 'Yusril', 'In Progress', 3], ['QRD-1501', 'Yusril', 'PR Review', 3], ['QRD-1496', 'Yusril', 'PR Review', 3],
  ];
  const tickets = rows.map(([key, dev, status, sp, dependsOn = []]) => ({ key, dev, status, sp, left: remainingSp(sp, status, 2), dependsOn, merge: status === 'To Do' ? 'none' : 'open' }));
  const developers = ['Aken', 'Alvin', 'Dwi Indra', 'M Danu Seta W', 'Shovian', 'Yusril'];
  const options = { developers, sprintDays: 12, spPerDay: 2, from: 10 };
  const forecast = (plan: typeof tickets) => endDay(Math.max(...scheduleSprint(plan, options).map((row) => row.end)), 10);
  const moves = suggestMoves(tickets, options);
  assert.ok(moves.length >= 1);
  const [first] = moves;
  assert.deepEqual([first.keys, first.from, first.to, first.improves], [['QRD-1278', 'QRD-1290'], 'Shovian', 'M Danu Seta W', true]);
  assert.equal(first.sp, 5);
  assert.equal(first.forecastBefore, forecast(tickets));
  assert.ok(first.forecastAfter < first.forecastBefore);
  const moved = tickets.map((ticket) => (first.keys.includes(ticket.key) ? { ...ticket, dev: first.to } : ticket));
  assert.equal(first.forecastAfter, forecast(moved));
  const open = new Set(rows.filter(([, , status]) => status !== 'To Do').map(([key]) => key));
  for (const move of moves) {
    assert.ok(move.keys.every((key) => !open.has(key)), `${move.keys} holds a card already under way`);
    assert.ok(move.forecastAfter < move.forecastBefore);
  }
  assert.ok(!moves.some((move) => move.keys.includes('QRD-1273')), 'QRD-1273 alone does not bring the forecast earlier');
});

test('a To Do card with an open pull request, or a lane already ending with the others, is never suggested', () => {
  const options = { developers: ['Ana', 'Budi'], spPerDay: 2 };
  assert.deepEqual(suggestMoves([{ key: 'QRD-1', dev: 'Ana', status: 'To Do', sp: 8, dependsOn: [], merge: 'open' }], options), []);
  assert.deepEqual(suggestMoves([
    { key: 'QRD-1', dev: 'Ana', status: 'To Do', sp: 4, dependsOn: [], merge: 'none' },
    { key: 'QRD-2', dev: 'Budi', status: 'In Progress', sp: 4, dependsOn: [], merge: 'none' },
  ], options), []);
});
