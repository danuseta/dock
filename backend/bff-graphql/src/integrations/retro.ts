// A sprint's retro of the agents' work: numbers from the runs, recurring problems, a table per ticket, and the
// Keep / Problem / Try lines sous drafts for the owner to accept. Numbers are pure; the lines are stored.
import { OrchestratorInputError, type Orchestration } from './orchestrator';

export const RETRO_KINDS = ['keep', 'problem', 'try'] as const;
export const RETRO_DESTS = ['kit', 'memory', 'dock', 'note', 'qa-agent'] as const;
/** Lines that go to the QA bot's repo are its owner's to apply; DOCK never opens a session or a PR for them. */
export const MANUAL_DESTS: readonly string[] = ['note', 'qa-agent'];
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
  blockedWaits: number;
  mergeConflicts: number;
  stackedRebases: number;
}
export interface RetroProblem { label: string; count: number; tickets: string[] }
export interface RetroTicket { key: string; title: string; kind: string; hours: number | null; rounds: number; issues: number; ownerWaitHours: number | null; result: string }

type RetroRun = Pick<Orchestration, 'key' | 'kind' | 'title' | 'stage' | 'closing' | 'rounds' | 'issues' | 'failures' | 'findings' | 'verdict' | 'stackedOn'>;

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

export function retroNumbers(runs: RetroRun[], extra = { blockedWaits: 0, mergeConflicts: 0 }): RetroNumbers {
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
    ...extra,
    stackedRebases: runs.reduce((sum, run) => sum + (run.stackedOn?.be?.retargetedAt ? 1 : 0) + (run.stackedOn?.fe?.retargetedAt ? 1 : 0), 0),
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

// ---- QA escalations by cause ---------------------------------------------------------------------------------------
// The QA bot labels a ticket it could not pass: QA-BLOCKED-<REASON> (blockedReason dependency, access, data,
// environment), QA-MANUAL for access, QA-ESCALATED for a mix. The retro counts them for the whole team from the sprint
// dashboard's tickets, and an escalation Planning did not predict becomes a triage rule to propose to the QA bot.

export const ESCALATION_CAUSES = ['dependency', 'access', 'data', 'environment', 'unspecified'] as const;
export type EscalationCause = typeof ESCALATION_CAUSES[number];
export interface EscalationCauseRow { cause: EscalationCause; label: string; count: number; tickets: string[] }
export interface UnpredictedEscalation { key: string; summary: string; causes: EscalationCause[]; prediction: string | null }
export interface RetroEscalations { tickets: number; causes: EscalationCauseRow[]; unpredicted: UnpredictedEscalation[]; planned: boolean }
interface EscalationIssue { key: string; summary?: string; labels?: string[]; events?: Array<{ field: string; to: string | null }> }

export const CAUSE_LABEL: Record<EscalationCause, string> = {
  dependency: 'AC needs another ticket', access: 'QA bot has no access', data: 'Test data not prepared', environment: 'Environment not ready', unspecified: 'Escalated, cause not given',
};

/** A proposed triage rule per cause, phrased as what predict.mjs should answer. */
export const TRIAGE_RULE: Record<EscalationCause, string> = {
  dependency: 'Triage rule: an AC line that names another ticket, or a flow another ticket builds, that is not in UAT when this ticket reaches QA predicts ESCALATED (blockedReason dependency).',
  access: 'Triage rule: an AC that needs an account, a second user, a channel or a third-party API the QA bot does not hold predicts ESCALATED (blockedReason access).',
  data: 'Triage rule: an AC that needs data the UI cannot create (published items, seeded records, past dates) predicts ESCALATED (blockedReason data) unless the ticket names a fixture.',
  environment: 'Triage rule: an AC that needs a service, flag or config UAT does not have predicts ESCALATED (blockedReason environment).',
  unspecified: 'Triage rule: the QA bot labels every Blocked line with its blockedReason, so an escalation can be predicted next sprint.',
};

/** The causes a QA label names, upper or lower case. */
export function labelCauses(label: string): EscalationCause[] {
  const value = label.trim().toUpperCase().replace(/_/g, '-');
  const blocked = /^QA-BLOCKED-(DEPENDENCY|ACCESS|DATA|ENV|ENVIRONMENT)$/.exec(value);
  if (blocked) return [blocked[1] === 'ENV' ? 'environment' : blocked[1].toLowerCase() as EscalationCause];
  if (value === 'QA-MANUAL') return ['access'];
  if (value === 'QA-ESCALATED' || value === 'QA-BLOCKED') return ['unspecified'];
  return [];
}

/** Every label a ticket held during the sprint: the ones it has now and the ones a label change added. */
function sprintLabels(issue: EscalationIssue): string[] {
  const added = (issue.events || []).filter((event) => event.field === 'labels' && event.to).flatMap((event) => String(event.to).split(/\s+/));
  return [...new Set([...(issue.labels || []), ...added].filter(Boolean))];
}

export function qaEscalations(issues: EscalationIssue[], predictions: Map<string, string | null> | null): RetroEscalations {
  const byCause = new Map<EscalationCause, Set<string>>();
  const unpredicted: UnpredictedEscalation[] = [];
  let tickets = 0;
  for (const issue of issues) {
    let causes = [...new Set(sprintLabels(issue).flatMap(labelCauses))];
    if (!causes.length) continue;
    // A ticket with a named cause is not also counted as unspecified for its QA-ESCALATED label.
    if (causes.length > 1) causes = causes.filter((cause) => cause !== 'unspecified');
    tickets += 1;
    for (const cause of causes) byCause.set(cause, (byCause.get(cause) ?? new Set()).add(issue.key));
    const prediction = predictions?.has(issue.key) ? predictions.get(issue.key) ?? null : null;
    if (predictions && prediction !== 'ESCALATED') unpredicted.push({ key: issue.key, summary: issue.summary ?? issue.key, causes, prediction });
  }
  return {
    tickets,
    causes: ESCALATION_CAUSES.filter((cause) => byCause.has(cause)).map((cause) => ({ cause, label: CAUSE_LABEL[cause], count: byCause.get(cause)!.size, tickets: [...byCause.get(cause)!].sort() }))
      .sort((a, b) => b.count - a.count),
    unpredicted: unpredicted.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    planned: !!predictions,
  };
}

/** One proposed triage rule per cause Planning missed, with the tickets as evidence. */
export function triageSuggestions(escalations: RetroEscalations): Array<{ kind: 'try'; text: string; evidence: string[]; dest: 'qa-agent' }> {
  const causes = ESCALATION_CAUSES.filter((cause) => escalations.unpredicted.some((item) => item.causes.includes(cause)));
  return causes.map((cause) => ({
    kind: 'try' as const,
    text: TRIAGE_RULE[cause],
    evidence: escalations.unpredicted.filter((item) => item.causes.includes(cause)).map((item) => `${item.key} escalated (${cause}); Planning predicted ${item.prediction ?? 'nothing'}`).slice(0, 10),
    dest: 'qa-agent' as const,
  }));
}
