// A sprint draft in Agents > Sprint > Planning: the sprint's tickets loaded from Jira, the planner's changes to
// developer, wave, SP and AC, the schedule and AC check computed from them, the QA bot's prediction, and the decisions
// the planner made. Publish writes back only what differs from Jira, and refuses a ticket whose AC moved in Jira since
// it was loaded, so a teammate's edit is never overwritten.
import { acFindings, acHash, isDoneStatus, normalizeAcLine, splitAc, type AcFinding } from './ac-scope';
import { AC_FIELD, OLD_USER_STORY_FIELD, OPEN_TO_CONFIRM_FIELD, PROBLEM_FIELD, REFERENCE_FIELD, USER_STORY_FIELD, type PlanningIssue, type PlanningSprint, type RevisionIssue } from './jira-sprint';
import { predictQa, type QaInputTicket, type QaPrediction, type QaRun } from './qa-predict';
import { DEFAULT_SP_PER_DAY, DEFAULT_SPRINT_DAYS, endDay, planLayout, planStart, rankOf, remainingSp, scheduleSprint, suggestMoves, workingDayOf, workingDays, type MoveSuggestion, type ScheduledTicket } from './scope-cut';
import type { MergeRead, TicketMerge } from './merge-state';
import { SprintInputError } from './sprint-dashboard';
import { writeContract, type ContractClient } from './sprint-contract';
import { StoryboardMissing, framesIn, type StoryboardResult } from './storyboard';
import { WRITING_FLAG_LABEL, flagReason, lintTicket, ticketRepo, type LintInput, type TicketLint } from './ticket-lint';
import type { StoryboardScenario } from './storyboard-flows';
import type { SprintDraftInput, SprintDraftNewTicketData, SprintDraftRevisionData, SprintDraftRevisionUpdate, SprintDraftTicketInput } from '../storage/service';
import { splitView, type SplitState, type SplitView } from './split-page';
import { planLabel, sprintRevision, stalePlanLabels } from './plan-publish';

export const SP_PER_DAY_KEY = 'planningSpPerDay';
/**
 * A QRD key of another ticket in AC is a dependency: Publish adds the "is blocked by" link. A line that only informs moves
 * to the Reference field. move hands the line to the ticket in the sprint that builds it.
 */
const AC_ACTIONS = ['dependency', 'reference', 'move'];
/** Calls saved before the AC rule: wait reads as dependency, drop as reference. */
const LEGACY_AC_ACTIONS: Record<string, string> = { wait: 'dependency', drop: 'reference' };
export const acAction = (action: string) => LEGACY_AC_ACTIONS[action] ?? action;
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
  /** The keys of the sprint's tickets that are also in a closed sprint: carried over from an earlier one. */
  carriedKeys?(sprintId: number): Promise<string[]>;
  statusesOf(keys: string[]): Promise<Map<string, string>>;
  issueNow(key: string): Promise<PlanningIssue | null>;
  assignableAccounts(key: string, name: string): Promise<string[]>;
  setAc(key: string, value: unknown): Promise<void>;
  setAssignee(key: string, accountId: string): Promise<void>;
  /** One comment holding the test cases as `QONFLO-TC v1` and a JSON code block. */
  postTcs(key: string, body: TcComment): Promise<void>;
  /** The Reference field, in the format Jira returned it. */
  setReference?(key: string, value: unknown): Promise<void>;
  /** A Blocks link: key is blocked by blocker. */
  addBlockedBy?(key: string, blocker: string): Promise<void>;
  /** The name of Jira's "Test" link type (outward tests, inward is tested by); null when the site has none. */
  testLinkType?(): Promise<string | null>;
  /** A Test link: tester (the FE ticket) tests tested (the BE ticket). */
  addTestLink?(tester: string, tested: string, typeName: string): Promise<void>;
  /** The shared publish signal: Publish labels every ticket of the plan plan-published-r<N>. */
  addLabel?(key: string, label: string): Promise<void>;
  removeLabel?(key: string, label: string): Promise<void>;
  /** A plain comment, one paragraph per line: an answered planning question on its ticket. */
  comment?(key: string, lines: string[]): Promise<void>;
  /** Creates an issue from its fields; returns the new key. */
  createIssue?(fields: Record<string, unknown>): Promise<string>;
  /** The account ids of users assignable in the project whose display name is exactly name. */
  projectAccounts?(project: string, name: string): Promise<string[]>;
  /** The fields a revision may change and Jira's updated timestamp; null when the ticket is not in Jira. */
  revisionIssue?(key: string): Promise<RevisionIssue | null>;
  /** Writes the given fields of an existing ticket in one edit. */
  editIssue?(key: string, fields: Record<string, unknown>): Promise<void>;
}

/** A draft test case: the AC line it checks (1-based), the steps and what is expected. */
export interface DraftTc { id: string; ac: number; title: string; steps: string[]; expected: string }
export interface TcComment { version: 1; tcs: DraftTc[] }
export const TC_MARKER = 'QONFLO-TC v1';
const MAX_TCS = 100;
const MAX_STEPS = 40;

interface DraftRow {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: Date | null; decisions: string; qaReason: string | null;
  refStatuses: string; createdBy: string | null; loadedAt: Date; publishedAt: Date | null; storyboards?: string; questions?: string; merges?: string; addedKeys?: string;
  tickets: Array<{
    key: string; summary: string; dev: string | null; sp: number | null; wave: number | null; planRank?: number | null; ac: string; jiraAc: string; jiraDev: string | null;
    dependsOn: string; status: string; prediction: string | null; position: number; epic?: string | null; frames?: string;
    tcs?: string; tcAt?: Date | null; tcPosted?: string | null; carried?: boolean;
    issueType?: string | null; description?: string | null; userStory?: string | null; problem?: string | null;
  }>;
  newTickets?: NewTicketRow[];
  revisions?: RevisionRow[];
}

interface NewTicketRow extends SprintDraftNewTicketData { id: string; position: number }

export interface DraftStore {
  getSettings(): Promise<Array<{ key: string; value: string }>>;
  getSprintDraft(sprint: string): Promise<DraftRow | null>;
  replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]): Promise<unknown>;
  addSprintDraftTickets(sprint: string, tickets: SprintDraftTicketInput[], addedKeys: string[]): Promise<unknown>;
  listSprintDrafts(): Promise<Array<{ sprint: string; sprintId: number; status: string }>>;
  updateSprintDraftTicket(sprint: string, key: string, data: { dev?: string | null; sp?: number | null; wave?: number | null; ac?: string[]; jiraAc?: string[]; jiraDev?: string | null; tcs?: string; tcAt?: Date; tcPosted?: string | null }): Promise<unknown>;
  updateSprintDraft(sprint: string, data: { decisions?: string; qaReason?: string | null; status?: string; publishedAt?: Date | null; storyboards?: string; questions?: string }): Promise<unknown>;
  saveSprintDraftPredictions(sprint: string, predictions: Map<string, string> | null, qaReason: string | null): Promise<unknown>;
  sprintDraftsWithEpic(epic: string): Promise<string[]>;
  addSprintDraftNewTicket(sprint: string, data: SprintDraftNewTicketData): Promise<string>;
  updateSprintDraftNewTicket(sprint: string, id: string, data: Partial<SprintDraftNewTicketData>): Promise<unknown>;
  removeSprintDraftNewTicket(sprint: string, id: string): Promise<unknown>;
  saveSprintDraftRevision(sprint: string, key: string, data: SprintDraftRevisionData): Promise<unknown>;
  updateSprintDraftRevision(id: string, data: SprintDraftRevisionUpdate): Promise<unknown>;
}

/** The newest storyboard version of an epic as the draft last saw it; error says why there is none. */
export interface StoryboardState {
  epic: string; version: number | null; previous: number | null; path: string | null; page: string | null; frames: number; changed: string[];
  changedAt: string | null; checkedAt: string; error: string | null;
  scenarios?: StoryboardScenario[];
  /** The tickets each changed flow lists; a changed flow without tickets falls back to the flow ids a ticket names. */
  tickets?: Record<string, string[]>;
  /** The planner said the epic has no storyboard (decision sbnone|EPIC); it counts as recorded. */
  none?: boolean;
}

/** A ticket the planner drafts for the sprint; Publish creates it in Jira. id is NEW-n, never reused in the sprint. */
export interface DraftNewTicket {
  id: string; summary: string; type: string; epic: string | null; dev: string | null; sp: number | null; priority: string | null;
  userStory: string; problem: string; ac: string[]; reference: string | null; source: string;
  createdKey: string | null; error: string | null;
  /** The writing standard (ticket-lint) on the ticket as drafted. */
  lint: TicketLint;
  /** Why it was created with a WRITING-FLAG despite a block finding; null when it was not. */
  flagReason: string | null;
}
/**
 * A question the planning chat could not settle from the storyboard. The planner answers it in the chat: the answer is
 * kept here, as a draft decision, as a comment on its ticket, and in the contract's decisions on publish.
 */
export interface DraftQuestion { id: string; text: string; key: string | null; askedAt: string; answered: boolean; answeredBy: string | null; answeredAt: string | null; answer?: string | null; options?: string[] }

/** A ticket naming a frame that changed in the newest storyboard version: its AC needs a check, Held when work has not started. */
export interface StoryboardFlag { version: number; frames: string[]; held: boolean; checked: Decision | null }

export interface DraftTicketView extends Omit<ScheduledTicket, 'dev' | 'wave'> {
  summary: string; dev: string | null; jiraDev: string | null; sp: number | null; wave: number; waveSet: boolean; status: string;
  /** SP still to do by the ticket's status once the sprint is under way; null before day 1 or on a published plan. */
  left: number | null;
  ac: string[]; dependsOn: string[]; prediction: QaPrediction | null; qaDecision: Decision | null;
  epic: string | null; frames: string[]; storyboard: StoryboardFlag | null;
  tcs: DraftTc[];
  /** The writing standard on the fields the draft holds: summary, AC, SP, Blocks links, and the type, description, User Story and Problem the load read (a draft loaded before that has none, so W4 and W7 wait for the next load). */
  lint: TicketLint;
  /** QA approved the test cases as they are now (decision tc|KEY); a later change of the set needs a new approval. */
  tcApproved: boolean;
  /** The hash of the AC lines; a ticket summary is written for one hash. */
  acHash: string;
  /** The storyboard changed a frame of this ticket after its test cases were written. */
  tcStale: boolean;
  /** The test cases differ from the last QONFLO-TC comment, so Publish posts them. */
  tcPending: boolean;
  merge: TicketMerge; pulls: string[];
  /** Jira already says past merge while a pull request is still open. */
  jiraAhead: boolean;
  /** Past merge: kept on the plan only; the schedule, AC check, QA and publish use the other tickets. */
  merged: boolean;
  /** Carried over from an earlier sprint and not past merge yet: first on its owner's lane. */
  carried: boolean;
  /** The number of the ticket's #N label in Jira; null without one. */
  rank: number | null;
  /** Where the plan put the ticket: by rank on its owner's lane, back to back from day 1, at its full SP. */
  planStart: number; planDur: number;
}

/** The tickets still to build: the draft's tickets without the merged ones. */
export const openTickets = <T extends { merged: boolean }>(view: { tickets: T[] }): T[] => view.tickets.filter((ticket) => !ticket.merged);
/** Every assignee of the sprint, those whose cards all merged included. end is the working day their lane ends. */
export interface DraftDeveloper { name: string; merged: number; open: number; sp: number; leftSp: number; end: number | null }
/** The merge state read from GitHub on the last load; source jira when GitHub could not be read. */
export interface DraftMerges { source: 'github' | 'jira'; tickets: Record<string, MergeRead> }
/** linked: the ticket already has an "is blocked by" link to the ticket the line names, so the line is a dependency. */
export interface DraftFindingView extends AcFinding { decision: Decision | null; linked: boolean }
export interface DraftView {
  sprint: string; sprintId: number; status: string; sprintDays: number; startDate: string | null; spPerDay: number;
  createdBy: string | null; loadedAt: string; publishedAt: string | null; qaReason: string | null;
  devs: string[]; tickets: DraftTicketView[]; findings: DraftFindingView[]; blockers: string[]; canPublish: boolean;
  /** Tickets of the sprint already past merge: in tickets as merged, left out of the schedule and the AC check. */
  landed: number;
  /** Tickets carried over from an earlier sprint that are past merge: left out of the draft entirely. */
  carriedPast: number;
  /** Today's working day on the plan's axis, 1-based; null before day 1. Open tickets are not laid before it. */
  today: number | null;
  storyboards: StoryboardState[];
  questions: DraftQuestion[];
  developers: DraftDeveloper[];
  mergeSource: 'github' | 'jira';
  moves: MoveSuggestion[];
  /** The planner's written scope cut (decision scope|cut): what leaves the sprint when the SP do not fit. */
  scopeCut?: Decision | null;
  /** The weeks the split page gives, with the tickets that sit elsewhere; null when no split page was read for this draft. */
  split?: SplitView | null;
  newTickets: DraftNewTicket[];
  /** Tickets that joined the sprint in Jira after the last load and were added by the hourly refresh. */
  addedSince: string[];
  /** Changes the planning agent proposes to tickets that exist in Jira: pending first, then applied, newest first; discarded ones left out. */
  revisions: DraftRevision[];
}
/**
 * referenceAdded: lines Publish appends to the Reference field; blockedBy: tickets Publish links as blocking this one; create: the new ticket Publish creates.
 * testsFor: the [BE] tickets of those Blocks links this [FE] ticket gets a Test link to; pairWarning: why it gets none although it has such a pair.
 */
export interface DraftChange { key: string; assigneeFrom: string | null; assigneeTo: string | null; acRemoved: string[]; acAdded: string[]; referenceAdded: string[]; blockedBy: string[]; testsFor: string[]; pairWarning: string | null; refused: string | null; create?: DraftNewTicket | null }
export const TEST_LINK_MISSING = 'Link type Test not found in Jira; ask a Jira admin to add it (tests / is tested by)';
/** One line of a publish: a ticket's AC and assignee, a Test link of an FE and BE pair, a new ticket, or the Confluence contract page. */
export interface PublishResult { key: string; kind: 'ticket' | 'link' | 'tc' | 'label' | 'contract' | 'create' | 'revision'; status: 'updated' | 'created' | 'refused' | 'failed' | 'skipped'; detail: string | null }
/** Where the split page's weeks are read from and kept per draft; read gives null when no split page is set. */
export interface SplitSource {
  read(): Promise<SplitState | null>;
  get(sprint: string): Promise<SplitState | null>;
  save(sprint: string, state: SplitState | null): Promise<unknown>;
}
export interface ContractTarget { client: ContractClient | null; parentId: string | null }

const MAX_DESCRIPTION = 4000;
/** The refresh that picks up tickets added to a sprint runs at most this often. */
const REFRESH_MS = 60 * 60 * 1000;

/** A draft ticket as the load reads it from Jira: AC, links, and the text the writing check needs. */
function draftTicketOf(issue: PlanningIssue, carried: boolean): SprintDraftTicketInput {
  const ac = acValueLines(issue.acRaw);
  const text = (raw: unknown) => fieldLines(raw).map((line) => line.trim()).filter(Boolean).join('\n');
  return {
    key: issue.key, summary: issue.summary, dev: issue.assignee, sp: issue.sp, wave: null, planRank: rankOf(issue.labels ?? []), status: issue.status,
    ac, jiraAc: ac, jiraDev: issue.assignee,
    dependsOn: [...new Set(issue.links.filter((link) => link.relation === 'blockedBy').map((link) => link.key))],
    epic: issue.epic ?? null, frames: framesIn([...ac, ...fieldLines(issue.descriptionRaw)]), carried,
    issueType: issue.type || null, description: text(issue.descriptionRaw).slice(0, MAX_DESCRIPTION), userStory: text(issue.userStoryRaw), problem: text(issue.problemRaw),
  };
}

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
const qaId = (key: string) => `qa|${key}`;
export const tcId = (key: string) => `tc|${key}`;
/** Approved when QA approved the set after it was last written, and there is a set to approve. */
const tcApproved = (ticket: { tcs: DraftTc[]; tcAt?: Date | null }, approval: Decision | undefined) => (
  !!approval && approval.action === 'approve' && ticket.tcs.length > 0 && (!ticket.tcAt || ticket.tcAt.toISOString() <= approval.at)
);
const storyboardId = (key: string, version: number) => `sb|${key}|v${version}`;
const SCOPE_CUT_ID = 'scope|cut';
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

// ---- New tickets ----------------------------------------------------------------------------------------------------

export const NEW_TICKET_LABEL = 'dock-plan';
export const MAX_NEW_TICKETS = 30;
const NEW_TICKET_ID = /^NEW-\d+$/;
const NEW_TICKET_TYPES = ['Task', 'Story', 'Bug'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const DEFAULT_PRIORITY = 'Medium';
const DEFAULT_PROJECT = 'QRD';
const sbNoneId = (epic: string) => `sbnone|${epic}`;

function newTicketText(input: Record<string, unknown>, name: string, label: string, max: number): string | null | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new SprintInputError(`${label} must be text`);
  const text = value.trim();
  if (text.length > max) throw new SprintInputError(`${label} is at most ${max} characters`);
  return text;
}

/** AC lines as the route or the panel sends them: at most 40 lines of at most 1000 characters. */
function acInputLines(value: unknown, holder: string): string[] {
  if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) throw new SprintInputError('ac must be a list of lines');
  const lines = (value as string[]).map(normalizeAcLine).filter(Boolean);
  if (lines.length > 40) throw new SprintInputError(`${holder} holds at most 40 AC lines`);
  const long = lines.findIndex((line) => line.length > 1000);
  if (long >= 0) throw new SprintInputError(`AC line ${long + 1} is at most 1000 characters`);
  return lines;
}

/** The fields of a new ticket the input sets; a field left out stays as it is, null clears it. Anything out of range is refused. */
export function parseNewTicket(raw: unknown): Partial<SprintDraftNewTicketData> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SprintInputError('ticket must be an object');
  const input = raw as Record<string, unknown>;
  const data: Partial<SprintDraftNewTicketData> = {};
  const summary = newTicketText(input, 'summary', 'Summary', 200);
  if (summary !== undefined) data.summary = summary ?? '';
  const type = newTicketText(input, 'type', 'Type', 20);
  if (type !== undefined) {
    const known = type ? NEW_TICKET_TYPES.find((item) => item.toLowerCase() === type.toLowerCase()) : 'Task';
    if (!known) throw new SprintInputError('Type is Task, Story or Bug');
    data.type = known;
  }
  const epic = newTicketText(input, 'epic', 'Epic', 40);
  if (epic !== undefined) {
    const key = epic ? epic.toUpperCase() : null;
    if (key && !TICKET_KEY.test(key)) throw new SprintInputError('Epic must be an epic key such as QRD-1200');
    data.epic = key;
  }
  const dev = newTicketText(input, 'dev', 'Developer', 120);
  if (dev !== undefined) data.dev = dev || null;
  if (input.sp !== undefined) {
    const sp = input.sp;
    if (sp !== null && (typeof sp !== 'number' || !Number.isFinite(sp) || sp < 0 || sp > 100)) throw new SprintInputError('SP must be from 0 to 100');
    data.sp = sp as number | null;
  }
  const priority = newTicketText(input, 'priority', 'Priority', 20);
  if (priority !== undefined) {
    const known = priority ? PRIORITIES.find((item) => item.toLowerCase() === priority.toLowerCase()) : null;
    if (priority && !known) throw new SprintInputError(`Priority is ${PRIORITIES.join(', ')}`);
    data.priority = known ?? null;
  }
  const userStory = newTicketText(input, 'userStory', 'User Story', 4000);
  if (userStory !== undefined) data.userStory = userStory ?? '';
  const problem = newTicketText(input, 'problem', 'Problem Definition', 4000);
  if (problem !== undefined) data.problem = problem ?? '';
  if (input.ac !== undefined) data.ac = JSON.stringify(acInputLines(input.ac ?? [], 'A new ticket'));
  const reference = newTicketText(input, 'reference', 'Reference', 2000);
  if (reference !== undefined) data.reference = reference || null;
  const source = newTicketText(input, 'source', 'Source', 200);
  if (source !== undefined) data.source = source || 'manual';
  return data;
}

const newTicketView = (row: NewTicketRow): DraftNewTicket => ({
  id: row.id, summary: row.summary, type: row.type, epic: row.epic ?? null, dev: row.dev ?? null, sp: row.sp ?? null, priority: row.priority ?? null,
  userStory: row.userStory, problem: row.problem, ac: parse<string[]>(row.ac, []), reference: row.reference ?? null, source: row.source,
  createdKey: row.createdKey ?? null, error: row.error ?? null, flagReason: row.flagReason ?? null,
  lint: lintTicket({ type: row.type, summary: row.summary, userStory: row.userStory, problem: row.problem, ac: parse<string[]>(row.ac, []), reference: row.reference ?? '', sp: row.sp ?? null }),
});

/** Why Publish cannot create the ticket yet: the required fields still empty; null when it can. */
export function newTicketRefusal(ticket: DraftNewTicket): string | null {
  const missing = [
    !ticket.summary.trim() && 'summary', !ticket.userStory.trim() && 'User Story', !ticket.problem.trim() && 'Problem Definition', !ticket.ac.length && 'at least one AC line',
  ].filter((item): item is string => !!item);
  return missing.length ? `Missing ${missing.join(', ')}` : null;
}

/** The refusal text of a ticket below the writing standard: names each block finding; null when none. */
export function writingRefusal(lint: TicketLint): string | null {
  const blocks = lint.findings.filter((item) => item.level === 'block');
  return blocks.length ? `Below the writing standard: ${blocks.map((item) => item.text).join(' ')} Create or apply it with a flag and a reason to let it in.` : null;
}

/** The project the sprint's tickets are in, by their keys; QRD when the draft has none. */
export function sprintProject(keys: string[]): string {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const project = key.match(/^([A-Z][A-Z0-9_]*)-\d+$/)?.[1];
    if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? DEFAULT_PROJECT;
}

/** The error's message with what Jira said about each field, so a refused create names the field. */
function jiraErrorText(error: any): string {
  const message = error instanceof Error ? error.message : String(error);
  const data = error?.response?.data;
  const said = [...(Array.isArray(data?.errorMessages) ? data.errorMessages : []), ...Object.entries(data?.errors && typeof data.errors === 'object' ? data.errors : {}).map(([field, text]) => `${field}: ${text}`)];
  return said.length ? `${message} (${said.join('; ')})` : message;
}

const paragraphs = (text: string) => ({ type: 'doc', version: 1, content: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) });

/** The Jira create fields of a new ticket; AC and Reference in the format Publish writes them to an empty field. */
export function newTicketFields(ticket: DraftNewTicket, project: string, sprintId: number, accountId: string | null, flagged = false): Record<string, unknown> {
  const reference = (ticket.reference ?? '').split(/\r?\n/).map(normalizeAcLine).filter(Boolean);
  return {
    project: { key: project },
    issuetype: { name: ticket.type },
    summary: ticket.summary,
    customfield_10341: paragraphs(ticket.userStory),
    customfield_10331: paragraphs(ticket.problem),
    customfield_10332: rewriteAcValue(null, [], ticket.ac),
    ...(reference.length ? { customfield_10333: rewriteAcValue(null, [], reference) } : {}),
    ...(ticket.sp !== null ? { customfield_10016: ticket.sp } : {}),
    customfield_10020: sprintId,
    ...(ticket.epic ? { parent: { key: ticket.epic } } : {}),
    labels: flagged ? [NEW_TICKET_LABEL, WRITING_FLAG_LABEL] : [NEW_TICKET_LABEL],
    priority: { name: ticket.priority ?? DEFAULT_PRIORITY },
    ...(accountId ? { assignee: { accountId } } : {}),
  };
}

/** Every text line of a Jira rich-text or plain field. */
function fieldLines(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.split(/\r?\n/);
  return isAdf(raw) ? adfLines(raw) : [];
}

// ---- Revisions of tickets that exist in Jira ------------------------------------------------------------------------

export const MAX_PENDING_REVISIONS = 30;
const REVISION_SOURCES = ['chat', 'manual'];
/** The fields a revision may change, in the order it lists them; nothing else of a ticket is ever written. */
const REVISION_FIELDS = [
  { name: 'summary', label: 'Summary', field: 'summary' },
  { name: 'type', label: 'Type', field: 'issuetype' },
  { name: 'userStory', label: 'User Story', field: USER_STORY_FIELD },
  { name: 'problem', label: 'Problem Definition', field: PROBLEM_FIELD },
  { name: 'ac', label: 'Acceptance Criteria', field: AC_FIELD },
  { name: 'reference', label: 'Reference', field: REFERENCE_FIELD },
  { name: 'openToConfirm', label: 'Open to confirm', field: OPEN_TO_CONFIRM_FIELD },
] as const;
type RevisionFieldName = typeof REVISION_FIELDS[number]['name'];
const REVISION_TEXT: Array<[RevisionFieldName, string, number]> = [['userStory', 'User Story', 4000], ['problem', 'Problem Definition', 4000], ['reference', 'Reference', 2000], ['openToConfirm', 'Open to confirm', 4000]];
const REVISION_INPUTS = new Set<string>([...REVISION_FIELDS.map((field) => field.name), 'note', 'source']);
/** The values a revision writes: ac is a list of lines, every other field text. */
export type RevisionAfter = Partial<Record<RevisionFieldName, string | string[]>>;

interface RevisionRow {
  id: string; key: string; summary: string; status: string; note: string | null; source: string; after: string; before: string; jiraUpdated: string;
  error: string | null; appliedAt: Date | null; createdAt: Date; flagReason?: string | null;
}
export interface DraftRevisionField { name: string; label: string; before: string[]; after: string[] }
export interface DraftRevision {
  key: string; summary: string; status: string; note: string | null; source: string; fields: DraftRevisionField[];
  /** The key is a ticket of this draft; otherwise it sits in the backlog or another sprint. */
  inSprint: boolean;
  error: string | null; createdAt: string; appliedAt: string | null;
  /** The writing standard on the values the revision writes (the fields it changes). */
  lint: TicketLint;
  flagReason: string | null;
}

/** The fields a revision sets and its note and source; a field left out or null is not part of it. Anything out of range is refused. */
export function parseRevision(raw: unknown): { after: RevisionAfter; note?: string | null; source?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SprintInputError('revision must be an object');
  const input = raw as Record<string, unknown>;
  const other = Object.keys(input).find((name) => !REVISION_INPUTS.has(name));
  if (other) throw new SprintInputError(`${other} is not a field a revision may change`);
  const after: RevisionAfter = {};
  const summary = newTicketText(input, 'summary', 'Summary', 200);
  if (summary === '') throw new SprintInputError('Summary cannot be empty');
  if (summary) after.summary = summary;
  const type = newTicketText(input, 'type', 'Type', 20);
  if (typeof type === 'string') {
    const known = NEW_TICKET_TYPES.find((item) => item.toLowerCase() === type.toLowerCase());
    if (!known) throw new SprintInputError('Type is Task, Story or Bug');
    after.type = known;
  }
  for (const [name, label, max] of REVISION_TEXT) {
    const value = newTicketText(input, name, label, max);
    if (typeof value === 'string') after[name] = value;
  }
  if (input.ac !== undefined && input.ac !== null) after.ac = acInputLines(input.ac, 'A revision');
  const note = newTicketText(input, 'note', 'Note', 500);
  const source = newTicketText(input, 'source', 'Source', 20);
  if (source && !REVISION_SOURCES.includes(source)) throw new SprintInputError('Source is chat or manual');
  return { after, ...(note !== undefined ? { note: note || null } : {}), ...(source ? { source } : {}) };
}

const textLines = (lines: string[]) => lines.map((line) => line.trim()).filter(Boolean);

/** A revision value as lines, the way the field is compared with Jira and shown next to it. */
function revisionLines(name: RevisionFieldName, value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  if (name === 'summary' || name === 'type') return value ? [value] : [];
  const lines = value.split(/\r?\n/);
  return name === 'reference' ? lines.map(normalizeAcLine).filter(Boolean) : textLines(lines);
}

/** Jira's value of a revision field as lines: AC and Reference as Publish reads them, the other text as the ticket detail does. */
function jiraLines(issue: RevisionIssue, name: RevisionFieldName): string[] {
  if (name === 'summary') return issue.summary ? [issue.summary] : [];
  if (name === 'type') return issue.type ? [issue.type] : [];
  if (name === 'ac') return acValueLines(issue.fields[AC_FIELD]);
  if (name === 'reference') return fieldLines(issue.fields[REFERENCE_FIELD]).map(normalizeAcLine).filter(Boolean);
  if (name === 'userStory') {
    const story = textLines(fieldLines(issue.fields[USER_STORY_FIELD]));
    return story.length ? story : textLines(fieldLines(issue.fields[OLD_USER_STORY_FIELD]));
  }
  return textLines(fieldLines(issue.fields[name === 'problem' ? PROBLEM_FIELD : OPEN_TO_CONFIRM_FIELD]));
}

/**
 * The Jira edit of a revision: only the fields that differ from Jira now. AC and Reference are rewritten line by line
 * in Jira's format as Publish does; the other text fields are written as Create in Jira writes them, or as text when
 * Jira holds the field as text.
 */
export function revisionEdit(issue: RevisionIssue, after: RevisionAfter): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const { name, field } of REVISION_FIELDS) {
    const value = after[name];
    if (value === undefined) continue;
    const now = jiraLines(issue, name);
    const lines = revisionLines(name, value);
    if (name === 'ac' || name === 'reference') {
      const { removed, added } = diffLines(now, lines);
      if (removed.length || added.length) fields[field] = rewriteAcValue(issue.fields[field] ?? null, removed, added);
    } else if (!sameLines(now, lines)) {
      if (name === 'summary') fields[field] = value;
      else if (name === 'type') fields[field] = { name: value };
      else if (!lines.length) fields[field] = null;
      else fields[field] = typeof issue.fields[field] === 'string' ? lines.join('\n') : paragraphs(lines.join('\n'));
    }
  }
  return fields;
}

/** What a revision is checked on: only the fields it changes; the Blocks links of the ticket when it is in this draft. */
function revisionLint(after: RevisionAfter, key: string, blockedBy: string[], decidedRefs: string[]): TicketLint {
  const text = (name: RevisionFieldName) => (after[name] === undefined ? undefined : revisionLines(name, after[name]!).join('\n'));
  const input: LintInput = { key, summary: text('summary'), type: text('type'), userStory: text('userStory'), problem: text('problem'), reference: text('reference'), openToConfirm: text('openToConfirm'), blockedBy, decidedRefs };
  if (after.ac !== undefined) input.ac = revisionLines('ac', after.ac);
  return lintTicket(input);
}

function revisionView(row: RevisionRow, inSprint: boolean, blockedBy: string[] = [], decidedRefs: string[] = []): DraftRevision {
  const after = parse<RevisionAfter>(row.after, {});
  const before = parse<Record<string, string[]>>(row.before, {});
  return {
    key: row.key, summary: row.summary, status: row.status, note: row.note ?? null, source: row.source,
    fields: REVISION_FIELDS.filter(({ name }) => after[name] !== undefined).map(({ name, label }) => ({ name, label, before: before[name] ?? [], after: revisionLines(name, after[name]!) })),
    inSprint, error: row.error ?? null, createdAt: row.createdAt.toISOString(), appliedAt: row.appliedAt?.toISOString() ?? null,
    lint: revisionLint(after, row.key, blockedBy, decidedRefs), flagReason: row.flagReason ?? null,
  };
}

function revisionKey(key: string): string {
  const ticket = key.trim().toUpperCase();
  if (!TICKET_KEY.test(ticket)) throw new SprintInputError('key must be a ticket key such as QRD-1602');
  return ticket;
}

/** The error's message with what Jira said, prefixed with the status Jira responded with. */
function jiraFailure(error: any): string {
  const status = error?.response?.status;
  return status ? `Jira responded ${status}: ${jiraErrorText(error)}` : jiraErrorText(error);
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

/** The AC of every ticket after the decisions: a moved line leaves its ticket for the one it needs, a line for Reference goes. */
export function finalAc(tickets: Array<{ key: string; ac: string[] }>, decisions: Decisions): Map<string, string[]> {
  const result = new Map(tickets.map((ticket) => [ticket.key, [...ticket.ac]]));
  for (const [id, decision] of Object.entries(decisions)) {
    const [kind, key, refKey, ...rest] = id.split('|');
    const action = acAction(decision.action);
    if (kind !== 'ac' || (action !== 'move' && action !== 'reference')) continue;
    const text = rest.join('|');
    const lines = result.get(key);
    const index = lines ? lines.findIndex((line) => normalizeAcLine(line) === text) : -1;
    if (!lines || index < 0) continue;
    const [line] = lines.splice(index, 1);
    const target = result.get(refKey);
    if (action === 'move' && target && !target.some((other) => normalizeAcLine(other) === text)) target.push(line);
  }
  return result;
}

/** The line as the Reference field keeps it: the ticket it names first. */
export const referenceLine = (refKey: string, text: string) => `${refKey}: ${normalizeAcLine(text)}`;

/**
 * What the decisions write beside the AC: each ticket's lines for the Reference field, and the tickets it gets an
 * "is blocked by" link to. Only lines still in the ticket's AC count.
 */
export function acSideEffects(tickets: Array<{ key: string; ac: string[] }>, decisions: Decisions): Map<string, { reference: string[]; blockedBy: string[] }> {
  const result = new Map(tickets.map((ticket) => [ticket.key, { reference: [] as string[], blockedBy: [] as string[] }]));
  const acOf = new Map(tickets.map((ticket) => [ticket.key, ticket.ac.map(normalizeAcLine)]));
  for (const [id, decision] of Object.entries(decisions)) {
    const [kind, key, refKey, ...rest] = id.split('|');
    const text = rest.join('|');
    const effects = result.get(key);
    if (kind !== 'ac' || !effects || !acOf.get(key)!.includes(text)) continue;
    const action = acAction(decision.action);
    if (action === 'reference' && !effects.reference.includes(referenceLine(refKey, text))) effects.reference.push(referenceLine(refKey, text));
    if (action === 'dependency' && !effects.blockedBy.includes(refKey)) effects.blockedBy.push(refKey);
  }
  return result;
}

/** What still holds Publish: an after-it AC line with neither a Blocks link nor a decision. */
export function publishBlockers(findings: Array<AcFinding & { linked?: boolean }>, decisions: Decisions): string[] {
  return findings.filter((finding) => finding.kind === 'after-it' && !finding.linked && !decisions[finding.id]).map((finding) => finding.id);
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
    private readonly mergeStates: ((keys: string[]) => Promise<Map<string, MergeRead> | null>) | null = null,
    /** Why this DOCK may not change the draft (it is not the planner's), or null when it may. */
    private readonly editGuard: (() => Promise<string | null>) | null = null,
    private readonly split: SplitSource | null = null,
    /** Runs once a publish has marked the draft published: the visuals nobody saved go. */
    private readonly afterPublish: ((sprint: string) => Promise<unknown>) | null = null,
  ) {}

  private async mayEdit(): Promise<void> {
    const refused = this.editGuard ? await this.editGuard() : null;
    if (refused) throw new SprintInputError(refused);
  }

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
    const carried = new Set(jira.carriedKeys ? await jira.carriedKeys(sprint.id) : []);
    const keys = new Set(issues.map((issue) => issue.key));
    const read = this.mergeStates ? await this.mergeStates([...keys]).catch(() => null) : null;
    const merges: DraftMerges = read ? { source: 'github', tickets: Object.fromEntries(read) } : { source: 'jira', tickets: {} };
    const tickets: SprintDraftTicketInput[] = issues.map((issue) => draftTicketOf(issue, carried.has(issue.key)));
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
      startDate: start ? new Date(start) : null, createdBy: previous?.createdBy ?? by, refStatuses: JSON.stringify(refStatuses), merges: JSON.stringify(merges),
    }, tickets);
    await this.readSplit(sprint.name);
    await this.refreshQa(sprint.name);
    return this.checkStoryboards(sprint.name).catch(async () => (await this.view(sprint.name))!);
  }

  /**
   * Adds the tickets that joined the sprint in Jira after the last load. Only new keys are written: the planner's changes and
   * decisions on the tickets already in the draft stay, and the draft reports the new keys until the next load.
   */
  async addNewTickets(sprint: string): Promise<string[]> {
    const row = await this.store.getSprintDraft(sprint);
    if (!row) return [];
    const jira = await this.jira();
    const known = new Set(row.tickets.map((ticket) => ticket.key));
    const fresh = (await jira.sprintIssues(row.sprintId)).filter((issue) => !known.has(issue.key));
    if (!fresh.length) return [];
    const carried = new Set(jira.carriedKeys ? await jira.carriedKeys(row.sprintId).catch(() => [] as string[]) : []);
    const keys = fresh.map((issue) => issue.key);
    await this.store.addSprintDraftTickets(sprint, fresh.map((issue) => draftTicketOf(issue, carried.has(issue.key))), [...new Set([...parse<string[]>(row.addedKeys, []), ...keys])]);
    return keys;
  }

  private refreshedAt = 0;

  /** The hourly refresh: every draft of an active or future sprint picks up the tickets added to the sprint since it was loaded. One search per sprint. */
  async refreshNewTickets(): Promise<Record<string, string[]>> {
    const now = this.now().getTime();
    if (this.refreshedAt && now - this.refreshedAt < REFRESH_MS) return {};
    this.refreshedAt = now;
    if (this.editGuard && (await this.editGuard())) return {};
    const drafts = await this.store.listSprintDrafts();
    if (!drafts.length) return {};
    const open = new Set((await (await this.jira()).listSprints()).map((item) => item.id));
    const added: Record<string, string[]> = {};
    for (const draft of drafts.filter((item) => open.has(item.sprintId))) {
      const keys = await this.addNewTickets(draft.sprint).catch(() => [] as string[]);
      if (keys.length) added[draft.sprint] = keys;
    }
    return added;
  }

  async view(sprint: string): Promise<DraftView | null> {
    const row = await this.store.getSprintDraft(sprint);
    if (!row) return null;
    const view = this.compute(row, await this.spPerDay());
    const state = this.split ? await this.split.get(sprint) : null;
    return state ? { ...view, split: splitView(state, row.status === 'published' ? [] : openTickets(view)) } : view;
  }

  /** Reads the split page for the draft; the draft itself is never changed by it. A kept difference stays kept while the page still says that week. */
  private async readSplit(sprint: string): Promise<void> {
    if (!this.split) return;
    const before = await this.split.get(sprint).catch(() => null);
    const fresh = await this.split.read().catch(() => before);
    if (fresh) fresh.kept = Object.fromEntries(Object.entries(before?.kept ?? {}).filter(([key, week]) => fresh.weeks[key]?.week === week));
    await this.split.save(sprint, fresh);
  }

  /** Moves one ticket to the week the split page gives; the only way the split page changes the draft. */
  async useSplit(sprint: string, key: string): Promise<DraftView> {
    const entry = (await this.split?.get(sprint))?.weeks[key];
    if (!entry) throw new SprintInputError(`The split page gives no week for ${key}`);
    return this.updateTicket(sprint, key, { wave: entry.week });
  }

  /** Keeps the ticket where the draft has it and stops showing the difference until the split page says another week. */
  async keepSplit(sprint: string, key: string): Promise<DraftView> {
    await this.mayEdit();
    await this.row(sprint);
    const state = await this.split?.get(sprint);
    const entry = state?.weeks[key];
    if (!state || !entry) throw new SprintInputError(`The split page gives no week for ${key}`);
    await this.split!.save(sprint, { ...state, kept: { ...state.kept, [key]: entry.week } });
    return (await this.view(sprint))!;
  }

  private compute(row: DraftRow, spPerDay: number): DraftView {
    const decisions = parse<Decisions>(row.decisions, {});
    const refStatuses = parse<Record<string, string>>(row.refStatuses, {});
    const loaded = row.tickets.map((ticket) => ({
      ...ticket, ac: parse<string[]>(ticket.ac, []), jiraAc: parse<string[]>(ticket.jiraAc, []), dependsOn: parse<string[]>(ticket.dependsOn, []),
      prediction: parse<QaPrediction | null>(ticket.prediction, null), epic: ticket.epic ?? null, frames: parse<string[]>(ticket.frames, []),
      tcs: parse<DraftTc[]>(ticket.tcs, []), carried: !!ticket.carried,
    }));
    const merges = parse<Partial<DraftMerges>>(row.merges, {});
    const mergeSource = merges.source === 'github' ? 'github' : 'jira';
    const mergeOf = (key: string): MergeRead | null => (mergeSource === 'github' ? merges.tickets?.[key] ?? null : null);
    // GitHub decides when the ticket has pull requests; a ticket without any (an infra or RND task) is past merge when Jira says so.
    const pastMerge = (ticket: { key: string; status: string }) => {
      const merge = mergeOf(ticket.key)?.merge;
      if (merge === 'merged') return true;
      if (merge === 'open') return false;
      return isDoneStatus(ticket.status);
    };
    // A ticket carried over from an earlier sprint that is past merge was that sprint's work: this draft leaves it out.
    const all = loaded.filter((ticket) => !(ticket.carried && pastMerge(ticket)));
    const tickets = all.filter((ticket) => !pastMerge(ticket));
    // A carried ticket still open was planned in its own sprint: its AC references, QA prediction and storyboard are not asked again.
    const planned = tickets.filter((ticket) => !ticket.carried);
    // Once the sprint has started, a draft lays open tickets from today's working day, never in the past. A published
    // plan keeps its days, so AC drift can still tell a ticket that slipped past its planned day.
    const today = workingDayOf(row.startDate?.toISOString() ?? null, this.now());
    // The same draft counts only the work left on each ticket by its status; before day 1 every ticket keeps its full SP.
    const underWay = !!today && row.status !== 'published';
    const left = new Map(tickets.map((ticket) => [ticket.key, underWay ? remainingSp(ticket.sp, ticket.status, spPerDay) : null]));
    const from = underWay && today ? today - 1 : 0;
    const laneInput = tickets.map((ticket) => ({ key: ticket.key, dev: ticket.dev, sp: ticket.sp, left: left.get(ticket.key), wave: ticket.wave, dependsOn: ticket.dependsOn }));
    const schedule = new Map(scheduleSprint(laneInput, { sprintDays: row.sprintDays, spPerDay, from }).map((item) => [item.key, item]));
    const ends = new Map([...schedule.values()].map((item) => [item.key, item.end]));
    const status = new Map(all.map((ticket) => [ticket.key, ticket.status]));
    const blockedBy = new Map(all.map((ticket) => [ticket.key, ticket.dependsOn]));
    const findings = acFindings(planned, ends, (key) => status.get(key) ?? refStatuses[key] ?? null).map((finding) => {
      const decision = decisions[finding.id] ?? null;
      return { ...finding, decision: decision && { ...decision, action: acAction(decision.action) }, linked: (blockedBy.get(finding.key) ?? []).includes(finding.refKey) };
    });
    const blockers = publishBlockers(findings, decisions);
    const epics = new Set(all.filter((ticket) => !ticket.carried).map((ticket) => ticket.epic));
    const storyboards = Object.values(parse<Record<string, StoryboardState>>(row.storyboards, {})).filter((board) => epics.has(board.epic)).sort((a, b) => a.epic.localeCompare(b.epic))
      .map((board) => ({ ...board, none: !!decisions[sbNoneId(board.epic)] }));
    const newTickets = (row.newTickets ?? []).map(newTicketView);
    const draftKeys = new Set(row.tickets.map((ticket) => ticket.key));
    const revisions = (row.revisions ?? []).filter((item) => item.status !== 'discarded').map((item) => revisionView(item, draftKeys.has(item.key), blockedBy.get(item.key) ?? [], findings.filter((finding) => finding.key === item.key && finding.decision).map((finding) => finding.refKey)))
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || (b.appliedAt ?? b.createdAt).localeCompare(a.appliedAt ?? a.createdAt));
    const boardOf = new Map(storyboards.map((board) => [board.epic, board]));
    const flagOf = (ticket: { key: string; epic: string | null; frames: string[]; ac: string[]; status: string; carried?: boolean }): StoryboardFlag | null => {
      if (ticket.carried) return null;
      const board = ticket.epic ? boardOf.get(ticket.epic) : undefined;
      if (!board?.version || !board.changed.length) return null;
      const named = new Set([...ticket.frames, ...framesIn(ticket.ac)]);
      const frames = board.changed.filter((id) => (board.tickets?.[id]?.length ? board.tickets[id].includes(ticket.key) : named.has(id)));
      return frames.length ? { version: board.version, frames, held: !isInProgress(ticket.status), checked: decisions[storyboardId(ticket.key, board.version)] ?? null } : null;
    };
    const tcStale = (ticket: { key: string; epic: string | null; frames: string[]; ac: string[]; status: string; tcs: DraftTc[]; tcAt?: Date | null }) => {
      const changedAt = ticket.epic ? boardOf.get(ticket.epic)?.changedAt : null;
      return ticket.tcs.length > 0 && !!flagOf(ticket) && !!changedAt && (!ticket.tcAt || ticket.tcAt.toISOString() < changedAt);
    };
    const devs = [...new Set(tickets.map((ticket) => ticket.dev).filter((dev): dev is string => !!dev))].sort((a, b) => a.localeCompare(b));
    const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 1000) / 1000;
    const developers = [...new Set(all.map((ticket) => ticket.dev).filter((dev): dev is string => !!dev))].sort((a, b) => a.localeCompare(b)).map((name) => {
      const mine = all.filter((ticket) => ticket.dev === name);
      const open = tickets.filter((ticket) => ticket.dev === name);
      const ends = open.map((ticket) => schedule.get(ticket.key)!.end);
      return {
        name, merged: mine.length - open.length, open: open.length, sp: sum(mine.map((ticket) => ticket.sp ?? 0)),
        leftSp: sum(open.map((ticket) => left.get(ticket.key) ?? ticket.sp ?? 0)),
        end: ends.length ? endDay(Math.max(...ends), from) : null,
      };
    });
    const plan = new Map(planLayout(all.map((ticket) => ({ key: ticket.key, dev: ticket.dev, sp: ticket.sp, rank: ticket.planRank ?? null, carried: ticket.carried })), { spPerDay }).map((item) => [item.key, item]));
    const view = (ticket: (typeof all)[number], placed: Omit<ScheduledTicket, 'key' | 'dev'>, merged: boolean): DraftTicketView => ({
      key: ticket.key, summary: ticket.summary, dev: ticket.dev, jiraDev: ticket.jiraDev, sp: ticket.sp, left: left.get(ticket.key) ?? null, wave: placed.wave, waveSet: ticket.wave !== null,
      status: ticket.status, ac: ticket.ac, dependsOn: ticket.dependsOn, start: placed.start, dur: placed.dur, end: placed.end,
      inSprint: placed.inSprint, split: placed.split, prediction: ticket.prediction, qaDecision: decisions[qaId(ticket.key)] ?? null,
      epic: ticket.epic, frames: ticket.frames, storyboard: flagOf(ticket),
      lint: lintTicket({ key: ticket.key, summary: ticket.summary, ac: ticket.ac, sp: ticket.sp, blockedBy: ticket.dependsOn, type: ticket.issueType ?? undefined, userStory: ticket.userStory ?? undefined, problem: ticket.problem ?? undefined, description: ticket.description ?? undefined, decidedRefs: findings.filter((finding) => finding.key === ticket.key && finding.decision).map((finding) => finding.refKey) }),
      tcs: ticket.tcs, tcApproved: tcApproved(ticket, decisions[tcId(ticket.key)]), acHash: acHash(ticket.ac), tcStale: tcStale(ticket), tcPending: ticket.tcs.length > 0 && JSON.stringify(ticket.tcs) !== (ticket.tcPosted ?? ''),
      merge: mergeOf(ticket.key)?.merge ?? 'unknown', pulls: mergeOf(ticket.key)?.pulls ?? [],
      jiraAhead: isDoneStatus(ticket.status) && mergeOf(ticket.key)?.merge === 'open',
      merged, carried: ticket.carried, rank: ticket.planRank ?? null, planStart: plan.get(ticket.key)!.planStart, planDur: plan.get(ticket.key)!.planDur,
    });
    const openKeys = new Set(tickets.map((ticket) => ticket.key));
    const merged = all.filter((ticket) => !openKeys.has(ticket.key)).map((ticket) => {
      const { planStart: start, planDur: dur } = plan.get(ticket.key)!;
      return view(ticket, { wave: ticket.wave ?? 1, start, dur, end: start + dur, inSprint: start + dur <= row.sprintDays, split: null }, true);
    });
    const moves = row.status === 'published' ? [] : suggestMoves(
      laneInput.map((ticket, index) => ({ ...ticket, status: tickets[index].status, merge: mergeOf(ticket.key)?.merge ?? 'unknown' })),
      { developers: developers.map((developer) => developer.name), sprintDays: row.sprintDays, spPerDay, from },
    );
    return {
      sprint: row.sprint, sprintId: row.sprintId, status: row.status, sprintDays: row.sprintDays, startDate: row.startDate?.toISOString() ?? null,
      spPerDay, createdBy: row.createdBy, loadedAt: row.loadedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, qaReason: row.qaReason,
      devs, today, landed: all.length - tickets.length, carriedPast: loaded.length - all.length, storyboards, questions: parse<DraftQuestion[]>(row.questions, []), developers, mergeSource, moves,
      tickets: [
        ...tickets.map((ticket) => view(ticket, schedule.get(ticket.key)!, false)).sort((a, b) => a.start - b.start || a.key.localeCompare(b.key, undefined, { numeric: true })),
        ...merged.sort((a, b) => a.planStart - b.planStart || a.key.localeCompare(b.key, undefined, { numeric: true })),
      ],
      findings,
      blockers,
      canPublish: tickets.length > 0 || newTickets.some((ticket) => !ticket.createdKey),
      scopeCut: decisions[SCOPE_CUT_ID] ?? null,
      newTickets,
      revisions,
      addedSince: parse<string[]>(row.addedKeys, []).filter((key) => draftKeys.has(key)),
    };
  }

  /** Runs predict.mjs on the draft as it stands and stores what it answered. */
  async refreshQa(sprint: string): Promise<DraftView> {
    const view = (await this.view(sprint))!;
    const open = openTickets(view);
    const ends = new Map(open.map((ticket) => [ticket.key, ticket.end]));
    const summaries = new Map(view.tickets.map((ticket) => [ticket.key, ticket.summary]));
    const linksOf = (key: string, dependsOn: string[]) => [
      ...dependsOn.map((other) => ({ key: other, type: 'is blocked by', ...(summaries.has(other) ? { summary: summaries.get(other)! } : {}) })),
      ...view.tickets.filter((other) => other.dependsOn.includes(key)).map((other) => ({ key: other.key, type: 'blocks', summary: other.summary })),
    ];
    const input: QaInputTicket[] = open.filter((ticket) => !ticket.carried).map((ticket) => ({
      key: ticket.key, summary: ticket.summary, ac: ticket.ac, endDay: ticket.end,
      waitsOn: [...new Set([...ticket.dependsOn, ...view.findings.filter((finding) => finding.key === ticket.key).map((finding) => finding.refKey)])]
        .map((key) => ({ key, endDay: ends.get(key) ?? null })),
      links: linksOf(ticket.key, ticket.dependsOn),
    }));
    const run = input.length ? await this.predict(input) : { predictions: new Map<string, QaPrediction>(), reason: null };
    const stored = run.predictions ? new Map([...run.predictions.entries()].map(([key, prediction]) => [key, JSON.stringify(prediction)])) : null;
    await this.store.saveSprintDraftPredictions(sprint, stored, run.reason);
    return (await this.view(sprint))!;
  }

  async updateTicket(sprint: string, key: string, change: { dev?: string | null; wave?: number | null; sp?: number | null; ac?: string[] | null }): Promise<DraftView> {
    await this.mayEdit();
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

  /** Hands cards to another developer in the draft only; Publish writes the assignee to Jira. */
  async moveCards(sprint: string, keys: string[], to: string): Promise<DraftView> {
    await this.mayEdit();
    const row = await this.row(sprint);
    if (row.status === 'published') throw new SprintInputError('This draft is published; load it from Jira again to change it');
    const dev = to.trim().slice(0, 120);
    if (!dev) throw new SprintInputError('to is required');
    if (!keys.length) throw new SprintInputError('keys is required');
    const missing = keys.find((key) => !row.tickets.some((ticket) => ticket.key === key));
    if (missing) throw new SprintInputError(`${missing} is not in the ${sprint} draft`);
    for (const key of new Set(keys)) await this.store.updateSprintDraftTicket(sprint, key, { dev });
    return (await this.view(sprint))!;
  }

  /** Drafts a new ticket (no id) or changes one; Publish creates it in Jira. Fields left out of the input stay as they are. */
  async saveNewTicket(sprint: string, id: string | null, input: unknown): Promise<{ id: string; view: DraftView }> {
    await this.mayEdit();
    const row = await this.row(sprint);
    if (row.status === 'published') throw new SprintInputError('This draft is published; load it from Jira again to change it');
    const data = parseNewTicket(input);
    const existing = row.newTickets ?? [];
    if (!id) {
      if (existing.length >= MAX_NEW_TICKETS) throw new SprintInputError(`A sprint holds at most ${MAX_NEW_TICKETS} new tickets`);
      const created = await this.store.addSprintDraftNewTicket(sprint, {
        summary: '', type: 'Task', epic: null, dev: null, sp: null, priority: null, userStory: '', problem: '', ac: '[]', reference: null, source: 'manual', ...data,
      });
      return { id: created, view: (await this.view(sprint))! };
    }
    const ticket = existing.find((item) => item.id === id);
    if (!ticket) throw new SprintInputError(`${id} is not a new ticket of the ${sprint} draft`);
    if (ticket.createdKey) throw new SprintInputError(`${id} is already created in Jira as ${ticket.createdKey}`);
    await this.store.updateSprintDraftNewTicket(sprint, id, data);
    return { id, view: (await this.view(sprint))! };
  }

  async removeNewTicket(sprint: string, id: string): Promise<DraftView> {
    await this.mayEdit();
    const row = await this.row(sprint);
    if (!NEW_TICKET_ID.test(id) || !(row.newTickets ?? []).some((item) => item.id === id)) throw new SprintInputError(`${id} is not a new ticket of the ${sprint} draft`);
    await this.store.removeSprintDraftNewTicket(sprint, id);
    return (await this.view(sprint))!;
  }

  /**
   * Saves the pending revision of a ticket that exists in Jira, replacing the one before. The before snapshot and Jira's
   * updated timestamp are read now; an edit from the panel (origin manual) keeps the snapshot of the revision it edits.
   */
  async saveRevision(sprint: string, key: string, input: unknown, origin: 'chat' | 'manual'): Promise<{ revision: DraftRevision; view: DraftView }> {
    await this.mayEdit();
    const row = await this.row(sprint);
    const ticket = revisionKey(key);
    const { after, note, source } = parseRevision(input);
    const names = REVISION_FIELDS.map((field) => field.name).filter((name) => after[name] !== undefined);
    if (!names.length) throw new SprintInputError('A revision changes at least one field');
    const revisions = row.revisions ?? [];
    const pending = revisions.find((item) => item.key === ticket && item.status === 'pending');
    if (!pending && revisions.filter((item) => item.status === 'pending').length >= MAX_PENDING_REVISIONS) throw new SprintInputError(`A sprint holds at most ${MAX_PENDING_REVISIONS} pending revisions`);
    const issue = await this.revisionIssue(await this.jira(), ticket);
    const edit = origin === 'manual' && !!pending;
    const kept = edit ? parse<Record<string, string[]>>(pending!.before, {}) : {};
    await this.store.saveSprintDraftRevision(sprint, ticket, {
      summary: issue.summary || ticket,
      note: note !== undefined ? note : edit ? pending!.note ?? null : null,
      source: source ?? (edit ? pending!.source : origin),
      after: JSON.stringify(Object.fromEntries(names.map((name) => [name, after[name]]))),
      before: JSON.stringify(Object.fromEntries(names.map((name) => [name, kept[name] ?? jiraLines(issue, name)]))),
      jiraUpdated: edit ? pending!.jiraUpdated : issue.updated,
      error: null,
      ...(edit ? {} : { createdAt: this.now() }),
    });
    const view = (await this.view(sprint))!;
    return { revision: view.revisions.find((item) => item.key === ticket && item.status === 'pending')!, view };
  }

  /**
   * Writes the pending revision to Jira: refused when the ticket changed in Jira after the revision was written, and only
   * the fields that still differ are sent. A failure stays on the revision, which stays pending.
   */
  async applyRevision(sprint: string, key: string, by: string | null, flag?: unknown): Promise<PublishResult> {
    await this.mayEdit();
    const row = await this.row(sprint);
    const ticket = revisionKey(key);
    const pending = this.pendingRevision(row, ticket, sprint);
    const after = parse<RevisionAfter>(pending.after, {});
    const reason = this.flagInput(flag);
    const lint = (await this.view(sprint))!.revisions.find((item) => item.key === ticket && item.status === 'pending')?.lint;
    const blocked = !!lint && !lint.ok;
    if (blocked && !reason) {
      const detail = writingRefusal(lint!)!;
      await this.store.updateSprintDraftRevision(pending.id, { error: detail });
      return { key: ticket, kind: 'revision', status: 'refused', detail };
    }
    const jira = await this.jira();
    let issue: RevisionIssue;
    let fields: Record<string, unknown> = {};
    let refused: string | null = null;
    try {
      issue = await this.revisionIssue(jira, ticket);
      if (issue.updated !== pending.jiraUpdated) refused = `${ticket} changed in Jira after this revision was written; ask the agent to write it again`;
      else {
        fields = revisionEdit(issue, after);
        if (Object.keys(fields).length) {
          if (!jira.editIssue) throw new Error('This Jira connection cannot edit tickets');
          await jira.editIssue(ticket, fields);
        }
        if (blocked && !refused) {
          if (!jira.addLabel) throw new Error('This Jira connection cannot add a label');
          await jira.addLabel(ticket, WRITING_FLAG_LABEL);
        }
      }
    } catch (error) {
      const detail = error instanceof SprintInputError ? error.message : jiraFailure(error);
      await this.store.updateSprintDraftRevision(pending.id, { error: detail.slice(0, MAX_LINE) });
      return { key: ticket, kind: 'revision', status: 'failed', detail };
    }
    if (refused) {
      await this.store.updateSprintDraftRevision(pending.id, { error: refused });
      return { key: ticket, kind: 'revision', status: 'refused', detail: refused };
    }
    await this.store.updateSprintDraftRevision(pending.id, {
      status: 'applied', appliedAt: this.now(), appliedBy: by, error: null, ...(blocked ? { flagReason: reason } : {}), summary: typeof after.summary === 'string' ? after.summary : issue.summary || ticket,
    });
    if (fields[AC_FIELD] !== undefined && row.tickets.some((item) => item.key === ticket)) {
      const ac = acValueLines(fields[AC_FIELD]);
      await this.store.updateSprintDraftTicket(sprint, ticket, { ac, jiraAc: ac });
    }
    const written = REVISION_FIELDS.filter(({ field }) => field in fields).map(({ label }) => label);
    return { key: ticket, kind: 'revision', status: 'updated', detail: written.length ? `${written.join(', ')} written to Jira` : 'Jira already holds these values' };
  }

  /** Discards the pending revision; it is kept as history and left out of the draft. */
  async discardRevision(sprint: string, key: string): Promise<DraftView> {
    await this.mayEdit();
    const row = await this.row(sprint);
    const pending = this.pendingRevision(row, revisionKey(key), sprint);
    await this.store.updateSprintDraftRevision(pending.id, { status: 'discarded' });
    return (await this.view(sprint))!;
  }

  private pendingRevision(row: DraftRow, key: string, sprint: string): RevisionRow {
    const pending = (row.revisions ?? []).find((item) => item.key === key && item.status === 'pending');
    if (!pending) throw new SprintInputError(`${key} has no pending revision in the ${sprint} draft`);
    return pending;
  }

  private async revisionIssue(jira: DraftJira, key: string): Promise<RevisionIssue> {
    if (!jira.revisionIssue) throw new SprintInputError('This Jira connection cannot read ticket fields');
    const issue = await jira.revisionIssue(key);
    if (!issue) throw new SprintInputError(`${key} is not in Jira`);
    return issue;
  }

  /** Records, changes or clears (action "clear") the planner's call on an AC finding, an ESCALATED prediction or the scope cut. */
  async decide(sprint: string, id: string, action: string, note: string | null, by: string | null): Promise<DraftView> {
    await this.mayEdit();
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
        action = acAction(action);
        if (!AC_ACTIONS.includes(action)) throw new SprintInputError('An AC line naming another ticket is a dependency, moves to Reference, or moves to the ticket that builds it');
        if (action === 'move' && !openTickets(view).some((ticket) => ticket.key === finding.refKey)) throw new SprintInputError(`${finding.refKey} is not in this sprint; make the line a dependency or move it to Reference`);
      } else if (id.startsWith('tc|')) {
        const ticket = openTickets(view).find((item) => tcId(item.key) === id);
        if (!ticket) throw new SprintInputError('That ticket is not in the draft');
        if (action !== 'approve') throw new SprintInputError('Test cases are approved with action approve');
        if (!ticket.tcs.length) throw new SprintInputError(`${ticket.key} has no test cases to approve`);
      } else if (id.startsWith('sb|')) {
        if (!openTickets(view).some((ticket) => ticket.storyboard && storyboardId(ticket.key, ticket.storyboard.version) === id)) throw new SprintInputError('No storyboard change on that ticket');
        if (action !== 'checked') throw new SprintInputError('A storyboard change is marked checked');
      } else if (id.startsWith('sbnone|')) {
        const epic = id.slice('sbnone|'.length);
        if (!epic || !(view.tickets.some((ticket) => ticket.epic === epic) || view.storyboards.some((board) => board.epic === epic))) throw new SprintInputError(`No ticket of ${sprint} belongs to ${epic || 'that epic'}`);
        if (action !== 'none') throw new SprintInputError('An epic without a storyboard is marked with action none');
      } else if (id === SCOPE_CUT_ID) {
        if (action !== 'cut') throw new SprintInputError('A scope cut is written with action cut');
        if (!text) throw new SprintInputError('Write what leaves the sprint');
      } else if (id.startsWith('qa|')) {
        if (!openTickets(view).some((ticket) => qaId(ticket.key) === id && ticket.prediction)) throw new SprintInputError('No QA prediction for that ticket');
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
    await this.mayEdit();
    const row = await this.row(sprint);
    const ticket = row.tickets.find((item) => item.key === key);
    if (!ticket) throw new SprintInputError(`${key} is not in the ${sprint} draft`);
    const tcs = parseTcs(input, parse<string[]>(ticket.ac, []).length);
    await this.store.updateSprintDraftTicket(sprint, key, { tcs: JSON.stringify(tcs), tcAt: this.now() });
    return (await this.view(sprint))!;
  }

  /** Adds an open question to the draft; the same open text is asked once. `options` are the quick replies the chat offers. */
  async ask(sprint: string, text: string, key: string | null, options: string[] = []): Promise<DraftView> {
    const row = await this.row(sprint);
    const question = text.trim().slice(0, MAX_LINE);
    if (!question) throw new SprintInputError('text is required');
    const ticket = key?.trim().toUpperCase() || null;
    if (ticket && !TICKET_KEY.test(ticket)) throw new SprintInputError('key must be a ticket key such as QRD-1312');
    const questions = parse<DraftQuestion[]>(row.questions, []);
    if (!questions.some((item) => !item.answered && item.text === question && item.key === ticket)) {
      if (questions.length >= MAX_QUESTIONS) throw new SprintInputError(`A draft holds at most ${MAX_QUESTIONS} questions`);
      const at = this.now().toISOString();
      const quick = [...new Set(options.map((option) => String(option).trim().slice(0, 200)).filter(Boolean))].slice(0, 4);
      questions.push({ id: `q${questions.length + 1}-${Date.parse(at).toString(36)}`, text: question, key: ticket, askedAt: at, answered: false, answeredBy: null, answeredAt: null, answer: null, ...(quick.length ? { options: quick } : {}) });
      await this.store.updateSprintDraft(sprint, { questions: JSON.stringify(questions) });
    }
    return (await this.view(sprint))!;
  }

  /**
   * Marks a question answered, or open again. An answer with `text` (from the planning chat) is also kept as the draft
   * decision q|<id> and posted as a comment on the question's ticket; publish writes it to the contract's decisions.
   */
  async answer(sprint: string, id: string, answered: boolean, by: string | null, text: string | null = null): Promise<DraftView> {
    await this.mayEdit();
    const row = await this.row(sprint);
    const questions = parse<DraftQuestion[]>(row.questions, []);
    const question = questions.find((item) => item.id === id);
    if (!question) throw new SprintInputError('No such question in the draft');
    const reply = answered ? text?.trim().slice(0, MAX_LINE) || null : null;
    const at = this.now().toISOString();
    Object.assign(question, answered ? { answered: true, answeredBy: by, answeredAt: at, answer: reply } : { answered: false, answeredBy: null, answeredAt: null, answer: null });
    const decisions = parse<Decisions>(row.decisions, {});
    if (reply) decisions[`q|${id}`] = { action: 'answer', note: reply, by, at };
    else delete decisions[`q|${id}`];
    await this.store.updateSprintDraft(sprint, { questions: JSON.stringify(questions), decisions: JSON.stringify(decisions) });
    if (reply && question.key) {
      const jira = await this.jira();
      if (jira.comment) await jira.comment(question.key, [`Planning ${sprint}: ${question.text}`, `Keputusan: ${reply}`, ...(by ? [`Dijawab oleh ${by} di DOCK Planning.`] : [])]);
    }
    return (await this.view(sprint))!;
  }

  /** Reads the newest storyboard of every epic of the draft; an epic without one says why, and nothing else stops. */
  async checkStoryboards(sprint: string): Promise<DraftView> {
    const row = await this.row(sprint);
    if (!this.storyboard) return (await this.view(sprint))!;
    const epics = [...new Set(row.tickets.filter((ticket) => !ticket.carried).map((ticket) => ticket.epic).filter((epic): epic is string => !!epic))].sort();
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
      scenarios: result.scenarios ?? [], tickets: result.tickets ?? {},
    };
  }

  /** The changes Publish would write, each ticket read from Jira again; nothing is written. */
  async preview(sprint: string): Promise<DraftChange[]> {
    const changes = (await this.plannedChanges(sprint)).map(({ change }) => change);
    return [...changes, ...this.plannedCreates(await this.row(sprint))];
  }

  /** One change per new ticket not created yet; refused while a required field is empty. */
  private plannedCreates(row: DraftRow): DraftChange[] {
    return (row.newTickets ?? []).map(newTicketView).filter((ticket) => !ticket.createdKey).map((ticket) => ({
      key: ticket.id, assigneeFrom: null, assigneeTo: null, acRemoved: [], acAdded: [], referenceAdded: [], blockedBy: [], testsFor: [], pairWarning: null, refused: newTicketRefusal(ticket) ?? (ticket.flagReason ? null : writingRefusal(ticket.lint)), create: ticket,
    }));
  }

  /** Creates each new ticket in the sprint's project; one failure never stops the others. */
  /** Creates new tickets in Jira on their own, without publishing the plan; ids null takes every one not created yet. */
  async createNewTicketsOnly(sprint: string, ids: string[] | null, flag?: unknown): Promise<PublishResult[]> {
    await this.mayEdit();
    const reason = this.flagInput(flag);
    const open = this.plannedCreates(await this.row(sprint)).map((change) => change.create!.id);
    const unknown = (ids ?? []).filter((id) => !open.includes(id));
    if (unknown.length) throw new SprintInputError(`${unknown.join(', ')} is not a new ticket of the ${sprint} draft waiting to be created`);
    if (!open.length) throw new SprintInputError(`The ${sprint} draft has no new ticket waiting to be created`);
    return this.createNewTickets(sprint, await this.jira(), ids, reason);
  }

  /** The reason of a flag the panel sends; refused when it is not 5 to 300 characters. */
  private flagInput(flag: unknown): string | null {
    if (flag === undefined || flag === null) return null;
    const reason = flagReason(flag);
    if (!reason) throw new SprintInputError('The flag reason is 5 to 300 characters');
    return reason;
  }

  private async createNewTickets(sprint: string, jira: DraftJira, ids: string[] | null = null, reason: string | null = null): Promise<PublishResult[]> {
    if (reason) {
      for (const item of (await this.row(sprint)).newTickets ?? []) {
        if (!item.createdKey && (!ids || ids.includes(item.id)) && !newTicketView(item).lint.ok) await this.store.updateSprintDraftNewTicket(sprint, item.id, { flagReason: reason });
      }
    }
    const row = await this.row(sprint);
    const project = sprintProject(row.tickets.map((ticket) => ticket.key));
    const results: PublishResult[] = [];
    for (const change of this.plannedCreates(row).filter((item) => !ids || ids.includes(item.create!.id))) {
      const ticket = change.create!;
      if (change.refused) {
        await this.store.updateSprintDraftNewTicket(sprint, ticket.id, { error: change.refused });
        results.push({ key: ticket.id, kind: 'create', status: 'refused', detail: change.refused });
        continue;
      }
      try {
        if (!jira.createIssue) throw new Error('This Jira connection cannot create tickets');
        let accountId: string | null = null;
        let note: string | null = null;
        if (ticket.dev) {
          const accounts = jira.projectAccounts ? await jira.projectAccounts(project, ticket.dev).catch(() => [] as string[]) : [];
          if (accounts.length === 1) accountId = accounts[0];
          else note = accounts.length ? `created unassigned: more than one Jira user is named ${ticket.dev}` : `created unassigned: no assignable Jira user is named ${ticket.dev}`;
        }
        const key = await jira.createIssue(newTicketFields(ticket, project, row.sprintId, accountId, !ticket.lint.ok && !!ticket.flagReason));
        await this.store.updateSprintDraftNewTicket(sprint, ticket.id, { createdKey: key, error: null });
        results.push({ key: ticket.id, kind: 'create', status: 'created', detail: note ? `${key}; ${note}` : key });
      } catch (error: any) {
        const status = error?.response?.status;
        const message = jiraErrorText(error);
        const detail = status ? `Jira responded ${status}: ${message}` : message;
        await this.store.updateSprintDraftNewTicket(sprint, ticket.id, { error: detail.slice(0, MAX_LINE) });
        results.push({ key: ticket.id, kind: 'create', status: 'failed', detail });
      }
    }
    return results;
  }

  private async plannedChanges(sprint: string): Promise<Array<{ change: DraftChange; final: string[]; dev: string | null; now: PlanningIssue | null; testType: string | null }>> {
    const row = await this.row(sprint);
    const decisions = parse<Decisions>(row.decisions, {});
    const tickets = row.tickets.map((ticket) => ({ ...ticket, ac: parse<string[]>(ticket.ac, []), jiraAc: parse<string[]>(ticket.jiraAc, []) }));
    const finals = finalAc(tickets, decisions);
    const sides = acSideEffects(tickets, decisions);
    const touched = tickets.filter((ticket) => !sameLines(finals.get(ticket.key)!, ticket.jiraAc) || (!!ticket.dev && ticket.dev !== ticket.jiraDev)
      || sides.get(ticket.key)!.reference.length > 0 || sides.get(ticket.key)!.blockedBy.length > 0);
    const jira = touched.length ? await this.jira() : null;
    const drafted = new Map(tickets.map((ticket) => [ticket.key, ticket]));
    let testType: Promise<string | null> | null = null;
    const linkType = () => (testType ??= jira!.testLinkType!().catch(() => null));
    const repoOf = async (key: string) => {
      const draft = drafted.get(key);
      if (draft) return ticketRepo(draft.summary, draft.description);
      const issue = await jira!.issueNow(key).catch(() => null);
      return issue ? ticketRepo(issue.summary, fieldLines(issue.descriptionRaw).join('\n')) : null;
    };
    return mapLimit(touched, READ_CONCURRENCY, async (ticket) => {
      const final = finals.get(ticket.key)!;
      const now = await jira!.issueNow(ticket.key);
      const nowLines = now ? acValueLines(now.acRaw) : [];
      const { removed, added } = diffLines(nowLines, final);
      const nowDev = now?.assignee ?? null;
      const assign = !!ticket.dev && ticket.dev !== nowDev;
      const side = sides.get(ticket.key)!;
      const referenceNow = now ? fieldLines(now.referenceRaw).map(normalizeAcLine) : [];
      const referenceAdded = side.reference.filter((line) => !referenceNow.includes(line));
      const linked = new Set((now?.links ?? []).filter((link) => link.relation === 'blockedBy').map((link) => link.key));
      const blockedBy = side.blockedBy.filter((key) => !linked.has(key));
      let testsFor: string[] = [];
      let pairWarning: string | null = null;
      let pairType: string | null = null;
      if (now && blockedBy.length && jira!.testLinkType && jira!.addTestLink && ticketRepo(now.summary, fieldLines(now.descriptionRaw).join('\n')) === 'FE') {
        const pairs = (await Promise.all(blockedBy.map(async (key) => ((await repoOf(key)) === 'BE' ? key : null)))).filter((key): key is string => !!key);
        if (pairs.length) {
          pairType = await linkType();
          if (pairType) testsFor = pairs;
          else pairWarning = TEST_LINK_MISSING;
        }
      }
      let refused: string | null = null;
      if (!now) refused = 'The ticket is gone from Jira';
      else if (!sameLines(nowLines, ticket.jiraAc) && (removed.length || added.length || referenceAdded.length || blockedBy.length)) refused = 'The AC changed in Jira after it was loaded; load the sprint again';
      return {
        change: { key: ticket.key, assigneeFrom: assign ? nowDev : null, assigneeTo: assign ? ticket.dev : null, acRemoved: removed, acAdded: added, referenceAdded, blockedBy, testsFor, pairWarning, refused },
        final, dev: ticket.dev, now, testType: pairType,
      };
    }).then((rows) => rows.filter(({ change }) => change.refused || change.assigneeTo || change.acRemoved.length || change.acAdded.length || change.referenceAdded.length || change.blockedBy.length));
  }

  /** Writes the previewed changes ticket by ticket, then the contract page. An open blocker is shown in the dialog, never refused. */
  async publish(sprint: string, by: string | null = null): Promise<PublishResult[]> {
    await this.mayEdit();
    const view = (await this.view(sprint));
    if (!view) throw new SprintInputError(`No draft for ${sprint}; load it from Jira first`);
    const jira = await this.jira();
    const results: PublishResult[] = [];
    const links: PublishResult[] = [];
    for (const { change, final, dev, now, testType } of await this.plannedChanges(sprint)) {
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
        if (change.referenceAdded.length && !jira.setReference) throw new Error('This Jira connection cannot write the Reference field');
        if (change.blockedBy.length && !jira.addBlockedBy) throw new Error('This Jira connection cannot add a Blocks link');
        if (change.referenceAdded.length) await jira.setReference!(change.key, rewriteAcValue(now!.referenceRaw ?? null, [], change.referenceAdded));
        if (change.acRemoved.length || change.acAdded.length) {
          await jira.setAc(change.key, rewriteAcValue(now!.acRaw, change.acRemoved, change.acAdded));
          update.jiraAc = final;
        }
        for (const blocker of change.blockedBy) await jira.addBlockedBy!(change.key, blocker);
        for (const tested of change.testsFor) {
          try {
            await jira.addTestLink!(change.key, tested, testType!);
            links.push({ key: change.key, kind: 'link', status: 'created', detail: `${change.key} tests ${tested}` });
          } catch (error: any) {
            const status = error?.response?.status;
            const message = error instanceof Error ? error.message : String(error);
            links.push({ key: change.key, kind: 'link', status: 'failed', detail: `${change.key} tests ${tested}: ${status ? `Jira responded ${status}: ${message}` : message}` });
          }
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
    results.push(...links);
    const creates = await this.createNewTickets(sprint, jira);
    results.push(...creates);
    const written = tickets.every((result) => result.status === 'updated') && creates.every((result) => result.status === 'created');
    // A newer set of test cases is a new comment; the QA bot reads the latest one.
    for (const ticket of openTickets((await this.view(sprint))!).filter((item) => item.tcPending)) {
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
    // Every ticket of the draft carries the label, merged ones too: a ticket without it joined the sprint after publish.
    const current = (await this.view(sprint))!;
    const keys = [...new Set([...current.tickets.map((ticket) => ticket.key), ...current.newTickets.map((ticket) => ticket.createdKey).filter((key): key is string => !!key)])];
    const labelled = await this.publishLabels(jira, view.sprintId, keys, written);
    if (labelled) results.push(labelled);
    const flagged = await this.flagLabels(jira, view.sprintId, openTickets(current).filter((ticket) => !ticket.lint.ok).map((ticket) => ticket.key));
    if (flagged) results.push(flagged);
    const target = await this.contract().catch((): ContractTarget => ({ client: null, parentId: null }));
    const published = (await this.view(sprint))!;
    const contract = await writeContract(target.client, target.parentId, { ...published, tickets: openTickets(published) }, by, this.now());
    results.push({ key: 'Confluence', kind: 'contract', status: contract.status, detail: contract.detail });
    if (written && labelled?.status !== 'failed') {
      await this.store.updateSprintDraft(sprint, { status: 'published', publishedAt: this.now() });
      if (this.afterPublish) await this.afterPublish(sprint).catch(() => null);
    }
    return results;
  }

  /** WRITING-FLAG on each open ticket of the plan that fails a block rule of the writing standard; a ticket that already has it is left alone. */
  private async flagLabels(jira: DraftJira, sprintId: number, keys: string[]): Promise<PublishResult | null> {
    if (!jira.addLabel || !keys.length) return null;
    const issues = await jira.sprintIssues(sprintId);
    const have = new Set(issues.filter((issue) => (issue.labels ?? []).includes(WRITING_FLAG_LABEL)).map((issue) => issue.key));
    const todo = keys.filter((key) => !have.has(key));
    const failed: string[] = [];
    await mapLimit(todo, READ_CONCURRENCY, async (key) => {
      try {
        await jira.addLabel!(key, WRITING_FLAG_LABEL);
      } catch {
        failed.push(key);
      }
    });
    if (failed.length) return { key: 'Writing flag', kind: 'label', status: 'failed', detail: `${WRITING_FLAG_LABEL} could not be set on ${failed.sort().join(', ')}` };
    return { key: 'Writing flag', kind: 'label', status: 'updated', detail: `${WRITING_FLAG_LABEL} on ${keys.join(', ')} (below the writing standard)` };
  }

  /**
   * The publish signal every DOCK reads: plan-published-r<N> on each ticket of the plan, N one past the highest
   * revision the sprint carries, and older plan labels taken off. Skipped while a ticket write failed, so a half-written
   * plan never looks published to the developers.
   */
  private async publishLabels(jira: DraftJira, sprintId: number, keys: string[], ready: boolean): Promise<PublishResult | null> {
    if (!jira.addLabel) return null;
    if (!ready) return { key: 'Jira labels', kind: 'label', status: 'skipped', detail: 'A ticket was not written; the plan label waits for a publish that writes every ticket' };
    if (!keys.length) return { key: 'Jira labels', kind: 'label', status: 'skipped', detail: 'No open ticket to label' };
    const issues = await jira.sprintIssues(sprintId);
    const revision = (sprintRevision(issues) ?? 0) + 1;
    const label = planLabel(revision);
    const labelsOf = new Map(issues.map((issue) => [issue.key, issue.labels ?? []]));
    const failed: string[] = [];
    await mapLimit(keys, READ_CONCURRENCY, async (key) => {
      try {
        await jira.addLabel!(key, label);
        for (const stale of stalePlanLabels(labelsOf.get(key), revision)) await jira.removeLabel?.(key, stale);
      } catch {
        failed.push(key);
      }
    });
    if (failed.length) return { key: 'Jira labels', kind: 'label', status: 'failed', detail: `${label} could not be set on ${failed.sort().join(', ')}` };
    return { key: 'Jira labels', kind: 'label', status: 'updated', detail: `${label} on ${keys.length} ${keys.length === 1 ? 'ticket' : 'tickets'}` };
  }
}
