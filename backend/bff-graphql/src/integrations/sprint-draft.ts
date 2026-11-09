// A sprint draft in Agents > Sprint > Planning: the sprint's tickets loaded from Jira, the planner's changes to
// developer, wave, SP and AC, the schedule and AC check computed from them, the QA bot's prediction, and the decisions
// the planner made. Publish writes back only what differs from Jira, and refuses a ticket whose AC moved in Jira since
// it was loaded, so a teammate's edit is never overwritten.
import { acFindings, isDoneStatus, normalizeAcLine, splitAc, type AcFinding } from './ac-scope';
import type { PlanningIssue, PlanningSprint } from './jira-sprint';
import { predictQa, type QaInputTicket, type QaPrediction, type QaRun } from './qa-predict';
import { DEFAULT_SP_PER_DAY, DEFAULT_SPRINT_DAYS, scheduleSprint, workingDays, type ScheduledTicket } from './scope-cut';
import { SprintInputError } from './sprint-dashboard';
import type { SprintDraftInput, SprintDraftTicketInput } from '../storage/service';

export const SP_PER_DAY_KEY = 'planningSpPerDay';
const AC_ACTIONS = ['move', 'wait', 'drop'];
const QA_ACTIONS = ['accept', 'fix'];
const MAX_AC_LINES = 200;
const MAX_LINE = 2000;
const READ_CONCURRENCY = 4;

export interface Decision { action: string; note: string | null; by: string | null; at: string }
export type Decisions = Record<string, Decision>;

export interface DraftJira {
  listSprints(): Promise<PlanningSprint[]>;
  sprintIssues(sprintId: number): Promise<PlanningIssue[]>;
  statusesOf(keys: string[]): Promise<Map<string, string>>;
  issueNow(key: string): Promise<PlanningIssue | null>;
  assignableAccounts(key: string, name: string): Promise<string[]>;
  setAc(key: string, value: unknown): Promise<void>;
  setAssignee(key: string, accountId: string): Promise<void>;
}

interface DraftRow {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: Date | null; decisions: string; qaReason: string | null;
  refStatuses: string; createdBy: string | null; loadedAt: Date; publishedAt: Date | null;
  tickets: Array<{
    key: string; summary: string; dev: string | null; sp: number | null; wave: number | null; ac: string; jiraAc: string; jiraDev: string | null;
    dependsOn: string; status: string; prediction: string | null; position: number;
  }>;
}

export interface DraftStore {
  getSettings(): Promise<Array<{ key: string; value: string }>>;
  getSprintDraft(sprint: string): Promise<DraftRow | null>;
  replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]): Promise<unknown>;
  updateSprintDraftTicket(sprint: string, key: string, data: { dev?: string | null; sp?: number | null; wave?: number | null; ac?: string[]; jiraAc?: string[]; jiraDev?: string | null }): Promise<unknown>;
  updateSprintDraft(sprint: string, data: { decisions?: string; qaReason?: string | null; status?: string; publishedAt?: Date | null }): Promise<unknown>;
  saveSprintDraftPredictions(sprint: string, predictions: Map<string, string> | null, qaReason: string | null): Promise<unknown>;
}

export interface DraftTicketView extends Omit<ScheduledTicket, 'dev' | 'wave'> {
  summary: string; dev: string | null; jiraDev: string | null; sp: number | null; wave: number; waveSet: boolean; status: string;
  ac: string[]; dependsOn: string[]; prediction: QaPrediction | null; qaDecision: Decision | null;
}
export interface DraftFindingView extends AcFinding { decision: Decision | null }
export interface DraftView {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: string | null; spPerDay: number;
  createdBy: string | null; loadedAt: string; publishedAt: string | null; qaReason: string | null;
  devs: string[]; tickets: DraftTicketView[]; findings: DraftFindingView[]; blockers: string[]; canPublish: boolean;
  /** Tickets of the sprint already past merge: left out of the schedule and the AC check. */
  landed: number;
}
export interface DraftChange { key: string; assigneeFrom: string | null; assigneeTo: string | null; acRemoved: string[]; acAdded: string[]; refused: string | null }
export interface PublishResult { key: string; status: 'updated' | 'refused' | 'failed'; detail: string | null }

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
const qaId = (key: string) => `qa|${key}`;

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
    await this.store.replaceSprintDraft({
      sprint: sprint.name, sprintId: sprint.id,
      sprintDays: workingDays(sprint.startDate, sprint.endDate) ?? previous?.sprintDays ?? DEFAULT_SPRINT_DAYS,
      startDate: sprint.startDate ? new Date(sprint.startDate) : null, createdBy: previous?.createdBy ?? by, refStatuses: JSON.stringify(refStatuses),
    }, tickets);
    return this.refreshQa(sprint.name);
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
      prediction: parse<QaPrediction | null>(ticket.prediction, null),
    }));
    const tickets = all.filter((ticket) => !isDoneStatus(ticket.status));
    const schedule = new Map(scheduleSprint(
      tickets.map((ticket) => ({ key: ticket.key, dev: ticket.dev, sp: ticket.sp, wave: ticket.wave, dependsOn: ticket.dependsOn })),
      { sprintDays: row.sprintDays, spPerDay },
    ).map((item) => [item.key, item]));
    const ends = new Map([...schedule.values()].map((item) => [item.key, item.end]));
    const status = new Map(all.map((ticket) => [ticket.key, ticket.status]));
    const findings = acFindings(tickets, ends, (key) => status.get(key) ?? refStatuses[key] ?? null)
      .map((finding) => ({ ...finding, decision: decisions[finding.id] ?? null }));
    const blockers = publishBlockers(findings, tickets, decisions);
    const devs = [...new Set(tickets.map((ticket) => ticket.dev).filter((dev): dev is string => !!dev))].sort((a, b) => a.localeCompare(b));
    return {
      sprint: row.sprint, sprintId: row.sprintId, status: row.status, sprintDays: row.sprintDays, startDate: row.startDate?.toISOString() ?? null,
      spPerDay, createdBy: row.createdBy, loadedAt: row.loadedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, qaReason: row.qaReason,
      devs, landed: all.length - tickets.length,
      tickets: tickets.map((ticket) => {
        const placed = schedule.get(ticket.key)!;
        return {
          key: ticket.key, summary: ticket.summary, dev: ticket.dev, jiraDev: ticket.jiraDev, sp: ticket.sp, wave: placed.wave, waveSet: ticket.wave !== null,
          status: ticket.status, ac: ticket.ac, dependsOn: ticket.dependsOn, start: placed.start, dur: placed.dur, end: placed.end,
          inSprint: placed.inSprint, split: placed.split, prediction: ticket.prediction, qaDecision: decisions[qaId(ticket.key)] ?? null,
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

  /** Writes the previewed changes ticket by ticket. Held while a blocker has no decision. */
  async publish(sprint: string): Promise<PublishResult[]> {
    const view = (await this.view(sprint));
    if (!view) throw new SprintInputError(`No draft for ${sprint}; load it from Jira first`);
    if (!view.canPublish) throw new SprintInputError(`${view.blockers.length} AC line or QA prediction still needs a decision before publish`);
    const jira = await this.jira();
    const results: PublishResult[] = [];
    for (const { change, final, dev, now } of await this.plannedChanges(sprint)) {
      if (change.refused) {
        results.push({ key: change.key, status: 'refused', detail: change.refused });
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
        results.push({ key: change.key, status: 'updated', detail: null });
      } catch (error: any) {
        const status = error?.response?.status;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ key: change.key, status: 'failed', detail: status ? `Jira responded ${status}: ${message}` : message });
      }
    }
    if (results.every((result) => result.status === 'updated')) await this.store.updateSprintDraft(sprint, { status: 'published', publishedAt: this.now() });
    return results;
  }
}
