import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeWaves, scheduleSprint, splitParts, workingDays, type ScopeTicket } from '../integrations/scope-cut';

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
