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
  since?: string | null;
  until?: string | null;
}

/** One stop of the rail in one round: when the run was there, and who worked on it. */
export interface TimelineVisit { stageIndex: number; round: number; from?: string | null; to?: string | null; agents: TimelineAgent[] }

export type RunKind = 'build' | 'review' | 'card';

/** A decision in the ledger, D-n; entries from before sous have no n, status or by. */
export interface AgentDecision { n?: number | null; at: string; text: string; status?: string | null; by?: string | null; issue?: number | null; cancelNote?: string | null }
/** An issue raised during the run, I-n; level owner means it waits on the owner. */
export interface AgentIssue { n: number; at: string; type: string; text: string; level: string; status: string; resolvedBy?: number | null; resolvedAt?: string | null; options: string[] }

export interface AgentStackRepo { pr: string; branch?: string | null; base?: string | null; retargetedAt?: string | null }
/** The parent ticket this run's pull requests are stacked on, per repo. */
export interface AgentStack { key: string; be?: AgentStackRepo | null; fe?: AgentStackRepo | null }

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
  stackedOn?: AgentStack | null;
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
  updatedAt: string;
  events?: AgentEvent[];
  members?: TimelineAgent[];
  sample?: boolean;
}

export interface AgentTimeline {
  stageIndex: number;
  /** The run stopped at GATE 1 (a manual run); a cron run has no gate stop. */
  hasGate?: boolean;
  gates: Array<{ id: string; stageIndex: number; text: string; state: string; at: string }>;
  agents: TimelineAgent[];
  /** Every stop the run visited, oldest first; the last is where it is now. */
  visits: TimelineVisit[];
  buckets: Array<{ n: number; gate: boolean }>;
  totalTools: number;
  log: Array<{ at: string; kind: string; head: string; text: string }>;
}

/**
 * The stops of the flow graph's rail, the steps of a sous run: code and test are one task's Work, verify is the
 * FINAL review, commit shares PR. Gate is drawn only when the run stopped at GATE 1. `review` names the stop on a review run.
 */
export const FLOW_RAIL = [
  { id: 'gate', name: 'Gate', review: 'Brief' },
  { id: 'plan', name: 'Plan', review: 'Plan' },
  { id: 'work', name: 'Work', review: 'Work' },
  { id: 'final', name: 'Final review', review: 'Review' },
  { id: 'evidence', name: 'Evidence', review: 'Evidence' },
  { id: 'pr', name: 'PR', review: 'Verdict' },
] as const;

export type AgentRunSummary = Pick<AgentRun, 'key' | 'stage' | 'waiting' | 'acPassed' | 'acFailed' | 'acTotal' | 'activity' | 'stalled' | 'finished' | 'machine' | 'kind'>;

/** A review run reads as Review, a free form CARD-<slug> run (no Jira ticket) as Free task; a build run, or one that does not say, is a Task. */
export const kindLabel = (kind?: string | null) => (kind === 'review' ? 'Review' : kind === 'card' ? 'Free task' : 'Task');

export const FILTER_KINDS = ['review', 'task', 'card'] as const;
export interface RunFilter { kind: typeof FILTER_KINDS[number] | null }

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (allowed.includes(value as T) ? value as T : null);

/** The run a link opens on Agents: `/agents?run=QRD-1412`. */
export const runKeyFromSearch = (search: string): string | null => new URLSearchParams(search).get('run');

/** The Agents filter as the URL keeps it: `?kind=review`; anything else means all. */
export function runFilterFromSearch(search: string): RunFilter {
  return { kind: pick(new URLSearchParams(search).get('kind'), FILTER_KINDS) };
}

/** The query string for a filter, keeping any other parameter the URL already has. */
export function runFilterSearch(search: string, filter: RunFilter): string {
  const params = new URLSearchParams(search);
  if (filter.kind) params.set('kind', filter.kind);
  else params.delete('kind');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const matchesRunFilter = (run: Pick<AgentRun, 'kind'>, filter: RunFilter) => (
  !filter.kind || filter.kind === (run.kind === 'review' || run.kind === 'card' ? run.kind : 'task')
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

/** A review the owner can still LGTM: the runner's verdict is approve and DOCK has not labelled and approved it yet. */
export const canLgtm = (run: Pick<AgentRun, 'kind' | 'verdict' | 'approved' | 'sample'>): boolean => (
  run.kind === 'review' && run.verdict === 'approve' && !run.approved && !run.sample
);

/** What the Agents page offers on a run. A sample offers nothing; the DOCK that only monitors offers no control. */
export function runActions(run: Pick<AgentRun, 'sample'>, monitoring: boolean) {
  const editable = !run.sample && !monitoring;
  return { hide: editable, confirm: editable, chat: editable };
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
