// A sprint's dependency map and work order. The lead drafts it in a `Plan-<sprint>` session; Jira "blocks" links apply
// at once, an inferred edge waits for the owner. Only the owner's tickets are ordered.
import { OrchestratorInputError } from './orchestrator';
import type { TicketLink } from './jira';
import type { PlanEdgeInput, StorageService } from '../storage/service';
import { inPublishedPlan } from './plan-publish';

export interface PlanTicket { key: string; status: string; sprintName?: string | null; sprintState?: string | null; issueType?: string | null; links?: TicketLink[]; labels?: string[] }
export interface PlanRow { status: string; mappingKeys: string; mappedKeys: string; startedAt: Date | null }
export type PlanMode = 'full' | 'ticket';
export type PlanTrigger = { kind: PlanMode; sprint: string; keys: string[] } | { kind: 'expire'; sprint: string } | null;
export interface PlanDraft { sprint: string; mode: PlanMode; tickets: string[]; order: string[]; groups: string[][]; edges: PlanEdgeInput[] }
export interface Edge { ticketKey: string; dependsOnKey: string }

export const PLAN_STALE_MS = 2 * 3600 * 1000;
export const START_RETRY_MS = 30 * 60 * 1000;
const MAX_EDGES = 200;
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const keyOf = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase() : '');
const keyList = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(keyOf).filter((key) => KEY.test(key)))];

export function parseKeys(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/** The owner's tickets of the active sprint that get an order: Epics are left out. */
export function activeSprint(tickets: PlanTicket[]): { sprint: string; tickets: PlanTicket[] } | null {
  const active = tickets.filter((ticket) => String(ticket.sprintState || '').toUpperCase() === 'ACTIVE' && ticket.sprintName && !sameText(ticket.issueType || '', 'Epic'));
  if (active.length === 0) return null;
  const sprint = active[0].sprintName!;
  return { sprint, tickets: active.filter((ticket) => ticket.sprintName === sprint) };
}

/** Jira links as edges whose ticket is an owner ticket: "X is blocked by Y" and "Y blocks X" both give X dependsOn Y. */
export function jiraEdges(tickets: PlanTicket[]): PlanEdgeInput[] {
  const owner = new Set(tickets.map((ticket) => ticket.key));
  const edges = new Map<string, PlanEdgeInput>();
  for (const ticket of tickets) {
    for (const link of ticket.links || []) {
      const edge = link.relation === 'blockedBy' ? { ticketKey: ticket.key, dependsOnKey: link.key } : { ticketKey: link.key, dependsOnKey: ticket.key };
      if (owner.has(edge.ticketKey) && edge.ticketKey !== edge.dependsOnKey) edges.set(`${edge.ticketKey}|${edge.dependsOnKey}`, { ...edge, reason: 'Jira link' });
    }
  }
  return [...edges.values()];
}

/**
 * What the cron tick should start: a full run when the sprint has no map, a ticket run for owner tickets that joined, or
 * expiry of a run that never posted. With `requirePublish` only tickets of the published plan (a plan-published-rN
 * label) count: nothing starts before the planner publishes, and a ticket that joined after publish waits for a republish.
 */
export function planTriggers(ownerTickets: PlanTicket[], plan: PlanRow | null, now: Date, todoStatuses: string[] = ['To Do'], requirePublish = false): PlanTrigger {
  const found = activeSprint(ownerTickets);
  if (!found) return null;
  const active = requirePublish ? { ...found, tickets: found.tickets.filter((ticket) => inPublishedPlan(ticket.labels)) } : found;
  if (active.tickets.length === 0 && plan?.status !== 'mapping') return null;
  const keys = active.tickets.map((ticket) => ticket.key);
  if (!plan) {
    return active.tickets.some((ticket) => todoStatuses.some((status) => sameText(status, ticket.status))) ? { kind: 'full', sprint: active.sprint, keys } : null;
  }
  if (plan.status === 'mapping') {
    return plan.startedAt && now.getTime() - plan.startedAt.getTime() > PLAN_STALE_MS ? { kind: 'expire', sprint: active.sprint } : null;
  }
  const mapped = new Set(parseKeys(plan.mappedKeys));
  const tried = new Set(plan.status === 'failed' ? parseKeys(plan.mappingKeys) : []);
  const joined = keys.filter((key) => !mapped.has(key) && !tried.has(key));
  if (joined.length === 0) return null;
  const fresh = mapped.size === 0 && tried.size === 0;
  return { kind: fresh ? 'full' : 'ticket', sprint: active.sprint, keys: fresh ? keys : joined };
}

/** True when adding "ticket dependsOn dependsOn" closes a loop in `edges`. */
export function wouldCycle(edges: Edge[], ticket: string, dependsOn: string): boolean {
  const parents = new Map<string, string[]>();
  for (const edge of edges) parents.set(edge.ticketKey, [...(parents.get(edge.ticketKey) || []), edge.dependsOnKey]);
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const key = stack.pop()!;
    if (key === ticket) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(parents.get(key) || []));
  }
  return false;
}

/** The draft the plan session posts. Edges of a teammate's ticket, self-edges and edges that close a loop with `known` are dropped. */
export function parsePlanDraft(input: unknown, ownerKeys: string[], known: Edge[] = []): PlanDraft {
  if (!isRecord(input)) throw new OrchestratorInputError('A plan draft must be an object');
  const sprint = typeof input.sprint === 'string' ? input.sprint.trim().slice(0, 120) : '';
  if (!sprint) throw new OrchestratorInputError('sprint is required');
  const mode = input.mode ?? 'full';
  if (mode !== 'full' && mode !== 'ticket') throw new OrchestratorInputError('mode must be full or ticket');
  if (!Array.isArray(input.edges)) throw new OrchestratorInputError('edges must be an array');
  if (!Array.isArray(input.order)) throw new OrchestratorInputError('order must be an array');
  const owner = new Set(ownerKeys);
  const graph = [...known];
  const edges: PlanEdgeInput[] = [];
  for (const item of input.edges.filter(isRecord)) {
    const ticketKey = keyOf(item.ticket);
    const dependsOnKey = keyOf(item.dependsOn);
    if (!owner.has(ticketKey) || !KEY.test(dependsOnKey) || ticketKey === dependsOnKey) continue;
    if (edges.some((edge) => edge.ticketKey === ticketKey && edge.dependsOnKey === dependsOnKey) || wouldCycle(graph, ticketKey, dependsOnKey)) continue;
    const edge = { ticketKey, dependsOnKey, reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) || null : null };
    edges.push(edge);
    graph.push(edge);
    if (edges.length >= MAX_EDGES) break;
  }
  return {
    sprint,
    mode,
    tickets: keyList(input.tickets).filter((key) => owner.has(key)),
    order: keyList(input.order).filter((key) => owner.has(key)),
    groups: (Array.isArray(input.groups) ? input.groups : []).map(keyList).filter((group) => group.length > 0).slice(0, 50),
    edges,
  };
}

/** The work order to write. A ticket run puts the new keys at their draft position and keeps the others in their current order. Manual tickets are left out. */
export function planOrder(draft: Pick<PlanDraft, 'mode' | 'order' | 'tickets'>, current: Map<string, number>, manual: Set<string>): string[] {
  let order = draft.order;
  if (draft.mode === 'ticket') {
    const fresh = new Set(draft.tickets);
    const rank = (key: string) => current.get(key) ?? Number.POSITIVE_INFINITY;
    const rest = draft.order.filter((key) => !fresh.has(key)).map((key, index) => ({ key, index })).sort((a, b) => (rank(a.key) - rank(b.key)) || (a.index - b.index)).map((item) => item.key);
    draft.order.forEach((key, index) => { if (fresh.has(key)) rest.splice(Math.min(index, rest.length), 0, key); });
    order = rest;
  }
  return order.filter((key) => !manual.has(key));
}

export interface PlanPromptInput { sprint: string; mode: PlanMode; ownerKeys: string[]; otherKeys: string[]; jiraEdges: Edge[]; previousSprint: string | null; tryLines: string[]; mapKeys: string[]; order: string[] }

export function planPrompt(input: PlanPromptInput): string {
  const list = (keys: string[]) => (keys.length ? keys.join(', ') : 'none');
  const links = input.jiraEdges.map((edge) => `${edge.ticketKey} waits for ${edge.dependsOnKey}`).join('; ') || 'none';
  return [
    `Pakai skill sous: plan ${input.sprint}.`,
    'Sprint plan run: read only. No branch, no code, no Jira edits, no ledger.',
    `Owner tickets to order: ${list(input.ownerKeys)}. Other tickets of the sprint, read only as something an owner ticket may wait for: ${list(input.otherKeys)}.`,
    'For each owner ticket read the status, the acceptance criteria (customfield_10332), the epic, the Jira issue links, and the code areas it will touch (sous-explorer).',
    `Jira links DOCK already applies, do not repeat them: ${links}.`,
    ...(input.previousSprint && input.tryLines.length ? [`Lessons accepted in the retro of ${input.previousSprint}, apply them:`, ...input.tryLines.map((line) => `- ${line}`)] : []),
    ...(input.mode === 'ticket' ? [`Map only ${list(input.mapKeys)} against the rest. The order of the other tickets stays: ${list(input.order)}.`] : []),
    'Write JSON {"sprint","mode","tickets","order":[owner keys, first to last],"groups":[[keys safe in parallel]],"edges":[{"ticket","dependsOn","reason"}]}.',
    'An edge means the ticket cannot start before dependsOn is merged. The reason names the shared file, API or contract.',
    'Post it: node "$K/dock-push.cjs" plan <file.json>.',
    'Write chat replies in Bahasa Indonesia.',
  ].join('\n');
}

export type PlanStore = Pick<StorageService,
  'getSprintPlan' | 'saveSprintPlan' | 'getPlanEdges' | 'replaceJiraEdges' | 'applyInferredEdges' | 'setPlanEdgeState' | 'getAcceptedPlanEdges'
  | 'getPendingPlanKeys' | 'addOrchestratorEventOnce' | 'getTicketOrders' | 'getManualTicketKeys' | 'setTicketOrder' | 'getRetroItems' | 'getTicketDependencies'>;

export interface PlanDeps {
  now: () => Date;
  store: PlanStore;
  tickets: () => Promise<PlanTicket[]>;
  /** The workspace DOCK with its chat bridge online. */
  canStart: () => boolean;
  openSession: (title: string) => Promise<string>;
  send: (sessionId: string, text: string) => Promise<unknown>;
  deleteSession: (sessionId: string) => Promise<unknown>;
  sprints: () => Promise<Array<{ id: number; name: string; state: string; startDate: string }>>;
  sprintKeys: (sprintId: number) => Promise<string[]>;
  todoStatuses?: string[];
  /** "Plan per developer dibikin setelah publish": map only once the sprint plan is published. */
  requirePublish?: () => Promise<boolean>;
}

/** Starts and takes back the lead's plan runs. `watch` runs on every cron tick on the tickets the cron already fetched. */
export class SprintPlanner {
  private lastJira = '';
  private starting = false;
  private failedAt = Number.NEGATIVE_INFINITY;
  private sprint: string | null = null;

  constructor(private readonly deps: PlanDeps) {}

  async watch(tickets: PlanTicket[]): Promise<PlanTrigger> {
    const active = activeSprint(tickets);
    if (!active) return null;
    const edges = jiraEdges(active.tickets);
    const signature = `${active.sprint}\n${edges.map((edge) => `${edge.ticketKey}|${edge.dependsOnKey}`).sort().join(',')}`;
    if (signature !== this.lastJira) {
      await this.deps.store.replaceJiraEdges(active.sprint, edges);
      this.lastJira = signature;
    }
    this.sprint = active.sprint;
    const plan = await this.deps.store.getSprintPlan(active.sprint);
    const requirePublish = this.deps.requirePublish ? await this.deps.requirePublish() : false;
    const trigger = planTriggers(tickets, plan, this.deps.now(), this.deps.todoStatuses, requirePublish);
    if (trigger?.kind === 'expire') {
      this.failedAt = this.deps.now().getTime();
      await this.deps.store.saveSprintPlan(trigger.sprint, { status: 'failed', error: 'No draft posted within 2 h' });
      return trigger;
    }
    const tried = plan?.status === 'failed' ? parseKeys(plan.mappingKeys) : [];
    const planned = requirePublish ? active.tickets.filter((ticket) => inPublishedPlan(ticket.labels)) : active.tickets;
    if (trigger && this.deps.canStart() && this.deps.now().getTime() - this.failedAt >= START_RETRY_MS) await this.start(trigger.sprint, trigger.kind, trigger.keys, planned, edges, tried);
    return trigger;
  }

  /** "Map again": a full run of the active sprint. Returns the session id. */
  async map(): Promise<string> {
    if (!this.deps.canStart()) throw new OrchestratorInputError('The workspace is not connected');
    const tickets = await this.deps.tickets();
    const active = activeSprint(tickets);
    if (!active) throw new OrchestratorInputError('No active sprint has an owner ticket');
    const plan = await this.deps.store.getSprintPlan(active.sprint);
    if (plan?.status === 'mapping' && plan.startedAt && this.deps.now().getTime() - plan.startedAt.getTime() <= PLAN_STALE_MS) throw new OrchestratorInputError('A mapping run is already in flight');
    const sessionId = await this.start(active.sprint, 'full', active.tickets.map((ticket) => ticket.key), active.tickets, jiraEdges(active.tickets));
    if (!sessionId) throw new OrchestratorInputError('A mapping run is already starting');
    return sessionId;
  }

  /** The draft posted to `/ingest/orchestrator/plan`. */
  async ingest(body: unknown) {
    const now = this.deps.now();
    const sprint = isRecord(body) && typeof body.sprint === 'string' ? body.sprint.trim() : '';
    const owner = (await this.deps.tickets()).filter((ticket) => ticket.sprintName === sprint).map((ticket) => ticket.key);
    const draft = parsePlanDraft(body, owner, await this.knownEdges(sprint));
    if (draft.mode === 'ticket') await this.deps.store.applyInferredEdges(draft.sprint, draft.edges, draft.tickets);
    else await this.deps.store.applyInferredEdges(draft.sprint, draft.edges);
    const [current, manual, plan] = await Promise.all([this.deps.store.getTicketOrders(), this.deps.store.getManualTicketKeys(), this.deps.store.getSprintPlan(draft.sprint)]);
    const order = planOrder(draft, current, manual);
    for (const [index, key] of order.entries()) await this.deps.store.setTicketOrder(key, index + 1);
    const mappedKeys = [...new Set([...parseKeys(plan?.mappedKeys), ...parseKeys(plan?.mappingKeys), ...draft.tickets])];
    await this.deps.store.saveSprintPlan(draft.sprint, { status: 'idle', mappingKeys: [], mappedKeys, groups: draft.groups, mappedAt: now, error: null });
    return { sprint: draft.sprint, edges: draft.edges.length, order };
  }

  /** Accept or reject an edge; an accept that would close a loop is refused. */
  async decide(sprint: string, id: string, action: string) {
    if (action !== 'accept' && action !== 'reject') throw new OrchestratorInputError('action must be accept or reject');
    const edge = (await this.deps.store.getPlanEdges(sprint)).find((row) => row.id === id);
    if (!edge) throw new OrchestratorInputError('Unknown edge');
    if (action === 'accept' && wouldCycle((await this.knownEdges(sprint)).filter((row) => !(row.ticketKey === edge.ticketKey && row.dependsOnKey === edge.dependsOnKey)), edge.ticketKey, edge.dependsOnKey)) {
      throw new OrchestratorInputError('Accepting this edge would make a dependency loop');
    }
    return this.deps.store.setPlanEdgeState(id, action === 'accept' ? 'accepted' : 'rejected');
  }

  /** Pending edge keys of the sprint the last tick saw. */
  async heldKeys(): Promise<Set<string>> { return this.sprint ? this.deps.store.getPendingPlanKeys(this.sprint) : new Set(); }

  recordWait(key: string, detail: string) { return this.deps.store.addOrchestratorEventOnce(key, 'DEP_WAIT', detail); }

  private async knownEdges(sprint: string): Promise<Edge[]> {
    const [hand, accepted] = await Promise.all([this.deps.store.getTicketDependencies(), this.deps.store.getAcceptedPlanEdges(sprint)]);
    return [...hand, ...accepted].map((edge) => ({ ticketKey: edge.ticketKey, dependsOnKey: edge.dependsOnKey }));
  }

  private async start(sprint: string, mode: PlanMode, mapKeys: string[], tickets: PlanTicket[], edges: Edge[], tried: string[] = []): Promise<string | null> {
    if (this.starting) return null;
    this.starting = true;
    try {
      const ownerKeys = tickets.map((ticket) => ticket.key);
      const sprints = [...await this.deps.sprints()].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const index = sprints.findIndex((item) => item.name === sprint);
      const previous = index > 0 ? sprints[index - 1] : null;
      const [sprintKeys, retro, current] = await Promise.all([
        index >= 0 ? this.deps.sprintKeys(sprints[index].id).catch(() => []) : Promise.resolve([] as string[]),
        previous ? this.deps.store.getRetroItems(previous.name) : Promise.resolve([]),
        this.deps.store.getTicketOrders(),
      ]);
      const fresh = new Set(mapKeys);
      const text = planPrompt({
        sprint,
        mode,
        ownerKeys,
        otherKeys: sprintKeys.filter((key) => !ownerKeys.includes(key)),
        jiraEdges: edges,
        previousSprint: previous?.name ?? null,
        tryLines: retro.filter((item) => item.kind === 'try' && item.status === 'accepted').map((item) => item.text),
        mapKeys,
        order: ownerKeys.filter((key) => !fresh.has(key) && current.has(key)).sort((a, b) => current.get(a)! - current.get(b)!),
      });
      let sessionId: string | null = null;
      try {
        sessionId = await this.deps.openSession(`Plan-${sprint}`);
        await this.deps.send(sessionId, text);
      } catch (error) {
        if (sessionId) await this.deps.deleteSession(sessionId).catch(() => undefined);
        this.failedAt = this.deps.now().getTime();
        await this.deps.store.saveSprintPlan(sprint, { status: 'failed', error: error instanceof Error ? error.message : 'The plan session could not start' });
        throw error;
      }
      try {
        await this.deps.store.saveSprintPlan(sprint, { status: 'mapping', mappingKeys: [...new Set([...tried, ...mapKeys])], sessionId, startedAt: this.deps.now(), error: null });
      } catch (error) {
        this.failedAt = this.deps.now().getTime();
        throw error;
      }
      return sessionId;
    } finally {
      this.starting = false;
    }
  }
}
