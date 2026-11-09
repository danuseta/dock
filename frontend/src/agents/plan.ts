import { ago } from '../lib/discordThreads';

export type AgentsTab = 'office' | 'sprint' | 'library';
export type SprintSub = 'planning' | 'plan' | 'retro';

export interface PlanEdge {
  id: string;
  ticketKey: string;
  dependsOnKey: string;
  dependsOnTitle: string | null;
  dependsOnAssignee: string | null;
  dependsOnStatus: string | null;
  source: string;
  reason: string | null;
  state: string;
}
export interface PlanTicket { key: string; title: string; status: string; position: number; held: boolean; edges: PlanEdge[] }
export interface SprintPlan {
  sprint: string;
  status: string;
  error: string | null;
  sessionId: string | null;
  mappedAt: string | null;
  groups: string[][];
  tickets: PlanTicket[];
}

export function agentsRoute(search: string): { tab: AgentsTab; sub: SprintSub } {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  if (tab === 'library') return { tab: 'library', sub: 'plan' };
  if (tab === 'retro') return { tab: 'sprint', sub: 'retro' };
  if (tab === 'sprint') {
    const sub = params.get('sub');
    return { tab: 'sprint', sub: sub === 'retro' || sub === 'planning' ? sub : 'plan' };
  }
  return { tab: 'office', sub: 'plan' };
}

export const sourceLabel = (source: string) => (source === 'jira' ? 'Jira' : 'Inferred');

export const isMapping = (plan: Pick<SprintPlan, 'status'> | null) => plan?.status === 'mapping';

export const mappedText = (mappedAt: string | null, now: Date) => (mappedAt ? `Mapped ${ago(mappedAt, now)} ago` : 'Not mapped yet');

export const pendingEdges = (plan: SprintPlan | null) => (plan?.tickets ?? []).flatMap((ticket) => ticket.edges).filter((edge) => edge.state === 'pending');

export const edgeStateText = (state: string) => (state === 'accepted' ? 'Accepted' : state === 'rejected' ? 'Rejected' : 'Waiting for your call');

export const hasMap = (plan: SprintPlan | null) => !!plan && plan.mappedAt !== null;

export const groupsText = (groups: string[][]) => groups.filter((group) => group.length > 1).map((group) => group.join(' · '));

export interface DriftDecision { action: string; state: string; note: string | null; by: string | null; at: string }
export interface DriftRow {
  id: string; key: string; line: number; text: string; refKey: string; refStatus: string | null; refDev: string | null;
  refEnd: number | null; ownEnd: number | null; reason: string; state: string; decision: DriftDecision | null;
}
export interface SprintDrift { sprint: string; publishedAt: string | null; today: number | null; rows: DriftRow[] }

const DRIFT_STATE: Record<string, string> = { held: 'Held', moved: 'Moved', 'move-pending': 'Move pending', 'not-tested': 'Not tested here', wait: 'Wait', 'needs-po': 'Needs PO' };
export const driftStateLabel = (state: string) => DRIFT_STATE[state] ?? state;

/** Why the line is held, in the words of the plan. */
export function driftReason(row: Pick<DriftRow, 'reason' | 'refKey' | 'refEnd' | 'ownEnd' | 'refStatus' | 'key'>): string {
  const status = row.refStatus ? ` It is ${row.refStatus}.` : '';
  if (row.reason === 'slipped') return `${row.refKey} was planned to land D${Math.ceil(row.refEnd ?? 0)}, before ${row.key}, and has not.${status}`;
  if (row.reason === 'after-it') return `${row.refKey} lands D${Math.ceil(row.refEnd ?? 0)}, after ${row.key} (D${Math.ceil(row.ownEnd ?? 0)}).${status}`;
  return `${row.refKey} is outside this sprint's plan and has not landed.${status}`;
}

/** Held rows first, then the ones already decided. */
export const sortDrift = (rows: DriftRow[]) => [...rows].sort((a, b) => Number(a.state !== 'held') - Number(b.state !== 'held'));
