// A sprint's retro of the agents' work: numbers from the runs, recurring problems, a table per ticket, and the
// Keep / Problem / Try lines sous drafts for the owner to accept. Numbers are pure; the lines are stored.
import { OrchestratorInputError, type Orchestration } from './orchestrator';

export const RETRO_KINDS = ['keep', 'problem', 'try'] as const;
export const RETRO_DESTS = ['kit', 'memory', 'dock', 'note'] as const;
export type RetroKind = typeof RETRO_KINDS[number];
export type RetroDest = typeof RETRO_DESTS[number];
export interface RetroDraftItem { kind: RetroKind; text: string; evidence: string[]; dest: RetroDest }
export interface RetroNumbers {
  tickets: number;
  medianHours: number | null;
  fixRounds: number;
  replans: number;
  ownerIssues: number;
  medianOwnerWaitHours: number | null;
  reviews: number;
  requestChanges: number;
}
export interface RetroProblem { label: string; count: number; tickets: string[] }
export interface RetroTicket { key: string; title: string; kind: string; hours: number | null; rounds: number; issues: number; ownerWaitHours: number | null; result: string }

type RetroRun = Pick<Orchestration, 'key' | 'kind' | 'title' | 'stage' | 'closing' | 'rounds' | 'issues' | 'failures' | 'findings' | 'verdict'>;

const MAX_ITEMS = 40;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

const hoursBetween = (from: string, to: string | null) => (to ? (Date.parse(to) - Date.parse(from)) / 3600000 : NaN);
const ownerIssues = (run: RetroRun) => run.issues.filter((issue) => issue.level === 'owner');
const ownerWait = (run: RetroRun) => ownerIssues(run).map((issue) => hoursBetween(issue.at, issue.resolvedAt)).filter((hours) => hours >= 0);

export function retroNumbers(runs: RetroRun[]): RetroNumbers {
  const builds = runs.filter((run) => run.kind === 'build');
  const reviews = runs.filter((run) => run.kind === 'review');
  const average = (values: number[]) => (values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : 0);
  return {
    tickets: builds.length,
    medianHours: median(builds.map((run) => run.closing?.hours ?? NaN)),
    fixRounds: average(builds.map((run) => run.closing?.fixRounds ?? run.rounds?.used ?? 0)),
    replans: average(builds.map((run) => run.closing?.replans ?? 0)),
    ownerIssues: runs.reduce((sum, run) => sum + ownerIssues(run).length, 0),
    medianOwnerWaitHours: median(runs.flatMap(ownerWait)),
    reviews: reviews.length,
    requestChanges: reviews.filter((run) => run.verdict === 'request-change').length,
  };
}

/** What went wrong more than once: failure types, then review findings by severity. */
export function retroProblems(runs: RetroRun[]): RetroProblem[] {
  const counts = new Map<string, { n: number; keys: Set<string> }>();
  const add = (label: string, key: string) => {
    const entry = counts.get(label) ?? { n: 0, keys: new Set<string>() };
    entry.n += 1;
    entry.keys.add(key);
    counts.set(label, entry);
  };
  for (const run of runs) {
    for (const failure of run.failures) add(`Failure: ${failure.type}`, run.key);
    for (const finding of run.findings) add(`Review finding: ${finding.severity}`, run.key);
    for (const issue of ownerIssues(run)) add(`Escalated to the owner: ${issue.type}`, run.key);
  }
  return [...counts.entries()]
    .map(([label, entry]) => ({ label, count: entry.n, tickets: [...entry.keys].sort() }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

export function retroTickets(runs: RetroRun[]): RetroTicket[] {
  return runs.map((run) => ({
    key: run.key,
    title: run.title,
    kind: run.kind,
    hours: run.closing?.hours ?? null,
    rounds: run.closing?.fixRounds ?? run.rounds?.used ?? 0,
    issues: run.issues.length,
    ownerWaitHours: ownerWait(run).length ? round1(ownerWait(run).reduce((sum, hours) => sum + hours, 0)) : null,
    result: run.kind === 'review' ? (run.verdict ?? run.stage) : run.stage,
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

/** The draft the kit posts: `{ sprint, items: [{ kind, text, evidence, dest }] }`. A line without evidence is dropped. */
export function parseRetroDraft(input: unknown): { sprint: string; items: RetroDraftItem[] } {
  if (!isRecord(input)) throw new OrchestratorInputError('A retro draft must be an object');
  const sprint = typeof input.sprint === 'string' ? input.sprint.trim().slice(0, 120) : '';
  if (!sprint) throw new OrchestratorInputError('sprint is required');
  const items = (Array.isArray(input.items) ? input.items : []).filter(isRecord).map((item) => ({
    kind: String(item.kind ?? '').toLowerCase() as RetroKind,
    text: typeof item.text === 'string' ? item.text.trim().slice(0, 1000) : '',
    evidence: (Array.isArray(item.evidence) ? item.evidence : []).filter((line): line is string => typeof line === 'string' && line.trim() !== '').map((line) => line.trim().slice(0, 300)).slice(0, 10),
    dest: (RETRO_DESTS as readonly string[]).includes(String(item.dest)) ? item.dest as RetroDest : 'note',
  })).filter((item) => (RETRO_KINDS as readonly string[]).includes(item.kind) && item.text && item.evidence.length > 0);
  return { sprint, items: items.slice(0, MAX_ITEMS) };
}

/** What DOCK asks sous to do when the owner accepts a line that has somewhere to go. */
export function retroApplyPrompt(item: { id: string; text: string; dest: string; evidence: string[] }): string {
  return [`Pakai skill sous: retro apply ${item.id}`, `Dest: ${item.dest}`, `Text: ${item.text}`, `Evidence: ${item.evidence.join('; ')}`].join('\n');
}
