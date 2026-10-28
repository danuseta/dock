import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentRun } from '../agents/runs';
import { AnswerSheet } from '../decisions/AnswerSheet';
import { QuestionView } from '../decisions/QuestionView';
import { TicketList } from '../decisions/TicketList';
import { KEEP, KEEP_EFFECT, OWN, answerText, liveDrafts, questionCount, readyToSubmit, questionsOf, staleSent, submissionOf, unansweredGuesses, type Draft } from '../decisions/questions';
import { homeAttention, ticketAttention, ticketQuestions } from '../lib/attention';

const issue = (n: number, level: string, status = 'open', options: string[] = [], effects?: Array<string | null>) => ({ n, at: '', type: 'QUESTION', text: `Issue ${n}`, level, status, options, effects });

const run = {
  key: 'QRD-9', kind: 'build', title: 'Sous ticket', stage: 'code', ac: [{ n: 1, state: 'PENDING', text: 'The connection comes back by itself' }], acPassed: 0, acFailed: 0, acTotal: 1,
  activity: 'IDLE', idleSeconds: 0, stalled: false, hasTranscript: false, updatedAt: '', engine: 'sous', confirmedDecisions: [5],
  issues: [issue(3, 'owner', 'open', ['Refresh', 'Log in again'], ['FE calls /auth/refresh first', null]), issue(1, 'arbiter'), issue(2, 'owner', 'resolved')],
  decisions: [
    { n: 1, at: '', text: 'Use the new table', status: 'DECIDED', by: 'owner' },
    { n: 4, at: '', text: 'Backoff 1s to 30s', status: 'GUESS', by: 'sous', effect: 'Reconnects slow down', alts: [{ label: 'Fixed 5s', effect: 'One constant changes' }] },
    { n: 5, at: '', text: 'Name the event workflow:sync', status: 'GUESS', by: 'sous' },
    { n: 6, at: '', text: 'Keep the last state in sessionStorage', status: 'USULAN', by: 'sous' },
  ],
} as AgentRun;

test('a ticket asks its open owner issues first, then the guesses not confirmed yet; a review asks only its issues', () => {
  const questions = questionsOf(run);
  assert.deepStrictEqual(questions.map((question) => question.id), ['I-3', 'D-4', 'D-6']);
  assert.deepStrictEqual(questions.map((question) => question.blocking), [true, false, false], 'only an issue holds the work');
  assert.deepStrictEqual(questions[0].options.map((option) => option.effect), ['FE calls /auth/refresh first', 'Sous goes on with this answer in a new session.'], 'an option without an effect says what happens');
  assert.deepStrictEqual(questions[1].options.map((option) => [option.key, option.label]), [[KEEP, 'Keep what sous built'], ['a0', 'Fixed 5s']]);
  assert.strictEqual(questions[1].detail, 'Reconnects slow down');
  assert.deepStrictEqual(questionsOf({ ...run, kind: 'review' }).map((question) => question.id), ['I-3'], 'a review gives feedback only');
  assert.strictEqual(questionCount([run, { ...run, kind: 'review' }, { ...run, issues: [], decisions: [] }]), 4);
});

test('the answer sheet sends answers, confirms what was kept and changes the rest, and leaves out what is not answered', () => {
  const questions = questionsOf(run);
  const drafts: Record<string, Draft> = {
    'I-3': { choice: 'o0', text: '', unsure: false },
    'D-4': { choice: KEEP, text: '', unsure: true },
    'D-6': { choice: OWN, text: '  Drop it, the reload is fine ', unsure: false },
  };
  assert.deepStrictEqual(submissionOf(questions, drafts), { answers: [{ issue: 3, text: 'Refresh' }], changes: [{ n: 6, choice: 'Drop it, the reload is fine' }], confirms: [4] });
  assert.deepStrictEqual(submissionOf(questions, { ...drafts, 'D-6': { choice: OWN, text: '   ', unsure: false } }).changes, [], 'an empty own answer is not sent');
  assert.deepStrictEqual(submissionOf(questions, { 'D-4': { choice: 'a0', text: '', unsure: false } }), { answers: [], changes: [{ n: 4, choice: 'Fixed 5s' }], confirms: [] });
  assert.strictEqual(answerText(questions[0], undefined), null);
  assert.deepStrictEqual(submissionOf(questions, { 'I-3': { choice: 'o0', text: '', unsure: false, sent: true } }).answers, [], 'a sent answer is not sent again');
});

test('the effect is written under the picked option only', () => {
  const [, guess] = questionsOf(run);
  const render = (draft?: Draft) => renderToStaticMarkup(<QuestionView run={run} question={guess} number={2} total={3} draft={draft} sentCount={0} readOnly={null} guessesLeft={0} onKeepAll={() => undefined} onChange={() => undefined} onPrevious={() => undefined} onNext={() => undefined} />);
  const none = render();
  assert.doesNotMatch(none, new RegExp(KEEP_EFFECT), 'nothing picked, no effect');
  const kept = render({ choice: KEEP, text: '', unsure: false });
  assert.match(kept, /aria-checked="true"[^>]*>.*Keep what sous built<\/span><\/button><div[^>]*><p[^>]*>Nothing changes; it is recorded as confirmed\.<\/p>/);
  assert.doesNotMatch(kept, /One constant changes/, 'the other options keep their effect hidden');
  const own = render({ choice: OWN, text: 'Use 10s', unsure: false });
  assert.match(own, /<textarea[^>]*>Use 10s<\/textarea>/);
  assert.match(own, /Question 2 of 3/);
  assert.match(own, /Sous guessed and went on/);
  assert.match(own, /What it does\.<\/span> Reconnects slow down/);
  assert.match(render(), /Acceptance criteria \(1\)/);
});

test('the answer sheet lists every answer, says what submitting does, and hides Submit on a DOCK that only monitors', () => {
  const questions = questionsOf(run);
  const drafts: Record<string, Draft> = { 'I-3': { choice: 'o1', text: '', unsure: false }, 'D-4': { choice: KEEP, text: '', unsure: true } };
  const props = { run, questions, drafts, submitting: false, error: null, onOpen: () => undefined, onKeepAll: () => undefined, onSubmit: () => undefined };
  const html = renderToStaticMarkup(<AnswerSheet {...props} readOnly={null} />);
  assert.match(html, /2 of 3 answered/);
  assert.match(html, /Log in again/);
  assert.match(html, /Keep what sous built · unsure/);
  assert.match(html, /Not answered/);
  assert.match(html, /If you submit now, sous opens one session for one answer and one guess is recorded as confirmed\. One question stays open, so the pull requests stay draft\./);
  assert.match(html, />Submit</);
  const remote = renderToStaticMarkup(<AnswerSheet {...props} readOnly="This DOCK only monitors." />);
  assert.doesNotMatch(remote, />Submit</);
  assert.match(remote, /This DOCK only monitors\./);
});

test('Home lists pull request and agent problems; sous questions go to Decisions', () => {
  const items = [
    { id: '1', type: 'CONFLICT', message: 'Merge conflict' },
    { id: '2', type: 'AGENT_ISSUE', message: 'Waiting on you: I-3: Refresh?' },
    { id: '3', type: 'AGENT_WAITING', message: 'Waiting on you: I-2: Keep?' },
    { id: '4', type: 'AGENT_WAITING', message: 'Waiting on you: Confirm and start' },
    { id: '5', type: 'AGENT_STALLED', message: 'Quiet for 2 h' },
  ];
  assert.deepStrictEqual(homeAttention(items).map((item) => item.id), ['1', '4', '5']);
});

test('Needs you is one row per ticket, worst signal first, with the sous questions counted on the row', () => {
  const items = [
    { id: 'a', type: 'AGENT_STALLED', message: 'Quiet for 3 h', ticketKey: 'QRD-77' },
    { id: 'b', type: 'AGENT_CHANGES_REQUESTED', message: 'Changes requested on fe#915', ticketKey: 'QRD-91' },
    { id: 'c', type: 'AGENT_CHECKS_FAILING', message: 'Checks failing on fe#915', ticketKey: 'QRD-91' },
    { id: 'd', type: 'CONFLICT', message: 'Merge conflict on chore branch', ticketKey: null },
    { id: 'e', type: 'AGENT_ISSUE', message: 'Waiting on you: I-3: Refresh?', ticketKey: 'QRD-9' },
  ];
  const rows = ticketAttention(items, [...ticketQuestions([run]), { key: 'QRD-5', count: 0, blocking: false }]);
  assert.deepStrictEqual(rows.map((row) => row.id), ['d', 'QRD-91', 'QRD-9', 'QRD-77'], 'a pull request without a ticket keeps its own row; a ticket with no question left drops out');
  assert.deepStrictEqual(rows[1].items.map((item) => item.id), ['c', 'b'], 'failing checks come before requested changes');
  assert.deepStrictEqual(rows[1].groups, ['blocked', 'answer']);
  assert.deepStrictEqual(rows[2].items, [], 'the sous question is counted, not listed as an item');
  assert.deepStrictEqual(rows[2].questions, { key: 'QRD-9', title: 'Sous ticket', count: 3, blocking: true });
  assert.deepStrictEqual(rows[3].groups, ['quiet']);
});

test('Keep all fills only the unanswered sous guesses of the ticket, and is hidden when none is left or the DOCK only monitors', () => {
  const questions = questionsOf(run);
  assert.deepStrictEqual(unansweredGuesses(questions, {}), ['D-4', 'D-6'], 'an issue has no Keep');
  assert.deepStrictEqual(unansweredGuesses(questions, { 'D-4': { choice: 'a0', text: '', unsure: false } }), ['D-6'], 'an answered guess keeps its answer');
  assert.deepStrictEqual(unansweredGuesses(questions, { 'D-6': { choice: KEEP, text: '', unsure: false, sent: true } }), ['D-4'], 'a sent guess is left alone');
  const props = { run, questions, submitting: false, error: null, onOpen: () => undefined, onKeepAll: () => undefined, onSubmit: () => undefined };
  assert.match(renderToStaticMarkup(<AnswerSheet {...props} drafts={{}} readOnly={null} />), />Keep all sous built \(2\)</);
  const kept = { 'D-4': { choice: KEEP, text: '', unsure: false }, 'D-6': { choice: KEEP, text: '', unsure: false } };
  assert.doesNotMatch(renderToStaticMarkup(<AnswerSheet {...props} drafts={kept} readOnly={null} />), /Keep all/);
  assert.doesNotMatch(renderToStaticMarkup(<AnswerSheet {...props} drafts={{}} readOnly="This DOCK only monitors." />), /Keep all/);

  const view = (guessesLeft: number, readOnly: string | null) => renderToStaticMarkup(<QuestionView run={run} question={questions[0]} number={1} total={questions.length} sentCount={0} readOnly={readOnly} guessesLeft={guessesLeft} onKeepAll={() => undefined} onChange={() => undefined} onPrevious={() => undefined} onNext={() => undefined} />);
  assert.match(view(2, null), />Keep all sous built \(2\)</, 'Keep all is offered while answering, not only on the answer sheet');
  assert.doesNotMatch(view(0, null), /Keep all/);
  assert.doesNotMatch(view(2, 'This DOCK only monitors.'), /Keep all/);
});

test('the answer sheet lists what needs a look first and folds the answers already sent', () => {
  const questions = questionsOf(run);
  const drafts: Record<string, Draft> = { 'I-3': { choice: 'o0', text: '', unsure: false, sent: true }, 'D-4': { choice: KEEP, text: '', unsure: true } };
  const html = renderToStaticMarkup(<AnswerSheet run={run} questions={questions} drafts={drafts} submitting={false} error={null} readOnly={null} onOpen={() => undefined} onKeepAll={() => undefined} onSubmit={() => undefined} />);
  assert.ok(html.indexOf('Keep the last state') < html.indexOf('Backoff 1s to 30s'), 'the unanswered question comes before the unsure one');
  assert.match(html, /<summary[^>]*>1 sent, waiting for sous<\/summary>/);
  assert.match(html, /Issue 3 · Refresh/);
});

test('the ticket list is one line per ticket and lays out the open ticket like a calendar', () => {
  const other = { ...run, key: 'QRD-7', title: 'Other ticket', issues: [], decisions: [{ n: 1, at: '', text: 'Guess', status: 'GUESS', by: 'sous' }] } as AgentRun;
  const tickets = [run, other].map((item) => ({ run: item, questions: questionsOf(item) }));
  const html = renderToStaticMarkup(<TicketList tickets={tickets} openKey="QRD-9" drafts={{ 'I-3': { choice: 'o0', text: '', unsure: false } }} q={2} onOpen={() => undefined} />);
  assert.match(html, /2 tickets/);
  assert.match(html, /grid-cols-7/);
  assert.strictEqual(html.match(/aria-label="Question \d+/g)?.length, 3, 'only the open ticket shows its questions');
  assert.match(html, /aria-label="Question 1, answered, sous waits on it"/);
  assert.match(html, /aria-current="step"[^>]*>2</);
  assert.match(html, />1\/3</);
  assert.match(html, />0\/1</);
});

test('a sent answer opens again once sous had its turn and still asks the question, and the sheet says why Submit waits', () => {
  const sent: Draft = { choice: 'o0', text: '', unsure: false, sent: true, sentAt: '2026-10-28T04:52:00.000Z' };
  const after = { activity: 'IDLE', updatedAt: '2026-10-28T05:10:00.000Z' };
  assert.strictEqual(staleSent(sent, after), true, 'the ledger changed after the send and sous is idle');
  assert.strictEqual(staleSent(sent, { ...after, activity: 'ACTIVE' }), false, 'sous is still working on it');
  assert.strictEqual(staleSent(sent, { activity: 'IDLE', updatedAt: '2026-10-28T04:50:00.000Z' }), false, 'sous has not had its turn yet');
  assert.strictEqual(staleSent({ ...sent, sentAt: undefined }, { activity: 'IDLE', updatedAt: '' }), true, 'a send without a time is old');
  assert.strictEqual(staleSent({ choice: 'o0', text: '', unsure: false }, after), false, 'an unsent draft');
  assert.deepStrictEqual(liveDrafts({ 'I-3': sent }, after), { 'I-3': { choice: 'o0', text: '', unsure: false } }, 'the answer stays, ready to send again');

  const questions = questionsOf(run).slice(0, 1);
  const html = renderToStaticMarkup(<AnswerSheet run={run} questions={questions} drafts={{ 'I-3': sent }} submitting={false} error={null} readOnly={null} onOpen={() => undefined} onKeepAll={() => undefined} onSubmit={() => undefined} />);
  assert.match(html, /Nothing new to submit: one answer was sent and sous has not settled it yet\./);
});

test('Ready to submit needs every question answered and at least one answer not sent yet', () => {
  const questions = questionsOf(run).slice(0, 2);
  const keep: Draft = { choice: KEEP, text: '', unsure: false };
  const refresh: Draft = { choice: 'o0', text: '', unsure: false };
  assert.strictEqual(readyToSubmit(questions, { 'I-3': refresh, 'D-4': keep }), true);
  assert.strictEqual(readyToSubmit(questions, { 'I-3': refresh }), false, 'one question is open');
  assert.strictEqual(readyToSubmit(questions, { 'I-3': { ...refresh, sent: true }, 'D-4': { ...keep, sent: true } }), false, 'everything was sent already');
});
