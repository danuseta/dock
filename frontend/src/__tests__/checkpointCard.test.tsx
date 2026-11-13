import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckpointCard } from '../chat/CheckpointCard';
import { checkpointForAgent, newIds, placeCheckpoints, stepLabel, stepStage, type Checkpoint } from '../chat/checkpoints';

const checkpoint = (extra: Partial<Checkpoint> = {}): Checkpoint => ({
  id: 'e1', key: 'QRD-1534', step: 'plan', agentId: null, agent: 'sous-planner', text: 'Planned 3 tasks.', untestable: [], missingData: [], at: '2026-11-13T09:10:00.000Z', ...extra,
});

test('a checkpoint card shows the step, the agent, the time and the report', () => {
  const html = renderToStaticMarkup(<ol><CheckpointCard checkpoint={checkpoint()} /></ol>);
  assert.match(html, /Checkpoint/);
  assert.match(html, />Rencana kerja</, 'a Sous flow stage reads by its name');
  assert.match(html, /sous-planner/);
  assert.match(html, /<time dateTime="2026-11-13T09:10:00.000Z"/);
  assert.match(html, /Planned 3 tasks\./);
  assert.doesNotMatch(html, /Data uji/);
  assert.strictEqual(stepLabel('Task 2'), 'Task 2', 'a step the flow does not name reads as written');
});

test('the final review card carries the untestable AC lines and the missing test data', () => {
  const html = renderToStaticMarkup(<ol><CheckpointCard checkpoint={checkpoint({ step: 'final', agent: 'sous-reviewer', untestable: ['AC 3 needs QRD-1307 in UAT'], missingData: ['a workspace with two agents'] })} /></ol>);
  assert.match(html, />Review akhir</);
  assert.match(html, /Belum bisa dites selama tiket ini sendirian di UAT/);
  assert.match(html, /AC 3 needs QRD-1307 in UAT/);
  assert.match(html, /Data uji yang belum ada/);
  assert.match(html, /a workspace with two agents/);
});

test('after a stop the card offers to go on with a plain chat line', () => {
  const html = renderToStaticMarkup(<ol><CheckpointCard checkpoint={checkpoint({ step: 'video' })} onContinue={{ label: 'Lanjut dari Publish', run: () => undefined }} /></ol>);
  assert.match(html, /Lanjut dari Publish/);
});

test('an agent\'s checkpoint is the one with its id, else the next of its type after it started', () => {
  const workers = [
    { id: 'w1', name: 'sous-ticket-worker', startedAt: '2026-11-13T09:00:00.000Z' },
    { id: 'w2', name: 'sous-ticket-worker', startedAt: '2026-11-13T09:20:00.000Z' },
    { id: 'r1', name: 'sous-reviewer', startedAt: '2026-11-13T09:05:00.000Z' },
  ];
  const list = [
    checkpoint({ id: 'c1', step: 'code', agent: 'sous-ticket-worker', at: '2026-11-13T09:15:00.000Z' }),
    checkpoint({ id: 'c2', step: 'code', agent: 'sous-ticket-worker', at: '2026-11-13T09:30:00.000Z' }),
    checkpoint({ id: 'c3', step: 'loop', agentId: 'r1', agent: 'sous-reviewer', at: '2026-11-13T09:31:00.000Z' }),
  ];
  assert.strictEqual(checkpointForAgent(list, workers[0], workers)?.id, 'c1');
  assert.strictEqual(checkpointForAgent(list, workers[1], workers)?.id, 'c2');
  assert.strictEqual(checkpointForAgent(list, workers[2], workers)?.id, 'c3');
  assert.strictEqual(checkpointForAgent(list, { id: 'p1', name: 'sous-planner', startedAt: '2026-11-13T08:00:00.000Z' }, workers), null);
});

test('checkpoints sit among the thread items by time; later ones go at the end', () => {
  const times = ['2026-11-13T09:00:00.000Z', '2026-11-13T09:20:00.000Z'];
  const placed = placeCheckpoints(times, [checkpoint({ id: 'late', at: '2026-11-13T09:40:00.000Z' }), checkpoint({ id: 'mid', at: '2026-11-13T09:10:00.000Z' })]);
  assert.deepStrictEqual(placed.at.get(1)?.map((item) => item.id), ['mid']);
  assert.deepStrictEqual(placed.end.map((item) => item.id), ['late']);
});

test('only a checkpoint that arrives after the first read counts as new', () => {
  assert.deepStrictEqual(newIds(null, [checkpoint()]), [], 'opening a session is not news');
  assert.deepStrictEqual(newIds(new Set(['e1']), [checkpoint(), checkpoint({ id: 'e2' })]), ['e2']);
});

test('the kit steps map to Sous flow stages, task steps keep their task, anything else reads as written', () => {
  const cases: Array<[string, string | null, string | null, string]> = [
    ['planner', 'plan', null, 'Rencana kerja'],
    ['T2-work', 'code', 'T2', 'Ngoding per task · T2'],
    ['T3-review', 'loop', 'T3', 'Review loop · T3'],
    ['t1-verify', 'verify', 'T1', 'Verify · T1'],
    ['final-review', 'final', null, 'Review akhir'],
    ['video', 'video', null, 'Video demo'],
    ['publish', 'publish', null, 'Publish'],
    ['decide', 'decide', null, 'Decisions'],
    ['T2-deploy', null, null, 'T2-deploy'],
    ['something', null, null, 'something'],
  ];
  for (const [step, stage, task, label] of cases) {
    assert.deepStrictEqual(stepStage(step), { stage, task }, step);
    assert.strictEqual(stepLabel(step), label, step);
  }
  const html = renderToStaticMarkup(<ol><CheckpointCard checkpoint={checkpoint({ step: 'T2-work', agent: 'sous-ticket-worker' })} /></ol>);
  assert.match(html, />Ngoding per task · T2</);
});
