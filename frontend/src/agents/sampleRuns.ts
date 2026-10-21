import type { AgentRun, AgentTimeline } from './runs';

// A scripted run for the Agents page when no laptop has pushed anything yet.
// It never touches the server: SAMPLE-2 walks code -> test -> verify and then
// raises its hand at the owner's desk, on a loop.

const STEP_SECONDS = 7;

const ac = (states: string[]) => states.map((state, index) => ({
  n: index + 1,
  state,
  text: `Sample acceptance criterion ${index + 1}`,
  evidence: null,
}));

function run(partial: Partial<AgentRun> & Pick<AgentRun, 'key' | 'title' | 'stage'>, states: string[]): AgentRun {
  return {
    waiting: null, gate: 'GO', testsBe: null, testsFe: null, prBe: null, prFe: null, pullRequests: [], review: null, note: null,
    activity: 'IDLE', activityDetail: null, idleSeconds: 0, endedSeconds: null, stalled: false,
    hasTranscript: false, updatedAt: new Date().toISOString(), events: [], sample: true,
    ac: ac(states),
    acPassed: states.filter((state) => state === 'PASS').length,
    acFailed: states.filter((state) => state === 'FAIL').length,
    acTotal: states.length,
    ...partial,
  };
}

export function sampleRuns(elapsed: number): AgentRun[] {
  // The caller's clock ticks once a second, so the first frame can ask for a moment before the start.
  const elapsedSeconds = Math.max(0, Math.floor(elapsed));
  const step = Math.floor(elapsedSeconds / STEP_SECONDS) % 5;
  const sinceStep = elapsedSeconds % STEP_SECONDS;
  const tools = ['Edit', 'Read', 'Bash', 'Grep'];
  const moving: AgentRun = step === 4
    ? run({ key: 'SAMPLE-2', title: 'Sample: a ticket that runs on its own', stage: 'verify', waiting: 'Gate 2: check the AC evidence', activity: 'WAITING', activityDetail: 'gate', idleSeconds: sinceStep }, ['PASS', 'PASS', 'PASS'])
    : run({
      key: 'SAMPLE-2',
      title: 'Sample: a ticket that runs on its own',
      stage: ['code', 'test', 'verify', 'verify'][step],
      activity: 'ACTIVE',
      activityDetail: tools[Math.floor(elapsedSeconds / 2) % tools.length],
      idleSeconds: elapsedSeconds % 2,
    }, step === 3 ? ['PASS', 'PASS', 'PASS'] : step === 2 ? ['PASS', 'PASS', 'TODO'] : ['TODO', 'TODO', 'TODO']);

  return [
    run({ key: 'SAMPLE-1', title: 'Sample: a ticket at the plan gate', stage: 'plan', waiting: 'Gate 1: approve the plan', activity: 'WAITING', activityDetail: 'gate', idleSeconds: 95 + elapsedSeconds }, ['TODO', 'TODO', 'TODO']),
    moving,
    run({ key: 'SAMPLE-3', title: 'Sample: an agent that went quiet', stage: 'test', stalled: true, idleSeconds: 2520 + elapsedSeconds }, ['PASS', 'TODO']),
    run({ key: 'SAMPLE-4', title: 'Sample: a failed acceptance check', stage: 'verify', activity: 'IDLE', idleSeconds: 6 + (elapsedSeconds % 14) }, ['PASS', 'FAIL', 'TODO']),
  ];
}

const SAMPLE_RAIL: Record<string, number> = { code: 2, test: 2, verify: 3 };

/** The flow graph for SAMPLE-2, in step with sampleRuns: a team fans out, then waits at a gate. */
export function sampleTimeline(elapsed: number): AgentTimeline {
  const elapsedSeconds = Math.max(0, Math.floor(elapsed));
  const step = Math.floor(elapsedSeconds / STEP_SECONDS) % 5;
  const sinceStep = elapsedSeconds % STEP_SECONDS;
  const run = sampleRuns(elapsedSeconds)[1];
  const waiting = step === 4;
  const tool = ['Edit', 'Read', 'Bash', 'Grep'][Math.floor(elapsedSeconds / 2) % 4];
  const member = (id: string, name: string, detail: string, doneAfter: number) => ({
    id, parentId: 'coord', name, detail,
    state: sinceStep >= doneAfter ? 'done' : 'active',
    tool: sinceStep >= doneAfter ? null : tool,
    tools: Math.min(sinceStep, doneAfter) + 1,
  });
  const team = [
    [member('a1', 'executor', 'BE: service', 5), member('a2', 'executor', 'BE: controller', 4), member('a3', 'executor', 'FE: panel', 6), member('a4', 'executor', 'FE: tests', 3)],
    [member('a1', 'test-runner', 'BE tests', 6), member('a2', 'test-runner', 'FE tests', 4)],
    [member('a1', 'browser-verifier', 'check AC in the browser', 6)],
    [],
    [],
  ][step];
  const buckets = Array.from({ length: 48 }, (_, index) => {
    const age = 47 - index;
    const second = elapsedSeconds - age * 5;
    return { n: second < 0 || (waiting && age * 5 < sinceStep) ? 0 : 1 + ((second * 7) % 4), gate: false };
  });
  if (waiting) buckets[Math.max(0, 47 - Math.floor(sinceStep / 5))].gate = true;
  const now = Date.now();
  const stageIndex = SAMPLE_RAIL[run.stage] ?? 2;
  const lead = { id: 'main', parentId: null, name: 'lead', detail: 'sample team', state: waiting ? 'waiting' : 'active', tool: null, tools: 2 };
  const agents = [
    lead,
    { id: 'coord', parentId: 'main', name: 'coord-sample', detail: 'SAMPLE-2 coordinator', state: 'active', tool: waiting ? null : team.length ? 'Agent' : tool, tools: 6 + elapsedSeconds % 35 },
    ...team,
  ];
  return {
    stageIndex,
    hasGate: true,
    gates: [
      { id: 'g1', stageIndex: 1, text: 'Gate 1: approve the plan', state: 'passed', at: new Date(now - 60000).toISOString() },
      ...(waiting ? [{ id: 'g2', stageIndex: 3, text: run.waiting || '', state: 'waiting', at: new Date(now - sinceStep * 1000).toISOString() }] : []),
    ],
    agents,
    visits: [
      { stageIndex: 1, round: 1, from: new Date(now - 120000).toISOString(), to: new Date(now - 60000).toISOString(), agents: [{ ...lead, state: 'done', tools: 4 }] },
      ...(stageIndex > 2 ? [{ stageIndex: 2, round: 1, from: new Date(now - 60000).toISOString(), to: new Date(now - 30000).toISOString(), agents: [{ ...lead, state: 'done', tools: 9 }] }] : []),
      { stageIndex, round: 1, from: new Date(now - (stageIndex > 2 ? 30000 : 60000)).toISOString(), to: null, agents },
    ],
    buckets,
    totalTools: 20 + elapsedSeconds,
    log: [
      ...(waiting ? [{ at: new Date(now - sinceStep * 1000).toISOString(), kind: 'gate', head: 'Gate', text: run.waiting || '' }] : []),
      ...team.filter((agent) => agent.state === 'active').map((agent) => ({ at: new Date(now).toISOString(), kind: 'tool', head: agent.name, text: tool })),
      { at: new Date(now - sinceStep * 1000).toISOString(), kind: 'stage', head: 'Stage', text: run.stage },
    ],
  };
}
