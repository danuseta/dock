import assert from 'node:assert';
import os from 'node:os';
import test from 'node:test';
import { OrchestratorInputError, OrchestratorService, parseEventBatch } from '../integrations/orchestrator';
import { BUCKET_COUNT, buildTimeline, railIndex, type StageEvent, type ToolEvent } from '../integrations/orchestrator-timeline';
import type { StorageService } from '../storage/service';

const T0 = new Date('2026-10-05T10:00:00.000Z').getTime();
const at = (seconds: number) => new Date(T0 + seconds * 1000);
let sequence = 0;
const stageEvent = (kind: string, detail: string | null, seconds: number): StageEvent => ({ id: String(sequence += 1), kind, detail, createdAt: at(seconds) });
const toolEvent = (seconds: number, kind: string, name: string, agentId = 'main', agentType: string | null = null, detail: string | null = null): ToolEvent => (
  { kind, name, agentId, agentType, detail, at: at(seconds) }
);

test('ledger stages map onto the six-stop rail', () => {
  assert.deepStrictEqual(['gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done'].map((stage) => railIndex(stage)), [0, 1, 2, 3, 4, 4, 4, 5, 6]);
  assert.strictEqual(railIndex('blocked', 3), 3, 'a blocked ticket stays where it was');
});

test('timeline draws subagents, attributes their tools and closes them on stop', () => {
  const timeline = buildTimeline(
    { stage: 'test', waiting: null, activity: 'ACTIVE' },
    [stageEvent('STAGE', 'code', 0), stageEvent('STAGE', 'test', 100)],
    [
      toolEvent(10, 'tool', 'Edit'),
      toolEvent(20, 'spawn', 'general-purpose', 'main', null, 'left over from the code stage'),
      toolEvent(101, 'tool', 'Agent'),
      toolEvent(101, 'spawn', 'test-runner', 'main', null, 'Test-runner BE'),
      toolEvent(102, 'tool', 'Agent'),
      toolEvent(102, 'spawn', 'test-runner', 'main', null, 'Test-runner FE'),
      toolEvent(104, 'tool', 'Bash', 'a1', 'test-runner'),
      toolEvent(105, 'tool', 'Bash', 'a2', 'test-runner'),
      toolEvent(106, 'tool', 'Read', 'a1', 'test-runner'),
      toolEvent(110, 'stop', 'test-runner', 'a2', 'test-runner'),
    ],
    at(112),
  );

  assert.strictEqual(timeline.stageIndex, 3);
  assert.deepStrictEqual(timeline.agents.map((agent) => [agent.name, agent.detail, agent.state, agent.tool, agent.tools]), [
    ['orchestrator', null, 'active', 'Agent', 3],
    ['test-runner', 'Test-runner BE', 'active', 'Read', 2],
    ['test-runner', 'Test-runner FE', 'done', null, 1],
  ], 'agents from an earlier stage are gone, and each subagent keeps its own tools');
  assert.strictEqual(timeline.totalTools, 6);
  assert.strictEqual(timeline.buckets.length, BUCKET_COUNT);
  assert.strictEqual(timeline.buckets.reduce((sum, bucket) => sum + bucket.n, 0), 6);
  assert.strictEqual(timeline.buckets[BUCKET_COUNT - 1].n, 0);
  assert.deepStrictEqual([timeline.log[0].head, timeline.log[0].text], ['test-runner', 'finished']);
});

test('a ticket sent back shows the round and the loop until it passes that stage again', () => {
  const events = [
    stageEvent('STAGE', 'code', 0), stageEvent('STAGE', 'verify', 60),
    stageEvent('WAITING', 'Approve the plan', 20), stageEvent('RESUMED', null, 30), stageEvent('AGENT_WAITING', 'permission', 40),
    stageEvent('STAGE', 'code', 120),
  ];
  const back = buildTimeline({ stage: 'code', waiting: null, activity: 'IDLE' }, events, [], at(130));
  assert.deepStrictEqual([back.round, back.loopFrom, back.loopTo, back.stageIndex], [2, 4, 2, 2]);
  assert.deepStrictEqual(back.gates.map((gate) => [gate.text, gate.state, gate.stageIndex]), [['Approve the plan', 'passed', 2]]);
  assert.strictEqual(back.agents[0].state, 'idle');

  const again = buildTimeline(
    { stage: 'pr', waiting: 'Go commit', activity: 'WAITING' },
    [...events, stageEvent('STAGE', 'verify', 200), stageEvent('STAGE', 'pr', 260), stageEvent('WAITING', 'Go commit', 261)],
    [toolEvent(100, 'spawn', 'oh-my-claudecode:executor')],
    at(262),
  );
  assert.deepStrictEqual([again.round, again.loopFrom, again.stageIndex], [2, null, 5]);
  assert.deepStrictEqual(again.gates.map((gate) => gate.state), ['passed', 'waiting']);
  assert.strictEqual(again.agents[0].name, 'lead', 'an OMC team makes the main session the lead');
  assert.strictEqual(again.buckets[BUCKET_COUNT - 1].gate, true);
});

test('event batches update state once and keep every tool call', async () => {
  const run: any = {
    key: 'QRD-1', title: 'Ticket', stage: 'code', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null,
    ledgerUpdatedAt: at(0), transcriptAt: null, dismissedAt: null,
  };
  const toolRows: any[] = [];
  const stateEvents: any[] = [];
  let writes = 0;
  const storage = {
    getOrchestratorRun: async (key: string) => (key === 'QRD-1' ? run : null),
    updateOrchestratorRun: async (_key: string, data: any) => { writes += 1; return Object.assign(run, data); },
    addOrchestratorToolEvents: async (_key: string, rows: any[]) => { toolRows.push(...rows); },
    addOrchestratorEvent: async (_key: string, kind: string, detail: string | null) => { stateEvents.push({ id: String(stateEvents.length), kind, detail, createdAt: at(5) }); },
    getOrchestratorEvents: async () => [...stateEvents].reverse(),
    getOrchestratorToolEvents: async () => [...toolRows].map((row, index) => ({ id: index, ...row })).reverse(),
  } as unknown as StorageService;
  const service = new OrchestratorService(storage, os.tmpdir());

  const result = await service.ingestEventBatch({
    key: 'qrd-1',
    events: [
      { event: 'PreToolUse', at: at(1).toISOString(), tool: 'Agent', spawnType: 'Explore', detail: 'Hook payload probe' },
      { event: 'PreToolUse', at: at(2).toISOString(), tool: 'Bash', agentId: 'abc', agentType: 'Explore' },
      { event: 'PreToolUse', at: at(3).toISOString(), tool: 'SubagentHandback', agentId: 'abc', agentType: 'Explore' },
      { event: 'SubagentStop', at: at(4).toISOString(), agentId: 'abc', agentType: 'Explore' },
    ],
  }, at(5));

  assert.strictEqual(result?.activity, 'ACTIVE', 'a subagent stopping does not make the ticket idle');
  assert.strictEqual(writes, 1);
  assert.deepStrictEqual(toolRows.map((row) => [row.kind, row.agentId, row.name]), [
    ['tool', 'main', 'Agent'], ['spawn', 'main', 'Explore'], ['tool', 'abc', 'Bash'], ['stop', 'abc', 'Explore'],
  ], 'plumbing tools are left out');
  assert.deepStrictEqual(stateEvents.map((event) => event.kind), ['AGENT_ACTIVE']);

  const timeline = await service.timeline('QRD-1', at(6));
  assert.deepStrictEqual(timeline?.agents.map((agent) => [agent.name, agent.detail, agent.state, agent.tools]), [
    ['orchestrator', null, 'active', 1], ['Explore', 'Hook payload probe', 'done', 1],
  ]);

  await service.ingestEventBatch({ key: 'QRD-1', events: [{ event: 'Stop', at: at(7).toISOString() }] }, at(7));
  assert.strictEqual((await service.get('QRD-1', at(10)))?.activity, 'IDLE', 'the main session stopping does');

  assert.strictEqual(await service.ingestEventBatch({ key: 'QRD-404', events: [{ event: 'Stop' }] }, at(8)), null);
  assert.throws(() => parseEventBatch({ key: 'QRD-1', events: [] }), OrchestratorInputError);
  assert.throws(() => parseEventBatch({ key: 'QRD-1', events: Array.from({ length: 101 }, () => ({ event: 'Stop' })) }), OrchestratorInputError);
  assert.strictEqual(parseEventBatch({ key: 'QRD-1', events: [{ event: 'Stop', at: '2999-01-01T00:00:00Z' }] }, at(9)).events[0].at.getTime(), at(9).getTime());
});
