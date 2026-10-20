import type { AgentDecision, AgentIssue, AgentRun } from '../agents/runs';

type ReportFacts = Pick<AgentRun, 'engine' | 'issues' | 'decisions'>;

/** The report shows for a run the sous engine works, or any run that recorded an issue. */
export const showsSousReport = (run?: ReportFacts | null): boolean => Boolean(run && (run.engine === 'sous' || run.issues?.length));

/** Open issues that wait on the owner first, oldest first; then the open issues the arbiter or sous still hold. */
export function openIssues(run?: ReportFacts | null): { owner: AgentIssue[]; others: AgentIssue[] } {
  const open = (run?.issues ?? []).filter((issue) => issue.status === 'open').sort((a, b) => a.n - b.n);
  return { owner: open.filter((issue) => issue.level === 'owner'), others: open.filter((issue) => issue.level !== 'owner') };
}

/** Decisions newest first, each with its D-n; an entry from before sous counts by its place in the list. */
export const reportDecisions = (run?: ReportFacts | null): Array<AgentDecision & { n: number }> => (
  (run?.decisions ?? []).map((decision, index) => ({ ...decision, n: decision.n ?? index + 1 })).reverse()
);

/** Only what the arbiter or sous decided on their own can be cancelled by the owner. */
export const canCancel = (decision: Pick<AgentDecision, 'status'>): boolean => decision.status === 'SHOV' || decision.status === 'USULAN';

export const DECISION_TONE: Record<string, 'success' | 'warn' | 'neutral' | 'danger'> = {
  DECIDED: 'success', SHOV: 'warn', USULAN: 'warn', SUPERSEDED: 'neutral', CANCELLED: 'danger',
};

/** A report age as people say it: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function reportAge(at: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(at).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
