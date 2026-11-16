import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRows, groupRows, nextAt, rowsMarkdown, type ThinkingRow } from '../agents/thinking';
import { beforeText, buildResult, keyList, problemLabel, reviewSummary, shownNumbers } from '../agents/retro';

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

test('retro numbers show the sprint before, leave out a number zero in both, and read the Indonesian way', () => {
  const now = { tickets: 3, medianHours: 26.3, fixRounds: 1.7, replans: 0, ownerIssues: 6, medianOwnerWaitHours: 0.3, ownerWaitHours: 1.4, reviews: 5, requestChanges: 0, blockedWaits: 2, mergeConflicts: 2, stackedRebases: 0 };
  const before = { ...now, fixRounds: 8.5, stackedRebases: 9, blockedWaits: 0 };
  assert.equal(beforeText(before, 'fixRounds', '', 'QRD Sprint 26'), '8,5 di QRD Sprint 26');
  assert.equal(beforeText(null, 'tickets', '', null), null);
  const fields = shownNumbers(now, before).map(([field]) => field);
  assert.ok(fields.includes('stackedRebases'), 'zero now but not before stays');
  assert.ok(!fields.includes('replans') && !fields.includes('requestChanges'), 'zero in both goes');
  assert.equal(problemLabel('Failure: env'), 'Gagal karena environment');
  assert.equal(problemLabel('Review finding: non-blocking'), 'Temuan review non-blocking');
  assert.equal(problemLabel('Escalated to the owner: BLOCKER'), 'Eskalasi BLOCKER ke kamu');
  assert.equal(keyList(['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4', 'QRD-5']), 'QRD-1, QRD-2, QRD-3 +2');
  assert.equal(buildResult({ result: 'done', hours: 26.3 }), 'selesai · 26,3 j');
  assert.equal(buildResult({ result: 'pr', hours: null }), 'di PR');
  const review = (key: string, result: string, findings: number) => ({ key, title: key, kind: 'review', hours: null, rounds: 0, issues: 0, findings, ownerWaitHours: null, result });
  assert.equal(reviewSummary([review('QRD-1', 'approve', 3), review('QRD-2', 'approve', 4)]), '2 review · semua approve · 7 temuan');
});
