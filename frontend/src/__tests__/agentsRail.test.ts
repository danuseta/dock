import assert from 'node:assert/strict';
import test from 'node:test';
import { inVisit, railVisits, shortDuration, visitLength } from '../agents/rail';
import type { AgentTimeline } from '../agents/runs';

const lead = { id: 'main', parentId: null, name: 'lead', state: 'active', tools: 4 };
const member = (id: string, detail: string, state = 'done') => ({ id, parentId: 'main', name: 'sous-executor', detail, state, tools: 3 });

const timeline: AgentTimeline = {
  stageIndex: 2,
  hasGate: false,
  gates: [{ id: 'g1', stageIndex: 1, text: 'GATE 1', state: 'passed', at: '2026-10-21T09:41:00.000Z' }],
  agents: [lead, member('a4', 'Fix AC 3', 'active')],
  visits: [
    { stageIndex: 1, round: 1, from: '2026-10-21T09:30:00.000Z', to: '2026-10-21T09:42:00.000Z', agents: [{ ...lead, state: 'done' }] },
    { stageIndex: 2, round: 1, from: '2026-10-21T09:42:00.000Z', to: '2026-10-21T10:15:00.000Z', agents: [{ ...lead, state: 'done' }, member('a1', 'Build the filter'), member('a2', 'Run vitest')] },
    { stageIndex: 3, round: 1, from: '2026-10-21T10:15:00.000Z', to: '2026-10-21T10:24:00.000Z', agents: [{ ...lead, state: 'done' }, member('a3', 'Final review')] },
    { stageIndex: 2, round: 2, from: '2026-10-21T10:24:00.000Z', to: null, agents: [lead, member('a4', 'Fix AC 3', 'active')] },
  ],
  buckets: [{ n: 1, gate: false }],
  totalTools: 12,
  log: [],
};

test('the rail marks each visit done, sent back or now, and a finished run has no now', () => {
  assert.deepEqual(railVisits(timeline, false).map((visit) => visit.state), ['done', 'done', 'returned', 'now']);
  assert.deepEqual(railVisits(timeline, true).map((visit) => visit.state), ['done', 'done', 'returned', 'done']);
  assert.deepEqual(railVisits({ ...timeline, visits: [] }, false).map((visit) => [visit.stageIndex, visit.round, visit.agents.length]), [[2, 1, 2]], 'a timeline without visits is one visit at the current stop');
});

test('a visit holds the moments between its start and its end', () => {
  const work = timeline.visits[1];
  assert.equal(inVisit('2026-10-21T10:00:00.000Z', work), true);
  assert.equal(inVisit('2026-10-21T10:15:00.000Z', work), false, 'the end belongs to the next visit');
  assert.equal(inVisit('2020-01-01T00:00:00.000Z', { from: null, to: work.to }), true);
  assert.equal(visitLength(work, 0), 33 * 60 * 1000);
  assert.equal(visitLength({ from: null, to: null }, 0), null);
});

test('rail durations stay short', () => {
  assert.deepEqual([45_000, 33 * 60_000 + 20_000, 65 * 60_000].map(shortDuration), ['45s', '33m', '1h 05m']);
});
