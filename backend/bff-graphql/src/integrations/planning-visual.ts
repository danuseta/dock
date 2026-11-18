// The HTML visuals the planning agent makes for a sprint draft (a chart, a timeline). Each one is a file under the
// blackboard root, <root>/.planning-visuals/<sprint>/<id>.html, shown in a sandboxed frame in Planning, plus a row that says when
// the draft was last changed before it was made, so a later change marks it stale.
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SprintInputError } from './sprint-dashboard';

export const VISUAL_ID = /^[a-z0-9-]{1,40}$/;
export const VISUAL_SPRINT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const VISUAL_FILE = /^([a-z0-9-]{1,40})\.html$/;
export const MAX_VISUAL_BYTES = 2 * 1024 * 1024;
export const MAX_VISUAL_TITLE = 60;
export const MAX_VISUALS_PER_SPRINT = 30;
const MAX_SPRINT_NAME = 120;
const MAX_SPRINT_SEGMENT = 80;
const ID_HINT = 'id must be lower case letters, digits and dashes, up to 40';

export interface VisualRow { id: string; sprint: string; title: string; sessionId: string | null; draftStamp: Date; saved: boolean; createdAt: Date }

export interface VisualStore {
  sprintDraftChangedAt(sprint: string): Promise<Date | null>;
  listSprintDraftVisuals(sprint: string): Promise<VisualRow[]>;
  getSprintDraftVisual(id: string): Promise<VisualRow | null>;
  putSprintDraftVisual(data: { id: string; sprint: string; title: string; sessionId: string | null; draftStamp: Date; createdAt: Date }): Promise<unknown>;
  setSprintDraftVisualSaved(id: string, saved: boolean): Promise<unknown>;
  deleteSprintDraftVisual(id: string): Promise<unknown>;
}

export interface VisualView { id: string; title: string; createdAt: string; saved: boolean; stale: boolean; url: string; sessionId: string | null }

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const validId = (id: unknown): id is string => typeof id === 'string' && VISUAL_ID.test(id) && !WINDOWS_RESERVED.test(id);

/** The folder name of a sprint: lower case letters and digits joined by dashes; a name that is not a plain sprint name has none. */
export function visualSprintSegment(sprint: unknown): string {
  if (typeof sprint !== 'string') throw new SprintInputError('sprint must be a string');
  const name = sprint.trim();
  if (!name || name.length > MAX_SPRINT_NAME || /[\\/\x00-\x1f]|\.\./.test(name)) throw new SprintInputError('sprint is not a sprint name');
  const segment = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!segment || segment.length > MAX_SPRINT_SEGMENT || !VISUAL_SPRINT.test(segment)) throw new SprintInputError('sprint is not a sprint name');
  return segment;
}

export const visualUrl = (segment: string, id: string) => `/api/planning-visual/${segment}/${id}.html`;

export class PlanningVisualService {
  constructor(
    private readonly store: VisualStore,
    private readonly root: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  dir(segment: string): string {
    return path.join(this.root(), '.planning-visuals', segment);
  }

  /** The saved file of one visual, or null when the sprint segment or the file name is not one DOCK writes. */
  file(segment: string, name: string): string | null {
    return VISUAL_SPRINT.test(segment) && segment.length <= MAX_SPRINT_SEGMENT && VISUAL_FILE.test(name) ? path.join(this.dir(segment), name) : null;
  }

  private async filesIn(segment: string): Promise<number> {
    try {
      return (await fs.readdir(this.dir(segment))).filter((name) => VISUAL_FILE.test(name)).length;
    } catch {
      return 0;
    }
  }

  /** Creates the visual, or replaces the one with this id; a replaced visual keeps its saved state. */
  async put(sprintName: string, input: { id?: unknown; title: unknown; html: unknown; sessionId?: unknown }): Promise<{ id: string; url: string }> {
    const segment = visualSprintSegment(sprintName);
    const sprint = sprintName.trim();
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > MAX_VISUAL_TITLE) throw new SprintInputError(`title is required, up to ${MAX_VISUAL_TITLE} characters`);
    if (typeof input.html !== 'string' || !input.html.trim()) throw new SprintInputError('html must be a string');
    if (Buffer.byteLength(input.html, 'utf8') > MAX_VISUAL_BYTES) throw new SprintInputError('html is over 2 MB');
    if (input.sessionId !== undefined && input.sessionId !== null && (typeof input.sessionId !== 'string' || input.sessionId.length > 100)) throw new SprintInputError('sessionId must be a string');
    const sessionId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId : null;
    let id: string;
    if (input.id === undefined || input.id === null || input.id === '') id = `v-${randomBytes(6).toString('hex')}`;
    else if (validId(input.id)) id = input.id;
    else throw new SprintInputError(ID_HINT);
    const stamp = await this.store.sprintDraftChangedAt(sprint);
    if (!stamp) throw new SprintInputError(`No draft for ${sprint}; load it in Planning first`);
    const existing = await this.store.getSprintDraftVisual(id);
    if (existing && existing.sprint !== sprint) throw new SprintInputError(`id ${id} belongs to another sprint`);
    if (!existing && Math.max((await this.store.listSprintDraftVisuals(sprint)).length, await this.filesIn(segment)) >= MAX_VISUALS_PER_SPRINT) throw new SprintInputError(`A sprint holds at most ${MAX_VISUALS_PER_SPRINT} visuals; discard one first`);
    const target = path.join(this.dir(segment), `${id}.html`);
    await fs.mkdir(this.dir(segment), { recursive: true });
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, input.html, 'utf8');
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
    try {
      await this.store.putSprintDraftVisual({ id, sprint, title, sessionId, draftStamp: stamp, createdAt: this.now() });
    } catch (error) {
      if (!existing) await fs.rm(target, { force: true });
      throw error;
    }
    return { id, url: visualUrl(segment, id) };
  }

  /** Deletes the file and the row; a visual that is already gone is not an error. */
  async remove(sprintName: string, id: unknown): Promise<{ id: string }> {
    const segment = visualSprintSegment(sprintName);
    const sprint = sprintName.trim();
    if (!validId(id)) throw new SprintInputError(ID_HINT);
    const row = await this.store.getSprintDraftVisual(id);
    if (row && row.sprint !== sprint) throw new SprintInputError(`No visual ${id} in ${sprint}`);
    await fs.rm(path.join(this.dir(segment), `${id}.html`), { force: true });
    await this.store.deleteSprintDraftVisual(id);
    return { id };
  }

  async list(sprintName: string): Promise<VisualView[]> {
    const segment = visualSprintSegment(sprintName);
    const sprint = sprintName.trim();
    const [rows, changedAt] = await Promise.all([this.store.listSprintDraftVisuals(sprint), this.store.sprintDraftChangedAt(sprint)]);
    return rows.map((row) => ({
      id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), saved: row.saved, sessionId: row.sessionId,
      stale: !!changedAt && changedAt.getTime() > row.draftStamp.getTime(), url: visualUrl(segment, row.id),
    }));
  }

  async save(sprintName: string, id: unknown): Promise<VisualView[]> {
    visualSprintSegment(sprintName);
    const sprint = sprintName.trim();
    if (!validId(id)) throw new SprintInputError(ID_HINT);
    const row = await this.store.getSprintDraftVisual(id);
    if (!row || row.sprint !== sprint) throw new SprintInputError(`No visual ${id} in ${sprint}`);
    await this.store.setSprintDraftVisualSaved(id, true);
    return this.list(sprint);
  }

  async drop(sprintName: string, id: unknown): Promise<VisualView[]> {
    await this.remove(sprintName, id);
    return this.list(sprintName);
  }

  /** Publish keeps the saved visuals and deletes the rest. */
  async dropUnsaved(sprintName: string): Promise<number> {
    const rows = (await this.store.listSprintDraftVisuals(sprintName.trim())).filter((row) => !row.saved);
    for (const row of rows) await this.remove(sprintName, row.id);
    return rows.length;
  }
}
