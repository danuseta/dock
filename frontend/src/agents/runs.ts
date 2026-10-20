import { machineOf } from '../chat/messages';
import { poseOf, slotFromServer, type Pose } from './office/activity';

export interface AgentAc { n: number; state: string; text: string; evidence?: string | null }
export interface AgentEvent { id: string; kind: string; detail?: string | null; at: string }

export interface TimelineAgent {
  id: string;
  parentId?: string | null;
  name: string;
  detail?: string | null;
  state: string;
  tool?: string | null;
  tools: number;
}

export type RunKind = 'build' | 'review' | 'card';

/** A decision in the ledger, D-n; entries from before sous have no n, status or by. */
export interface AgentDecision { n?: number | null; at: string; text: string; status?: string | null; by?: string | null; issue?: number | null; cancelNote?: string | null }
/** An issue raised during the run, I-n; level owner means it waits on the owner. */
export interface AgentIssue { n: number; at: string; type: string; text: string; level: string; status: string; resolvedBy?: number | null; resolvedAt?: string | null; options: string[] }

export interface AgentPullRequest { url: string; number: number; repo: string; status: string; reviewDecision?: string | null; checks?: string | null }

export interface AgentRun {
  key: string;
  kind?: RunKind | string;
  title: string;
  stage: string;
  waiting?: string | null;
  gate?: string | null;
  ac: AgentAc[];
  acPassed: number;
  acFailed: number;
  acTotal: number;
  testsBe?: string | null;
  testsFe?: string | null;
  prBe?: string | null;
  prFe?: string | null;
  pullRequests?: AgentPullRequest[];
  review?: 'open' | 'merged' | null;
  reviewSignal?: 'changes_requested' | 'checks_failing' | 'checks_pending' | 'approved' | null;
  finished?: boolean;
  note?: string | null;
  brief?: string | null;
  decisions?: AgentDecision[];
  assumptions?: { n: number; text: string; falsifier: string; state: string; evidence?: string | null }[];
  failures?: { at: string; type: string; what?: string | null; evidence: string; attempt: number }[];
  closing?: { hours?: number | null; fixRounds: number; replans: number } | null;
  findings?: { at: string; severity: string; text: string }[];
  lgtm?: { at: string; text: string }[];
  verdict?: 'approve' | 'request-change' | null;
  engine?: string | null;
  rounds?: { used: number; max: number } | null;
  productionData?: boolean | null;
  draft?: boolean | null;
  issues?: AgentIssue[];
  /** Every step of the owner's last review approval succeeded. */
  approved?: boolean;
  blockers?: number;
  activity: string;
  activityDetail?: string | null;
  idleSeconds: number;
  endedSeconds?: number | null;
  stalled: boolean;
  hasTranscript: boolean;
  machine?: string | null;
  remote?: boolean;
  handoverTo?: string | null;
  handoverAt?: string | null;
  updatedAt: string;
  events?: AgentEvent[];
  members?: TimelineAgent[];
  sample?: boolean;
}

export interface AgentTimeline {
  stageIndex: number;
  round: number;
  loopFrom?: number | null;
  loopTo?: number | null;
  gates: Array<{ id: string; stageIndex: number; text: string; state: string; at: string }>;
  agents: TimelineAgent[];
  buckets: Array<{ n: number; gate: boolean }>;
  totalTools: number;
  log: Array<{ at: string; kind: string; head: string; text: string }>;
}

/** The six stops of the flow graph's rail; evidence and commit share Verify. */
export const FLOW_RAIL = [
  { id: 'gate', name: 'Gate', color: '#9aa0aa' },
  { id: 'plan', name: 'Plan', color: '#8c9bf0' },
  { id: 'code', name: 'Code', color: '#e8c56c' },
  { id: 'test', name: 'Test', color: '#62cf9f' },
  { id: 'verify', name: 'Verify', color: '#5cc0e0' },
  { id: 'pr', name: 'PR', color: '#62cf9f' },
] as const;

export type AgentRunSummary = Pick<AgentRun, 'key' | 'stage' | 'waiting' | 'acPassed' | 'acFailed' | 'acTotal' | 'activity' | 'stalled' | 'finished' | 'machine' | 'kind'>;

/** A review run reads as Review, a free form card as Card; a build run, or one that does not say, is a Task. */
export const kindLabel = (kind?: string | null) => (kind === 'review' ? 'Review' : kind === 'card' ? 'Card' : 'Task');

export const FILTER_MACHINES = ['laptop', 'workspace'] as const;
export const FILTER_KINDS = ['review', 'task', 'card'] as const;
export interface RunFilter { machine: typeof FILTER_MACHINES[number] | null; kind: typeof FILTER_KINDS[number] | null }

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (allowed.includes(value as T) ? value as T : null);

/** The Agents filter as the URL keeps it: `?machine=laptop&kind=review`; anything else means all. */
export function runFilterFromSearch(search: string): RunFilter {
  const params = new URLSearchParams(search);
  return { machine: pick(params.get('machine'), FILTER_MACHINES), kind: pick(params.get('kind'), FILTER_KINDS) };
}

/** The query string for a filter, keeping any other parameter the URL already has. */
export function runFilterSearch(search: string, filter: RunFilter): string {
  const params = new URLSearchParams(search);
  for (const name of ['machine', 'kind'] as const) {
    if (filter[name]) params.set(name, filter[name]!);
    else params.delete(name);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const matchesRunFilter = (run: Pick<AgentRun, 'machine' | 'kind'>, filter: RunFilter) => (
  (!filter.machine || machineOf(run) === filter.machine)
  && (!filter.kind || filter.kind === (run.kind === 'review' || run.kind === 'card' ? run.kind : 'task'))
);

export const STAGE_LABEL: Record<string, string> = {
  gate: 'Gate', plan: 'Plan', code: 'Code', test: 'Test', verify: 'Verify',
  evidence: 'Evidence', commit: 'Commit', pr: 'PR', done: 'Done', blocked: 'Blocked',
};

export const STAGE_COLOR: Record<string, string> = {
  gate: '#9aa0aa', plan: '#8c9bf0', code: '#e8c56c', test: '#62cf9f', verify: '#5cc0e0',
  evidence: '#5cc0e0', commit: '#5cc0e0', pr: '#5cc0e0', done: '#62cf9f', blocked: '#d9695a',
};

export const stageLabel = (stage: string) => STAGE_LABEL[stage] ?? stage;

/** A review walks the same rail as a build but its stops mean different things. */
const REVIEW_LABEL: Record<string, string> = {
  gate: 'Brief', plan: 'Plan', code: 'Review', test: 'Test', verify: 'Evidence', evidence: 'Evidence', commit: 'Verdict', pr: 'Verdict', done: 'Done', blocked: 'Blocked',
};
export const stageName = (stage: string, kind?: string) => (kind === 'review' ? REVIEW_LABEL[stage] : undefined) ?? stageLabel(stage);

/**
 * The lead hands each ticket to one sub-coordinator, which spawns the members.
 * When a ticket has no such agent, the lead is handling it directly and every
 * spawned agent counts as a member.
 */
export function splitTeam(agents?: TimelineAgent[] | null): { coordinator: TimelineAgent | null; members: TimelineAgent[] } {
  const all = (agents || []).filter((agent) => agent.parentId);
  const top = all.filter((agent) => agent.parentId === 'main');
  const coordinator = top.find((agent) => all.some((other) => other.parentId === agent.id))
    || top.find((agent) => /^coord/i.test(agent.name))
    || null;
  return { coordinator, members: all.filter((agent) => agent !== coordinator) };
}
export const stageColor = (stage: string) => STAGE_COLOR[stage] ?? '#9aa0aa';

export function formatAge(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export type RunStatus = 'waiting' | 'failed' | 'stalled' | 'working' | 'review' | 'changes_requested' | 'checks_failing' | 'thinking' | 'asleep' | 'done';

export const STATUS_LABEL: Record<RunStatus, string> = {
  waiting: 'Waiting on you',
  failed: 'AC failed',
  stalled: 'Stalled',
  working: 'Working',
  review: 'In review',
  changes_requested: 'Changes requested',
  checks_failing: 'CI failing',
  thinking: 'Thinking',
  asleep: 'Idle',
  done: 'Done',
};

const POSE_STATUS: Record<Pose, RunStatus> = {
  SeatedTyping: 'working', SeatedWaiting: 'waiting', SeatedThinking: 'thinking', Asleep: 'asleep',
};

export const statusLabel = (status: RunStatus, review?: AgentRun['review']): string => (
  status === 'review' && review === 'merged' ? 'Merged' : STATUS_LABEL[status]
);

/** One word for a run, worst news first. */
export function runStatus(run: Pick<AgentRun, 'stage' | 'waiting' | 'acFailed' | 'stalled' | 'activity' | 'idleSeconds' | 'endedSeconds' | 'review' | 'reviewSignal'>, now: number): RunStatus {
  if (run.stage === 'done') return 'done';
  if (run.review === 'merged') return 'review';
  if (run.waiting) return 'waiting';
  if (run.acFailed > 0) return 'failed';
  if (run.stalled) return 'stalled';
  const status = POSE_STATUS[poseOf(slotFromServer(run, now), now)];
  if (!run.review || status === 'working') return status;
  return run.reviewSignal === 'changes_requested' || run.reviewSignal === 'checks_failing' ? run.reviewSignal : 'review';
}

/** A run that needs someone to act: a failed check, a quiet agent, requested changes or a red CI. */
export const hasTrouble = (run: Pick<AgentRun, 'acFailed' | 'stalled' | 'review' | 'reviewSignal'>): boolean => (
  run.acFailed > 0 || (run.stalled && !run.review) || run.reviewSignal === 'changes_requested' || run.reviewSignal === 'checks_failing'
);

const SHIRT_COLORS = ['#e8c56c', '#8c9bf0', '#62cf9f', '#e08a7a', '#5cc0e0', '#c79bf0', '#f0a35c', '#9ad06a'];

/** Each pod has its own colour, so two tickets side by side never look alike. */
export const podColor = (index: number): string => SHIRT_COLORS[((index % SHIRT_COLORS.length) + SHIRT_COLORS.length) % SHIRT_COLORS.length];

/** A ticket keeps the same shirt across reloads. */
export function shirtColor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return SHIRT_COLORS[hash % SHIRT_COLORS.length];
}

export type RunSortColumn = 'ticket' | 'stage' | 'status' | 'ac' | 'waiting' | 'activity';
export interface RunSort { column: RunSortColumn; descending: boolean }

const STAGE_ORDER = ['gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done'];
const STATUS_ORDER: RunStatus[] = ['waiting', 'failed', 'changes_requested', 'checks_failing', 'stalled', 'working', 'review', 'thinking', 'asleep', 'done'];
const byKey = new Intl.Collator('en', { numeric: true });

/** A finished ticket leaves the working list and is kept in the archive. */
export const isArchived = (run: Pick<AgentRun, 'stage' | 'finished'>): boolean => run.stage === 'done' || run.finished === true;

export function sortRuns<T extends AgentRun>(runs: T[], sort: RunSort, statusOf: (run: T) => RunStatus): T[] {
  const rank = (run: T): number => {
    if (sort.column === 'stage') return STAGE_ORDER.indexOf(run.stage);
    if (sort.column === 'status') return STATUS_ORDER.indexOf(statusOf(run));
    if (sort.column === 'ac') return run.acTotal ? run.acPassed / run.acTotal : -1;
    if (sort.column === 'waiting') return run.waiting ? 0 : 1;
    if (sort.column === 'activity') return run.idleSeconds;
    return 0;
  };
  const direction = sort.descending ? -1 : 1;
  return [...runs].sort((a, b) => (
    (sort.column === 'ticket' ? byKey.compare(a.key, b.key) : rank(a) - rank(b)) * direction || byKey.compare(a.key, b.key)
  ));
}

/** A run as the Agents page uses it: a list the server did not send reads as empty, so a run cached by another query cannot break the page. */
export const completeRun = (run: Omit<AgentRun, 'ac'> & { ac?: AgentAc[] | null }): AgentRun => ({
  ...run,
  ac: run.ac ?? [],
  pullRequests: run.pullRequests ?? [],
  decisions: run.decisions ?? [],
  assumptions: run.assumptions ?? [],
  failures: run.failures ?? [],
  findings: run.findings ?? [],
  lgtm: run.lgtm ?? [],
  members: run.members ?? [],
});

/** What the Agents page offers on a run. A sample offers nothing; a run of another DOCK's machine is only read here. */
export function runActions(run: Pick<AgentRun, 'remote' | 'sample'>) {
  const editable = !run.sample && !run.remote;
  return { hide: editable, confirm: editable, move: editable, chat: editable, replay: !run.remote };
}

/** The machine a ticket is offered to, with the time of the offer. */
export function offerOf(run: Pick<AgentRun, 'handoverTo' | 'handoverAt'>): { to: string; at: string | null; label: string } | null {
  if (!run.handoverTo) return null;
  const at = run.handoverAt ? new Date(run.handoverAt) : null;
  const time = at && !Number.isNaN(at.getTime()) ? at.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  return { to: run.handoverTo, at: run.handoverAt || null, label: time ? `Offered to ${run.handoverTo} · ${time}` : `Offered to ${run.handoverTo}` };
}

/** The machines a ticket can be moved to: every machine but the one that owns it. */
export const moveTargets = (machines: Array<{ name: string; online: boolean }> | null | undefined, current: string): Array<{ name: string; online: boolean }> => (
  (machines || []).filter((machine) => machine.name !== current)
);

export function moveConfirmation(key: string, from: string, to: string, targetOnline: boolean): string {
  const base = `Move ${key} from ${from} to ${to}? The work continues on ${to}, from the commits already pushed. The chat sessions of ${from} do not move with it. Work still running on ${from} is not stopped, and its updates will be ignored.`;
  return targetOnline ? base : `${base} ${to} is offline, so nothing will pick ${key} up until it starts.`;
}

export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: current, pages, from: slice.length ? start + 1 : 0, to: start + slice.length };
}

// The gate the orchestrator cron puts on a ticket it did not start. Must match PARKED_TEXT in backend/bff-graphql/src/integrations/orchestrator-cron.ts.
export const PARKED_TEXT = 'No acceptance criteria on the ticket. Confirm to start anyway, or fill them in.';
// The gate on a cron ticket whose session ended before the agent answered. Must match START_FAILED_TEXT in backend/bff-graphql/src/integrations/orchestrator-cron.ts.
export const START_FAILED_TEXT = 'The cron session ended before the agent answered. Fix the machine, then retry.';

const SEVERITY_ORDER = ['blocker', 'non-blocking', 'nit'];

/** A review's findings as the panel lists them: blockers first, then non-blocking, then nits, each in the order written. */
export const reviewFindings = <T extends { severity: string }>(findings: T[]): T[] => (
  [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
);
