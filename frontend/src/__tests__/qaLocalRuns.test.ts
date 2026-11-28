import assert from 'node:assert';
import test from 'node:test';
import type { QaRun } from '../chat/qa';
import { canRunAgain, canSendFix, compareSprints, fixPastLimit, formatMinutes, itemMatches, matchesFilter, needsAction, notRunBlock, qaLocalSummary, runMinutes, sprintGroups, type QaLocalRow, type QaNotRunRow } from '../lib/qaLocalRuns';

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

const notRun = (key: string, sprint: string | null, prs = 0, openPrs = 0): QaNotRunRow => ({ key, title: null, jiraStatus: 'PR Review', sprint, prs, openPrs });

test('rows group by sprint, newest first and No Sprint last; inside: running, needs action, not run, then the rest', () => {
  const groups = sprintGroups(
    [row('QRD-1559', {}, { sprint: 'QRD Sprint 28' }), row('QRD-1592', { verdict: 'REVISION' }, { sprint: 'QRD Sprint 28' }), row('QRD-1593', { state: 'running', verdict: null }, { sprint: 'QRD Sprint 28' }), row('QRD-1426', {}, { sprint: 'QRD Sprint 26' })],
    [notRun('QRD-1711', 'QRD Sprint 28', 1, 1), notRun('QRD-1517', null)],
  );
  assert.deepStrictEqual(groups.map((group) => group.sprint), ['QRD Sprint 28', 'QRD Sprint 26', 'No Sprint']);
  assert.deepStrictEqual(groups[0].items.map((item) => item.row.key), ['QRD-1593', 'QRD-1592', 'QRD-1711', 'QRD-1559']);
  assert.ok(compareSprints('QRD Sprint 9', 'QRD Sprint 10') > 0);
});

test('Not run yet shows only tickets without a run, All shows both, the run filters never show them', () => {
  const items = sprintGroups([row('QRD-1559')], [notRun('QRD-1711', null, 1, 1)])[0].items;
  assert.deepStrictEqual(items.filter((item) => itemMatches(item, 'notrun')).map((item) => item.row.key), ['QRD-1711']);
  assert.strictEqual(items.filter((item) => itemMatches(item, 'all')).length, 2);
  assert.deepStrictEqual(items.filter((item) => itemMatches(item, 'lolos')).map((item) => item.row.key), ['QRD-1559']);
});

test('Run QA starts only on an open pull request: none says No PR yet, merged ones wait for UAT CHECK', () => {
  assert.strictEqual(notRunBlock({ prs: 1, openPrs: 1 }), null);
  assert.strictEqual(notRunBlock({ prs: 0, openPrs: 0 }), 'No PR yet');
  assert.strictEqual(notRunBlock({ prs: 2, openPrs: 0 }), 'PR merged');
});
