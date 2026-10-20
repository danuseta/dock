// Turns what the laptop reports (stage changes, gates, tool calls) into the
// live flow graph on the Agents page. Pure: no storage, no clock of its own.

// The steps a sous run takes. Gate is drawn only for a run that stopped at GATE 1 (a manual run).
export const RAIL = ['gate', 'plan', 'work', 'final', 'evidence', 'pr'] as const;
// The ledger keeps the older stage names: code and test are one task's work and verify, verify is the FINAL review.
const STAGE_STOP: Record<string, number> = { gate: 0, plan: 1, code: 2, test: 2, verify: 3, evidence: 4, commit: 5, pr: 5 };
const GATE_ONE = /gate\s*1/i;
export const BUCKET_SECONDS = 5;
export const BUCKET_COUNT = 48;

const MAX_CHILDREN = 14;
const MAX_GATES = 6;
const LOG_SIZE = 14;
// A member that has been silent this long is treated as finished: its stop event was missed.
const AGENT_SILENCE_MS = 10 * 60 * 1000;

export interface StageEvent { id: string; kind: string; detail: string | null; createdAt: Date }
export interface ToolEvent {
  kind: string;
  agentId: string;
  agentType: string | null;
  name: string;
  detail: string | null;
  at: Date;
}
export interface TimelineRun { stage: string; waiting: string | null; activity: string; rounds?: { used: number; max: number } | null }

export interface TimelineAgent {
  id: string;
  parentId: string | null;
  name: string;
  detail: string | null;
  state: 'active' | 'waiting' | 'idle' | 'done';
  tool: string | null;
  tools: number;
}

export function railIndex(stage: string, fallback = 0): number {
  if (stage === 'done') return RAIL.length;
  return STAGE_STOP[stage] ?? fallback;
}

const shortType = (type: string | null) => (type || 'agent').replace(/^[^:]+:/, '');

export function buildTimeline(run: TimelineRun, stageEventsDesc: StageEvent[], toolEvents: ToolEvent[], now: Date) {
  const stageEvents = [...stageEventsDesc].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const tools = [...toolEvents].sort((a, b) => a.at.getTime() - b.at.getTime());

  // Rail: where the ticket is and the gates it met on the way.
  let position = 0;
  let stageSince = new Date(0);
  const gates: Array<{ id: string; stageIndex: number; text: string; state: 'waiting' | 'passed'; at: string }> = [];
  for (const event of stageEvents) {
    if (event.kind === 'STAGE') {
      const next = railIndex(event.detail || '', position);
      // The next task going back from test to code stays on Work, so its finished agents stay drawn.
      if (next !== position) stageSince = event.createdAt;
      position = next;
    } else if (event.kind === 'WAITING') {
      gates.push({ id: event.id, stageIndex: Math.min(position, RAIL.length - 1), text: event.detail || '', state: 'passed', at: event.createdAt.toISOString() });
    }
  }
  const current = railIndex(run.stage, position);
  if (run.waiting && gates.length > 0) gates[gates.length - 1].state = 'waiting';
  // A round is a FINAL review that sent findings back; the ledger counts them, a stage going back does not.
  const used = run.rounds?.used ?? 0;
  const round = used + 1;
  const loop = used > 0 && current === RAIL.indexOf('work') ? { from: RAIL.indexOf('final'), to: current } : null;
  const hasGate = gates.some((gate) => GATE_ONE.test(gate.text));

  // Agents: the main session, the sub-coordinators it spawned, and whoever they spawned.
  // An agent stays for as long as it works; a finished one stays until the ticket changes stage.
  const main: TimelineAgent = {
    id: 'main',
    parentId: null,
    name: 'lead',
    detail: null,
    state: run.stage === 'done' ? 'done' : run.activity === 'ACTIVE' ? 'active' : run.activity === 'WAITING' ? 'waiting' : 'idle',
    tool: null,
    tools: 0,
  };
  interface Child extends TimelineAgent { type: string; linkedId: string | null; endedAt: Date | null; lastAt: Date }
  const children: Child[] = [];
  const addChild = (parentId: string, type: string, name: string, detail: string | null, linkedId: string | null, at: Date): Child => {
    const child: Child = { id: `agent-${children.length + 1}`, parentId, name, detail, state: 'active', tool: null, tools: 0, type, linkedId, endedAt: null, lastAt: at };
    children.push(child);
    return child;
  };
  const findChild = (event: ToolEvent) => (
    children.find((child) => child.linkedId === event.agentId)
    // First event from a new member: it is the oldest recent spawn of its type that nobody has claimed yet.
    || children.find((child) => !child.linkedId && child.state === 'active' && event.agentType != null
      && shortType(event.agentType) === shortType(child.type) && event.at.getTime() - child.lastAt.getTime() < AGENT_SILENCE_MS)
  );

  for (const event of tools) {
    if (event.kind === 'spawn') {
      // The row's agentId is whoever made the call, so a member spawned by a sub-coordinator hangs under it.
      const parent = event.agentId === 'main' ? undefined : children.find((child) => child.linkedId === event.agentId);
      addChild(parent ? parent.id : 'main', event.name, event.agentType || shortType(event.name), event.detail, null, event.at);
    } else if (event.kind === 'tool') {
      if (event.agentId === 'main') {
        main.tool = event.name;
        main.tools += 1;
        continue;
      }
      // Its spawn may have scrolled out of the buffer: an agent that is still calling tools still exists.
      const child = findChild(event) || addChild('main', event.agentType || 'agent', shortType(event.agentType), null, event.agentId, event.at);
      child.linkedId = event.agentId;
      child.lastAt = event.at;
      // An agent's turn can stop while its own members work and pick up again when they report.
      child.state = 'active';
      child.endedAt = null;
      child.tool = event.name;
      child.tools += 1;
    } else if (event.kind === 'stop') {
      const child = findChild(event);
      if (child) {
        child.state = 'done';
        child.tool = null;
        child.endedAt = event.at;
      }
    }
  }
  if (main.state !== 'active') main.tool = null;
  for (const child of children) {
    if (child.state === 'active' && now.getTime() - child.lastAt.getTime() > AGENT_SILENCE_MS) {
      child.state = 'done';
      child.tool = null;
      child.endedAt = child.lastAt;
    }
  }
  // Whoever still has a member at work is supervising, whatever its own last event was.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const child of children) {
      if (child.state !== 'active' && children.some((other) => other.parentId === child.id && other.state === 'active')) {
        child.state = 'active';
        child.tool = null;
        child.endedAt = null;
      }
    }
  }
  const shown = children.filter((child) => child.state === 'active' || (child.endedAt != null && child.endedAt >= stageSince));
  const shownIds = new Set(shown.map((child) => child.id));
  const agents: TimelineAgent[] = [main, ...shown.slice(-MAX_CHILDREN).map((child) => ({
    id: child.id,
    // A finished parent that is no longer shown hands its members up to the lead.
    parentId: child.parentId && child.parentId !== 'main' && !shownIds.has(child.parentId) ? 'main' : child.parentId,
    name: child.name, detail: child.detail, state: child.state, tool: child.tool, tools: child.tools,
  }))];

  // Activity strip: tool calls per five seconds, newest on the right.
  const end = now.getTime();
  const bucketOf = (at: Date) => BUCKET_COUNT - 1 - Math.floor((end - at.getTime()) / (BUCKET_SECONDS * 1000));
  const buckets = Array.from({ length: BUCKET_COUNT }, () => ({ n: 0, gate: false }));
  for (const event of tools) {
    const index = bucketOf(event.at);
    if (event.kind === 'tool' && index >= 0 && index < BUCKET_COUNT) buckets[index].n += 1;
  }
  for (const gate of gates) {
    const index = bucketOf(new Date(gate.at));
    if (index >= 0 && index < BUCKET_COUNT) buckets[index].gate = true;
  }

  const nameOf = (event: ToolEvent) => (event.agentId === 'main' ? main.name : shortType(event.agentType));
  const log = [
    ...stageEvents.filter((event) => ['STAGE', 'WAITING', 'RESUMED', 'MACHINE', 'HANDOVER', 'HANDOVER_CANCELLED'].includes(event.kind)).map((event) => ({
      at: event.createdAt,
      kind: event.kind === 'STAGE' ? 'stage' : event.kind === 'WAITING' ? 'gate' : 'ok',
      head: event.kind === 'STAGE' ? 'Stage' : event.kind === 'MACHINE' ? 'Machine' : event.kind === 'HANDOVER' || event.kind === 'HANDOVER_CANCELLED' ? 'Handover' : 'Gate',
      text: event.kind === 'RESUMED' ? 'opened' : event.kind === 'HANDOVER_CANCELLED' ? `cancelled${event.detail ? ` for ${event.detail}` : ''}` : event.detail || '',
    })),
    // The spawn row already says which agent was started, so the bare "Agent" tool row is left out.
    ...tools.filter((event) => !(event.kind === 'tool' && (event.name === 'Agent' || event.name === 'Task'))).map((event) => ({
      at: event.at,
      kind: event.kind === 'stop' ? 'ok' : 'tool',
      head: event.kind === 'spawn' ? main.name : nameOf(event),
      text: event.kind === 'spawn' ? `Agent → ${shortType(event.name)}` : event.kind === 'stop' ? 'finished' : event.name,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, LOG_SIZE)
    .map((entry) => ({ ...entry, at: entry.at.toISOString() }));

  return {
    stageIndex: current,
    round,
    loopFrom: loop ? loop.from : null,
    loopTo: loop ? loop.to : null,
    hasGate,
    gates: gates.slice(-MAX_GATES),
    agents,
    buckets,
    totalTools: tools.filter((event) => event.kind === 'tool').length,
    log,
  };
}

export type OrchestrationTimeline = ReturnType<typeof buildTimeline>;
