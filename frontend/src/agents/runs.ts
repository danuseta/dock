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

export type RunKind = 'build' | 'review';

export interface AgentPullRequest { url: string; number: number; repo: string; status: string }

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
  note?: string | null;
  activity: string;
  activityDetail?: string | null;
  idleSeconds: number;
  endedSeconds?: number | null;
  stalled: boolean;
  hasTranscript: boolean;
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

export type AgentRunSummary = Pick<AgentRun, 'key' | 'stage' | 'waiting' | 'acPassed' | 'acFailed' | 'acTotal' | 'activity' | 'stalled'>;

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

export type RunStatus = 'waiting' | 'failed' | 'stalled' | 'working' | 'review' | 'thinking' | 'asleep' | 'done';

export const STATUS_LABEL: Record<RunStatus, string> = {
  waiting: 'Waiting on you',
  failed: 'AC failed',
  stalled: 'Stalled',
  working: 'Working',
  review: 'In review',
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
export function runStatus(run: Pick<AgentRun, 'stage' | 'waiting' | 'acFailed' | 'stalled' | 'activity' | 'idleSeconds' | 'endedSeconds' | 'review'>, now: number): RunStatus {
  if (run.stage === 'done') return 'done';
  if (run.waiting) return 'waiting';
  if (run.acFailed > 0) return 'failed';
  if (run.stalled) return 'stalled';
  const status = POSE_STATUS[poseOf(slotFromServer(run, now), now)];
  return run.review && status !== 'working' ? 'review' : status;
}

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
const STATUS_ORDER: RunStatus[] = ['waiting', 'failed', 'stalled', 'working', 'review', 'thinking', 'asleep', 'done'];
const byKey = new Intl.Collator('en', { numeric: true });

/** A finished ticket leaves the working list and is kept in the archive. */
export const isArchived = (run: Pick<AgentRun, 'stage'>): boolean => run.stage === 'done';

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

export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: current, pages, from: slice.length ? start + 1 : 0, to: start + slice.length };
}
