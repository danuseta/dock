import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatActivity } from '../chat/activity/activity';
import { FixLoopBox } from '../chat/activity/AgentThread';
import { threadMessages } from '../chat/activity/transcript';
import { CheckpointEntry } from '../chat/CheckpointCard';
import { fixLoopText, lastCheckpointLabel, latestCheckpoint, stepLabel, stepRound, stepStage, type Checkpoint } from '../chat/checkpoints';
import { fixLoops, foldLoops, labelTask } from '../chat/fixLoops';

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 20, 4, minute, second)).toISOString();
let nextId = 1;
const call = (eventId: string, name: string, label: string, minute: number, extra: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 1, eventId, parentId: 'runner', kind: 'agent', agent: 'main', name, label: `Agent ${name}: ${label}`, summary: '',
    status: 'ok', hasDetail: false, seq: id, startedAt: at(minute), endedAt: at(minute, 50), ...extra,
  };
};
const step = (eventId: string, minute: number, second: number): ChatActivity => ({ ...call(eventId, 'Bash', 'node status.cjs', minute), kind: 'tool', name: 'Bash', label: 'node K/status.cjs set QRD-1559 note=..', startedAt: at(minute, second) });
const checkpoint = (id: string, stepName: string, minute: number, extra: Partial<Checkpoint> = {}): Checkpoint => ({
  id, key: 'QRD-1559', step: stepName, agentId: null, agent: 'sous-verifier', text: `${stepName} text`, untestable: [], missingData: [], at: at(minute, 30), ...extra,
});

const mockup = () => {
  const calls = [
    call('x1', 'sous-explorer', 'trace T1', 32),
    call('w1', 'sous-ticket-worker', 'T1 write bench', 33),
    call('v1', 'sous-verifier', 'T1 verify', 35),
    call('w2', 'sous-ticket-worker', 'T1 fix calculate path', 47),
    call('v2', 'sous-verifier', 'T1 verify again', 48),
    call('w3', 'sous-ticket-worker', 'T1 fix latestValue type', 49),
    call('v3', 'sous-verifier', 'T1 verify round 3', 50, { status: 'running', endedAt: null }),
  ];
  const checkpoints = [
    checkpoint('c0', 'T1-verify', 32, { agent: 'sous-explorer' }),
    checkpoint('r1', 'T1-round-1', 46, { text: '1 of 12 tests fails: write bench 50k still loads every row. Back to the worker.' }),
    checkpoint('r2', 'T1-round-2', 48, { text: 'tsc fails: dataPointHandler.ts:1021 type of latestValue. Back to the worker.' }),
  ];
  return { calls, checkpoints };
};

test('a round step maps to verify with its task and reads as its round', () => {
  assert.deepStrictEqual(stepRound('T1-round-2'), { task: 'T1', round: 2 });
  assert.deepStrictEqual(stepRound('t3-ROUND-10'), { task: 'T3', round: 10 });
  assert.strictEqual(stepRound('T1-verify'), null);
  assert.strictEqual(stepRound('T1-round-x'), null);
  assert.deepStrictEqual(stepStage('T1-round-2'), { stage: 'verify', task: 'T1' });
  assert.strictEqual(stepLabel('T1-round-2'), 'Verify · T1 · round 2');
  assert.strictEqual(stepLabel('T1-verify'), 'Verify · T1', 'the passing verify checkpoint keeps its label');
});

test('the panel names the newest checkpoint, a round as failed, and the loop while the newest is a round', () => {
  const { checkpoints } = mockup();
  const latest = latestCheckpoint([checkpoints[2], checkpoints[0], checkpoints[1]]);
  assert.strictEqual(latest?.id, 'r2', 'newest by time, whatever the order');
  assert.strictEqual(lastCheckpointLabel(latest!), 'Verify · T1 · round 2 failed');
  assert.strictEqual(lastCheckpointLabel(checkpoints[0]), 'Verify · T1');
  assert.strictEqual(fixLoopText(checkpoints), 'fix loop, 3 rounds', 'round 2 failed, round 3 runs');
  assert.strictEqual(fixLoopText([...checkpoints, checkpoint('p', 'T1-verify', 52)]), null, 'the passing verify ends the loop line');
  assert.strictEqual(fixLoopText([]), null);
  assert.strictEqual(latestCheckpoint([]), null);
});

test('consecutive worker and verifier runs on one task form a fix loop with a round per verifier', () => {
  const { calls, checkpoints } = mockup();
  const loops = fixLoops(calls, checkpoints);
  assert.strictEqual(loops.length, 1);
  const [loop] = loops;
  assert.strictEqual(loop.task, 'T1');
  assert.deepStrictEqual(loop.calls, ['w1', 'v1', 'w2', 'v2', 'w3', 'v3'], 'the explorer stays out');
  assert.strictEqual(loop.rounds, 3);
  assert.deepStrictEqual(['w1', 'v1', 'w2', 'v2', 'w3', 'v3'].map((id) => loop.roundOf.get(id)), [1, 1, 2, 2, 3, 3]);
  assert.deepStrictEqual([...loop.notes].map(([id, list]) => [id, list.map((item) => item.id)]), [['v1', ['r1']], ['v2', ['r2']]]);
});

test('a task the description does not name comes from the checkpoint the agent wrote or the task the runner was on', () => {
  assert.strictEqual(labelTask('T12 fix filter'), 'T12');
  assert.strictEqual(labelTask('Fix the TTL cache'), null);
  const calls = [
    call('w1', 'sous-ticket-worker', 'write the filter', 10),
    call('v1', 'sous-verifier', 'run the tests', 12),
    call('w2', 'sous-ticket-worker', 'fix the failing test', 14),
    call('v2', 'sous-verifier', 'run the tests', 16),
  ];
  const loops = fixLoops(calls, [checkpoint('c1', 'T2-work', 10, { agentId: 'w1', agent: 'sous-ticket-worker' }), checkpoint('r1', 'T2-round-1', 13)]);
  assert.deepStrictEqual(loops.map((loop) => [loop.task, loop.calls, loop.rounds]), [['T2', ['w1', 'v1', 'w2', 'v2'], 2]]);
  assert.deepStrictEqual(fixLoops(calls, []), [], 'no task anywhere: no loop');
});

test('one passing round is no loop; a failed first round already is one', () => {
  const calls = [call('w1', 'sous-ticket-worker', 'T1', 10), call('v1', 'sous-verifier', 'T1', 12)];
  assert.deepStrictEqual(fixLoops(calls, [checkpoint('p', 'T1-verify', 13)]), []);
  const loops = fixLoops([...calls, call('w2', 'sous-ticket-worker', 'T1', 15, { status: 'running', endedAt: null })], [checkpoint('r1', 'T1-round-1', 14)]);
  assert.deepStrictEqual(loops.map((loop) => [loop.calls, loop.rounds, loop.roundOf.get('w2')]), [[['w1', 'v1', 'w2'], 1, 2]]);
});

test('a loop review naming the task stays in the loop; the final review, another task or another agent ends it', () => {
  const calls = [
    call('w1', 'sous-ticket-worker', 'T1', 10),
    call('l1', 'sous-reviewer', 'LOOP review T1', 11),
    call('v1', 'sous-verifier', 'T1', 12),
    call('w2', 'sous-ticket-worker', 'T1', 14),
    call('v2', 'sous-verifier', 'T1', 16),
    call('f1', 'sous-reviewer', 'FINAL review T1 T2', 18),
    call('w3', 'sous-ticket-worker', 'T1', 20),
    call('v3', 'sous-verifier', 'T1', 22),
    call('w4', 'sous-ticket-worker', 'T2', 24),
    call('v4', 'sous-verifier', 'T2', 26),
    call('a1', 'sous-arbiter', 'T2 dispute', 27),
    call('w5', 'sous-ticket-worker', 'T2', 28),
    call('v5', 'sous-verifier', 'T2', 30),
  ];
  const loops = fixLoops(calls, [checkpoint('r', 'T2-round-1', 26), checkpoint('r2', 'T1-round-1', 22)]);
  assert.deepStrictEqual(loops.map((loop) => [loop.task, loop.calls.join(',')]), [['T1', 'w1,l1,v1,w2,v2'], ['T1', 'w3,v3'], ['T2', 'w4,v4']]);
  assert.deepStrictEqual([...loops[1].notes.keys()], ['v3'], 'a round goes under the newest verifier of its task before it');
});

test('a fold puts the loop where its first call was, with the steps between its calls, and drops emptied messages', () => {
  const { calls, checkpoints } = mockup();
  const rows = [...calls, step('s1', 33, 10), step('s2', 46, 40), step('s3', 52, 0)];
  const messages = threadMessages(rows, 'runner');
  const folded = foldLoops(messages, fixLoops(calls, checkpoints));
  const shape = folded.map((message) => message.parts.map((part) => (part.kind === 'loop' ? `loop[${part.parts.map((inner) => inner.event.eventId).join(',')}]` : part.event.eventId)).join(' '));
  assert.deepStrictEqual(shape, ['x1 loop[w1,s1,v1,s2,w2,v2,w3,v3]', 's3']);
});

test('the loop box names the task and rounds, numbers each call and puts each failed round as a thin line under its verifier', () => {
  const { calls, checkpoints } = mockup();
  const [loop] = fixLoops(calls, checkpoints);
  const parts = calls.slice(1).map((event) => ({ kind: 'call' as const, event }));
  const html = renderToStaticMarkup(<ul><FixLoopBox loop={loop} parts={parts} render={(part, round) => <li key={part.event.eventId}>{part.event.eventId} round {round}</li>} /></ul>);
  assert.match(html, /Fix loop T1 · 3 rounds/);
  assert.match(html, /w1 round 1[\s\S]*v1 round 1[\s\S]*Round 1[\s\S]*1 of 12 tests fails[\s\S]*w2 round 2[\s\S]*v2 round 2[\s\S]*Round 2[\s\S]*tsc fails[\s\S]*w3 round 3[\s\S]*v3 round 3/);
  assert.match(html, /–now/, 'a running loop ends at now');
  assert.strictEqual((html.match(/aria-label="Checkpoint Verify · T1 · round/g) ?? []).length, 2);
  const done = renderToStaticMarkup(<ul><FixLoopBox loop={loop} parts={parts.map((part) => ({ ...part, event: { ...part.event, status: 'ok', endedAt: part.event.endedAt ?? at(51) } }))} render={(part) => <li key={part.event.eventId} />} /></ul>);
  assert.doesNotMatch(done, /–now/, 'a finished loop ends at its last call');
});

test('a round checkpoint reads as a thin line, any other keeps the card', () => {
  const round = renderToStaticMarkup(<ol><CheckpointEntry checkpoint={checkpoint('r1', 'T1-round-1', 46, { text: 'tsc fails.' })} onContinue={{ label: 'Continue', run: () => undefined }} /></ol>);
  assert.match(round, />Round 1</);
  assert.match(round, /tsc fails\./);
  assert.doesNotMatch(round, />Checkpoint</, 'no card header');
  assert.doesNotMatch(round, /Continue/, 'a round never offers to continue');
  const card = renderToStaticMarkup(<ol><CheckpointEntry checkpoint={checkpoint('c', 'T1-verify', 52)} /></ol>);
  assert.match(card, />Checkpoint</);
  assert.match(card, />Verify · T1</);
});
