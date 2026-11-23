// The planning agent's side of Agents > Sprint > Planning: the kit skill in the `Planning-<sprint>` chat reads and
// changes the draft through these ingest routes, and the Planning panel polls the same draft. Route names and bodies
// are fixed; the kit is written against them.
import { OrchestratorInputError } from './orchestrator';
import { SprintInputError } from './sprint-dashboard';
import type { PlanningVisualService } from './planning-visual';
import { openTickets, type DraftView, type SprintDraftService } from './sprint-draft';
import { StoryboardMissing, type StoryboardReader } from './storyboard';
import { lintTicket, type LintInput } from './ticket-lint';
import type { TicketSummaryService } from './ticket-summary';

export const PLANNING_ROUTES = ['sprint-draft/get', 'sprint-draft/update', 'sprint-draft/tc', 'sprint-draft/question', 'sprint-draft/summary', 'sprint-draft/visual', 'sprint-draft/new', 'sprint-draft/revise', 'ticket/lint', 'storyboard'] as const;
export type PlanningRoute = typeof PLANNING_ROUTES[number];

export interface PlanningIngestDeps {
  drafts: Pick<SprintDraftService, 'view' | 'updateTicket' | 'ask' | 'applyStoryboard' | 'setTcs' | 'saveNewTicket' | 'removeNewTicket' | 'saveRevision' | 'discardRevision'>;
  storyboards: Pick<StoryboardReader, 'sync'>;
  /** The ticket summaries; get lists the acHash each stored summary was written for. */
  summaries?: Pick<TicketSummaryService, 'write' | 'hashes'>;
  /** The visuals the agent puts in Planning; without them the route answers that visuals are not available. */
  visuals?: Pick<PlanningVisualService, 'put' | 'remove' | 'list'>;
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

const LINT_TEXT = ['type', 'summary', 'userStory', 'problem', 'reference', 'openToConfirm', 'description', 'key'] as const;
const LINT_LISTS = ['ac', 'blockedBy', 'decidedRefs'] as const;

/** The body of ticket/lint: the writing standard's input; a field left out is not checked. */
export function lintInput(body: Record<string, unknown>): LintInput {
  const input: Record<string, unknown> = {};
  for (const name of LINT_TEXT) {
    const value = body[name];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new OrchestratorInputError(`${name} must be a string`);
    input[name] = value;
  }
  for (const name of LINT_LISTS) {
    const value = body[name];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) throw new OrchestratorInputError(`${name} must be an array of strings`);
    input[name] = value;
  }
  if (body.sp !== undefined) {
    if (body.sp !== null && (typeof body.sp !== 'number' || !Number.isFinite(body.sp))) throw new OrchestratorInputError('sp must be a number');
    input.sp = body.sp;
  }
  return input as LintInput;
}

/** The agent plans the cards still to build, as before merged cards joined the draft. */
const open = (view: DraftView): DraftView => ({ ...view, tickets: openTickets(view) });

async function draftOf(drafts: PlanningIngestDeps['drafts'], sprint: string): Promise<DraftView> {
  const view = await drafts.view(sprint);
  if (!view) throw new OrchestratorInputError(`No draft for ${sprint}; load it in Planning › Draft first`);
  return open(view);
}

export async function planningIngest(deps: PlanningIngestDeps, route: PlanningRoute, input: unknown): Promise<unknown> {
  const body = isRecord(input) ? input : {};
  try {
    if (route === 'storyboard') {
      const result = await deps.storyboards.sync(textField(body, 'epic')!);
      await deps.drafts.applyStoryboard(result);
      return { version: result.version, path: result.path, frames: result.frames, changed: result.changed };
    }
    if (route === 'ticket/lint') return lintTicket(lintInput(body));
    const sprint = textField(body, 'sprint')!;
    if (route === 'sprint-draft/get') {
      const view = await draftOf(deps.drafts, sprint);
      const withSummaries = deps.summaries ? { ...view, summaries: await deps.summaries.hashes(view.tickets.map((ticket) => ticket.key)) } : view;
      return deps.visuals ? { ...withSummaries, visuals: (await deps.visuals.list(sprint)).map(({ id, title, saved, stale }) => ({ id, title, saved, stale })) } : withSummaries;
    }
    if (route === 'sprint-draft/visual') {
      if (!deps.visuals) throw new OrchestratorInputError('Visuals are not available on this DOCK');
      if (body.action === 'rm') return await deps.visuals.remove(sprint, body.id);
      if (body.action !== 'put') throw new OrchestratorInputError("action must be 'put' or 'rm'");
      return await deps.visuals.put(sprint, { id: body.id, title: body.title, html: body.html, sessionId: body.sessionId });
    }
    if (route === 'sprint-draft/new') {
      const id = textField(body, 'id', false)?.toUpperCase() ?? null;
      if (body.remove === true) {
        if (!id) throw new OrchestratorInputError('id is required');
        await deps.drafts.removeNewTicket(sprint, id);
        return { removed: id };
      }
      if (!isRecord(body.ticket)) throw new OrchestratorInputError('ticket must be an object');
      const saved = await deps.drafts.saveNewTicket(sprint, id, body.ticket);
      const ticket = saved.view.newTickets.find((item) => item.id === saved.id) ?? null;
      return { id: saved.id, ticket, lint: ticket?.lint ?? null };
    }
    if (route === 'sprint-draft/revise') {
      const key = textField(body, 'key')!.toUpperCase();
      if (body.remove === true) {
        await deps.drafts.discardRevision(sprint, key);
        return { discarded: key };
      }
      if (!isRecord(body.revision)) throw new OrchestratorInputError('revision must be an object');
      const saved = await deps.drafts.saveRevision(sprint, key, body.revision, 'chat');
      return { key: saved.revision.key, revision: saved.revision, lint: saved.revision.lint };
    }
    if (route === 'sprint-draft/summary') {
      if (!deps.summaries) throw new OrchestratorInputError('Ticket summaries are not available on this DOCK');
      return await deps.summaries.write(sprint, body);
    }
    if (route === 'sprint-draft/question') {
      const options = Array.isArray(body.options) ? body.options.filter((option): option is string => typeof option === 'string') : [];
      return open(await deps.drafts.ask(sprint, textField(body, 'text')!, textField(body, 'key', false), options));
    }
    const key = textField(body, 'key')!.toUpperCase();
    if (route === 'sprint-draft/tc') return open(await deps.drafts.setTcs(sprint, key, body.tcs));
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
    return open(await deps.drafts.updateTicket(sprint, key, change));
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
