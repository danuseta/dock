import { stageOf, type SousStageId } from '../lib/sousFlow';
import { agentType } from './activity/activity';

/** The lead's report when one agent ends (QRD-1534): the step, who, a short report, and on the final review two notes. */
export interface Checkpoint { id: string; key: string; step: string; agentId: string | null; agent: string | null; text: string; untestable: string[]; missingData: string[]; at: string }
export interface CheckpointWorker { id: string; name: string; startedAt: string }

const NAMED_STEPS: Record<string, SousStageId> = { planner: 'plan', 'final-review': 'final', video: 'video', publish: 'publish' };
const TASK_STEPS: Record<string, SousStageId> = { work: 'code', review: 'loop', verify: 'verify' };

/** The Sous flow stage a kit step belongs to, with its task on task steps; null stage for a step the flow does not name. */
export function stepStage(step: string): { stage: SousStageId | null; task: string | null } {
  const value = step.trim();
  const task = /^(T\d+)-(work|review|verify)$/i.exec(value);
  if (task) return { stage: TASK_STEPS[task[2].toLowerCase()], task: task[1].toUpperCase() };
  const named = NAMED_STEPS[value.toLowerCase()] ?? (stageOf(value) ? value as SousStageId : null);
  return { stage: named, task: null };
}

/** The step as the Sous flow names it ("Ngoding · T2"), or as the lead wrote it. */
export function stepLabel(step: string): string {
  const { stage, task } = stepStage(step);
  const title = stage ? stageOf(stage)?.title : null;
  if (!title) return step;
  return task ? `${title} · ${task}` : title;
}

export const hasNotes = (checkpoint: Pick<Checkpoint, 'untestable' | 'missingData'>) => checkpoint.untestable.length > 0 || checkpoint.missingData.length > 0;

const sameAgent = (checkpoint: Checkpoint, worker: CheckpointWorker) => Boolean(checkpoint.agent) && agentType(checkpoint.agent!) === agentType(worker.name);

/**
 * The last checkpoint the lead wrote for one agent: the newest carrying its id, else the newest from an agent of the
 * same type written after it started and before the next agent of that type started.
 */
export function checkpointForAgent(checkpoints: readonly Checkpoint[], worker: CheckpointWorker, workers: readonly CheckpointWorker[] = []): Checkpoint | null {
  const byId = checkpoints.filter((checkpoint) => checkpoint.agentId && checkpoint.agentId === worker.id).pop();
  if (byId) return byId;
  const started = Date.parse(worker.startedAt);
  const next = workers
    .filter((other) => other.id !== worker.id && agentType(other.name) === agentType(worker.name) && Date.parse(other.startedAt) > started)
    .map((other) => Date.parse(other.startedAt))
    .sort((a, b) => a - b)[0] ?? Infinity;
  return checkpoints.filter((checkpoint) => !checkpoint.agentId && sameAgent(checkpoint, worker) && Date.parse(checkpoint.at) >= started && Date.parse(checkpoint.at) < next).pop() ?? null;
}

/**
 * Where each checkpoint goes among the thread's items, given each item's time in order: before the first item that
 * came after it. `at.get(i)` lists what goes before item i; `end` what comes after the last item.
 */
export function placeCheckpoints(itemTimes: readonly string[], checkpoints: readonly Checkpoint[]): { at: Map<number, Checkpoint[]>; end: Checkpoint[] } {
  const at = new Map<number, Checkpoint[]>();
  const end: Checkpoint[] = [];
  const times = itemTimes.map((time) => Date.parse(time));
  for (const checkpoint of [...checkpoints].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const when = Date.parse(checkpoint.at);
    const index = times.findIndex((time) => time > when);
    if (index < 0) end.push(checkpoint);
    else at.set(index, [...(at.get(index) ?? []), checkpoint]);
  }
  return { at, end };
}

/** The ids that are new since the last read; none on the first read, so opening a session does not count as news. */
export function newIds(seen: ReadonlySet<string> | null, checkpoints: readonly Checkpoint[]): string[] {
  if (!seen) return [];
  return checkpoints.map((checkpoint) => checkpoint.id).filter((id) => !seen.has(id));
}
