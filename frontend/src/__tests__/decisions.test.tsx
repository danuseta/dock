import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentRun } from '../agents/runs';
import { AnswerSheet } from '../decisions/AnswerSheet';
import { QuestionView } from '../decisions/QuestionView';
import { KEEP, KEEP_EFFECT, OWN, answerText, questionCount, questionsOf, submissionOf, type Draft } from '../decisions/questions';
import { homeAttention } from '../lib/attention';

const issue = (n: number, level: string, status = 'open', options: string[] = [], effects?: Array<string | null>) => ({ n, at: '', type: 'QUESTION', text: `Issue ${n}`, level, status, options, effects });

const run = {
  key: 'QRD-9', kind: 'build', title: 'Sous ticket', stage: 'code', ac: [{ n: 1, state: 'PENDING', text: 'The connection comes back by itself' }], acPassed: 0, acFailed: 0, acTotal: 1,
  activity: 'IDLE', idleSeconds: 0, stalled: false, hasTranscript: false, updatedAt: '', engine: 'sous', confirmedDecisions: [5],
  issues: [issue(3, 'owner', 'open', ['Refresh', 'Log in again'], ['FE calls /auth/refresh first', null]), issue(1, 'arbiter'), issue(2, 'owner', 'resolved')],
  decisions: [
    { n: 1, at: '', text: 'Use the new table', status: 'DECIDED', by: 'owner' },
    { n: 4, at: '', text: 'Backoff 1s to 30s', status: 'SHOV', by: 'sous', effect: 'Reconnects slow down', alts: [{ label: 'Fixed 5s', effect: 'One constant changes' }] },
    { n: 5, at: '', text: 'Name the event workflow:sync', status: 'SHOV', by: 'sous' },
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
  const render = (draft?: Draft) => renderToStaticMarkup(<QuestionView run={run} question={guess} number={2} total={3} draft={draft} readOnly={null} onChange={() => undefined} onPrevious={() => undefined} onNext={() => undefined} />);
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
  const props = { run, questions, drafts, submitting: false, error: null, onOpen: () => undefined, onSubmit: () => undefined };
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
