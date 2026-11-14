import { ago } from '../lib/discordThreads';

export type AgentsTab = 'office' | 'library';
export type PlanningPageTab = 'draft' | 'plan' | 'retro';
const PLANNING_TABS: PlanningPageTab[] = ['draft', 'plan', 'retro'];
const PLANNING_PANELS = ['mine', 'team', 'scope', 'ac', 'qa', 'tc', 'storyboard'] as const;
export type PlanningPanelId = (typeof PLANNING_PANELS)[number];

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

export const agentsRoute = (search: string): AgentsTab => (new URLSearchParams(search).get('tab') === 'library' ? 'library' : 'office');

/** The tab and Draft panel of /planning: `?tab=draft|plan|retro` (Draft when missing) and `?panel=`. */
export function planningRoute(search: string): { tab: PlanningPageTab; panel: PlanningPanelId | null } {
  const params = new URLSearchParams(search);
  const tab = params.get('tab') as PlanningPageTab;
  const panel = params.get('panel') as PlanningPanelId;
  return { tab: PLANNING_TABS.includes(tab) ? tab : 'draft', panel: PLANNING_PANELS.includes(panel) ? panel : null };
}

/** The Draft panel the URL names, else the fallback: Planning follows ?panel= on load and on Back / Forward. */
export const panelOf = <T extends string>(search: string, fallback: T): PlanningPanelId | T => planningRoute(search).panel ?? fallback;

/**
 * Planning moved out of Agents: an old link (/agents?tab=sprint&sub=planning|plan|retro, /agents?tab=sprint,
 * /agents?tab=retro) opens the matching /planning tab and keeps its other parameters, such as panel. Any other path
 * comes back unchanged.
 */
export function planningRedirect(href: string): string {
  const [path, query = ''] = href.split('?');
  if (path !== '/agents') return href;
  const params = new URLSearchParams(query);
  const tab = params.get('tab');
  if (tab !== 'sprint' && tab !== 'retro') return href;
  const sub = params.get('sub');
  const next = tab === 'retro' || sub === 'retro' ? 'retro' : sub === 'planning' ? 'draft' : 'plan';
  params.delete('tab');
  params.delete('sub');
  const rest = params.toString();
  return `/planning?tab=${next}${rest ? `&${rest}` : ''}`;
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
export interface DriftStoryboard { key: string; version: number; frames: string[]; held: boolean; checked: boolean }
export interface SprintDrift { sprint: string; publishedAt: string | null; today: number | null; rows: DriftRow[]; storyboard: DriftStoryboard[] }

export interface AcIn { id: string; from: string; to: string; line: number; text: string; by: string | null; at: string }

const DRIFT_STATE: Record<string, string> = { held: 'Held', moved: 'Moved', 'move-pending': 'Move pending', 'move-accepted': 'Accepted, remove by hand', 'not-tested': 'Not tested here', wait: 'Wait', 'needs-po': 'Needs PO' };
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
