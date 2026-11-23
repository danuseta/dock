import { agentTask, agentType, type ChatActivity } from './activity/activity';
import { stepRound, stepStage, type Checkpoint } from './checkpoints';

type LoopCall = Pick<ChatActivity, 'eventId' | 'name' | 'label' | 'startedAt'>;

/** A worker → verifier loop on one task, as the runner's thread shows it: its calls in order, the round of each and the failed rounds under their verifier. */
export interface FixLoop {
  task: string;
  calls: string[];
  /** Verifier runs so far. */
  rounds: number;
  roundOf: ReadonlyMap<string, number>;
  /** The round checkpoints under each verifier, by the verifier's event id. */
  notes: ReadonlyMap<string, Checkpoint[]>;
}

const WORKER = 'sous-ticket-worker';
const VERIFIER = 'sous-verifier';
const REVIEWER = 'sous-reviewer';

const timeOf = (iso: string) => Date.parse(iso);

/** The task an agent's description names ("T1 fix the filter"), if any. */
export function labelTask(label: string): string | null {
  const match = /\bT(\d+)\b/.exec(label);
  return match ? `T${match[1]}` : null;
}

/**
 * The fix loops among an agent's calls. A call's task comes from its description, else from the task checkpoint it
 * wrote, else from the task the runner was last on (the newest task checkpoint or call before it). Consecutive worker
 * and verifier calls on one task, with a loop review naming that task between them, form a run; a run is a fix loop
 * once its verifier ran twice or a failed round was reported. Other calls end the run.
 */
export function fixLoops(calls: readonly LoopCall[], checkpoints: readonly Checkpoint[]): FixLoop[] {
  const ordered = [...calls].sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt));
  const tasked = checkpoints
    .map((checkpoint) => ({ checkpoint, task: stepStage(checkpoint.step).task }))
    .filter((item): item is { checkpoint: Checkpoint; task: string } => item.task !== null)
    .sort((a, b) => timeOf(a.checkpoint.at) - timeOf(b.checkpoint.at));
  const runs: Array<{ task: string; calls: LoopCall[] }> = [];
  let last: { task: string | null; at: number } = { task: null, at: Number.NEGATIVE_INFINITY };
  let run: { task: string; calls: LoopCall[] } | null = null;
  for (const call of ordered) {
    const type = agentType(call.name);
    const own = labelTask(agentTask(call));
    const written = tasked.find((item) => item.checkpoint.agentId === call.eventId)?.task ?? null;
    const before = tasked.filter((item) => timeOf(item.checkpoint.at) <= timeOf(call.startedAt)).pop();
    const current = before && timeOf(before.checkpoint.at) >= last.at ? before.task : last.task;
    const task = own ?? written ?? current;
    last = { task, at: timeOf(call.startedAt) };
    const member = task !== null && (type === WORKER || type === VERIFIER || (type === REVIEWER && own !== null && !/final/i.test(agentTask(call))));
    if (!member) {
      run = null;
      continue;
    }
    if (!run || run.task !== task) {
      run = { task, calls: [] };
      runs.push(run);
    }
    run.calls.push(call);
  }

  const notes = new Map<string, Checkpoint[]>();
  const verifiers = runs.flatMap((item) => item.calls.filter((call) => agentType(call.name) === VERIFIER).map((call) => ({ task: item.task, call })));
  for (const checkpoint of checkpoints) {
    const round = stepRound(checkpoint.step);
    if (!round) continue;
    const verifier = verifiers.find((item) => item.call.eventId === checkpoint.agentId)
      ?? verifiers.filter((item) => item.task === round.task && timeOf(item.call.startedAt) <= timeOf(checkpoint.at)).pop();
    if (verifier) notes.set(verifier.call.eventId, [...(notes.get(verifier.call.eventId) ?? []), checkpoint]);
  }

  return runs.flatMap((item) => {
    const ran = item.calls.filter((call) => agentType(call.name) === VERIFIER);
    if (ran.length === 0 || (ran.length < 2 && !ran.some((call) => notes.has(call.eventId)))) return [];
    const roundOf = new Map<string, number>();
    let round = 1;
    for (const call of item.calls) {
      roundOf.set(call.eventId, round);
      if (agentType(call.name) === VERIFIER) round += 1;
    }
    const own = new Map(ran.filter((call) => notes.has(call.eventId)).map((call) => [call.eventId, notes.get(call.eventId)!]));
    return [{ task: item.task, calls: item.calls.map((call) => call.eventId), rounds: ran.length, roundOf, notes: own }];
  });
}

export type LoopPart<P> = P | { kind: 'loop'; loop: FixLoop; parts: P[] };

/**
 * An agent's thread messages with each fix loop folded into one part where its first call was: the loop carries every
 * part from its first call to its last, steps between them included. A message left empty is dropped.
 */
export function foldLoops<P extends { event: Pick<ChatActivity, 'eventId'> }>(messages: ReadonlyArray<{ key: string; at: string; parts: P[] }>, loops: readonly FixLoop[]): Array<{ key: string; at: string; parts: Array<LoopPart<P>> }> {
  const flat = messages.flatMap((message) => message.parts);
  const index = new Map(flat.map((part, position) => [part.event.eventId, position]));
  const spans = loops
    .map((loop) => ({ loop, from: index.get(loop.calls[0]) ?? -1, to: index.get(loop.calls[loop.calls.length - 1]) ?? -1 }))
    .filter((span) => span.from >= 0 && span.to >= span.from);
  const spanAt = (position: number) => spans.find((span) => position >= span.from && position <= span.to);
  let position = 0;
  const out: Array<{ key: string; at: string; parts: Array<LoopPart<P>> }> = [];
  for (const message of messages) {
    const parts: Array<LoopPart<P>> = [];
    for (const part of message.parts) {
      const span = spanAt(position);
      if (!span) parts.push(part);
      else if (position === span.from) parts.push({ kind: 'loop', loop: span.loop, parts: flat.slice(span.from, span.to + 1) });
      position += 1;
    }
    if (parts.length > 0) out.push({ ...message, parts });
  }
  return out;
}
