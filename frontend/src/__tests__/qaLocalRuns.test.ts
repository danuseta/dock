import assert from 'node:assert';
import test from 'node:test';
import type { QaRun } from '../chat/qa';
import { canRunAgain, canSendFix, fixPastLimit, formatMinutes, matchesFilter, needsAction, qaLocalSummary, runMinutes, type QaLocalRow } from '../lib/qaLocalRuns';

const run = (extra: Partial<QaRun> = {}): QaRun => ({
  runId: '20261123T144549Z', state: 'done', step: 'judge', steps: [], testCases: [], verdict: 'LOLOS', rule: null, passed: 0, failed: 0, blocked: 0, error: null,
  startedAt: '2026-11-23T14:45:49Z', updatedAt: '2026-11-23T14:54:01Z', finishedAt: '2026-11-23T14:54:01Z', ...extra,
});
const row = (key: string, extra: Partial<QaRun> = {}, more: Partial<QaLocalRow> = {}): QaLocalRow => ({ key, title: null, jiraStatus: null, run: run(extra), runs: 1, fixRound: 0, fixSent: false, sessionId: null, ...more });

test('the filters: running, needs action (REVISION, ESCALATED, a dead run) and lolos', () => {
  const rows = [row('QRD-1594', { state: 'running', verdict: null }), row('QRD-1570', { verdict: 'REVISION' }), row('QRD-1579', { verdict: 'ESCALATED' }), row('QRD-1601', { state: 'failed', verdict: null }), row('QRD-1559')];
  assert.deepStrictEqual(rows.filter((item) => matchesFilter(item, 'running')).map((item) => item.key), ['QRD-1594']);
  assert.deepStrictEqual(rows.filter(needsAction).map((item) => item.key), ['QRD-1570', 'QRD-1579', 'QRD-1601']);
  assert.deepStrictEqual(rows.filter((item) => matchesFilter(item, 'lolos')).map((item) => item.key), ['QRD-1559']);
  assert.strictEqual(rows.filter((item) => matchesFilter(item, 'all')).length, 5);
  assert.deepStrictEqual(qaLocalSummary(rows), { running: 1, lolos: 1, revision: 1, escalated: 1, failed: 1, medianMinutes: 8.2 });
});

test('run time: to the finish, or to now while running; short labels', () => {
  assert.strictEqual(formatMinutes(runMinutes(run())), '8m');
  assert.strictEqual(formatMinutes(runMinutes(run({ state: 'running', finishedAt: null }), Date.parse('2026-11-23T14:51:49Z'))), '6m');
  assert.strictEqual(formatMinutes(runMinutes(run({ finishedAt: '2026-11-23T14:45:49Z' }))), '0s');
  assert.strictEqual(formatMinutes(95), '1h 35m');
  assert.strictEqual(formatMinutes(runMinutes(run({ startedAt: null }))), '-');
});

test('Run again once a run stopped; Send fix on a REVISION not sent yet, confirmed past two rounds', () => {
  assert.strictEqual(canRunAgain(row('A', { state: 'running' })), false);
  assert.strictEqual(canRunAgain(row('A', { state: 'failed' })), true);
  assert.strictEqual(canSendFix(row('A', { verdict: 'REVISION' })), true);
  assert.strictEqual(canSendFix(row('A', { verdict: 'REVISION' }, { fixSent: true })), false);
  assert.strictEqual(canSendFix(row('A', { verdict: 'ESCALATED' })), false);
  assert.strictEqual(fixPastLimit(row('A', { verdict: 'REVISION' }, { fixRound: 1 })), false);
  assert.strictEqual(fixPastLimit(row('A', { verdict: 'REVISION' }, { fixRound: 2 })), true);
});

test('a preparing QA session counts as live: Running filter and card, no Run again, time so far', () => {
  const preparing = row('QRD-1593', { state: 'preparing', verdict: null, runId: '', finishedAt: null, updatedAt: '2026-11-23T14:45:49Z' });
  assert.strictEqual(matchesFilter(preparing, 'running'), true);
  assert.strictEqual(qaLocalSummary([preparing]).running, 1);
  assert.strictEqual(canRunAgain(preparing), false);
  assert.strictEqual(formatMinutes(runMinutes(preparing.run, Date.parse('2026-11-23T14:55:49Z'))), '10m');
});
