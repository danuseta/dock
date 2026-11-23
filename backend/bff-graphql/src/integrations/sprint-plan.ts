// A sprint's dependency map and a suggested work order. The lead drafts it in a `Plan-<sprint>` session the owner starts
// with Map dependencies; Jira "blocks" links apply at once, an inferred edge waits for the owner. The order it proposes is
// only kept as a suggestion: the work order is the owner's own, else the Jira "#N" label.
import { OrchestratorInputError } from './orchestrator';
import { isSettledStatus } from './attention';
import { labelOrder, startsWithoutWaiting } from './orchestrator-cron';
import type { TicketLink } from './jira';
import type { PlanEdgeInput, StorageService } from '../storage/service';

export interface PlanTicket { key: string; status: string; sprintName?: string | null; sprintState?: string | null; issueType?: string | null; links?: TicketLink[]; labels?: string[]; description?: string | null }
export interface PlanRow { status: string; mappingKeys: string; mappedKeys: string; startedAt: Date | null }
export type PlanMode = 'full' | 'ticket';
export type PlanTrigger = { kind: 'expire'; sprint: string } | null;
/** `edges` may become waits (kind dependency); `fileEdges` only share a file or component and never hold a ticket. */
export interface PlanDraft { sprint: string; mode: PlanMode; tickets: string[]; order: string[]; groups: string[][]; edges: PlanEdgeInput[]; fileEdges: PlanEdgeInput[] }
export interface Edge { ticketKey: string; dependsOnKey: string }
export interface SprintIssue { key: string; status?: string | null; assignee?: string | null }

export const PLAN_STALE_MS = 2 * 3600 * 1000;
export const SUGGESTED_ORDER_PREFIX = 'planSuggestedOrder:';
export const FILE_EDGES_PREFIX = 'planFileEdges:';
/** A ticket this many tickets wait on moves up in the suggested order. */
export const HUB_WAITERS = 3;
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

/** What the cron tick does with the plan: only the expiry of a mapping run that never posted. A run starts from Map dependencies alone. */
export function planTriggers(ownerTickets: PlanTicket[], plan: PlanRow | null, now: Date): PlanTrigger {
  const found = activeSprint(ownerTickets);
  if (!found || plan?.status !== 'mapping') return null;
  return plan.startedAt && now.getTime() - plan.startedAt.getTime() > PLAN_STALE_MS ? { kind: 'expire', sprint: found.sprint } : null;
}

/** The suggested order the last plan draft left for the sprint, or none. */
export function parseSuggestedOrder(raw: string | null | undefined): string[] {
  return keyList(parseKeys(raw));
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

/** The file edges the last plan draft left for the sprint: tickets that touch the same file, shown as merge-conflict risk. */
export function parseFileEdges(raw: string | null | undefined): PlanEdgeInput[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    return (Array.isArray(value) ? value : []).filter(isRecord)
      .map((item) => ({ ticketKey: keyOf(item.ticketKey), dependsOnKey: keyOf(item.dependsOnKey), reason: typeof item.reason === 'string' ? item.reason : null }))
      .filter((edge) => KEY.test(edge.ticketKey) && KEY.test(edge.dependsOnKey));
  } catch {
    return [];
  }
}

/**
 * The draft the plan session posts. Edges of a teammate's ticket, self-edges and edges that close a loop with `known` are
 * dropped. An edge of kind "file" (only the same file or component) goes to `fileEdges` and never waits; any other kind,
 * or none as in older drafts, is a dependency.
 */
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
  const fileEdges: PlanEdgeInput[] = [];
  const has = (list: PlanEdgeInput[], ticketKey: string, dependsOnKey: string) => list.some((edge) => edge.ticketKey === ticketKey && edge.dependsOnKey === dependsOnKey);
  for (const item of input.edges.filter(isRecord)) {
    const ticketKey = keyOf(item.ticket);
    const dependsOnKey = keyOf(item.dependsOn);
    if (!owner.has(ticketKey) || !KEY.test(dependsOnKey) || ticketKey === dependsOnKey) continue;
    const edge = { ticketKey, dependsOnKey, reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) || null : null };
    if (item.kind === 'file') {
      if (!has(fileEdges, ticketKey, dependsOnKey) && !has(edges, ticketKey, dependsOnKey) && fileEdges.length < MAX_EDGES) fileEdges.push(edge);
      continue;
    }
    if (has(edges, ticketKey, dependsOnKey) || wouldCycle(graph, ticketKey, dependsOnKey)) continue;
    const fileIndex = fileEdges.findIndex((other) => other.ticketKey === ticketKey && other.dependsOnKey === dependsOnKey);
    if (fileIndex >= 0) fileEdges.splice(fileIndex, 1);
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
    fileEdges,
  };
}

/** The suggested work order. A ticket run puts the new keys at their draft position and keeps the others in their current order. Manual tickets are left out. */
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

/** The smallest W of the ticket's "sprint-S-wave-W" Jira labels, or null. */
export function waveOf(labels: string[] | undefined): number | null {
  const waves = (labels || []).map((label) => /^sprint-\d+-wave-(\d{1,3})$/i.exec(label.trim())).filter(Boolean).map((match) => Number(match![1]));
  return waves.length ? Math.min(...waves) : null;
}

const waveLabel = (labels: string[] | undefined) => (labels || []).map((label) => label.trim()).find((label) => /^sprint-\d+-wave-\d{1,3}$/i.test(label)) ?? null;

export interface OrderTicket { key: string; status: string; labels?: string[]; description?: string | null; links?: TicketLink[] }
/** A stored plan edge: jira, or inferred and pending, accepted or rejected. File edges are never passed in. */
export interface OrderEdge { ticketKey: string; dependsOnKey: string; source: string; state: string }
export interface OrderParent { status?: string | null; assignee?: string | null }
export interface SuggestedRow { key: string; jiraOrder: number | null; wave: number | null; jiraPosition: number; waitedOn: number; atRisk: boolean; reason: string | null }

const isToDo = (status: string | null | undefined) => /^to ?do$/i.test(String(status || '').trim());
const ticketNumber = (key: string) => Number(key.split('-')[1]) || 0;
const byNumber = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
const NONE = Number.POSITIVE_INFINITY;
/** "#N" first, then the wave; a ticket without one comes after the ones with it. */
const jiraCompare = (a: Pick<OrderTicket, 'labels'>, b: Pick<OrderTicket, 'labels'>) => byNumber(labelOrder(a.labels) ?? NONE, labelOrder(b.labels) ?? NONE) || byNumber(waveOf(a.labels) ?? NONE, waveOf(b.labels) ?? NONE);

/**
 * DOCK's suggested work order, worked out here and never taken from the Plan agent as is.
 * 1. Jira order: the "#N" label, then the "sprint-S-wave-W" wave, then the agent's order, then the ticket number.
 * 2. A ticket waited on by 3 or more tickets (Jira Blocks and accepted dependency edges, the owner's and teammates')
 *    moves up past the tickets before it that nobody waits on, but never past a ticket of an earlier wave or a startable
 *    ticket with a lower "#N".
 * 3. A ticket that waits on a teammate's ticket still in To Do moves after every other ticket and is at risk.
 * 4. A ticket never comes before an open owner ticket it waits on (Jira Blocks, or a pending or accepted dependency edge).
 * A ticket with a "How it starts without waiting" paragraph skips 3 and 4 and keeps its place. Startable means no open
 * ticket to wait on, or that paragraph. Each row says why it moved.
 */
export function suggestOrder(tickets: OrderTicket[], edges: OrderEdge[], parentOf: (key: string) => OrderParent | null, agentOrder: string[] = []): SuggestedRow[] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const statusOf = (key: string) => byKey.get(key)?.status ?? parentOf(key)?.status ?? null;
  const live = edges.filter((edge) => edge.source === 'jira' || edge.state !== 'rejected');
  const parents = new Map<string, OrderEdge[]>();
  for (const edge of live) if (byKey.has(edge.ticketKey) && !isSettledStatus(statusOf(edge.dependsOnKey))) parents.set(edge.ticketKey, [...(parents.get(edge.ticketKey) ?? []), edge]);
  const waiters = new Map<string, Set<string>>();
  const waits = (parent: string, child: string) => { if (parent !== child) waiters.set(parent, (waiters.get(parent) ?? new Set()).add(child)); };
  for (const ticket of tickets) {
    for (const link of ticket.links || []) {
      if (link.relation === 'blocks') waits(ticket.key, link.key);
      else waits(link.key, ticket.key);
    }
  }
  for (const edge of live) if (edge.source === 'jira' || edge.state === 'accepted') waits(edge.dependsOnKey, edge.ticketKey);
  const waitedOn = (key: string) => waiters.get(key)?.size ?? 0;
  const free = (ticket: OrderTicket) => !!startsWithoutWaiting(ticket.description);
  const startable = (ticket: OrderTicket) => free(ticket) || !parents.has(ticket.key);
  const number = (ticket: OrderTicket) => labelOrder(ticket.labels) ?? NONE;
  const wave = (ticket: OrderTicket) => waveOf(ticket.labels) ?? NONE;
  const agent = (ticket: OrderTicket) => (agentOrder.includes(ticket.key) ? agentOrder.indexOf(ticket.key) : NONE);
  const compare = (useAgent: boolean) => (a: OrderTicket, b: OrderTicket) => jiraCompare(a, b) || (useAgent ? byNumber(agent(a), agent(b)) : 0) || ticketNumber(a.key) - ticketNumber(b.key);
  const jiraPosition = new Map([...tickets].sort(compare(false)).map((ticket, index) => [ticket.key, index + 1]));
  const reasons = new Map<string, string[]>(tickets.map((ticket) => [ticket.key, []]));
  const say = (key: string, text: string) => reasons.get(key)!.push(text);

  let list = [...tickets].sort(compare(true));
  const passable = (before: OrderTicket, hub: OrderTicket) => waitedOn(before.key) === 0
    && !(startable(before) && number(before) < number(hub))
    && !(Number.isFinite(wave(before)) && Number.isFinite(wave(hub)) && wave(before) < wave(hub));
  for (const hub of list.filter((ticket) => waitedOn(ticket.key) >= HUB_WAITERS)) {
    const from = list.indexOf(hub);
    let to = from;
    while (to > 0 && passable(list[to - 1], hub)) to -= 1;
    if (to < from) list = [...list.slice(0, to), hub, ...list.slice(to, from), ...list.slice(from + 1)];
    say(hub.key, `${to < from ? 'moved up: ' : ''}${waitedOn(hub.key)} tickets wait on it`);
  }

  const risk = new Map<string, string>();
  for (const ticket of list) {
    if (free(ticket)) continue;
    const blocker = (parents.get(ticket.key) ?? []).find((edge) => !byKey.has(edge.dependsOnKey) && isToDo(statusOf(edge.dependsOnKey)));
    if (!blocker) continue;
    const assignee = parentOf(blocker.dependsOnKey)?.assignee;
    risk.set(ticket.key, `moved after: waits on ${blocker.dependsOnKey} (To Do${assignee ? `, ${assignee}` : ''})`);
  }
  list = [...list.filter((ticket) => !risk.has(ticket.key)), ...list.filter((ticket) => risk.has(ticket.key))];

  const input = new Map(list.map((ticket, index) => [ticket.key, index]));
  const ownerParents = (ticket: OrderTicket) => (free(ticket) ? [] : (parents.get(ticket.key) ?? []).filter((edge) => input.has(edge.dependsOnKey)));
  const placed: OrderTicket[] = [];
  const at = new Map<string, number>();
  const remaining = [...list];
  while (remaining.length) {
    let index = remaining.findIndex((ticket) => ownerParents(ticket).every((edge) => at.has(edge.dependsOnKey)));
    if (index < 0) index = 0;
    const [ticket] = remaining.splice(index, 1);
    const deferred = placed.some((other) => input.get(other.key)! > input.get(ticket.key)!);
    const last = ownerParents(ticket).filter((edge) => at.has(edge.dependsOnKey)).sort((a, b) => at.get(b.dependsOnKey)! - at.get(a.dependsOnKey)!)[0];
    if (deferred && last) say(ticket.key, `after ${last.dependsOnKey}: ${last.source === 'jira' ? 'Jira Blocks' : 'dependency'}`);
    at.set(ticket.key, placed.length);
    placed.push(ticket);
  }

  return placed.map((ticket) => {
    const lines = reasons.get(ticket.key)!;
    if (risk.has(ticket.key)) lines.unshift(risk.get(ticket.key)!);
    if (free(ticket) && parents.has(ticket.key)) lines.unshift('starts without waiting');
    return {
      key: ticket.key,
      jiraOrder: labelOrder(ticket.labels),
      wave: waveOf(ticket.labels),
      jiraPosition: jiraPosition.get(ticket.key)!,
      waitedOn: waitedOn(ticket.key),
      atRisk: risk.has(ticket.key),
      reason: lines.length ? lines.join('; ') : null,
    };
  });
}

/** What the Plan agent is told about one owner ticket: its Jira place, whether it starts without waiting, and the teammates' tickets it waits on. */
export interface PlanTicketFact { key: string; order: number | null; wave: string | null; withoutWaiting: boolean; waitsOn: Array<{ key: string; status: string | null; assignee: string | null }> }

/** The facts of the owner tickets, in Jira order. */
export function planTicketFacts(tickets: PlanTicket[], edges: Edge[], issues: SprintIssue[]): PlanTicketFact[] {
  const owner = new Set(tickets.map((ticket) => ticket.key));
  const issue = new Map(issues.map((item) => [item.key, item]));
  return [...tickets].sort((a, b) => jiraCompare(a, b) || ticketNumber(a.key) - ticketNumber(b.key)).map((ticket) => ({
    key: ticket.key,
    order: labelOrder(ticket.labels),
    wave: waveLabel(ticket.labels),
    withoutWaiting: !!startsWithoutWaiting(ticket.description),
    waitsOn: edges.filter((edge) => edge.ticketKey === ticket.key && !owner.has(edge.dependsOnKey))
      .map((edge) => ({ key: edge.dependsOnKey, status: issue.get(edge.dependsOnKey)?.status ?? null, assignee: issue.get(edge.dependsOnKey)?.assignee ?? null })),
  }));
}

const factLine = (fact: PlanTicketFact) => [
  `- ${fact.key}: ${fact.order === null ? 'no #N' : `#${fact.order}`}, ${fact.wave ?? 'no wave label'}`,
  fact.withoutWaiting ? ', has a "How it starts without waiting" paragraph' : '',
  fact.waitsOn.length ? `, waits on ${fact.waitsOn.map((item) => `${item.key} (${[item.status ?? 'status unknown', item.assignee].filter(Boolean).join(', ')})`).join(', ')}` : '',
  '.',
].join('');

export interface PlanPromptInput { sprint: string; mode: PlanMode; ownerKeys: string[]; otherKeys: string[]; jiraEdges: Edge[]; previousSprint: string | null; tryLines: string[]; mapKeys: string[]; order: string[]; facts?: PlanTicketFact[] }

export function planPrompt(input: PlanPromptInput): string {
  const list = (keys: string[]) => (keys.length ? keys.join(', ') : 'none');
  const links = input.jiraEdges.map((edge) => `${edge.ticketKey} waits for ${edge.dependsOnKey}`).join('; ') || 'none';
  const facts = input.facts ?? [];
  return [
    `Pakai skill sous: plan ${input.sprint}.`,
    'Sprint plan run: read only. No branch, no code, no Jira edits, no ledger.',
    `Owner tickets to order: ${list(input.ownerKeys)}. Other tickets of the sprint, read only as something an owner ticket may wait for: ${list(input.otherKeys)}.`,
    'For each owner ticket read the status, the acceptance criteria (customfield_10332), the epic, the Jira issue links, and the code areas it will touch (sous-explorer).',
    `Jira links DOCK already applies, do not repeat them: ${links}.`,
    ...(facts.length ? ['Owner tickets in Jira order (the #N label, then the sprint-S-wave-W label, then the ticket number). This order is the baseline: keep it unless a dependency forces a ticket later.', ...facts.map(factLine)] : []),
    ...(input.previousSprint && input.tryLines.length ? [`Lessons accepted in the retro of ${input.previousSprint}, apply them:`, ...input.tryLines.map((line) => `- ${line}`)] : []),
    ...(input.mode === 'ticket' ? [`Map only ${list(input.mapKeys)} against the rest. The order of the other tickets stays: ${list(input.order)}.`] : []),
    'Write JSON {"sprint","mode","tickets","order":[owner keys, first to last],"groups":[[keys startable together now]],"edges":[{"ticket","dependsOn","kind","reason"}]}.',
    'Every edge has a kind. "dependency": the ticket needs an API, data shape, behaviour or UI that dependsOn builds, so it cannot start before dependsOn is merged. "file": they only touch the same file or component.',
    'Never add an edge whose only reason is a shared file as a dependency: additive changes handle that, DOCK shows it as merge-conflict risk and never makes the ticket wait. The reason names the API, data shape or contract, or for a file edge the file.',
    'A ticket with a "How it starts without waiting" paragraph starts without waiting: it can be in groups with the tickets it waits on.',
    'Post it: node "$K/dock-push.cjs" plan <file.json>.',
    'Write chat replies in Bahasa Indonesia.',
  ].join('\n');
}

export type PlanStore = Pick<StorageService,
  'getSprintPlan' | 'saveSprintPlan' | 'getPlanEdges' | 'replaceJiraEdges' | 'applyInferredEdges' | 'setPlanEdgeState' | 'getAcceptedPlanEdges'
  | 'getPendingPlanKeys' | 'addOrchestratorEventOnce' | 'getTicketOrders' | 'getManualTicketKeys' | 'getRetroItems' | 'getTicketDependencies' | 'getSettingValues' | 'upsertSetting'>;

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
  /** The sprint's issues from the dashboard snapshot, teammates' included. */
  sprintIssues: (sprintId: number) => Promise<SprintIssue[]>;
}

/** Starts and takes back the lead's plan runs. `watch` runs on every cron tick on the tickets the cron already fetched; it never starts a run. */
export class SprintPlanner {
  private lastJira = '';
  private starting = false;
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
    const trigger = planTriggers(tickets, await this.deps.store.getSprintPlan(active.sprint), this.deps.now());
    if (trigger) await this.deps.store.saveSprintPlan(trigger.sprint, { status: 'failed', error: 'No draft posted within 2 h' });
    return trigger;
  }

  /** "Map dependencies": a full run of the active sprint. Returns the session id. */
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
    const [previous, manual, plan] = await Promise.all([this.suggestedOrder(draft.sprint), this.deps.store.getManualTicketKeys(), this.deps.store.getSprintPlan(draft.sprint)]);
    const order = planOrder(draft, new Map(previous.map((key, index) => [key, index + 1])), manual);
    await this.deps.store.upsertSetting(`${SUGGESTED_ORDER_PREFIX}${draft.sprint}`, JSON.stringify(order), `Work order the Plan agent suggested for ${draft.sprint}`);
    const fresh = new Set(draft.tickets);
    const files = [...(draft.mode === 'ticket' ? (await this.fileEdges(draft.sprint)).filter((edge) => !fresh.has(edge.ticketKey)) : []), ...draft.fileEdges];
    await this.deps.store.upsertSetting(`${FILE_EDGES_PREFIX}${draft.sprint}`, JSON.stringify(files), `Tickets of ${draft.sprint} the Plan agent found touching the same file`);
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

  /** The order the last plan draft suggested for the sprint; it changes nothing until the owner uses it. */
  async suggestedOrder(sprint: string): Promise<string[]> {
    return parseSuggestedOrder((await this.deps.store.getSettingValues([`${SUGGESTED_ORDER_PREFIX}${sprint}`]))[0]?.value);
  }

  /** The same-file edges of the last plan draft: merge-conflict risk only, never a wait. */
  async fileEdges(sprint: string): Promise<PlanEdgeInput[]> {
    return parseFileEdges((await this.deps.store.getSettingValues([`${FILE_EDGES_PREFIX}${sprint}`]))[0]?.value);
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
      const [issues, retro, suggested] = await Promise.all([
        index >= 0 ? this.deps.sprintIssues(sprints[index].id).catch(() => [] as SprintIssue[]) : Promise.resolve([] as SprintIssue[]),
        previous ? this.deps.store.getRetroItems(previous.name) : Promise.resolve([]),
        this.suggestedOrder(sprint),
      ]);
      const current = new Map(suggested.map((key, position) => [key, position + 1]));
      const fresh = new Set(mapKeys);
      const text = planPrompt({
        sprint,
        mode,
        ownerKeys,
        otherKeys: issues.map((issue) => issue.key).filter((key) => !ownerKeys.includes(key)),
        jiraEdges: edges,
        previousSprint: previous?.name ?? null,
        tryLines: retro.filter((item) => item.kind === 'try' && item.status === 'accepted').map((item) => item.text),
        mapKeys,
        order: ownerKeys.filter((key) => !fresh.has(key) && current.has(key)).sort((a, b) => current.get(a)! - current.get(b)!),
        facts: planTicketFacts(tickets, edges, issues),
      });
      let sessionId: string | null = null;
      try {
        sessionId = await this.deps.openSession(`Plan-${sprint}`);
        await this.deps.send(sessionId, text);
      } catch (error) {
        if (sessionId) await this.deps.deleteSession(sessionId).catch(() => undefined);
        await this.deps.store.saveSprintPlan(sprint, { status: 'failed', error: error instanceof Error ? error.message : 'The plan session could not start' });
        throw error;
      }
      await this.deps.store.saveSprintPlan(sprint, { status: 'mapping', mappingKeys: [...new Set([...tried, ...mapKeys])], sessionId, startedAt: this.deps.now(), error: null });
      return sessionId;
    } finally {
      this.starting = false;
    }
  }
}
