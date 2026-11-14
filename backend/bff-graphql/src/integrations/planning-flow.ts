// Settings › Planning flow: which planning stages run, who holds each one and whether the next stage waits for its
// approval. Stored as JSON under AppSettings.planningFlow; no saved flow means every stage runs, as before the setting.

export const PLANNING_FLOW_KEY = 'planningFlow';
export const PLAN_STAGE_IDS = ['load', 'scope', 'ac', 'qa', 'tc', 'storyboard', 'contract', 'publish'] as const;
export const PLAN_STAGE_ROLES = ['DOCK', 'Planner', 'QA', 'PO'] as const;
/** Stages a flow can never skip: the draft has to come from Jira and go back to it. */
export const REQUIRED_STAGES: readonly PlanStageId[] = ['load', 'publish'];

export type PlanStageId = (typeof PLAN_STAGE_IDS)[number];
export interface PlanStage { id: PlanStageId; skip: boolean; owner: string; approve: boolean }
export interface PlanningFlow { template: string | null; stages: PlanStage[] }

export const DEFAULT_OWNERS: Record<PlanStageId, string> = {
  load: 'DOCK', scope: 'Planner', ac: 'Planner', qa: 'QA', tc: 'QA', storyboard: 'PO', contract: 'PO', publish: 'Planner',
};
const MAX_TEMPLATE = 60;

export class PlanningFlowError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every stage on, with its usual owner: the flow DOCK runs when none is saved. */
export const defaultPlanningFlow = (): PlanningFlow => ({
  template: null,
  stages: PLAN_STAGE_IDS.map((id) => ({ id, skip: false, owner: DEFAULT_OWNERS[id], approve: false })),
});

/** The flow from its JSON, every stage in order; a stage left out keeps its default. A wrong value is an error. */
export function parsePlanningFlow(raw: string): PlanningFlow {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new PlanningFlowError('The planning flow is not valid JSON'); }
  if (!isRecord(input)) throw new PlanningFlowError('The planning flow must be an object');
  if (input.template !== undefined && input.template !== null && typeof input.template !== 'string') throw new PlanningFlowError('template must be text');
  const template = typeof input.template === 'string' ? input.template.trim().slice(0, MAX_TEMPLATE) || null : null;
  if (!Array.isArray(input.stages)) throw new PlanningFlowError('stages must be a list');
  const given = new Map<PlanStageId, PlanStage>();
  for (const stage of input.stages) {
    if (!isRecord(stage)) throw new PlanningFlowError('Each stage must be an object');
    const id = stage.id as PlanStageId;
    if (!PLAN_STAGE_IDS.includes(id)) throw new PlanningFlowError(`Unknown stage ${String(stage.id)}`);
    if (given.has(id)) throw new PlanningFlowError(`Stage ${id} is listed twice`);
    const skip = stage.skip ?? false;
    const approve = stage.approve ?? false;
    if (typeof skip !== 'boolean') throw new PlanningFlowError(`${id}.skip must be true or false`);
    if (typeof approve !== 'boolean') throw new PlanningFlowError(`${id}.approve must be true or false`);
    if (skip && REQUIRED_STAGES.includes(id)) throw new PlanningFlowError(`Stage ${id} cannot be skipped`);
    const owner = stage.owner ?? DEFAULT_OWNERS[id];
    if (typeof owner !== 'string' || !(PLAN_STAGE_ROLES as readonly string[]).includes(owner)) throw new PlanningFlowError(`${id}.owner must be one of ${PLAN_STAGE_ROLES.join(', ')}`);
    given.set(id, { id, skip, owner, approve: skip ? false : approve });
  }
  return { template, stages: defaultPlanningFlow().stages.map((stage) => given.get(stage.id) ?? stage) };
}

/** The saved flow for the query: the stored JSON, or null when none is saved or it no longer reads. */
export function storedPlanningFlow(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { return JSON.stringify(parsePlanningFlow(raw)); } catch { return null; }
}
