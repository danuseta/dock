import assert from 'node:assert';
import test from 'node:test';
import {
  canSubmitQuestion, closedSince, countdown, freshLines, isAnswerable, parseBody, permissionAnswer, permissionButtons, planAnswer, planTextFor, questionAnswer, questionDismissal, settledOutcome, settle, toggleChoice, visiblePending,
  type ChatInteraction, type QuestionItem,
} from '../chat/interactions/interactions';

const NOW = Date.parse('2026-10-12T10:00:00.000Z');
const interaction = (id: number, kind: string, body: unknown, over: Partial<ChatInteraction> = {}): ChatInteraction => ({
  id, sessionId: 's1', turnId: 7, kind, title: 'Run a command', body: typeof body === 'string' ? body : JSON.stringify(body), state: 'pending',
  createdAt: '2026-10-12T09:59:00.000Z', expiresAt: '2026-10-12T10:10:00.000Z', answeredAt: null, ...over,
});
const permission = { tool: 'Bash', label: 'Run a command', summary: 'npm test', detail: 'npm test -- --watch=false', agent: null, alwaysLabel: 'Bash(npm test:*)' };
const questions: QuestionItem[] = [
  { question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'SQLite', description: 'file' }, { label: 'Postgres', description: 'server' }] },
  { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'lint', description: '' }, { label: 'test', description: '' }, { label: 'build', description: '' }] },
];

test('interaction bodies parse per kind and reject anything malformed', () => {
  assert.deepStrictEqual(parseBody(interaction(1, 'permission', permission)), { kind: 'permission', ...permission });
  const bare = parseBody(interaction(1, 'permission', { tool: 'Bash', label: 'Run', summary: 's', detail: 'd' }));
  assert.deepStrictEqual(bare, { kind: 'permission', tool: 'Bash', label: 'Run', summary: 's', detail: 'd', agent: null, alwaysLabel: null });
  assert.strictEqual(parseBody(interaction(2, 'question', { questions }))?.kind, 'question');
  assert.deepStrictEqual(parseBody(interaction(3, 'plan', { planChars: 120 })), { kind: 'plan', planChars: 120 });
  assert.strictEqual(parseBody(interaction(4, 'permission', '{not json')), null);
  assert.strictEqual(parseBody(interaction(5, 'permission', { tool: 3 })), null);
  assert.strictEqual(parseBody(interaction(6, 'question', { questions: [] })), null);
  assert.strictEqual(parseBody(interaction(7, 'weird', {})), null);
  assert.strictEqual(parseBody(interaction(8, 'permission', '[]')), null);
});

test('countdown reads as minutes and seconds and flips to expired', () => {
  assert.deepStrictEqual(countdown('2026-10-12T10:09:42.000Z', NOW), { text: '9:42', expired: false });
  assert.deepStrictEqual(countdown('2026-10-12T10:00:05.000Z', NOW), { text: '0:05', expired: false });
  assert.deepStrictEqual(countdown('2026-10-12T10:00:00.000Z', NOW), { text: 'Expired', expired: true });
  assert.deepStrictEqual(countdown('2026-10-12T09:00:00.000Z', NOW), { text: 'Expired', expired: true });
  assert.deepStrictEqual(countdown('garbage', NOW), { text: 'Expired', expired: true });
});

test('only a pending, unexpired ask can be answered', () => {
  assert.strictEqual(isAnswerable(interaction(1, 'plan', {}), NOW), true);
  assert.strictEqual(isAnswerable(interaction(1, 'plan', {}, { state: 'answered' }), NOW), false);
  assert.strictEqual(isAnswerable(interaction(1, 'plan', {}, { state: 'expired' }), NOW), false);
  assert.strictEqual(isAnswerable(interaction(1, 'plan', {}, { state: 'cancelled' }), NOW), false);
  assert.strictEqual(isAnswerable(interaction(1, 'plan', {}, { expiresAt: '2026-10-12T09:59:59.000Z' }), NOW), false);
});

test('permission buttons: always allow only when the machine offered a rule', () => {
  assert.deepStrictEqual(permissionButtons({ alwaysLabel: 'Bash(npm test:*)' }), ['deny', 'allow', 'allow_session']);
  assert.deepStrictEqual(permissionButtons({ alwaysLabel: null }), ['deny', 'allow']);
  assert.deepStrictEqual(permissionButtons({ alwaysLabel: '' }), ['deny', 'allow']);
});

test('permission and plan answers carry the decision and a trimmed note', () => {
  assert.deepStrictEqual(permissionAnswer('allow_session'), { decision: 'allow_session' });
  assert.deepStrictEqual(permissionAnswer('deny'), { decision: 'deny' });
  assert.deepStrictEqual(planAnswer('approve', ''), { decision: 'approve' });
  assert.deepStrictEqual(planAnswer('approve_edits', '  '), { decision: 'approve_edits' });
  assert.deepStrictEqual(planAnswer('reject', '  use a smaller diff  '), { decision: 'reject', note: 'use a smaller diff' });
  assert.strictEqual(planAnswer('reject', 'x'.repeat(900)).note?.length, 500);
});

test('choices: single select swaps, multi select toggles', () => {
  assert.deepStrictEqual(toggleChoice([], 'a', false), ['a']);
  assert.deepStrictEqual(toggleChoice(['a'], 'b', false), ['b']);
  assert.deepStrictEqual(toggleChoice(['a'], 'a', false), []);
  assert.deepStrictEqual(toggleChoice(['a'], 'b', true), ['a', 'b']);
  assert.deepStrictEqual(toggleChoice(['a', 'b'], 'a', true), ['b']);
});

test('question answers: every question needs a choice or an other text', () => {
  assert.strictEqual(canSubmitQuestion(questions, [{ picked: [0], other: '' }, { picked: [], other: '' }]), false);
  assert.strictEqual(canSubmitQuestion(questions, [{ picked: [0], other: '' }]), false);
  assert.strictEqual(canSubmitQuestion(questions, [{ picked: [0], other: '' }, { picked: [], other: '  ' }]), false);
  assert.strictEqual(canSubmitQuestion(questions, [{ picked: [0], other: '' }, { picked: [0, 1], other: '' }]), true);
  assert.strictEqual(canSubmitQuestion(questions, [{ picked: [], other: 'something else' }, { picked: [0], other: '' }]), true);

  assert.deepStrictEqual(
    questionAnswer(questions, [{ picked: [0], other: '' }, { picked: [0, 1], other: '' }]),
    { decision: 'answer', answers: [{ index: 0, labels: ['SQLite'], other: null }, { index: 1, labels: ['lint', 'test'], other: null }] },
  );
  assert.deepStrictEqual(
    questionAnswer(questions, [{ picked: [0], other: '  libsql  ' }, { picked: [0], other: '' }])?.answers[0],
    { index: 0, labels: [], other: 'libsql' },
    'an other text replaces the chosen options',
  );
  assert.strictEqual(questionAnswer(questions, [{ picked: [], other: '' }, { picked: [], other: '' }]), null);
  assert.deepStrictEqual(questionDismissal(), { decision: 'deny' });
});

test('question options are chosen by position, so two options with one label do not toggle together', () => {
  const twins: QuestionItem[] = [{
    question: 'Which?', header: 'Pick', multiSelect: true,
    options: [{ label: 'same', description: 'first' }, { label: 'same', description: 'second' }, { label: 'other', description: '' }],
  }];
  const second = toggleChoice<number>([], 1, true);
  assert.deepStrictEqual(second, [1]);
  assert.deepStrictEqual(toggleChoice(second, 0, true), [1, 0], 'choosing the first leaves the second chosen');
  assert.deepStrictEqual(toggleChoice([1, 0], 1, true), [0], 'clearing the second leaves the first chosen');
  assert.deepStrictEqual(questionAnswer(twins, [{ picked: [1], other: '' }])?.answers, [{ index: 0, labels: ['same'], other: null }]);
  assert.deepStrictEqual(questionAnswer(twins, [{ picked: [0, 1, 2], other: '' }])?.answers[0].labels, ['same', 'same', 'other']);
  assert.deepStrictEqual(questionAnswer(twins, [{ picked: [9], other: '' }])?.answers[0].labels, [], 'a position outside the list adds nothing');
});

test('closed asks: the outcome line says what happened', () => {
  assert.strictEqual(settledOutcome('permission', 'allow'), 'Allowed');
  assert.strictEqual(settledOutcome('permission', 'allow_session'), 'Allowed for this session');
  assert.strictEqual(settledOutcome('permission', 'deny'), 'Denied');
  assert.strictEqual(settledOutcome('question', 'answer'), 'Answered');
  assert.strictEqual(settledOutcome('question', 'deny'), 'Dismissed');
  assert.strictEqual(settledOutcome('plan', 'approve'), 'Plan approved');
  assert.strictEqual(settledOutcome('plan', 'approve_edits'), 'Plan approved, edits allowed');
  assert.strictEqual(settledOutcome('plan', 'reject'), 'Plan sent back');
  assert.strictEqual(settledOutcome('permission', 'expired'), 'Expired');
  assert.strictEqual(settledOutcome('permission', 'cancelled'), 'Cancelled');
});

test('a card that leaves the pending list becomes expired or cancelled, an answered one is not repeated', () => {
  const first = interaction(1, 'permission', permission);
  const second = interaction(2, 'permission', permission, { expiresAt: '2026-10-12T09:59:30.000Z' });
  const third = interaction(3, 'plan', {});
  const closed = closedSince([first, second, third], [first], [{ id: 3, kind: 'plan', title: 'Plan ready', outcome: 'Plan approved', at: NOW - 1000 }], NOW);
  assert.deepStrictEqual(closed.map((entry) => [entry.id, entry.outcome]), [[2, 'Expired']]);
  assert.deepStrictEqual(closedSince([first], [first], [], NOW), []);
  const cancelled = closedSince([first], [], [], NOW);
  assert.deepStrictEqual(cancelled.map((entry) => [entry.id, entry.outcome]), [[1, 'Cancelled']]);
  const answeredElsewhere = closedSince(
    [first, second, third],
    [],
    [],
    NOW,
    [{ id: 1, state: 'answered', decision: 'allow_session' }, { id: 2, state: 'expired' }, { id: 3, state: 'answered', decision: 'approve' }],
  );
  assert.deepStrictEqual(answeredElsewhere.map((entry) => entry.outcome), ['Allowed for this session', 'Expired', 'Plan approved']);
  assert.deepStrictEqual(closedSince([first], [], [], NOW, [{ id: 1, state: 'cancelled' }]).map((entry) => entry.outcome), ['Cancelled']);
  assert.deepStrictEqual(closedSince([first], [], [], NOW, [{ id: 1, state: 'answered', decision: 'deny' }]).map((entry) => entry.outcome), ['Denied']);
});

test('the pending list hides what was answered here, and a settled log stays short and fresh', () => {
  const list = [interaction(1, 'permission', permission), interaction(2, 'plan', {}), interaction(3, 'plan', {}, { state: 'answered' })];
  const log = settle([], { id: 1, kind: 'permission', title: 'x', outcome: 'Allowed', at: NOW }, NOW);
  assert.deepStrictEqual(visiblePending(list, log).map((item) => item.id), [2]);
  assert.strictEqual(settle(log, { id: 1, kind: 'permission', title: 'x', outcome: 'Denied', at: NOW }, NOW).length, 1, 'one line per ask');

  let many = log;
  for (let id = 10; id < 16; id += 1) many = settle(many, { id, kind: 'plan', title: 'p', outcome: 'Plan approved', at: NOW }, NOW);
  assert.strictEqual(many.length, 3);
  assert.deepStrictEqual(many.map((entry) => entry.id), [13, 14, 15]);
  const later = settle(many, { id: 99, kind: 'plan', title: 'p', outcome: 'Plan approved', at: NOW + 6 * 60 * 1000 }, NOW + 6 * 60 * 1000);
  assert.deepStrictEqual(later.map((entry) => entry.id), [99], 'lines older than five minutes drop away');
  assert.deepStrictEqual(freshLines(many, NOW + 6 * 60 * 1000), []);
  assert.strictEqual(freshLines(many, NOW + 1000).length, 3);
});

test('the plan text is the newest assistant reply of the turn', () => {
  const row = (id: number, role: string, text: string) => ({ id, sessionId: 's1', role, text, state: 'done', at: '' });
  const messages = [row(5, 'assistant', 'old'), row(7, 'user', 'plan it'), row(8, 'tool', 'Read a file'), row(9, 'assistant', 'step one'), row(10, 'assistant', 'the plan')];
  assert.strictEqual(planTextFor(messages, 7), 'the plan');
  assert.strictEqual(planTextFor(messages, 10), null);
  assert.strictEqual(planTextFor([], 7), null);
});
