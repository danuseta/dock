// Settings › Planning flow as Planning reads it: which stages run, who holds each one, and whether it needs approval.
// No saved flow means every stage runs, as Planning did before the setting.

export type PlanStageId = 'load' | 'scope' | 'ac' | 'qa' | 'tc' | 'storyboard' | 'contract' | 'publish';
export interface PlanStage { id: PlanStageId; skip: boolean; owner: string; approve: boolean }
export interface PlanningFlow { template: string | null; stages: PlanStage[] }

export const PLAN_STAGES: Array<{ id: PlanStageId; label: string; owner: string }> = [
  { id: 'load', label: 'Load Jira', owner: 'DOCK' },
  { id: 'scope', label: 'Scope / kapasitas', owner: 'Planner' },
  { id: 'ac', label: 'AC check', owner: 'Planner' },
  { id: 'qa', label: 'QA check', owner: 'QA' },
  { id: 'tc', label: 'Test case', owner: 'QA' },
  { id: 'storyboard', label: 'Storyboard', owner: 'PO' },
  { id: 'contract', label: 'Kontrak', owner: 'PO' },
  { id: 'publish', label: 'Publish', owner: 'Planner' },
];
export const PLAN_STAGE_ROLES = ['DOCK', 'Planner', 'QA', 'PO'];
export const REQUIRED_STAGES: PlanStageId[] = ['load', 'publish'];

export const FLOW_TEMPLATES: Array<{ name: string; skip: PlanStageId[]; approve: PlanStageId[] }> = [
  { name: 'Lengkap', skip: [], approve: ['scope', 'publish'] },
  { name: 'Tanpa QA', skip: ['qa', 'tc'], approve: ['publish'] },
  { name: 'Cuma scope + publish', skip: ['ac', 'qa', 'tc', 'storyboard', 'contract'], approve: ['publish'] },
];

export const defaultFlow = (): PlanningFlow => ({ template: null, stages: PLAN_STAGES.map((stage) => ({ id: stage.id, skip: false, owner: stage.owner, approve: false })) });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The saved flow, every stage in order; an empty or unreadable value is the default flow. */
export function parseFlow(raw: string | null | undefined): PlanningFlow {
  if (!raw) return defaultFlow();
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return defaultFlow(); }
  if (!isRecord(input) || !Array.isArray(input.stages)) return defaultFlow();
  const given = new Map(input.stages.filter(isRecord).map((stage) => [stage.id, stage]));
  return {
    template: typeof input.template === 'string' ? input.template : null,
    stages: defaultFlow().stages.map((stage) => {
      const saved = given.get(stage.id);
      if (!saved) return stage;
      const skip = saved.skip === true && !REQUIRED_STAGES.includes(stage.id);
      return { id: stage.id, skip, owner: typeof saved.owner === 'string' && PLAN_STAGE_ROLES.includes(saved.owner) ? saved.owner : stage.owner, approve: !skip && saved.approve === true };
    }),
  };
}

/** A template's stages; each stage keeps the owner it had. */
export function applyTemplate(flow: PlanningFlow, name: string): PlanningFlow {
  const template = FLOW_TEMPLATES.find((item) => item.name === name);
  if (!template) return flow;
  return { template: name, stages: flow.stages.map((stage) => ({ ...stage, skip: template.skip.includes(stage.id), approve: !template.skip.includes(stage.id) && template.approve.includes(stage.id) })) };
}

/** One stage changed by hand; the flow no longer follows a template. Load and Publish always run. */
export function updateStage(flow: PlanningFlow, id: PlanStageId, change: Partial<Omit<PlanStage, 'id'>>): PlanningFlow {
  return {
    template: null,
    stages: flow.stages.map((stage) => {
      if (stage.id !== id) return stage;
      const next = { ...stage, ...change };
      if (REQUIRED_STAGES.includes(id)) next.skip = false;
      if (next.skip) next.approve = false;
      return next;
    }),
  };
}

/** The stages this flow skips. */
export const skippedStages = (flow: PlanningFlow | null): Set<PlanStageId> => new Set((flow?.stages ?? []).filter((stage) => stage.skip).map((stage) => stage.id));
