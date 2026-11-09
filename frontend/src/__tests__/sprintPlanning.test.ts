import assert from 'node:assert/strict';
import test from 'node:test';
import { agentsRoute } from '../agents/plan';
import {
  UNASSIGNED, barPlace, changeCount, dayOf, decisionLabel, findingKindLabel, lanes, parseWave, predictionTone, publishHint, scopeSummary, sortFindings,
  spanOf, waveRows, workingDayLabels, type DraftFinding, type DraftTicket,
} from '../agents/planning';

const ticket = (over: Partial<DraftTicket>): DraftTicket => ({
  key: 'QRD-1', summary: 'One', dev: 'Danu', jiraDev: 'Danu', sp: 3, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [],
  start: 0, dur: 1.5, end: 1.5, inSprint: true, split: null, prediction: null, qaDecision: null, ...over,
});
const finding = (over: Partial<DraftFinding>): DraftFinding => ({ id: 'x', key: 'QRD-1', line: 1, text: 't', refKey: 'QRD-2', kind: 'lands-first', refEnd: 1, ownEnd: 2, decision: null, ...over });

test('agentsRoute opens Sprint > Planning for sub=planning and keeps Plan as the default', () => {
  assert.deepEqual(agentsRoute('?tab=sprint&sub=planning'), { tab: 'sprint', sub: 'planning' });
  assert.deepEqual(agentsRoute('?tab=sprint&sub=nope'), { tab: 'sprint', sub: 'plan' });
});

test('lanes follow the draft developers, sum SP, count backlog and add Unassigned last', () => {
  const rows = lanes({ devs: ['Aken', 'Danu'], tickets: [
    ticket({ key: 'QRD-2', start: 1.5, end: 3 }), ticket({ key: 'QRD-1' }), ticket({ key: 'QRD-3', dev: 'Aken', sp: 8, inSprint: false, end: 12 }), ticket({ key: 'QRD-4', dev: null, sp: null }),
  ] });
  assert.deepEqual(rows.map((lane) => [lane.dev, lane.sp, lane.tickets.map((item) => item.key), lane.backlog]), [
    ['Aken', 8, ['QRD-3'], 1], ['Danu', 6, ['QRD-1', 'QRD-2'], 0], [UNASSIGNED, 0, ['QRD-4'], 0],
  ]);
  assert.equal(rows[0].color, 'var(--color-accent)');
});

test('days, span, bars and working-day labels', () => {
  assert.deepEqual([dayOf(0), dayOf(2.5), dayOf(3)], ['D1', 'D3', 'D3']);
  assert.equal(spanOf({ sprintDays: 10, tickets: [ticket({ end: 15.5 })] }), 16);
  assert.equal(spanOf({ sprintDays: 10, tickets: [] }), 10);
  assert.deepEqual(barPlace({ start: 2, dur: 1 }, 10), { left: '20%', width: '10%' });
  assert.deepEqual(workingDayLabels('2026-10-29T01:00:00.000Z', 4), ['29 Oct', '30 Oct', '2 Nov', '3 Nov']);
  assert.deepEqual(workingDayLabels(null, 3), []);
});

test('waves close on their last ticket and are late past the sprint; scope sums in and out', () => {
  const tickets = [ticket({ wave: 1, end: 3 }), ticket({ wave: 2, end: 9, sp: 2 }), ticket({ wave: 2, end: 11, sp: 5, inSprint: false })];
  assert.deepEqual(waveRows({ sprintDays: 10, tickets }), [
    { wave: 1, count: 1, sp: 3, closes: 3, late: false },
    { wave: 2, count: 2, sp: 7, closes: 11, late: true },
  ]);
  assert.deepEqual(scopeSummary({ tickets }), { inSprint: 2, inSprintSp: 5, backlog: 1, backlogSp: 5 });
});

test('findings sort after-it first and decisions read as words', () => {
  const sorted = sortFindings([finding({ key: 'QRD-3' }), finding({ key: 'QRD-9', kind: 'after-it' }), finding({ key: 'QRD-1', line: 2 })]);
  assert.deepEqual(sorted.map((item) => item.key), ['QRD-9', 'QRD-1', 'QRD-3']);
  assert.deepEqual(['after-it', 'lands-first', 'outside-plan'].map(findingKindLabel), ['after it', 'lands first', 'outside plan']);
  const decision = (action: string, note: string | null = null) => ({ action, note, by: 'Alvin', at: '' });
  assert.equal(decisionLabel(decision('move'), 'QRD-2'), 'Moved to QRD-2');
  assert.equal(decisionLabel(decision('wait')), 'Kept, waits');
  assert.equal(decisionLabel(decision('fix', 'AC 3 rewritten')), 'Fixed: AC 3 rewritten');
  assert.equal(decisionLabel(null), null);
});

test('QA tone, publish hint, change count and wave input', () => {
  assert.deepEqual(['LOLOS', 'ESCALATED', 'REVISION-RISK', null].map(predictionTone), ['ok', 'conflict', 'warn', 'none']);
  assert.equal(publishHint({ canPublish: false, blockers: ['a', 'b'], tickets: [ticket({})] }), '2 items need a decision before publish');
  assert.equal(publishHint({ canPublish: false, blockers: ['a'], tickets: [ticket({})] }), '1 item needs a decision before publish');
  assert.equal(publishHint({ canPublish: false, blockers: [], tickets: [] }), 'No tickets in this sprint');
  assert.equal(changeCount([
    { key: 'A', assigneeFrom: null, assigneeTo: 'Ana', acRemoved: [], acAdded: [], refused: null },
    { key: 'B', assigneeFrom: null, assigneeTo: null, acRemoved: ['x'], acAdded: [], refused: 'AC changed' },
  ]), 1);
  assert.deepEqual(['2', '0', ' 3 ', '1.5', '', '-1', '51'].map(parseWave), [2, 0, 3, null, null, null, null]);
});
