import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRows, groupRows, nextAt, rowsMarkdown, type ThinkingRow } from '../agents/thinking';
import { numberDelta } from '../agents/retro';

const row = (id: string, at: string, overrides: Partial<ThinkingRow> = {}): ThinkingRow => ({
  id, at: `2026-10-28T${at}:00.000Z`, stageIndex: 2, round: 2, agent: 'sous-ticket-runner', kind: 'ask', topic: 'thinking', text: id, answer: null, options: [], flag: null, ...overrides,
});
const rows = [
  row('video', '16:04', { stageIndex: 4, agent: 'sous-video', kind: 'did', topic: 'agent' }),
  row('stage', '15:50', { stageIndex: 4, agent: 'DOCK', kind: 'event', topic: 'stage' }),
  row('broadcast', '15:44', { agent: 'DOCK', kind: 'event', topic: 'git', flag: 'while sous was still working' }),
  row('label', '15:45', { answer: 'Storyboard', options: [{ label: 'Storyboard', why: 'contract §1', chosen: true }, { label: 'Old label', why: null, chosen: false }] }),
  row('owner', '15:43', { agent: 'owner', kind: 'event', topic: 'owner' }),
];

test('the Thinking column and the log filter by kind, topic, problems, stage, round and agent', () => {
  assert.deepEqual(filterRows(rows, 'thinking', null).map((r) => r.id), ['video', 'label']);
  assert.deepEqual(filterRows(rows, 'events', null).map((r) => r.id), ['stage', 'broadcast', 'owner']);
  assert.deepEqual(filterRows(rows, 'owner', null).map((r) => r.id), ['owner']);
  assert.deepEqual(filterRows(rows, 'agents', null).map((r) => r.id), ['video', 'label']);
  assert.deepEqual(filterRows(rows, 'git', null).map((r) => r.id), ['broadcast']);
  assert.deepEqual(filterRows(rows, 'problems', null).map((r) => r.id), ['broadcast']);
  assert.deepEqual(filterRows(rows, 'all', { stageIndex: 4, round: 2 }).map((r) => r.id), ['video', 'stage']);
  assert.deepEqual(filterRows(rows, 'all', { agent: 'sous-video' }).map((r) => r.id), ['video']);
});

test('rows group under their stage and round in the order they came, and raw stops at the next row', () => {
  assert.deepEqual(groupRows(rows).map((group) => [group.stageIndex, group.rows.length]), [[4, 2], [2, 3]]);
  assert.equal(nextAt(rows, rows[3]), '2026-10-28T15:50:00.000Z');
  assert.equal(nextAt(rows, rows[0]), null);
});

test('the log exports as Markdown with every option under its row', () => {
  const md = rowsMarkdown('QRD-1268', rows);
  assert.match(md, /## Evidence · R2/);
  assert.match(md, /\*\*sous-ticket-runner\*\* ask label → Storyboard/);
  assert.match(md, / {2}- ✗ Old label/);
  assert.match(md, /_\(while sous was still working\)_/);
});

test('retro numbers compare with the sprint before and say which way is better', () => {
  const now = { tickets: 11, medianHours: 5.8, fixRounds: 1.6, replans: 0, ownerIssues: 23, medianOwnerWaitHours: 4.1, reviews: 3, requestChanges: 2 };
  const before = { ...now, medianHours: 7, ownerIssues: 14 };
  assert.deepEqual(numberDelta(now, before, 'medianHours', 'down'), { text: '-1.2 vs before', good: true });
  assert.deepEqual(numberDelta(now, before, 'ownerIssues', 'down'), { text: '+9 vs before', good: false });
  assert.equal(numberDelta(now, null, 'tickets', null), null);
});
