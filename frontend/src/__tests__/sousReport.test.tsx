import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KindBadge } from '../agents/KindBadge';
import { kindLabel, matchesRunFilter, runFilterFromSearch, type AgentRun } from '../agents/runs';
import { SousReport } from '../components/ticket/SousReport';
import { canCancel, openIssues, reportAge, reportDecisions, showsSousReport } from '../lib/sousReport';
import { needsYou } from '../lib/ticketDetail';
import { NeedsYouCard } from '../components/ticket/NeedsYouCard';
import { StackedOnBadge } from '../components/ticket/StackedOnBadge';

const issue = (n: number, level: string, status = 'open') => ({ n, at: '', type: 'QUESTION', text: `Issue ${n}`, level, status, options: [] as string[] });

const run = {
  key: 'QRD-9', title: 'Sous ticket', stage: 'code', ac: [], acPassed: 0, acFailed: 0, acTotal: 0, activity: 'IDLE', idleSeconds: 0, stalled: false, hasTranscript: false, updatedAt: '',
  engine: 'sous', rounds: { used: 2, max: 4 }, draft: true, productionData: false,
  issues: [issue(3, 'owner'), issue(1, 'arbiter'), issue(2, 'owner', 'resolved'), { ...issue(4, 'owner'), options: ['Keep', 'Drop'] }],
  decisions: [
    { n: 1, at: '', text: 'Use the new table', status: 'DECIDED', by: 'owner' },
    { n: 2, at: '', text: 'Keep the export', status: 'SHOV', by: 'arbiter', issue: 1 },
    { n: 3, at: '', text: 'Drop the cache', status: 'CANCELLED', by: 'sous', cancelNote: 'needed by QRD-8' },
    { n: 4, at: '', text: 'Rename the field', status: 'USULAN', by: 'sous' },
  ],
} as AgentRun;

test('the sous report lists owner issues first, oldest first, and decisions newest first', () => {
  assert.strictEqual(showsSousReport(run), true);
  assert.strictEqual(showsSousReport({ engine: null, issues: [], decisions: [{ at: '', text: 'x' }] }), false, 'a run on the older flow has no report');
  const { owner, others } = openIssues(run);
  assert.deepStrictEqual([owner.map((item) => item.n), others.map((item) => item.n)], [[3, 4], [1]]);
  assert.deepStrictEqual(reportDecisions(run).map((item) => item.n), [4, 3, 2, 1]);
  assert.deepStrictEqual(reportDecisions({ decisions: [{ at: '', text: 'old' }, { at: '', text: 'older' }] }).map((item) => item.n), [2, 1], 'old entries count by their place');
  assert.deepStrictEqual(run.decisions!.map(canCancel), [false, true, false, true], 'only SHOV and USULAN can be cancelled');
});

test('the sous report shows Batalkan on each cancellable decision and an answer box on each owner issue', () => {
  const html = renderToStaticMarkup(<SousReport run={run} onAnswer={async () => undefined} onCancel={async () => undefined} busy={false} />);
  assert.match(html, /Laporan sous/);
  assert.match(html, /Round 2 of 4/);
  assert.match(html, /Draft PR/);
  assert.strictEqual(html.match(/>Batalkan</g)?.length, 2);
  assert.match(html, /I-3 · Waiting on you/);
  assert.match(html, /aria-label="Answer to I-4"/);
  assert.match(html, />Keep<.*>Drop</);
  assert.match(html, /Cancelled: needed by QRD-8/);
  assert.ok(html.indexOf('I-3') < html.indexOf('D-4'), 'what waits on the owner comes before the decisions');

  const remote = renderToStaticMarkup(<SousReport run={run} onAnswer={async () => undefined} onCancel={async () => undefined} busy={false} blocked="Answer it there." />);
  assert.doesNotMatch(remote, />Batalkan</);
  assert.doesNotMatch(remote, /Answer to I-/);
  assert.match(remote, /Answer it there\./);
});

test('cards: a Card kind with its own badge and filter', () => {
  assert.strictEqual(kindLabel('card'), 'Card');
  assert.match(renderToStaticMarkup(<KindBadge kind="card" />), />Card</);
  assert.deepStrictEqual(runFilterFromSearch('?kind=card'), { machine: null, kind: 'card' });
  const all = [{ machine: 'laptop', kind: 'card' }, { machine: 'laptop', kind: 'build' }, { machine: 'laptop', kind: 'review' }];
  assert.deepStrictEqual(all.filter((item) => matchesRunFilter(item, { machine: null, kind: 'card' })), [all[0]]);
  assert.deepStrictEqual(all.filter((item) => matchesRunFilter(item, { machine: null, kind: 'task' })), [all[1]], 'a card is not a task');
});

test('a doctor report age reads like people say it', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');
  assert.deepStrictEqual(
    ['2026-10-20T12:00:20.000Z', '2026-10-20T11:55:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-17T12:00:00.000Z'].map((at) => reportAge(at, now)),
    ['just now', '5 min ago', '3 h ago', '3 days ago'],
  );
});

test('on a sous ticket the I-n question is answered only in Laporan sous; other tickets keep their answer buttons', () => {
  const facts = { stage: 'code', finished: false, ac: [], reviewSignal: null, waiting: 'I-4: Keep the export? [Keep|Drop]' };
  const sous = needsYou({ run: { ...facts, engine: 'sous' } });
  assert.deepStrictEqual(sous, [{ id: 'question', kind: 'sous', text: 'I-4: Keep the export?' }]);
  const card = renderToStaticMarkup(<NeedsYouCard items={sous} onAction={() => undefined} onAnswer={async () => undefined} answering={false} />);
  assert.match(card, /Answer in Laporan sous/);
  assert.doesNotMatch(card, />Keep<|Answer the agent|Send the answer/);

  const old = needsYou({ run: { ...facts, engine: null } });
  assert.deepStrictEqual(old[0].kind, 'question');
  assert.match(renderToStaticMarkup(<NeedsYouCard items={old} onAction={() => undefined} onAnswer={async () => undefined} answering={false} />), />Keep<.*>Drop</);
  assert.strictEqual(needsYou({ run: { ...facts, engine: 'sous', waiting: 'Confirm the base branch' } })[0].kind, 'question', 'a sous wait that is not an I-n keeps its answer box');
});

test('while an owner reply or cancel is in flight the Laporan sous buttons are disabled', () => {
  const html = renderToStaticMarkup(<SousReport run={run} onAnswer={async () => undefined} onCancel={async () => undefined} busy />);
  assert.strictEqual(html.match(/disabled=""[^>]*>Batalkan</g)?.length, 2);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Keep</);
});

test('a stacked ticket shows the parent and a link to each of its pull requests', () => {
  const html = renderToStaticMarkup(<StackedOnBadge stack={{ key: 'QRD-1345', be: { pr: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1281', branch: 'feat/QRD-1345-flows' }, fe: null }} />);
  assert.match(html, /Stacked on QRD-1345/);
  assert.match(html, /href="https:\/\/github.com\/qonekid\/ms-admin-worker-backend\/pull\/1281"/);
  assert.match(html, /BE #1281/);
  assert.doesNotMatch(html, /FE #/);
});
