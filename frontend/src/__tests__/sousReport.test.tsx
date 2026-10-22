import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KindBadge } from '../agents/KindBadge';
import { kindLabel, matchesRunFilter, runFilterFromSearch, runFilterSearch, runKeyFromSearch, type AgentRun } from '../agents/runs';
import { RunDecisions } from '../agents/RunDecisions';
import { RunQuestions } from '../agents/RunQuestions';
import { isGuess, openIssues, ownerChecks, reportAge, reportDecisions, waitsOnOwner } from '../lib/sousReport';
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
  const { owner, others } = openIssues(run);
  assert.deepStrictEqual([owner.map((item) => item.n), others.map((item) => item.n)], [[3, 4], [1]]);
  assert.deepStrictEqual(reportDecisions(run).map((item) => item.n), [4, 3, 2, 1]);
  assert.deepStrictEqual(reportDecisions({ decisions: [{ at: '', text: 'old' }, { at: '', text: 'older' }] }).map((item) => item.n), [2, 1], 'old entries count by their place');
  assert.deepStrictEqual(run.decisions!.map(isGuess), [false, true, false, true], 'only SHOV and USULAN are guesses the owner settles');
});

test('the run panel asks each owner issue with an answer box, oldest first', () => {
  const html = renderToStaticMarkup(<RunQuestions run={run} onAnswer={async () => undefined} busy={false} />);
  assert.match(html, /Waiting on you · 2/);
  assert.match(html, /aria-label="Answer to I-3"/);
  assert.match(html, /aria-label="Answer to I-4"/);
  assert.match(html, />Keep<.*>Drop</);
  assert.ok(html.indexOf('I-3') < html.indexOf('I-4'), 'oldest first');

  const remote = renderToStaticMarkup(<RunQuestions run={run} onAnswer={async () => undefined} busy={false} readOnly="Answer it there." />);
  assert.doesNotMatch(remote, /Answer to I-/);
  assert.match(remote, /Answer it there\./);
});

test('decisions read in plain English, fold at three, and only an agent ruling or proposal can be confirmed or changed', () => {
  const html = renderToStaticMarkup(<RunDecisions run={run} onConfirm={async () => undefined} onChange={async () => undefined} busy={false} />);
  assert.doesNotMatch(html, />(SHOV|USULAN|DECIDED)</, 'the raw ledger status stays in the tooltip');
  assert.match(html, /title="Ledger status SHOV"[^>]*>Agent ruling</);
  assert.match(html, /title="Ledger status USULAN"[^>]*>Proposal</);
  assert.strictEqual(html.match(/>Confirm</g)?.length, 2);
  assert.strictEqual(html.match(/>Change</g)?.length, 2);
  assert.match(html, /2 to confirm/);
  assert.match(html, />Confirm all except…</);
  assert.match(html, /Cancelled: needed by QRD-8/);
  assert.match(html, /by arbiter · answers I-1/);
  assert.doesNotMatch(html, /D-1</, 'the fourth decision is folded');
  assert.match(html, /Show all 4 · 1 cancelled/);
  const old = renderToStaticMarkup(<RunDecisions run={{ ...run, decisions: [{ at: '', text: 'old' }] }} onConfirm={async () => undefined} onChange={async () => undefined} busy={false} />);
  assert.doesNotMatch(old, /by owner|Your decision/, 'an entry without by names nobody');
  assert.match(old, />Recorded</);

  const remote = renderToStaticMarkup(<RunDecisions run={run} onConfirm={async () => undefined} onChange={async () => undefined} busy={false} readOnly="Answer it there." />);
  assert.doesNotMatch(remote, />(Confirm|Change)</);
});

test('a confirmed guess is marked, the effect and the other options are shown, and only unsettled items wait on the owner', () => {
  const settled = { ...run, kind: 'build', confirmedDecisions: [2], decisions: [...run.decisions!, { n: 5, at: '', text: 'Disable Save on an empty form', status: 'SHOV', by: 'sous', effect: 'Save stays grey until a field is filled', alts: [{ label: 'Show an error on Save', effect: 'the button stays active' }] }] } as AgentRun;
  const checks = ownerChecks(settled);
  assert.deepStrictEqual([checks.issues.map((item) => item.n), checks.decisions.map((item) => item.n)], [[3, 4], [4, 5]], 'D-2 is confirmed; oldest first');
  assert.strictEqual(waitsOnOwner(settled), true);
  assert.strictEqual(waitsOnOwner({ ...settled, kind: 'review' }), false, 'a review gives feedback only');
  assert.strictEqual(waitsOnOwner({ ...settled, issues: [], confirmedDecisions: [2, 4, 5] }), false);
  const html = renderToStaticMarkup(<RunDecisions run={{ ...settled, decisions: [run.decisions![1], settled.decisions![4]] }} onConfirm={async () => undefined} onChange={async () => undefined} busy={false} />);
  assert.match(html, /D-2<\/span>.*Confirmed by you/);
  assert.strictEqual(html.match(/>Confirm</g)?.length, 1, 'a confirmed guess offers nothing more');
  assert.match(html, /Effect:<\/b> Save stays grey until a field is filled/);
  assert.match(html, /Other option:<\/b> Show an error on Save \(the button stays active\)/);
  const pending = renderToStaticMarkup(<RunDecisions run={settled} onConfirm={async () => undefined} onChange={async () => undefined} busy={false} pendingOnly />);
  assert.deepStrictEqual(pending.match(/D-\d+/g), ['D-5', 'D-4'], 'only what waits, unfolded');
  const asked = renderToStaticMarkup(<RunQuestions run={{ ...run, issues: [{ ...issue(7, 'owner'), options: ['Hard', 'Soft'], effects: ['gone for good', null] }] }} onAnswer={async () => undefined} busy={false} />);
  assert.match(asked, /Hard:<\/b> gone for good/);
  assert.match(asked, /Soft:<\/b> no effect given/);
});

test('a /agents?run=KEY link names the run and survives a filter change', () => {
  assert.strictEqual(runKeyFromSearch('?run=QRD-1412'), 'QRD-1412');
  assert.strictEqual(runKeyFromSearch(''), null);
  assert.strictEqual(runFilterSearch('?run=QRD-1412', { kind: 'review' }), '?run=QRD-1412&kind=review');
});

test('cards: a free task with its own badge, tooltip and filter', () => {
  assert.strictEqual(kindLabel('card'), 'Free task');
  assert.match(renderToStaticMarkup(<KindBadge kind="card" />), /title="No Jira ticket"[^>]*>.*Free task</);
  assert.deepStrictEqual(runFilterFromSearch('?kind=card'), { kind: 'card' });
  const all = [{ kind: 'card' }, { kind: 'build' }, { kind: 'review' }];
  assert.deepStrictEqual(all.filter((item) => matchesRunFilter(item, { kind: 'card' })), [all[0]]);
  assert.deepStrictEqual(all.filter((item) => matchesRunFilter(item, { kind: 'task' })), [all[1]], 'a card is not a task');
});

test('a doctor report age reads like people say it', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');
  assert.deepStrictEqual(
    ['2026-10-20T12:00:20.000Z', '2026-10-20T11:55:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-17T12:00:00.000Z'].map((at) => reportAge(at, now)),
    ['just now', '5 min ago', '3 h ago', '3 days ago'],
  );
});

test('on a sous ticket the I-n question is answered only on Agents; other tickets keep their answer buttons', () => {
  const facts = { stage: 'code', finished: false, ac: [], reviewSignal: null, waiting: 'I-4: Keep the export? [Keep|Drop]' };
  const sous = needsYou({ run: { ...facts, engine: 'sous' } });
  assert.deepStrictEqual(sous, [{ id: 'question', kind: 'sous', text: 'I-4: Keep the export?' }]);
  const card = renderToStaticMarkup(<NeedsYouCard items={sous} onAction={() => undefined} onAnswer={async () => undefined} answering={false} />);
  assert.match(card, /Answer in Agents →/);
  assert.doesNotMatch(card, />Keep<|Answer the agent|Send the answer/);

  const old = needsYou({ run: { ...facts, engine: null } });
  assert.deepStrictEqual(old[0].kind, 'question');
  assert.match(renderToStaticMarkup(<NeedsYouCard items={old} onAction={() => undefined} onAnswer={async () => undefined} answering={false} />), />Keep<.*>Drop</);
  assert.strictEqual(needsYou({ run: { ...facts, engine: 'sous', waiting: 'Confirm the base branch' } })[0].kind, 'question', 'a sous wait that is not an I-n keeps its answer box');
});

test('while an owner reply or cancel is in flight the run panel buttons are disabled', () => {
  assert.strictEqual(renderToStaticMarkup(<RunDecisions run={run} onConfirm={async () => undefined} onChange={async () => undefined} busy />).match(/disabled=""[^>]*>Confirm</g)?.length, 2);
  assert.match(renderToStaticMarkup(<RunQuestions run={run} onAnswer={async () => undefined} busy />), /<button[^>]*disabled=""[^>]*>Keep</);
});

test('a stacked ticket shows the parent and a link to each of its pull requests', () => {
  const html = renderToStaticMarkup(<StackedOnBadge stack={{ key: 'QRD-1345', be: { pr: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1281', branch: 'feat/QRD-1345-flows' }, fe: null }} />);
  assert.match(html, /Stacked on QRD-1345/);
  assert.match(html, /href="https:\/\/github.com\/qonekid\/ms-admin-worker-backend\/pull\/1281"/);
  assert.match(html, /BE #1281/);
  assert.doesNotMatch(html, /FE #/);
});
