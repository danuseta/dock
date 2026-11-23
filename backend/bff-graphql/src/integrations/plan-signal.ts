// What every DOCK knows about a sprint plan from Jira alone: whether it is published and which revision, who published
// it and when, which tickets joined or had their AC changed since, whether this DOCK is the planner's, and this
// developer's own work order. Each developer's DOCK has its own database, so all of it is read from the plan labels.
import { acValueLines } from './sprint-draft';
import type { PlanningIssue, PlanningSprint } from './jira-sprint';
import { labelOrder } from './orchestrator-cron';
import { PLANNER_KEY, isPlanner, planChanges, planLabel, revisionOf, sprintRevision, sprintStage, type SprintStage } from './plan-publish';

export interface SignalSettings { waitForPublish: boolean; planAfterPublish: boolean }
export interface SignalMe { accountId: string | null; displayName: string | null }
export interface SignalHistory { created?: string; author?: { displayName?: string | null } | null; items?: Array<{ field?: string; fromString?: string | null; toString?: string | null }> }

export interface PlanSignalDeps {
  sprints(): Promise<PlanningSprint[]>;
  sprintIssues(sprintId: number): Promise<PlanningIssue[]>;
  changelog(key: string): Promise<SignalHistory[]>;
  myself(): Promise<SignalMe>;
  setting(key: string): Promise<string | null>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  dockOrder(): Promise<Map<string, number>>;
  cronSettings(): Promise<SignalSettings>;
  draftStatus(sprint: string): Promise<{ status: string; loadedAt: string; publishedAt: string | null } | null>;
}

export interface WorkOrderItem { key: string; summary: string; status: string; sp: number | null; order: number | null }

export interface PlanSignalView {
  sprint: string; sprintId: number; sprintState: string; activeSince: string | null;
  stage: SprintStage; revision: number | null;
  publishedBy: string | null; publishedAt: string | null;
  planner: string | null; me: string | null; isPlanner: boolean;
  draftLoadedAt: string | null; draftStatus: string | null;
  /** Tickets of the sprint without a plan label: they joined after the last publish. */
  joined: string[];
  /** Plan tickets whose AC differs from what this DOCK saw when the revision went out. */
  acChanged: string[];
  waitForPublish: boolean; planAfterPublish: boolean;
  /** This developer's To Do tickets of the published plan, in work order. */
  myOrder: WorkOrderItem[];
  /** This developer's To Do tickets the cron skips: not in the published plan. */
  myOutside: string[];
}

const ME_TTL_MS = 5 * 60 * 1000;
const todo = (status: string) => /^to ?do$/i.test(status.trim());

export class PlanSignalService {
  private me: { at: number; value: SignalMe } | null = null;

  constructor(private readonly deps: PlanSignalDeps) {}

  /** This DOCK's Jira user, read again every few minutes. */
  async myself(): Promise<SignalMe> {
    if (this.me && Date.now() - this.me.at < ME_TTL_MS) return this.me.value;
    const value = await this.deps.myself();
    this.me = { at: Date.now(), value };
    return value;
  }

  /** The planner set in Settings, or null when every DOCK may plan. */
  async planner(): Promise<string | null> {
    return (await this.deps.setting(PLANNER_KEY))?.trim() || null;
  }

  /** Why this DOCK may not change or publish the draft, or null when it may. */
  async editRefusal(): Promise<string | null> {
    const planner = await this.planner();
    if (!planner) return null;
    const me = await this.myself().catch(() => null);
    return isPlanner(planner, me) ? null : `Read-only: only ${planner} (the planner) can change or publish the draft`;
  }

  async view(sprintName: string): Promise<PlanSignalView | null> {
    const sprint = (await this.deps.sprints()).find((item) => item.name === sprintName);
    if (!sprint) return null;
    const [issues, me, planner, settings, draft] = await Promise.all([
      this.deps.sprintIssues(sprint.id), this.myself().catch(() => null), this.planner(), this.deps.cronSettings(), this.deps.draftStatus(sprint.name),
    ]);
    const revision = sprintRevision(issues);
    const tickets = issues.map((issue) => ({ key: issue.key, labels: issue.labels ?? [], ac: acValueLines(issue.acRaw) }));
    const baseline = revision === null ? null : await this.baseline(sprint.name, revision, tickets);
    const changes = planChanges(tickets, revision, baseline);
    const published = revision === null ? null : await this.publishedBy(sprint.name, revision, issues);
    const order = await this.deps.dockOrder();
    const mine = issues.filter((issue) => todo(issue.status) && !!me?.displayName && issue.assignee === me.displayName);
    const rank = (issue: PlanningIssue) => order.get(issue.key) ?? labelOrder(issue.labels) ?? Number.POSITIVE_INFINITY;
    const myOrder = mine.filter((issue) => revisionOf(issue.labels) !== null)
      .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, undefined, { numeric: true }))
      .map((issue) => ({ key: issue.key, summary: issue.summary, status: issue.status, sp: issue.sp, order: Number.isFinite(rank(issue)) ? rank(issue) : null }));
    return {
      sprint: sprint.name, sprintId: sprint.id, sprintState: sprint.state, activeSince: sprint.state === 'active' ? sprint.startDate : null,
      stage: sprintStage(revision, sprint.state), revision,
      publishedBy: published?.by ?? null, publishedAt: published?.at ?? null,
      planner, me: me?.displayName ?? null, isPlanner: isPlanner(planner, me),
      draftLoadedAt: draft?.loadedAt ?? null, draftStatus: draft?.status ?? null,
      joined: changes.joined, acChanged: changes.acChanged,
      waitForPublish: settings.waitForPublish, planAfterPublish: settings.planAfterPublish,
      myOrder: revision === null ? [] : myOrder,
      myOutside: revision === null ? [] : mine.filter((issue) => revisionOf(issue.labels) === null).map((issue) => issue.key),
    };
  }

  /** The AC of each plan ticket when this DOCK first saw the revision; recorded on that first look. */
  private async baseline(sprint: string, revision: number, tickets: Array<{ key: string; labels: string[]; ac: string[] }>): Promise<Record<string, string[]>> {
    const key = `baseline:${sprint}:r${revision}`;
    const saved = await this.deps.cacheGet(key);
    if (saved && typeof saved === 'object') return saved as Record<string, string[]>;
    const value = Object.fromEntries(tickets.filter((ticket) => revisionOf(ticket.labels) === revision).map((ticket) => [ticket.key, ticket.ac]));
    await this.deps.cacheSet(key, value);
    return value;
  }

  /** Who added the revision's label and when, from the changelog of one ticket that carries it. */
  private async publishedBy(sprint: string, revision: number, issues: PlanningIssue[]): Promise<{ by: string | null; at: string | null } | null> {
    const key = `published:${sprint}:r${revision}`;
    const saved = await this.deps.cacheGet(key);
    if (saved && typeof saved === 'object') return saved as { by: string | null; at: string | null };
    const label = planLabel(revision);
    const carrier = issues.find((issue) => (issue.labels ?? []).includes(label));
    if (!carrier) return null;
    const histories = await this.deps.changelog(carrier.key).catch(() => []);
    const added = [...histories].reverse().find((history) => (history.items ?? []).some((item) => item.field === 'labels'
      && String(item.toString ?? '').split(/\s+/).includes(label) && !String(item.fromString ?? '').split(/\s+/).includes(label)));
    const value = { by: added?.author?.displayName ?? null, at: added?.created ?? null };
    if (added) await this.deps.cacheSet(key, value);
    return value;
  }
}
