import { ago } from '../lib/discordThreads';

export type AgentsTab = 'office' | 'library' | 'lessons';
export type PlanningPageTab = 'now' | 'draft' | 'retro';
const PLANNING_TABS: PlanningPageTab[] = ['now', 'draft', 'retro'];
const PLANNING_PANELS = ['mine', 'team', 'scope', 'ac', 'qa', 'tc', 'storyboard', 'order', 'new'] as const;
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
export interface PlanTicket { key: string; title: string; status: string; position: number; order: number | null; orderSource: string | null; suggestedPosition: number | null; held: boolean; edges: PlanEdge[] }
export interface PlanSuggestion { key: string; title: string; jiraOrder: number | null; wave: number | null; jiraPosition: number; waitedOn: number; atRisk: boolean; reason: string | null }
export interface PlanFileEdge { ticketKey: string; dependsOnKey: string; dependsOnTitle: string | null; reason: string | null }
export interface SprintPlan {
  sprint: string;
  status: string;
  error: string | null;
  sessionId: string | null;
  mappedAt: string | null;
  groups: string[][];
  suggestedOrder: string[];
  suggestion: PlanSuggestion[];
  fileEdges: PlanFileEdge[];
  tickets: PlanTicket[];
}

export const agentsRoute = (search: string): AgentsTab => {
  const tab = new URLSearchParams(search).get('tab');
  return tab === 'library' || tab === 'lessons' ? tab : 'office';
};

/** The tab and Draft panel of /planning: `?tab=now|draft|retro` and `?panel=`. With no tab it is Now, or Draft when a panel is named. The old Plan tab is Draft's Order panel. */
export function planningRoute(search: string): { tab: PlanningPageTab; panel: PlanningPanelId | null } {
  const params = new URLSearchParams(search);
  const tab = params.get('tab') as PlanningPageTab;
  if (params.get('tab') === 'plan') return { tab: 'draft', panel: 'order' };
  const panel = PLANNING_PANELS.includes(params.get('panel') as PlanningPanelId) ? params.get('panel') as PlanningPanelId : null;
  return { tab: PLANNING_TABS.includes(tab) ? tab : panel ? 'draft' : 'now', panel };
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

/** True when the suggested order differs from the work order the cron follows now. */
export const suggestionDiffers = (plan: Pick<SprintPlan, 'suggestedOrder' | 'tickets'>) => {
  const current = plan.tickets.map((ticket) => ticket.key).filter((key) => plan.suggestedOrder.includes(key));
  return plan.suggestedOrder.length > 0 && plan.suggestedOrder.some((key, index) => current[index] !== key);
};

/** "Jira #14", "Yours #2" or nothing when the ticket number orders the ticket. */
export const orderSourceLabel = (ticket: Pick<PlanTicket, 'order' | 'orderSource'>) => (ticket.order == null ? '' : `${ticket.orderSource === 'owner' ? 'Yours' : 'Jira'} #${ticket.order}`);

/** The Jira place of a suggested ticket: "#4", "Wave 2" without a #N, or nothing. */
export const jiraPlaceLabel = (row: Pick<PlanSuggestion, 'jiraOrder' | 'wave'>) => (row.jiraOrder != null ? `#${row.jiraOrder}` : row.wave != null ? `Wave ${row.wave}` : '');

export const groupsText =(groups: string[][]) => groups.filter((group) => group.length > 1).map((group) => group.join(' · '));

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
