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
