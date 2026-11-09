// A sprint draft in Agents > Sprint > Planning: the sprint's tickets loaded from Jira, the planner's changes to
// developer, wave, SP and AC, the schedule and AC check computed from them, the QA bot's prediction, and the decisions
// the planner made. Publish writes back only what differs from Jira, and refuses a ticket whose AC moved in Jira since
// it was loaded, so a teammate's edit is never overwritten.
import { acFindings, isDoneStatus, normalizeAcLine, splitAc, type AcFinding } from './ac-scope';
import type { PlanningIssue, PlanningSprint } from './jira-sprint';
import { predictQa, type QaInputTicket, type QaPrediction, type QaRun } from './qa-predict';
import { DEFAULT_SP_PER_DAY, DEFAULT_SPRINT_DAYS, planStart, scheduleSprint, workingDayOf, workingDays, type ScheduledTicket } from './scope-cut';
import { SprintInputError } from './sprint-dashboard';
import { writeContract, type ContractClient } from './sprint-contract';
import { StoryboardMissing, framesIn, type StoryboardResult } from './storyboard';
import type { SprintDraftInput, SprintDraftTicketInput } from '../storage/service';

export const SP_PER_DAY_KEY = 'planningSpPerDay';
const AC_ACTIONS = ['move', 'wait', 'drop'];
const QA_ACTIONS = ['accept', 'fix'];
const MAX_AC_LINES = 200;
const MAX_LINE = 2000;
const MAX_QUESTIONS = 200;
const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const READ_CONCURRENCY = 4;

export interface Decision { action: string; note: string | null; by: string | null; at: string }
export type Decisions = Record<string, Decision>;

export interface DraftJira {
  listSprints(): Promise<PlanningSprint[]>;
  /** The end date of the sprint closed before this one on the board; null when there is none. */
  previousSprintEnd?(sprint: PlanningSprint): Promise<string | null>;
  sprintIssues(sprintId: number): Promise<PlanningIssue[]>;
  statusesOf(keys: string[]): Promise<Map<string, string>>;
  issueNow(key: string): Promise<PlanningIssue | null>;
  assignableAccounts(key: string, name: string): Promise<string[]>;
  setAc(key: string, value: unknown): Promise<void>;
  setAssignee(key: string, accountId: string): Promise<void>;
  /** One comment holding the test cases as `QONFLO-TC v1` and a JSON code block. */
  postTcs(key: string, body: TcComment): Promise<void>;
}

/** A draft test case: the AC line it checks (1-based), the steps and what is expected. */
export interface DraftTc { id: string; ac: number; title: string; steps: string[]; expected: string }
export interface TcComment { version: 1; tcs: DraftTc[] }
export const TC_MARKER = 'QONFLO-TC v1';
const MAX_TCS = 100;
const MAX_STEPS = 40;

interface DraftRow {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: Date | null; decisions: string; qaReason: string | null;
  refStatuses: string; createdBy: string | null; loadedAt: Date; publishedAt: Date | null; storyboards?: string; questions?: string;
  tickets: Array<{
    key: string; summary: string; dev: string | null; sp: number | null; wave: number | null; ac: string; jiraAc: string; jiraDev: string | null;
    dependsOn: string; status: string; prediction: string | null; position: number; epic?: string | null; frames?: string;
    tcs?: string; tcAt?: Date | null; tcPosted?: string | null;
  }>;
}

export interface DraftStore {
  getSettings(): Promise<Array<{ key: string; value: string }>>;
  getSprintDraft(sprint: string): Promise<DraftRow | null>;
  replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]): Promise<unknown>;
  updateSprintDraftTicket(sprint: string, key: string, data: { dev?: string | null; sp?: number | null; wave?: number | null; ac?: string[]; jiraAc?: string[]; jiraDev?: string | null; tcs?: string; tcAt?: Date; tcPosted?: string | null }): Promise<unknown>;
  updateSprintDraft(sprint: string, data: { decisions?: string; qaReason?: string | null; status?: string; publishedAt?: Date | null; storyboards?: string; questions?: string }): Promise<unknown>;
  saveSprintDraftPredictions(sprint: string, predictions: Map<string, string> | null, qaReason: string | null): Promise<unknown>;
  sprintDraftsWithEpic(epic: string): Promise<string[]>;
}

/** The newest storyboard version of an epic as the draft last saw it; error says why there is none. */
export interface StoryboardState {
  epic: string; version: number | null; previous: number | null; path: string | null; page: string | null; frames: number; changed: string[];
  changedAt: string | null; checkedAt: string; error: string | null;
}
/** A question the planning chat could not settle from the storyboard; the planner marks it answered. */
export interface DraftQuestion { id: string; text: string; key: string | null; askedAt: string; answered: boolean; answeredBy: string | null; answeredAt: string | null }

/** A ticket naming a frame that changed in the newest storyboard version: its AC needs a check, Held when work has not started. */
export interface StoryboardFlag { version: number; frames: string[]; held: boolean; checked: Decision | null }

export interface DraftTicketView extends Omit<ScheduledTicket, 'dev' | 'wave'> {
  summary: string; dev: string | null; jiraDev: string | null; sp: number | null; wave: number; waveSet: boolean; status: string;
  ac: string[]; dependsOn: string[]; prediction: QaPrediction | null; qaDecision: Decision | null;
  epic: string | null; frames: string[]; storyboard: StoryboardFlag | null;
  tcs: DraftTc[];
  /** The storyboard changed a frame of this ticket after its test cases were written. */
  tcStale: boolean;
  /** The test cases differ from the last QONFLO-TC comment, so Publish posts them. */
  tcPending: boolean;
}
export interface DraftFindingView extends AcFinding { decision: Decision | null }
export interface DraftView {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: string | null; spPerDay: number;
  createdBy: string | null; loadedAt: string; publishedAt: string | null; qaReason: string | null;
  devs: string[]; tickets: DraftTicketView[]; findings: DraftFindingView[]; blockers: string[]; canPublish: boolean;
  /** Tickets of the sprint already past merge: left out of the schedule and the AC check. */
  landed: number;
  /** Today's working day on the plan's axis, 1-based; null before day 1. Open tickets are not laid before it. */
  today: number | null;
  storyboards: StoryboardState[];
  questions: DraftQuestion[];
}
export interface DraftChange { key: string; assigneeFrom: string | null; assigneeTo: string | null; acRemoved: string[]; acAdded: string[]; refused: string | null }
/** One line of a publish: a ticket's AC and assignee, or the Confluence contract page. */
export interface PublishResult { key: string; kind: 'ticket' | 'tc' | 'contract'; status: 'updated' | 'refused' | 'failed' | 'skipped'; detail: string | null }
export interface ContractTarget { client: ContractClient | null; parentId: string | null }

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
const qaId = (key: string) => `qa|${key}`;
const storyboardId = (key: string, version: number) => `sb|${key}|v${version}`;
const isInProgress = (status: string) => /in ?progress/i.test(status);

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The test cases as the route or the panel sends them; anything malformed is refused whole. */
export function parseTcs(input: unknown, acCount: number): DraftTc[] {
  if (!Array.isArray(input)) throw new SprintInputError('tcs must be an array');
  if (input.length > MAX_TCS) throw new SprintInputError(`A ticket holds at most ${MAX_TCS} test cases`);
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = clip(item.id, 20).toUpperCase();
    if (!/^TC-\d{1,4}$/.test(id)) throw new SprintInputError(`Test case ${index + 1}: id must look like TC-1`);
    if (ids.has(id)) throw new SprintInputError(`${id} appears twice`);
    ids.add(id);
    const ac = Number(item.ac);
    if (!Number.isInteger(ac) || ac < 1 || (acCount > 0 && ac > acCount)) throw new SprintInputError(`${id}: ac must be the number of one of the ${acCount} AC lines`);
    const title = clip(item.title, 300);
    if (!title) throw new SprintInputError(`${id}: title is required`);
    if (!Array.isArray(item.steps) || item.steps.length > MAX_STEPS) throw new SprintInputError(`${id}: steps must be a list of at most ${MAX_STEPS}`);
    const steps = item.steps.map((step) => clip(step, 1000)).filter(Boolean);
    const expected = clip(item.expected, 2000);
    if (!expected) throw new SprintInputError(`${id}: expected is required`);
    return { id, ac, title, steps, expected };
  });
}

/** Every text line of a Jira rich-text or plain field. */
function fieldLines(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.split(/\r?\n/);
  return isAdf(raw) ? adfLines(raw) : [];
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

// ---- The AC field in Jira's own format -------------------------------------------------------------------------------
// Jira Cloud's v3 API returns a rich-text field as an ADF document and a one-line text field as a string. A line is one
// text block (paragraph, heading, task item), split at hard breaks, the way the ticket detail reads the field.

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'taskItem', 'decisionItem']);
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'decisionList', 'listItem']);

const isAdf = (value: unknown): value is { type: string; content?: unknown[] } => !!value && typeof value === 'object' && (value as any).type === 'doc';

function inlineText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.text ?? '');
  if (node.type === 'mention') return String(node.attrs?.text ?? '');
  if (node.type === 'inlineCard') return String(node.attrs?.url ?? '');
  if (node.type === 'emoji') return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
  return Array.isArray(node.content) ? node.content.map(inlineText).join('') : '';
}

function segments(content: unknown[]): unknown[][] {
  const parts: unknown[][] = [[]];
  for (const node of content) {
    if ((node as any)?.type === 'hardBreak') parts.push([]);
    else parts[parts.length - 1].push(node);
  }
  return parts;
}

function adfLines(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (TEXT_BLOCKS.has(node.type)) {
    for (const part of segments(Array.isArray(node.content) ? node.content : [])) out.push(part.map(inlineText).join(''));
  } else if (node.type === 'codeBlock') {
    out.push(...inlineText(node).split('\n'));
  } else if (Array.isArray(node.content)) {
    for (const child of node.content) adfLines(child, out);
  }
  return out;
}

/** The AC lines of the field as Jira returned it. */
export function acValueLines(raw: unknown): string[] {
  if (typeof raw === 'string') return splitAc(raw);
  if (isAdf(raw)) return adfLines(raw).map(normalizeAcLine).filter(Boolean);
  return [];
}

/** What to remove from `from` and add to it to get `to`, counting repeated lines. */
export function diffLines(from: string[], to: string[]): { removed: string[]; added: string[] } {
  const left = [...to];
  const removed: string[] = [];
  for (const line of from) {
    const index = left.indexOf(line);
    if (index >= 0) left.splice(index, 1);
    else removed.push(line);
  }
  return { removed, added: left };
}

function takeLine(pending: string[], text: string): boolean {
  const index = pending.indexOf(normalizeAcLine(text));
  if (index < 0 || !normalizeAcLine(text)) return false;
  pending.splice(index, 1);
  return true;
}

function removeFromAdf(node: any, pending: string[]): any {
  if (!node || typeof node !== 'object') return node;
  if (TEXT_BLOCKS.has(node.type)) {
    const parts = segments(Array.isArray(node.content) ? node.content : []);
    const kept = parts.filter((part) => !takeLine(pending, part.map(inlineText).join('')));
    if (kept.length === parts.length) return node;
    if (kept.length === 0) return null;
    return { ...node, content: kept.flatMap((part, index) => (index === 0 ? part : [{ type: 'hardBreak' }, ...part])) };
  }
  if (!Array.isArray(node.content)) return node;
  const content = node.content.map((child: unknown) => removeFromAdf(child, pending)).filter((child: unknown) => child !== null);
  if (content.length === 0 && CONTAINERS.has(node.type)) return null;
  return content.length === node.content.length && content.every((child: unknown, index: number) => child === node.content[index]) ? node : { ...node, content };
}

/**
 * The field with `removed` lines taken out and `added` lines appended, in the format Jira returned: ADF keeps every
 * other node and its marks and appends a bullet list; text keeps the other lines and their bullet style. A line that
 * cannot be found throws, so nothing half-edited is written.
 */
export function rewriteAcValue(raw: unknown, removed: string[], added: string[]): unknown {
  const pending = removed.map(normalizeAcLine);
  if (typeof raw === 'string') {
    const lines = raw.split(/\r?\n/).filter((line) => !takeLine(pending, line));
    if (pending.length) throw new Error(`AC line not found in Jira: ${pending[0]}`);
    const bullet = lines.some((line) => /^\s*[-*]\s+/.test(line)) ? '- ' : '';
    return [...lines, ...added.map((line) => `${bullet}${line}`)].join('\n');
  }
  let doc: any = isAdf(raw) ? removeFromAdf(raw, pending) : { type: 'doc', version: 1, content: [] };
  if (pending.length) throw new Error(`AC line not found in Jira: ${pending[0]}`);
  if (!doc) doc = { ...(raw as object), content: [] };
  if (added.length === 0) return doc;
  const items = added.map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }));
  const content = Array.isArray(doc.content) ? [...doc.content] : [];
  const last = content[content.length - 1];
  if (last?.type === 'bulletList') content[content.length - 1] = { ...last, content: [...(last.content || []), ...items] };
  else content.push({ type: 'bulletList', content: items });
  return { ...doc, content };
}

// ---- Decisions ----------------------------------------------------------------------------------------------------

/** The AC of every ticket after the decisions: a moved line leaves its ticket for the one it needs, a dropped line goes. */
export function finalAc(tickets: Array<{ key: string; ac: string[] }>, decisions: Decisions): Map<string, string[]> {
  const result = new Map(tickets.map((ticket) => [ticket.key, [...ticket.ac]]));
  for (const [id, decision] of Object.entries(decisions)) {
    const [kind, key, refKey, ...rest] = id.split('|');
    if (kind !== 'ac' || (decision.action !== 'move' && decision.action !== 'drop')) continue;
    const text = rest.join('|');
    const lines = result.get(key);
    const index = lines ? lines.findIndex((line) => normalizeAcLine(line) === text) : -1;
    if (!lines || index < 0) continue;
    const [line] = lines.splice(index, 1);
    const target = result.get(refKey);
    if (decision.action === 'move' && target && !target.some((other) => normalizeAcLine(other) === text)) target.push(line);
  }
  return result;
}

/** What still holds Publish: an after-it AC line or an ESCALATED prediction with no decision. */
export function publishBlockers(findings: AcFinding[], tickets: Array<{ key: string; prediction: QaPrediction | null }>, decisions: Decisions): string[] {
  return [
    ...findings.filter((finding) => finding.kind === 'after-it' && !decisions[finding.id]).map((finding) => finding.id),
    ...tickets.filter((ticket) => ticket.prediction?.prediction === 'ESCALATED' && !decisions[qaId(ticket.key)]).map((ticket) => qaId(ticket.key)),
  ];
}

// ---- The service --------------------------------------------------------------------------------------------------

export class SprintDraftService {
  constructor(
    private readonly store: DraftStore,
    private readonly jira: () => Promise<DraftJira>,
    private readonly predict: (tickets: QaInputTicket[]) => Promise<QaRun> = (tickets) => predictQa(tickets),
    private readonly now: () => Date = () => new Date(),
    private readonly contract: () => Promise<ContractTarget> = async () => ({ client: null, parentId: null }),
    private readonly storyboard: ((epic: string) => Promise<StoryboardResult>) | null = null,
  ) {}

  async sprints(): Promise<PlanningSprint[]> {
    return (await this.jira()).listSprints();
  }

  private async spPerDay(): Promise<number> {
    const value = Number((await this.store.getSettings()).find((setting) => setting.key === SP_PER_DAY_KEY)?.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SP_PER_DAY;
  }

  private async row(sprint: string): Promise<DraftRow> {
    const row = await this.store.getSprintDraft(sprint);
    if (!row) throw new SprintInputError(`No draft for ${sprint}; load it from Jira first`);
    return row;
  }

  /** Reads the sprint's tickets from Jira into the draft, then asks the QA bot. Decisions of lines that still match stay. */
  async load(sprintId: number, by: string | null): Promise<DraftView> {
    const jira = await this.jira();
    const sprint = (await jira.listSprints()).find((item) => item.id === sprintId);
    if (!sprint) throw new SprintInputError('That sprint is not an active or future sprint of the board');
    const issues = await jira.sprintIssues(sprint.id);
    const keys = new Set(issues.map((issue) => issue.key));
    const tickets: SprintDraftTicketInput[] = issues.map((issue) => {
      const ac = acValueLines(issue.acRaw);
      return {
        key: issue.key, summary: issue.summary, dev: issue.assignee, sp: issue.sp, wave: null, status: issue.status,
        ac, jiraAc: ac, jiraDev: issue.assignee,
        dependsOn: [...new Set(issue.links.filter((link) => link.relation === 'blockedBy').map((link) => link.key))],
        epic: issue.epic ?? null, frames: framesIn([...ac, ...fieldLines(issue.descriptionRaw)]),
      };
    });
    const outside = new Set<string>();
    for (const ticket of tickets) {
      for (const line of ticket.ac) for (const ref of line.match(/\bQRD-\d+\b/gi) || []) outside.add(ref.toUpperCase());
      for (const dep of ticket.dependsOn) outside.add(dep);
    }
    const refKeys = [...outside].filter((key) => !keys.has(key));
    const refStatuses = refKeys.length ? Object.fromEntries(await jira.statusesOf(refKeys)) : {};
    const previous = await this.store.getSprintDraft(sprint.name);
    const start = planStart(sprint.startDate, jira.previousSprintEnd ? await jira.previousSprintEnd(sprint).catch(() => null) : null);
    // Test cases are DOCK's own: they survive a load from Jira.
    for (const ticket of tickets) {
      const before = previous?.tickets.find((item) => item.key === ticket.key);
      if (before) Object.assign(ticket, { tcs: before.tcs ?? '[]', tcAt: before.tcAt ?? null, tcPosted: before.tcPosted ?? null });
    }
    await this.store.replaceSprintDraft({
      sprint: sprint.name, sprintId: sprint.id,
      sprintDays: workingDays(start, sprint.endDate) ?? previous?.sprintDays ?? DEFAULT_SPRINT_DAYS,
      startDate: start ? new Date(start) : null, createdBy: previous?.createdBy ?? by, refStatuses: JSON.stringify(refStatuses),
    }, tickets);
    await this.refreshQa(sprint.name);
    return this.checkStoryboards(sprint.name).catch(async () => (await this.view(sprint.name))!);
  }

  async view(sprint: string): Promise<DraftView | null> {
    const row = await this.store.getSprintDraft(sprint);
    return row ? this.compute(row, await this.spPerDay()) : null;
  }

  private compute(row: DraftRow, spPerDay: number): DraftView {
    const decisions = parse<Decisions>(row.decisions, {});
    const refStatuses = parse<Record<string, string>>(row.refStatuses, {});
    const all = row.tickets.map((ticket) => ({
      ...ticket, ac: parse<string[]>(ticket.ac, []), jiraAc: parse<string[]>(ticket.jiraAc, []), dependsOn: parse<string[]>(ticket.dependsOn, []),
      prediction: parse<QaPrediction | null>(ticket.prediction, null), epic: ticket.epic ?? null, frames: parse<string[]>(ticket.frames, []),
      tcs: parse<DraftTc[]>(ticket.tcs, []),
    }));
    const tickets = all.filter((ticket) => !isDoneStatus(ticket.status));
    // Once the sprint has started, a draft lays open tickets from today's working day, never in the past. A published
    // plan keeps its days, so AC drift can still tell a ticket that slipped past its planned day.
    const today = workingDayOf(row.startDate?.toISOString() ?? null, this.now());
    const schedule = new Map(scheduleSprint(
      tickets.map((ticket) => ({ key: ticket.key, dev: ticket.dev, sp: ticket.sp, wave: ticket.wave, dependsOn: ticket.dependsOn })),
      { sprintDays: row.sprintDays, spPerDay, from: today && row.status !== 'published' ? today - 1 : 0 },
    ).map((item) => [item.key, item]));
    const ends = new Map([...schedule.values()].map((item) => [item.key, item.end]));
    const status = new Map(all.map((ticket) => [ticket.key, ticket.status]));
    const findings = acFindings(tickets, ends, (key) => status.get(key) ?? refStatuses[key] ?? null)
      .map((finding) => ({ ...finding, decision: decisions[finding.id] ?? null }));
    const blockers = publishBlockers(findings, tickets, decisions);
    const storyboards = Object.values(parse<Record<string, StoryboardState>>(row.storyboards, {})).sort((a, b) => a.epic.localeCompare(b.epic));
    const boardOf = new Map(storyboards.map((board) => [board.epic, board]));
    const flagOf = (ticket: { key: string; epic: string | null; frames: string[]; ac: string[]; status: string }): StoryboardFlag | null => {
      const board = ticket.epic ? boardOf.get(ticket.epic) : undefined;
      if (!board?.version || !board.changed.length) return null;
      const named = new Set([...ticket.frames, ...framesIn(ticket.ac)]);
      const frames = board.changed.filter((id) => named.has(id));
      return frames.length ? { version: board.version, frames, held: !isInProgress(ticket.status), checked: decisions[storyboardId(ticket.key, board.version)] ?? null } : null;
    };
    const tcStale = (ticket: { key: string; epic: string | null; frames: string[]; ac: string[]; status: string; tcs: DraftTc[]; tcAt?: Date | null }) => {
      const changedAt = ticket.epic ? boardOf.get(ticket.epic)?.changedAt : null;
      return ticket.tcs.length > 0 && !!flagOf(ticket) && !!changedAt && (!ticket.tcAt || ticket.tcAt.toISOString() < changedAt);
    };
    const devs = [...new Set(tickets.map((ticket) => ticket.dev).filter((dev): dev is string => !!dev))].sort((a, b) => a.localeCompare(b));
    return {
      sprint: row.sprint, sprintId: row.sprintId, status: row.status, sprintDays: row.sprintDays, startDate: row.startDate?.toISOString() ?? null,
      spPerDay, createdBy: row.createdBy, loadedAt: row.loadedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, qaReason: row.qaReason,
      devs, today, landed: all.length - tickets.length, storyboards, questions: parse<DraftQuestion[]>(row.questions, []),
      tickets: tickets.map((ticket) => {
        const placed = schedule.get(ticket.key)!;
        return {
          key: ticket.key, summary: ticket.summary, dev: ticket.dev, jiraDev: ticket.jiraDev, sp: ticket.sp, wave: placed.wave, waveSet: ticket.wave !== null,
          status: ticket.status, ac: ticket.ac, dependsOn: ticket.dependsOn, start: placed.start, dur: placed.dur, end: placed.end,
          inSprint: placed.inSprint, split: placed.split, prediction: ticket.prediction, qaDecision: decisions[qaId(ticket.key)] ?? null,
          epic: ticket.epic, frames: ticket.frames, storyboard: flagOf(ticket),
          tcs: ticket.tcs, tcStale: tcStale(ticket), tcPending: ticket.tcs.length > 0 && JSON.stringify(ticket.tcs) !== (ticket.tcPosted ?? ''),
        };
      }).sort((a, b) => a.start - b.start || a.key.localeCompare(b.key, undefined, { numeric: true })),
      findings,
      blockers,
      canPublish: blockers.length === 0 && tickets.length > 0,
    };
  }

  /** Runs predict.mjs on the draft as it stands and stores what it answered. */
  async refreshQa(sprint: string): Promise<DraftView> {
    const view = (await this.view(sprint))!;
    const ends = new Map(view.tickets.map((ticket) => [ticket.key, ticket.end]));
    const input: QaInputTicket[] = view.tickets.map((ticket) => ({
      key: ticket.key, summary: ticket.summary, ac: ticket.ac, endDay: ticket.end,
      waitsOn: [...new Set([...ticket.dependsOn, ...view.findings.filter((finding) => finding.key === ticket.key).map((finding) => finding.refKey)])]
        .map((key) => ({ key, endDay: ends.get(key) ?? null })),
    }));
    const run = input.length ? await this.predict(input) : { predictions: new Map<string, QaPrediction>(), reason: null };
    const stored = run.predictions ? new Map([...run.predictions.entries()].map(([key, prediction]) => [key, JSON.stringify(prediction)])) : null;
    await this.store.saveSprintDraftPredictions(sprint, stored, run.reason);
    return (await this.view(sprint))!;
  }

  async updateTicket(sprint: string, key: string, change: { dev?: string | null; wave?: number | null; sp?: number | null; ac?: string[] | null }): Promise<DraftView> {
    const row = await this.row(sprint);
    if (row.status === 'published') throw new SprintInputError('This draft is published; load it from Jira again to change it');
    if (!row.tickets.some((ticket) => ticket.key === key)) throw new SprintInputError(`${key} is not in the ${sprint} draft`);
    const data: { dev?: string | null; sp?: number | null; wave?: number | null; ac?: string[] } = {};
    if (change.dev !== undefined) data.dev = change.dev?.trim().slice(0, 120) || null;
    if (change.wave !== undefined) {
      if (change.wave !== null && (!Number.isInteger(change.wave) || change.wave < 0 || change.wave > 50)) throw new SprintInputError('Wave must be a whole number from 1 to 50, or 0 to compute it');
      data.wave = change.wave ? change.wave : null;
    }
    if (change.sp !== undefined) {
      if (change.sp !== null && (!Number.isFinite(change.sp) || change.sp < 0 || change.sp > 100)) throw new SprintInputError('SP must be from 0 to 100');
      data.sp = change.sp;
    }
    if (change.ac) {
      const lines = change.ac.map((line) => normalizeAcLine(line).slice(0, MAX_LINE)).filter(Boolean);
      if (lines.length > MAX_AC_LINES) throw new SprintInputError(`An AC holds at most ${MAX_AC_LINES} lines`);
      data.ac = lines;
    }
    await this.store.updateSprintDraftTicket(sprint, key, data);
    return (await this.view(sprint))!;
  }

  /** Records, changes or clears (action "clear") the planner's call on an AC finding or an ESCALATED prediction. */
  async decide(sprint: string, id: string, action: string, note: string | null, by: string | null): Promise<DraftView> {
    const row = await this.row(sprint);
    const view = this.compute(row, await this.spPerDay());
    const decisions = parse<Decisions>(row.decisions, {});
    if (action === 'clear') {
      delete decisions[id];
    } else {
      const text = note?.trim().slice(0, MAX_LINE) || null;
      if (id.startsWith('ac|')) {
        const finding = view.findings.find((item) => item.id === id);
        if (!finding) throw new SprintInputError('No such AC line in the draft');
        if (!AC_ACTIONS.includes(action)) throw new SprintInputError('An AC line is moved, kept to wait, or dropped');
        if (action === 'move' && !view.tickets.some((ticket) => ticket.key === finding.refKey)) throw new SprintInputError(`${finding.refKey} is not in this sprint; keep the line or drop it`);
      } else if (id.startsWith('sb|')) {
        if (!view.tickets.some((ticket) => ticket.storyboard && storyboardId(ticket.key, ticket.storyboard.version) === id)) throw new SprintInputError('No storyboard change on that ticket');
        if (action !== 'checked') throw new SprintInputError('A storyboard change is marked checked');
      } else if (id.startsWith('qa|')) {
        if (!view.tickets.some((ticket) => qaId(ticket.key) === id && ticket.prediction)) throw new SprintInputError('No QA prediction for that ticket');
        if (!QA_ACTIONS.includes(action)) throw new SprintInputError('A QA prediction is accepted as a risk or fixed');
        if (action === 'fix' && !text) throw new SprintInputError('Say what was fixed');
      } else {
        throw new SprintInputError('Unknown decision');
      }
      decisions[id] = { action, note: text, by, at: this.now().toISOString() };
    }
    await this.store.updateSprintDraft(sprint, { decisions: JSON.stringify(decisions) });
    return (await this.view(sprint))!;
  }

  /** Replaces a ticket's test cases, from the planning agent or the panel. */
  async setTcs(sprint: string, key: string, input: unknown): Promise<DraftView> {
    const row = await this.row(sprint);
    const ticket = row.tickets.find((item) => item.key === key);
    if (!ticket) throw new SprintInputError(`${key} is not in the ${sprint} draft`);
    const tcs = parseTcs(input, parse<string[]>(ticket.ac, []).length);
    await this.store.updateSprintDraftTicket(sprint, key, { tcs: JSON.stringify(tcs), tcAt: this.now() });
    return (await this.view(sprint))!;
  }

  /** Adds an open question to the draft; the same open text is asked once. */
  async ask(sprint: string, text: string, key: string | null): Promise<DraftView> {
    const row = await this.row(sprint);
    const question = text.trim().slice(0, MAX_LINE);
    if (!question) throw new SprintInputError('text is required');
    const ticket = key?.trim().toUpperCase() || null;
    if (ticket && !TICKET_KEY.test(ticket)) throw new SprintInputError('key must be a ticket key such as QRD-1312');
    const questions = parse<DraftQuestion[]>(row.questions, []);
    if (!questions.some((item) => !item.answered && item.text === question && item.key === ticket)) {
      if (questions.length >= MAX_QUESTIONS) throw new SprintInputError(`A draft holds at most ${MAX_QUESTIONS} questions`);
      const at = this.now().toISOString();
      questions.push({ id: `q${questions.length + 1}-${Date.parse(at).toString(36)}`, text: question, key: ticket, askedAt: at, answered: false, answeredBy: null, answeredAt: null });
      await this.store.updateSprintDraft(sprint, { questions: JSON.stringify(questions) });
    }
    return (await this.view(sprint))!;
  }

  /** Marks a question answered, or open again. */
  async answer(sprint: string, id: string, answered: boolean, by: string | null): Promise<DraftView> {
    const row = await this.row(sprint);
    const questions = parse<DraftQuestion[]>(row.questions, []);
    const question = questions.find((item) => item.id === id);
    if (!question) throw new SprintInputError('No such question in the draft');
    Object.assign(question, answered ? { answered: true, answeredBy: by, answeredAt: this.now().toISOString() } : { answered: false, answeredBy: null, answeredAt: null });
    await this.store.updateSprintDraft(sprint, { questions: JSON.stringify(questions) });
    return (await this.view(sprint))!;
  }

  /** Reads the newest storyboard of every epic of the draft; an epic without one says why, and nothing else stops. */
  async checkStoryboards(sprint: string): Promise<DraftView> {
    const row = await this.row(sprint);
    if (!this.storyboard) return (await this.view(sprint))!;
    const epics = [...new Set(row.tickets.map((ticket) => ticket.epic).filter((epic): epic is string => !!epic))].sort();
    const boards = parse<Record<string, StoryboardState>>(row.storyboards, {});
    for (const epic of epics) {
      try {
        boards[epic] = this.boardState(await this.storyboard(epic), boards[epic]);
      } catch (error) {
        const message = error instanceof StoryboardMissing ? error.message : `Confluence: ${error instanceof Error ? error.message : String(error)}`;
        boards[epic] = { ...(boards[epic] ?? { epic, version: null, previous: null, path: null, page: null, frames: 0, changed: [], changedAt: null }), checkedAt: this.now().toISOString(), error: message };
      }
    }
    await this.store.updateSprintDraft(sprint, { storyboards: JSON.stringify(boards) });
    return (await this.view(sprint))!;
  }

  /** A storyboard read outside Planning (the agent's route): every draft holding a ticket of the epic takes it. */
  async applyStoryboard(result: StoryboardResult): Promise<string[]> {
    const sprints = await this.store.sprintDraftsWithEpic(result.epic);
    for (const sprint of sprints) {
      const row = await this.store.getSprintDraft(sprint);
      if (!row) continue;
      const boards = parse<Record<string, StoryboardState>>(row.storyboards, {});
      boards[result.epic] = this.boardState(result, boards[result.epic]);
      await this.store.updateSprintDraft(sprint, { storyboards: JSON.stringify(boards) });
    }
    return sprints;
  }

  private boardState(result: StoryboardResult, before: StoryboardState | undefined): StoryboardState {
    const at = this.now().toISOString();
    return {
      epic: result.epic, version: result.version, previous: result.previous, path: result.path, page: result.page, frames: result.frames.length, changed: result.changed,
      changedAt: before?.version === result.version ? before.changedAt ?? at : at, checkedAt: at, error: null,
    };
  }

  /** The changes Publish would write, each ticket read from Jira again; nothing is written. */
  async preview(sprint: string): Promise<DraftChange[]> {
    return (await this.plannedChanges(sprint)).map(({ change }) => change);
  }

  private async plannedChanges(sprint: string): Promise<Array<{ change: DraftChange; final: string[]; dev: string | null; now: PlanningIssue | null }>> {
    const row = await this.row(sprint);
    const decisions = parse<Decisions>(row.decisions, {});
    const tickets = row.tickets.map((ticket) => ({ ...ticket, ac: parse<string[]>(ticket.ac, []), jiraAc: parse<string[]>(ticket.jiraAc, []) }));
    const finals = finalAc(tickets, decisions);
    const touched = tickets.filter((ticket) => !sameLines(finals.get(ticket.key)!, ticket.jiraAc) || (!!ticket.dev && ticket.dev !== ticket.jiraDev));
    const jira = touched.length ? await this.jira() : null;
    return mapLimit(touched, READ_CONCURRENCY, async (ticket) => {
      const final = finals.get(ticket.key)!;
      const now = await jira!.issueNow(ticket.key);
      const nowLines = now ? acValueLines(now.acRaw) : [];
      const { removed, added } = diffLines(nowLines, final);
      const nowDev = now?.assignee ?? null;
      const assign = !!ticket.dev && ticket.dev !== nowDev;
      let refused: string | null = null;
      if (!now) refused = 'The ticket is gone from Jira';
      else if (!sameLines(nowLines, ticket.jiraAc) && (removed.length || added.length)) refused = 'The AC changed in Jira after it was loaded; load the sprint again';
      return {
        change: { key: ticket.key, assigneeFrom: assign ? nowDev : null, assigneeTo: assign ? ticket.dev : null, acRemoved: removed, acAdded: added, refused },
        final, dev: ticket.dev, now,
      };
    }).then((rows) => rows.filter(({ change }) => change.refused || change.assigneeTo || change.acRemoved.length || change.acAdded.length));
  }

  /** Writes the previewed changes ticket by ticket, then the contract page. Held while a blocker has no decision. */
  async publish(sprint: string, by: string | null = null): Promise<PublishResult[]> {
    const view = (await this.view(sprint));
    if (!view) throw new SprintInputError(`No draft for ${sprint}; load it from Jira first`);
    if (!view.canPublish) throw new SprintInputError(`${view.blockers.length} AC line or QA prediction still needs a decision before publish`);
    const jira = await this.jira();
    const results: PublishResult[] = [];
    for (const { change, final, dev, now } of await this.plannedChanges(sprint)) {
      if (change.refused) {
        results.push({ key: change.key, kind: 'ticket', status: 'refused', detail: change.refused });
        continue;
      }
      try {
        let accountId: string | null = null;
        if (change.assigneeTo) {
          const accounts = await jira.assignableAccounts(change.key, change.assigneeTo);
          if (accounts.length !== 1) throw new Error(accounts.length ? `More than one Jira user is named ${change.assigneeTo}` : `No assignable Jira user is named ${change.assigneeTo}`);
          accountId = accounts[0];
        }
        const update: { jiraAc?: string[]; jiraDev?: string | null } = {};
        if (change.acRemoved.length || change.acAdded.length) {
          await jira.setAc(change.key, rewriteAcValue(now!.acRaw, change.acRemoved, change.acAdded));
          update.jiraAc = final;
        }
        if (accountId) {
          await jira.setAssignee(change.key, accountId);
          update.jiraDev = dev;
        }
        await this.store.updateSprintDraftTicket(sprint, change.key, update);
        results.push({ key: change.key, kind: 'ticket', status: 'updated', detail: null });
      } catch (error: any) {
        const status = error?.response?.status;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ key: change.key, kind: 'ticket', status: 'failed', detail: status ? `Jira responded ${status}: ${message}` : message });
      }
    }
    const tickets = results.filter((result) => result.kind === 'ticket');
    // A newer set of test cases is a new comment; the QA bot reads the latest one.
    for (const ticket of (await this.view(sprint))!.tickets.filter((item) => item.tcPending)) {
      try {
        await jira.postTcs(ticket.key, { version: 1, tcs: ticket.tcs });
        await this.store.updateSprintDraftTicket(sprint, ticket.key, { tcPosted: JSON.stringify(ticket.tcs) });
        results.push({ key: ticket.key, kind: 'tc', status: 'updated', detail: `${ticket.tcs.length} test ${ticket.tcs.length === 1 ? 'case' : 'cases'} posted` });
      } catch (error: any) {
        const status = error?.response?.status;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ key: ticket.key, kind: 'tc', status: 'failed', detail: status ? `Jira responded ${status}: ${message}` : message });
      }
    }
    const target = await this.contract().catch((): ContractTarget => ({ client: null, parentId: null }));
    const contract = await writeContract(target.client, target.parentId, (await this.view(sprint))!, by, this.now());
    results.push({ key: 'Confluence', kind: 'contract', status: contract.status, detail: contract.detail });
    if (tickets.every((result) => result.status === 'updated')) await this.store.updateSprintDraft(sprint, { status: 'published', publishedAt: this.now() });
    return results;
  }
}
