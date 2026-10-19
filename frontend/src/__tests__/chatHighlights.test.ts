import assert from 'node:assert';
import test from 'node:test';
import { agentTask, agentType, runningLanes, sessionStats, turnHighlights, type ChatActivity } from '../chat/activity/activity';

let nextId = 1;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 19, 8, 0, seconds)).toISOString();
const row = (overrides: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 10, eventId: `e${id}`, parentId: null, kind: 'tool', agent: 'main', name: 'Bash', label: `Step ${id}`, summary: '',
    status: 'ok', hasDetail: false, seq: id, startedAt: at(id), endedAt: at(id + 1), ...overrides,
  };
};

test('a turn lists each skill once and every subagent with the steps it ran', () => {
  const executor = row({ kind: 'agent', name: 'oh-my-claudecode:executor', label: 'Agent executor: add the tags filter', status: 'running', endedAt: null });
  const events = [
    row({ kind: 'skill', name: 'build-ticket', label: 'Skill: build-ticket' }),
    row({ kind: 'skill', name: 'build-ticket', label: 'Skill: build-ticket' }),
    row({ kind: 'skill', name: 'graphify', label: 'Skill: graphify' }),
    executor,
    row({ parentId: executor.eventId, agent: 'executor', name: 'Edit' }),
    row({ parentId: executor.eventId, agent: 'executor', name: 'Bash' }),
    row({ parentId: executor.eventId, kind: 'note', name: 'note' }),
  ];
  const { skills, agents } = turnHighlights(events);
  assert.deepStrictEqual(skills, ['build-ticket', 'graphify']);
  assert.strictEqual(agents.length, 1);
  assert.strictEqual(agents[0].node.event.eventId, executor.eventId);
  assert.strictEqual(agents[0].steps, 2);
});

test('a turn without skills or subagents has nothing to highlight', () => {
  assert.deepStrictEqual(turnHighlights([row(), row()]), { skills: [], agents: [] });
});

test('a subagent reads as its type and its task', () => {
  assert.strictEqual(agentType('oh-my-claudecode:executor'), 'executor');
  assert.strictEqual(agentType('Explore'), 'Explore');
  assert.strictEqual(agentTask({ label: 'Agent executor: add the tags filter', name: 'executor' }), 'add the tags filter');
  assert.strictEqual(agentTask({ label: 'Agent executor', name: 'oh-my-claudecode:executor' }), 'Agent executor');
});

test('session stats count steps, distinct skills, subagents and the ones still running', () => {
  const events = [
    row(), row({ kind: 'note', name: 'note' }),
    row({ kind: 'skill', name: 'graphify' }), row({ kind: 'skill', name: 'graphify' }),
    row({ kind: 'agent', name: 'executor', status: 'running', endedAt: null }), row({ kind: 'agent', name: 'explore' }),
  ];
  assert.deepStrictEqual(sessionStats(events), { steps: 5, skills: 1, agents: 2, runningAgents: 1 });
});

test('lanes hold each running subagent with its own newest steps; finished ones get none', () => {
  const lead = row({ kind: 'agent', name: 'executor', label: 'Agent executor: build', status: 'running', endedAt: null });
  const done = row({ kind: 'agent', name: 'explore', status: 'ok' });
  const events = [lead, done, row({ parentId: done.eventId, name: 'Grep' })];
  for (let index = 0; index < 14; index += 1) events.push(row({ parentId: lead.eventId, name: 'Bash', label: `step ${index}` }));
  const lanes = runningLanes(events);
  assert.deepStrictEqual(lanes.map((lane) => lane.agent.eventId), [lead.eventId]);
  assert.strictEqual(lanes[0].steps.length, 12);
  assert.strictEqual(lanes[0].steps.at(-1)?.label, 'step 13');
});
