// The planning agent's side of Agents > Sprint > Planning: the kit skill in the `Planning-<sprint>` chat reads and
// changes the draft through these ingest routes, and the Planning panel polls the same draft. Route names and bodies
// are fixed; the kit is written against them.
import { OrchestratorInputError } from './orchestrator';
import { SprintInputError } from './sprint-dashboard';
import type { DraftView, SprintDraftService } from './sprint-draft';
import { StoryboardMissing, type StoryboardReader } from './storyboard';

export const PLANNING_ROUTES = ['sprint-draft/get', 'sprint-draft/update', 'sprint-draft/tc', 'sprint-draft/question', 'storyboard'] as const;
export type PlanningRoute = typeof PLANNING_ROUTES[number];

export interface PlanningIngestDeps {
  drafts: Pick<SprintDraftService, 'view' | 'updateTicket' | 'ask' | 'applyStoryboard' | 'setTcs'>;
  storyboards: Pick<StoryboardReader, 'sync'>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function textField(body: Record<string, unknown>, name: string, required = true): string | null {
  const value = body[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new OrchestratorInputError(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new OrchestratorInputError(`${name} must be a string`);
  return value.trim();
}

function numberField(body: Record<string, unknown>, name: string): number | null | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new OrchestratorInputError(`${name} must be a number`);
  return value;
}

async function draftOf(drafts: PlanningIngestDeps['drafts'], sprint: string): Promise<DraftView> {
  const view = await drafts.view(sprint);
  if (!view) throw new OrchestratorInputError(`No draft for ${sprint}; load it in Agents › Sprint › Planning first`);
  return view;
}

export async function planningIngest(deps: PlanningIngestDeps, route: PlanningRoute, input: unknown): Promise<unknown> {
  const body = isRecord(input) ? input : {};
  try {
    if (route === 'storyboard') {
      const result = await deps.storyboards.sync(textField(body, 'epic')!);
      await deps.drafts.applyStoryboard(result);
      return { version: result.version, path: result.path, frames: result.frames, changed: result.changed };
    }
    const sprint = textField(body, 'sprint')!;
    if (route === 'sprint-draft/get') return await draftOf(deps.drafts, sprint);
    if (route === 'sprint-draft/question') return await deps.drafts.ask(sprint, textField(body, 'text')!, textField(body, 'key', false));
    const key = textField(body, 'key')!.toUpperCase();
    if (route === 'sprint-draft/tc') return await deps.drafts.setTcs(sprint, key, body.tcs);
    const change: { dev?: string | null; wave?: number | null; sp?: number | null; ac?: string[] } = {};
    if (body.dev !== undefined) change.dev = body.dev === null ? null : textField(body, 'dev', false);
    const wave = numberField(body, 'wave');
    if (wave !== undefined) change.wave = wave;
    const sp = numberField(body, 'sp');
    if (sp !== undefined) change.sp = sp;
    if (body.ac !== undefined) {
      if (!Array.isArray(body.ac) || body.ac.some((line) => typeof line !== 'string')) throw new OrchestratorInputError('ac must be an array of strings');
      change.ac = body.ac as string[];
    }
    return await deps.drafts.updateTicket(sprint, key, change);
  } catch (error) {
    if (error instanceof SprintInputError || error instanceof StoryboardMissing) throw new OrchestratorInputError(error.message);
    throw error;
  }
}

/** The chat session Planning opens for a sprint; the kit skill reads the sprint from this title. */
export const planningChatTitle = (sprint: string) => `Planning-${sprint}`;

/** The first message of the Planning chat: runs the kit skill sprint-planner with the sprint and the epics DOCK knows. */
export function planningChatPrompt(sprint: string, epics: string[]): string {
  const list = [...new Set(epics.filter(Boolean))].sort();
  return [
    `Pakai skill sprint-planner: ${sprint}${list.length ? ` epic ${list.join(', ')}` : ''}`,
    `Sprint: ${sprint}`,
    `Epic: ${list.length ? list.join(', ') : 'belum diketahui, tanyakan ke planner atau ambil dari parent tiket'}`,
    'Draft ada di DOCK; ubah hanya lewat kit/sprint-draft.cjs. Jangan publish, jangan tulis ke Jira atau Confluence.',
  ].join('\n');
}
