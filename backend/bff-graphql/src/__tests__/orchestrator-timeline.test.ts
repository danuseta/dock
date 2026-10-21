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

test('ledger stages map onto the sous steps: code and test are Work, verify is the FINAL review', () => {
  assert.deepStrictEqual(['gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done'].map((stage) => railIndex(stage)), [0, 1, 2, 2, 3, 4, 5, 5, 6]);
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

  assert.strictEqual(timeline.stageIndex, 2);
  assert.deepStrictEqual(timeline.agents.map((agent) => [agent.name, agent.detail, agent.state, agent.tool, agent.tools]), [
    ['lead', null, 'active', 'Agent', 3],
    ['general-purpose', 'left over from the code stage', 'active', null, 0],
    ['test-runner', 'Test-runner BE', 'active', 'Read', 2],
    ['test-runner', 'Test-runner FE', 'done', null, 1],
  ], 'an agent that never stopped is still there, and each subagent keeps its own tools');
  assert.strictEqual(timeline.totalTools, 6);
  assert.strictEqual(timeline.buckets.length, BUCKET_COUNT);
  assert.strictEqual(timeline.buckets.reduce((sum, bucket) => sum + bucket.n, 0), 6);
  assert.strictEqual(timeline.buckets[BUCKET_COUNT - 1].n, 0);
  assert.deepStrictEqual([timeline.log[0].head, timeline.log[0].text], ['test-runner', 'finished']);
});

test('tasks taking turns between code and test are not rounds; the ledger rounds are', () => {
  const tasks = [
    stageEvent('STAGE', 'plan', 0), stageEvent('STAGE', 'code', 30), stageEvent('STAGE', 'test', 60),
    stageEvent('STAGE', 'code', 90), stageEvent('STAGE', 'test', 120), stageEvent('STAGE', 'code', 150),
  ];
  const clean = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, tasks, [toolEvent(40, 'spawn', 'sous-ticket-worker'), toolEvent(70, 'stop', 'sous-ticket-worker', 'w1', 'sous-ticket-worker')], at(160));
  assert.deepStrictEqual([clean.round, clean.loopFrom, clean.loopTo, clean.stageIndex, clean.hasGate], [1, null, null, 2, false], 'a cron run has no gate and three tasks in a row are one round');
  assert.strictEqual(clean.agents.length, 2, 'the first task\'s finished worker stays drawn while the run is on Work');

  const sentBack = buildTimeline({ stage: 'code', waiting: null, activity: 'IDLE', rounds: { used: 1, max: 4 } }, [...tasks, stageEvent('STAGE', 'verify', 200), stageEvent('STAGE', 'code', 260)], [], at(270));
  assert.deepStrictEqual([sentBack.round, sentBack.loopFrom, sentBack.loopTo, sentBack.stageIndex], [2, 3, 2, 2]);
  assert.strictEqual(sentBack.agents[0].state, 'idle');
  const passed = buildTimeline({ stage: 'evidence', waiting: null, activity: 'ACTIVE', rounds: { used: 1, max: 4 } }, [...tasks, stageEvent('STAGE', 'evidence', 300)], [], at(310));
  assert.deepStrictEqual([passed.round, passed.loopFrom, passed.stageIndex], [2, null, 4], 'the round stays, the loop goes once the run is past Work');
});

test('each stop the run visited keeps its own team, and going back starts the next round', () => {
  const events = [
    stageEvent('STAGE', 'plan', 0), stageEvent('STAGE', 'code', 100), stageEvent('STAGE', 'test', 150),
    stageEvent('STAGE', 'verify', 300), stageEvent('STAGE', 'code', 400),
  ];
  const tools = [
    toolEvent(10, 'tool', 'Read'),
    toolEvent(20, 'spawn', 'explore', 'main', null, 'Map the inbox'),
    toolEvent(25, 'tool', 'Grep', 'e1', 'explore'),
    toolEvent(30, 'stop', 'explore', 'e1', 'explore'),
    toolEvent(110, 'spawn', 'sous-executor', 'main', null, 'Build the filter'),
    toolEvent(120, 'tool', 'Edit', 'x1', 'sous-executor'),
    toolEvent(280, 'stop', 'sous-executor', 'x1', 'sous-executor'),
    toolEvent(310, 'spawn', 'sous-verifier', 'main', null, 'Final review'),
    toolEvent(320, 'tool', 'Bash', 'v1', 'sous-verifier'),
    toolEvent(390, 'stop', 'sous-verifier', 'v1', 'sous-verifier'),
    toolEvent(410, 'spawn', 'sous-executor', 'main', null, 'Fix AC 3'),
    toolEvent(420, 'tool', 'Edit', 'x2', 'sous-executor'),
  ];
  const timeline = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE', rounds: { used: 1, max: 3 } }, events, tools, at(430));

  assert.deepStrictEqual(timeline.visits.map((visit) => [visit.stageIndex, visit.round]), [[1, 1], [2, 1], [3, 1], [2, 2]], 'code and test are one visit; verify back to code is round 2');
  assert.deepStrictEqual(timeline.visits.map((visit) => visit.agents.slice(1).map((agent) => agent.detail)), [
    ['Map the inbox'], ['Build the filter'], ['Final review'], ['Fix AC 3'],
  ]);
  assert.deepStrictEqual([timeline.visits[0].from, timeline.visits[0].to], [at(0).toISOString(), at(100).toISOString()]);
  assert.deepStrictEqual(timeline.visits[0].agents[0], { ...timeline.agents[0], state: 'done', tool: null, tools: 1 }, 'a past visit shows the lead finished, with the tools it called there');
  assert.deepStrictEqual([timeline.visits[1].agents[1].since, timeline.visits[1].agents[1].until], [at(110).toISOString(), at(280).toISOString()]);
  assert.deepStrictEqual(timeline.visits[3].agents, timeline.agents, 'the current visit is the team the graph already draws');
});

test('a member still at work shows on every visit it spans', () => {
  const timeline = buildTimeline(
    { stage: 'verify', waiting: null, activity: 'ACTIVE' },
    [stageEvent('STAGE', 'code', 0), stageEvent('STAGE', 'verify', 100)],
    [toolEvent(10, 'spawn', 'sous-executor', 'main', null, 'Long build'), toolEvent(120, 'tool', 'Edit', 'x1', 'sous-executor')],
    at(130),
  );
  assert.deepStrictEqual(timeline.visits.map((visit) => visit.agents.slice(1).map((agent) => agent.detail)), [['Long build'], ['Long build']]);
});

test('a manual run that stopped at GATE 1 gets the Gate stop, and the last gate waits while the run does', () => {
  const events = [
    stageEvent('STAGE', 'plan', 0), stageEvent('WAITING', 'GATE 1: plan in BOARD/prompts/S1.md', 20), stageEvent('RESUMED', null, 30),
    stageEvent('AGENT_WAITING', 'permission', 40), stageEvent('STAGE', 'code', 120),
  ];
  const back = buildTimeline({ stage: 'code', waiting: null, activity: 'IDLE' }, events, [], at(130));
  assert.strictEqual(back.hasGate, true);
  assert.deepStrictEqual(back.gates.map((gate) => [gate.text, gate.state, gate.stageIndex]), [['GATE 1: plan in BOARD/prompts/S1.md', 'passed', 1]]);

  const again = buildTimeline(
    { stage: 'pr', waiting: 'Go commit', activity: 'WAITING' },
    [...events, stageEvent('STAGE', 'verify', 200), stageEvent('STAGE', 'pr', 260), stageEvent('WAITING', 'Go commit', 261)],
    [toolEvent(100, 'spawn', 'oh-my-claudecode:executor')],
    at(262),
  );
  assert.deepStrictEqual([again.round, again.loopFrom, again.stageIndex], [1, null, 5]);
  assert.deepStrictEqual(again.gates.map((gate) => gate.state), ['passed', 'waiting']);
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
  }, at(5), 'laptop');

  assert.strictEqual(result?.activity, 'ACTIVE', 'a subagent stopping does not make the ticket idle');
  assert.strictEqual(writes, 1);
  assert.deepStrictEqual(toolRows.map((row) => [row.kind, row.agentId, row.name]), [
    ['tool', 'main', 'Agent'], ['spawn', 'main', 'Explore'], ['tool', 'abc', 'Bash'], ['stop', 'abc', 'Explore'],
  ], 'plumbing tools are left out');
  assert.deepStrictEqual(stateEvents.map((event) => event.kind), ['AGENT_ACTIVE']);

  const timeline = await service.timeline('QRD-1', at(6));
  assert.deepStrictEqual(timeline?.agents.map((agent) => [agent.name, agent.detail, agent.state, agent.tools]), [
    ['lead', null, 'active', 1], ['Explore', 'Hook payload probe', 'done', 1],
  ]);

  assert.deepStrictEqual((await service.members('QRD-1', at(6))).map((agent) => agent.name), ['Explore']);
  assert.deepStrictEqual(await service.members('QRD-404', at(6)), []);

  await service.ingestEventBatch({ key: 'QRD-1', events: [{ event: 'Stop', at: at(7).toISOString() }] }, at(7), 'laptop');
  assert.strictEqual((await service.get('QRD-1', at(10)))?.activity, 'IDLE', 'the main session stopping does');

  assert.strictEqual(await service.ingestEventBatch({ key: 'QRD-404', events: [{ event: 'Stop' }] }, at(8), 'laptop'), null);
  assert.throws(() => parseEventBatch({ key: 'QRD-1', events: [] }), OrchestratorInputError);
  assert.throws(() => parseEventBatch({ key: 'QRD-1', events: Array.from({ length: 101 }, () => ({ event: 'Stop' })) }), OrchestratorInputError);
  assert.strictEqual(parseEventBatch({ key: 'QRD-1', events: [{ event: 'Stop', at: '2999-01-01T00:00:00Z' }] }, at(9)).events[0].at.getTime(), at(9).getTime());
});

test('a sub-coordinator and the members it spawns form a tree', () => {
  const timeline = buildTimeline(
    { stage: 'code', waiting: null, activity: 'ACTIVE' },
    [stageEvent('STAGE', 'plan', 0), stageEvent('STAGE', 'code', 100)],
    [
      toolEvent(5, 'spawn', 'oh-my-claudecode:executor', 'main', 'coord-1406', 'QRD-1406 coordinator'),
      toolEvent(6, 'tool', 'Read', 'c1', 'oh-my-claudecode:executor'),
      toolEvent(10, 'spawn', 'oh-my-claudecode:executor', 'c1', 'be-exec', 'BE service'),
      toolEvent(11, 'tool', 'Edit', 'm1', 'oh-my-claudecode:executor'),
      toolEvent(50, 'stop', 'oh-my-claudecode:executor', 'm1', 'oh-my-claudecode:executor'),
      toolEvent(105, 'spawn', 'test-runner', 'c1', null, 'BE tests'),
      toolEvent(106, 'tool', 'Bash', 'm2', 'test-runner'),
      toolEvent(107, 'tool', 'Grep', 'ghost', 'oh-my-claudecode:verifier'),
    ],
    at(110),
  );
  const byName = new Map(timeline.agents.map((agent) => [agent.name, agent]));
  const coordinator = byName.get('coord-1406');
  assert.ok(coordinator, 'the name the lead gave its sub-coordinator is used');
  assert.deepStrictEqual([coordinator.parentId, coordinator.state], ['main', 'active'], 'it outlives the stage it was spawned in');
  assert.strictEqual(byName.has('be-exec'), false, 'a member that finished in an earlier stage is gone');
  assert.deepStrictEqual([byName.get('test-runner')?.parentId, byName.get('test-runner')?.tool], [coordinator.id, 'Bash']);
  assert.deepStrictEqual([byName.get('verifier')?.parentId, byName.get('verifier')?.tools], ['main', 1], 'an agent whose spawn was never seen still appears');
});

test('a member whose stop event never arrived is retired after ten silent minutes', () => {
  const events = [
    toolEvent(0, 'spawn', 'oh-my-claudecode:executor', 'main', 'old-exec', 'never stopped'),
    toolEvent(5, 'tool', 'Edit', 'old', 'oh-my-claudecode:executor'),
    toolEvent(1000, 'spawn', 'oh-my-claudecode:executor', 'main', 'new-exec', 'fresh'),
    toolEvent(1001, 'tool', 'Edit', 'new', 'oh-my-claudecode:executor'),
  ];
  const stages = [stageEvent('STAGE', 'code', 900)];
  const timeline = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, stages, events, at(1005));
  assert.deepStrictEqual(timeline.agents.map((agent) => [agent.name, agent.state, agent.tools]), [['lead', 'active', 0], ['new-exec', 'active', 1]],
    'the silent one is gone, and the new member is not mistaken for it');
  const early = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, [stageEvent('STAGE', 'code', 0)], events.slice(0, 2), at(300));
  assert.deepStrictEqual(early.agents.map((agent) => agent.name), ['lead', 'old-exec'], 'five quiet minutes is still a working member');
});

test('a sub-coordinator whose turn stopped while its members work is still working', () => {
  const events = [
    toolEvent(1, 'spawn', 'oh-my-claudecode:executor', 'main', 'coord-1260', 'QRD-1260 coordinator'),
    toolEvent(2, 'tool', 'Read', 'c1', 'oh-my-claudecode:executor'),
    toolEvent(3, 'spawn', 'test-runner', 'c1', 'be-tests', 'BE tests'),
    toolEvent(4, 'tool', 'Bash', 'm1', 'test-runner'),
    toolEvent(5, 'stop', 'oh-my-claudecode:executor', 'c1', 'oh-my-claudecode:executor'),
  ];
  const stages = [stageEvent('STAGE', 'code', 0)];
  const waiting = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, stages, events, at(10));
  assert.deepStrictEqual(waiting.agents.map((agent) => [agent.name, agent.state]), [['lead', 'active'], ['coord-1260', 'active'], ['be-tests', 'active']]);

  const teamDone = [...events, toolEvent(20, 'stop', 'test-runner', 'm1', 'test-runner')];
  assert.strictEqual(buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, stages, teamDone, at(21)).agents[1].state, 'done');

  const resumed = [...teamDone, toolEvent(22, 'tool', 'Bash', 'c1', 'oh-my-claudecode:executor')];
  const after = buildTimeline({ stage: 'code', waiting: null, activity: 'ACTIVE' }, stages, resumed, at(23));
  assert.deepStrictEqual([after.agents[1].state, after.agents[1].tool], ['active', 'Bash'], 'it picks up again when the reports come in');
});
