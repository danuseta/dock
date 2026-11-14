// The sprint plan's publish signal, shared through Jira: Publish puts the label plan-published-r<N> on every ticket of
// the plan, so each developer's DOCK, which has its own database, can tell that the plan is out, which revision it is,
// and which tickets joined after it. Nothing here talks to Jira; the callers pass what Jira returned.

export const PLAN_LABEL_PREFIX = 'plan-published-r';
const PLAN_LABEL = /^plan-published-r(\d{1,4})$/;

/** The label of revision `revision`. */
export const planLabel = (revision: number) => `${PLAN_LABEL_PREFIX}${revision}`;

/** The revision a single label names, or null when it is not a plan label. */
export function labelRevision(label: string): number | null {
  const match = PLAN_LABEL.exec(label.trim());
  return match ? Number(match[1]) : null;
}

/** The highest plan revision among the labels, or null without one. */
export function revisionOf(labels: string[] | undefined): number | null {
  const revisions = (labels ?? []).map(labelRevision).filter((value): value is number => value !== null && value > 0);
  return revisions.length ? Math.max(...revisions) : null;
}

/** True when the ticket carries a plan label: it was part of a published plan. */
export const inPublishedPlan = (labels: string[] | undefined): boolean => revisionOf(labels) !== null;

/** The sprint's published revision: the highest one any of its tickets carries, or null before the first publish. */
export function sprintRevision(tickets: Array<{ labels?: string[] }>): number | null {
  const revisions = tickets.map((ticket) => revisionOf(ticket.labels)).filter((value): value is number => value !== null);
  return revisions.length ? Math.max(...revisions) : null;
}

/** The plan labels a ticket should drop when it takes `revision`: every older one. */
export const stalePlanLabels = (labels: string[] | undefined, revision: number): string[] => (labels ?? []).filter((label) => {
  const value = labelRevision(label);
  return value !== null && value !== revision;
});

/**
 * Why the cron leaves a To Do ticket alone while it waits for the plan, or null when it may take it.
 * `sprintRevision` is the revision of the ticket's sprint as the cron sees it.
 */
export function publishWait(ticket: { labels?: string[]; sprintName?: string | null }, sprintRevisionNow: number | null): string | null {
  if (inPublishedPlan(ticket.labels)) return null;
  const sprint = ticket.sprintName || 'the sprint';
  return sprintRevisionNow === null
    ? `waiting for the plan of ${sprint} to be published`
    : `outside the published plan r${sprintRevisionNow}: joined after publish, waits for a republish`;
}

export interface SignalTicket { key: string; labels: string[]; ac: string[] }
export interface PlanChanges { joined: string[]; acChanged: string[] }

/**
 * What changed in Jira since revision `revision` went out: tickets of the sprint without a plan label (joined after
 * publish) and tickets whose AC differs from the baseline this DOCK recorded when it first saw the revision.
 */
export function planChanges(tickets: SignalTicket[], revision: number | null, baseline: Record<string, string[]> | null): PlanChanges {
  if (revision === null) return { joined: [], acChanged: [] };
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
  return {
    joined: tickets.filter((ticket) => !inPublishedPlan(ticket.labels)).map((ticket) => ticket.key),
    acChanged: baseline ? tickets.filter((ticket) => inPublishedPlan(ticket.labels) && baseline[ticket.key] && !same(baseline[ticket.key], ticket.ac)).map((ticket) => ticket.key) : [],
  };
}

export const PLANNER_KEY = 'planningPlanner';

/**
 * True when this DOCK's Jira user is the planner named in Settings: by account id or by display name, case aside.
 * No planner set means every DOCK may plan, as before the role existed.
 */
export function isPlanner(planner: string | null | undefined, me: { accountId?: string | null; displayName?: string | null } | null): boolean {
  const wanted = (planner ?? '').trim().toLowerCase();
  if (!wanted) return true;
  if (!me) return false;
  return [me.accountId, me.displayName].some((value) => (value ?? '').trim().toLowerCase() === wanted);
}

export type SprintStage = 'draft' | 'published' | 'running';

/** Draft until the plan is out, published once a revision exists, running once the sprint is active in Jira as well. */
export function sprintStage(revision: number | null, sprintState: string | null | undefined): SprintStage {
  if (revision === null) return 'draft';
  return String(sprintState ?? '').toLowerCase() === 'active' ? 'running' : 'published';
}

/** Staging runs the cron as a dry run: DOCK_CRON_DRY_RUN=1 logs what it would start and opens no Claude session. */
export const cronDryRun = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|true|yes)$/i.test(env.DOCK_CRON_DRY_RUN?.trim() ?? '');
