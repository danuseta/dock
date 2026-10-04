import type { AgentRun } from './runs';

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
    waiting: null, gate: 'GO', testsBe: null, testsFe: null, prBe: null, prFe: null, note: null,
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
