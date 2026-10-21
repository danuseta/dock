import assert from 'node:assert';
import test from 'node:test';
import { isLongDescription, jiraAcLines, needsYou, runState, splitChoices, stepIndex } from '../lib/ticketDetail';

const run = { waiting: null, stalled: false, finished: false, stage: 'code', ac: [], reviewSignal: null };

test('the step of a stage folds evidence and commit into Verify, and an unknown stage is off the steps', () => {
  assert.strictEqual(stepIndex('plan'), 1);
  assert.strictEqual(stepIndex('evidence'), stepIndex('verify'));
  assert.strictEqual(stepIndex('commit'), stepIndex('verify'));
  assert.strictEqual(stepIndex('blocked'), -1);
  assert.strictEqual(stepIndex(null), -1);
});

test('the run label reads none, waiting, stalled, running or finished', () => {
  assert.strictEqual(runState(null), 'none');
  assert.strictEqual(runState(run), 'running');
  assert.strictEqual(runState({ ...run, stalled: true }), 'stalled');
  assert.strictEqual(runState({ ...run, waiting: 'Keep tags?' }), 'waiting');
  assert.strictEqual(runState({ ...run, waiting: 'Keep tags?', finished: true }), 'finished');
  assert.strictEqual(runState({ ...run, stage: 'pr' }), 'pr', 'an open PR waits for review, it is not running');
  assert.strictEqual(runState({ ...run, stage: 'pr', stalled: true }), 'pr');
  assert.strictEqual(runState({ ...run, stage: 'pr', waiting: 'Keep tags?' }), 'waiting');
});

test('needs you is empty when nothing waits on the owner', () => {
  assert.deepStrictEqual(needsYou({ run: null, pullRequests: [] }), []);
  assert.deepStrictEqual(needsYou({ run, pullRequests: [{ id: '1', repo: 'web', number: 3, status: 'OPEN' }] }), []);
});

test('needs you lists the question first, then failing AC, review and conflicts', () => {
  const items = needsYou({
    run: { ...run, stage: 'pr', waiting: 'Keep the tag filter?', reviewSignal: 'checks_failing', ac: [{ n: 1, state: 'PASS', text: 'Folder' }, { n: 2, state: 'FAIL', text: 'Tags filter' }] },
    pullRequests: [{ id: 'p1', repo: 'web', pullNumber: 12, status: 'CONFLICT' }],
  });
  assert.deepStrictEqual(items.map((item) => item.kind), ['question', 'ac', 'review', 'conflict']);
  assert.strictEqual(items[1].text, 'Tags filter');
  assert.strictEqual(items[3].text, 'web#12 has a merge conflict');
});

test('a finished run asks nothing', () => {
  assert.deepStrictEqual(needsYou({ run: { ...run, stage: 'done', finished: true, waiting: 'old' } }), []);
});

test('a description folds when it runs past eight lines', () => {
  assert.strictEqual(isLongDescription('one\ntwo'), false);
  assert.strictEqual(isLongDescription(Array.from({ length: 9 }, () => 'line').join('\n')), true);
  assert.strictEqual(isLongDescription('x'.repeat(2000)), true);
  assert.strictEqual(isLongDescription(null), false);
});

test('answers in brackets at the end of the question become buttons', () => {
  assert.deepStrictEqual(splitChoices('Keep the tag filter? [Keep|Drop]'), { question: 'Keep the tag filter?', choices: ['Keep', 'Drop'] });
  assert.deepStrictEqual(splitChoices('Which base? [ develop | feat/V1-Playbook | main ]'), { question: 'Which base?', choices: ['develop', 'feat/V1-Playbook', 'main'] });
  assert.deepStrictEqual(splitChoices('Approve the plan?'), { question: 'Approve the plan?', choices: [] });
  assert.deepStrictEqual(splitChoices('See [this link] first'), { question: 'See [this link] first', choices: [] });
  assert.deepStrictEqual(needsYou({ run: { ...run, waiting: 'Keep it? [Keep|Drop]' } })[0], { id: 'question', kind: 'question', text: 'Keep it?', choices: ['Keep', 'Drop'] });
});

test('the Jira Acceptance Criteria field reads as one criterion per line without its marker', () => {
  assert.deepStrictEqual(jiraAcLines('- User can rename a folder\n\n* Rename is saved\n[ ] Empty name shows an error\n2) Works with search'), [
    'User can rename a folder', 'Rename is saved', 'Empty name shows an error', 'Works with search',
  ]);
  assert.deepStrictEqual(jiraAcLines(null), []);
  assert.deepStrictEqual(jiraAcLines('  \n '), []);
});
