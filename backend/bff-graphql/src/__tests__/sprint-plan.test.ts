import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { JiraService, blockLinks } from '../integrations/jira';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { PLAN_PROMPT_MAX, SprintPlanner, jiraEdges, parsePlanDraft, planOrder, planPrompt, planTriggers, suggestOrder, type OrderEdge, type PlanDeps, type PlanTicket } from '../integrations/sprint-plan';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { PlanEdgeInput, SprintPlanData } from '../storage/service';

const NOW = new Date('2026-11-03T03:00:00Z');
const ticket = (key: string, overrides: Partial<PlanTicket> = {}): PlanTicket => ({ key, status: 'To Do', sprintName: 'S27', sprintState: 'ACTIVE', issueType: 'Story', links: [], ...overrides });
const row = (overrides: Record<string, unknown> = {}) => ({ status: 'idle', mappingKeys: '[]', mappedKeys: '[]', startedAt: null, ...overrides });

interface EdgeRow { id: string; sprint: string; ticketKey: string; dependsOnKey: string; source: string; reason: string | null; state: string }

function fakeStore() {
  const edges: EdgeRow[] = [];
  const plans = new Map<string, Record<string, unknown>>();
  const orders = new Map<string, number>();
  const manual = new Set<string>();
  const events: Array<[string, string, string | null]> = [];
  const retro: Array<{ sprint: string; kind: string; status: string; text: string }> = [];
  const settings = new Map<string, string>();
  let id = 0;
  const same = (a: { ticketKey: string; dependsOnKey: string }, b: { ticketKey: string; dependsOnKey: string }) => a.ticketKey === b.ticketKey && a.dependsOnKey === b.dependsOnKey;
  const store = {
    getSprintPlan: async (sprint: string) => (plans.get(sprint) ?? null) as never,
    saveSprintPlan: async (sprint: string, data: SprintPlanData) => {
      const { mappingKeys, mappedKeys, groups, ...rest } = data;
      const next = { ...(plans.get(sprint) ?? row()), ...rest, ...(mappingKeys ? { mappingKeys: JSON.stringify(mappingKeys) } : {}), ...(mappedKeys ? { mappedKeys: JSON.stringify(mappedKeys) } : {}), ...(groups ? { groups: JSON.stringify(groups) } : {}) };
      plans.set(sprint, next);
      return next as never;
    },
    getPlanEdges: async (sprint: string) => edges.filter((edge) => edge.sprint === sprint) as never,
    replaceJiraEdges: async (sprint: string, list: PlanEdgeInput[]) => {
      for (const stale of edges.filter((edge) => edge.sprint === sprint && edge.source === 'jira' && !list.some((item) => same(item, edge)))) edges.splice(edges.indexOf(stale), 1);
      for (const item of list) {
        const held = edges.find((edge) => edge.sprint === sprint && same(edge, item));
        if (held) Object.assign(held, { source: 'jira', state: 'accepted' });
        else edges.push({ id: String((id += 1)), sprint, ticketKey: item.ticketKey, dependsOnKey: item.dependsOnKey, source: 'jira', reason: item.reason ?? null, state: 'accepted' });
      }
    },
    applyInferredEdges: async (sprint: string, list: PlanEdgeInput[], scope?: string[]) => {
      for (const stale of edges.filter((edge) => edge.sprint === sprint && edge.source === 'inferred' && edge.state === 'pending' && (!scope || scope.includes(edge.ticketKey)) && !list.some((item) => same(item, edge)))) edges.splice(edges.indexOf(stale), 1);
      for (const item of list) {
        if (!edges.some((edge) => edge.sprint === sprint && same(edge, item))) edges.push({ id: String((id += 1)), sprint, ticketKey: item.ticketKey, dependsOnKey: item.dependsOnKey, source: 'inferred', reason: item.reason ?? null, state: 'pending' });
      }
    },
    setPlanEdgeState: async (edgeId: string, state: string) => Object.assign(edges.find((edge) => edge.id === edgeId)!, { state }) as never,
    getAcceptedPlanEdges: async (sprint: string) => edges.filter((edge) => edge.sprint === sprint && edge.state === 'accepted') as never,
    getPendingPlanKeys: async (sprint: string) => new Set(edges.filter((edge) => edge.sprint === sprint && edge.state === 'pending').map((edge) => edge.ticketKey)),
    addOrchestratorEventOnce: async (key: string, kind: string, detail: string | null) => { events.push([key, kind, detail]); return null; },
    getTicketOrders: async () => new Map(orders),
    getManualTicketKeys: async () => new Set(manual),
    setTicketOrder: async (key: string, position: number) => { orders.set(key, position); return {} as never; },
    getRetroItems: async (sprint: string) => retro.filter((item) => item.sprint === sprint) as never,
    getTicketDependencies: async () => [] as never,
    getSettingValues: async (keys: string[]) => keys.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key)! })) as never,
    upsertSetting: async (key: string, value: string) => { settings.set(key, value); return {} as never; },
  };
  return { store, edges, plans, orders, manual, events, retro, settings };
}

function planner(tickets: PlanTicket[], overrides: Partial<PlanDeps> = {}) {
  const world = fakeStore();
  const sessions: Array<{ title: string; text: string }> = [];
  const deps: PlanDeps = {
    now: () => NOW,
    store: world.store as never,
    tickets: async () => tickets,
    canStart: () => true,
    openSession: async (title) => { sessions.push({ title, text: '' }); return `session-${sessions.length}`; },
    send: async (sessionId, text) => { sessions[Number(sessionId.split('-')[1]) - 1].text = text; },
    deleteSession: async () => undefined,
    sprints: async () => [{ id: 2, name: 'S27', state: 'active', startDate: '2026-11-02' }, { id: 1, name: 'S26', state: 'closed', startDate: '2026-10-19' }],
    sprintIssues: async () => [{ key: 'QRD-1' }, { key: 'QRD-2' }, { key: 'QRD-9' }],
    ...overrides,
  };
  return { ...world, sessions, planner: new SprintPlanner(deps) };
}

test('Jira links read both directions and drop other link types', () => {
  assert.deepStrictEqual(blockLinks([
    { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'QRD-2' } },
    { type: { name: 'Blocks' }, outwardIssue: { key: 'QRD-3' } },
    { type: { name: 'Dependency', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'QRD-4' } },
    { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, inwardIssue: { key: 'QRD-5' } },
  ]), [{ key: 'QRD-2', relation: 'blockedBy' }, { key: 'QRD-3', relation: 'blocks' }, { key: 'QRD-4', relation: 'blockedBy' }]);
  const formatted = new JiraService({} as never, {} as never).formatTicket({ key: 'QRD-1', fields: { issuetype: { name: 'Story' }, issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'QRD-2' } }] } }, 'x.atlassian.net');
  assert.deepStrictEqual([formatted?.issueType, formatted?.links], ['Story', [{ key: 'QRD-2', relation: 'blockedBy' }]]);
});

test('a cached ticket list without links is fetched again', async () => {
  let fetched = 0;
  const storage = { getCache: async () => [{ key: 'QRD-1', assignee: 'M', labels: [] }], upsertCache: async () => undefined };
  const client = { fetchAssignedTickets: async () => { fetched += 1; return { issues: [{ key: 'QRD-1', fields: { assignee: { displayName: 'M' } } }] }; } };
  const tickets = await new JiraService(storage as never, client as never).getAssignedTickets({ domain: 'x', email: 'e', apiToken: 't' });
  assert.strictEqual(fetched, 1);
  assert.deepStrictEqual(tickets[0].links, []);
});

test('a Jira link applies at once as an accepted edge of the owner ticket, without a second write when nothing changed', async () => {
  const tickets = [ticket('QRD-1', { links: [{ key: 'QRD-9', relation: 'blockedBy' }] }), ticket('QRD-2', { links: [{ key: 'QRD-1', relation: 'blocks' }, { key: 'QRD-8', relation: 'blocks' }] })];
  const world = planner(tickets, { canStart: () => false });
  let writes = 0;
  const replace = world.store.replaceJiraEdges;
  world.store.replaceJiraEdges = async (sprint, edges) => { writes += 1; return replace(sprint, edges); };
  await world.planner.watch(tickets);
  await world.planner.watch(tickets);
  assert.deepStrictEqual(world.edges.map((edge) => [edge.ticketKey, edge.dependsOnKey, edge.source, edge.state]), [['QRD-1', 'QRD-9', 'jira', 'accepted'], ['QRD-1', 'QRD-2', 'jira', 'accepted']]);
  assert.strictEqual(writes, 1);
});

test('triggers: no plan and a joined owner key start nothing; only a stale run expires', () => {
  const tickets = [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-5', { issueType: 'Epic' })];
  assert.strictEqual(planTriggers(tickets, null, NOW), null);
  assert.strictEqual(planTriggers(tickets, row({ mappedKeys: '["QRD-1"]' }), NOW), null);
  assert.strictEqual(planTriggers(tickets, row({ status: 'failed', mappingKeys: '["QRD-1"]' }), NOW), null);
  assert.strictEqual(planTriggers(tickets, row({ mappedKeys: '["QRD-1","QRD-2"]' }), NOW), null);
  assert.strictEqual(planTriggers(tickets, row({ status: 'mapping', startedAt: new Date(NOW.getTime() - 3600_000) }), NOW), null);
  assert.deepStrictEqual(planTriggers(tickets, row({ status: 'mapping', startedAt: new Date(NOW.getTime() - 3 * 3600_000) }), NOW), { kind: 'expire', sprint: 'S27' });
  assert.strictEqual(planTriggers([ticket('QRD-1', { status: 'In Progress' })], null, NOW), null);
});

test('a tick never starts a plan session; Map dependencies runs one full session', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2')]);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.strictEqual(world.sessions.length, 0);
  await world.planner.map();
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  assert.strictEqual(world.sessions.length, 1);
  assert.strictEqual(world.sessions[0].title, 'Plan-S27');
  assert.strictEqual(world.sessions[0].text.split('\n')[0], 'Pakai skill sous: plan S27.');
  assert.match(world.sessions[0].text, /Owner tickets to order: QRD-1, QRD-2\. Other tickets of the sprint, read only as something an owner ticket may wait for: QRD-9\./);
  assert.deepStrictEqual([world.plans.get('S27')?.status, world.plans.get('S27')?.mappingKeys, world.plans.get('S27')?.sessionId], ['mapping', '["QRD-1","QRD-2"]', 'session-1']);
});

test('a send that fails deletes the new session and marks the plan failed; the next tick does not retry it', async () => {
  const deleted: string[] = [];
  let sends = 0;
  const world = planner([ticket('QRD-1')], {
    send: async () => { sends += 1; throw new Error('bridge went away'); },
    deleteSession: async (sessionId) => { deleted.push(sessionId); },
  });
  await assert.rejects(world.planner.map(), /bridge went away/);
  assert.deepStrictEqual(deleted, ['session-1']);
  assert.deepStrictEqual([world.plans.get('S27')?.status, world.plans.get('S27')?.error], ['failed', 'bridge went away']);
  await world.planner.watch([ticket('QRD-1')]);
  assert.strictEqual(sends, 1);
});

test('a ticket-mode draft only replaces the pending edges of its own tickets', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  await world.planner.ingest({ sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2'], order: [], edges: [{ ticket: 'QRD-1', dependsOn: 'QRD-8' }, { ticket: 'QRD-2', dependsOn: 'QRD-9' }] });
  await world.planner.ingest({ sprint: 'S27', mode: 'ticket', tickets: ['QRD-3'], order: [], edges: [{ ticket: 'QRD-3', dependsOn: 'QRD-1' }] });
  assert.deepStrictEqual(world.edges.map((edge) => edge.ticketKey), ['QRD-1', 'QRD-2', 'QRD-3']);
  await world.planner.ingest({ sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2', 'QRD-3'], order: [], edges: [{ ticket: 'QRD-3', dependsOn: 'QRD-1' }] });
  assert.deepStrictEqual(world.edges.map((edge) => edge.ticketKey), ['QRD-3']);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.deepStrictEqual(await world.planner.heldKeys(), new Set(['QRD-3']));
});

test('an expired run fails once and is not retried by a tick; Map dependencies starts a new one', async () => {
  let now = NOW;
  const world = planner([ticket('QRD-1'), ticket('QRD-2')], { now: () => now });
  const hours = (n: number) => { now = new Date(NOW.getTime() + n * 3600_000); };
  await world.planner.map();
  hours(1);
  assert.strictEqual(await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]), null);
  hours(3);
  assert.deepStrictEqual(await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]), { kind: 'expire', sprint: 'S27' });
  assert.strictEqual(world.plans.get('S27')?.status, 'failed');
  hours(4);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.strictEqual(world.sessions.length, 1);
  assert.strictEqual(typeof (await world.planner.map()), 'string');
  assert.strictEqual(world.sessions.length, 2);
});

test('a session sent but not saved as mapping fails Map dependencies, and the next tick opens nothing', async () => {
  let now = NOW;
  const world = planner([ticket('QRD-1')], { now: () => now });
  const save = world.store.saveSprintPlan;
  world.store.saveSprintPlan = async (sprint, data) => { if (data.status === 'mapping') throw new Error('db locked'); return save(sprint, data); };
  await assert.rejects(world.planner.map(), /db locked/);
  now = new Date(NOW.getTime() + 60_000);
  await world.planner.watch([ticket('QRD-1')]);
  assert.strictEqual(world.sessions.length, 1);
});

test('an owner ticket joining the sprint starts nothing; the full map lists every owner ticket', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  await world.store.saveSprintPlan('S27', { status: 'idle', mappedKeys: ['QRD-1', 'QRD-2'] });
  await world.planner.watch([ticket('QRD-1', { links: [{ key: 'QRD-77', relation: 'blockedBy' }] }), ticket('QRD-2')]);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.strictEqual(world.sessions.length, 0);
  await world.planner.map();
  assert.match(world.sessions[0].text, /Owner tickets to order: QRD-1, QRD-2, QRD-3\./);
  assert.strictEqual(world.plans.get('S27')?.mappingKeys, '["QRD-1","QRD-2","QRD-3"]');
});

test('the prompt carries only the accepted Try lines of the previous sprint', async () => {
  const world = planner([ticket('QRD-1')]);
  world.retro.push(
    { sprint: 'S26', kind: 'try', status: 'accepted', text: 'Map shared API files first' },
    { sprint: 'S26', kind: 'try', status: 'open', text: 'Open try line' },
    { sprint: 'S26', kind: 'try', status: 'closed', text: 'Closed try line' },
    { sprint: 'S26', kind: 'keep', status: 'accepted', text: 'Accepted keep line' },
    { sprint: 'S27', kind: 'try', status: 'accepted', text: 'This sprint line' },
  );
  await world.planner.map();
  const text = world.sessions[0].text;
  assert.match(text, /Lessons accepted in the retro of S26, apply them:\n- Map shared API files first\n/);
  for (const absent of ['Open try line', 'Closed try line', 'Accepted keep line', 'This sprint line', 'Map only']) assert.ok(!text.includes(absent), absent);
  assert.strictEqual(planPrompt({ sprint: 'S1', mode: 'full', ownerKeys: [], otherKeys: [], jiraEdges: [], previousSprint: null, tryLines: [], mapKeys: [], order: [] }).includes('Lessons'), false);
});

test('a draft drops a teammate edge, a self-edge and a cycle; malformed drafts are refused', () => {
  const draft = parsePlanDraft({ sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2'], order: ['QRD-2', 'QRD-1', 'QRD-9'], groups: [['QRD-1', 'qrd-2']], edges: [
    { ticket: 'QRD-1', dependsOn: 'QRD-2', reason: 'shared resolver' },
    { ticket: 'QRD-9', dependsOn: 'QRD-1', reason: 'teammate' },
    { ticket: 'QRD-2', dependsOn: 'QRD-2', reason: 'self' },
    { ticket: 'QRD-2', dependsOn: 'QRD-1', reason: 'loop with the first' },
    { ticket: 'QRD-2', dependsOn: 'QRD-5', reason: 'loop with a hand edge' },
  ] }, ['QRD-1', 'QRD-2'], [{ ticketKey: 'QRD-5', dependsOnKey: 'QRD-2' }]);
  assert.deepStrictEqual(draft.edges, [{ ticketKey: 'QRD-1', dependsOnKey: 'QRD-2', reason: 'shared resolver' }]);
  assert.deepStrictEqual([draft.order, draft.groups], [['QRD-2', 'QRD-1'], [['QRD-1', 'QRD-2']]]);
  for (const bad of [null, [], { mode: 'full', edges: [], order: [] }, { sprint: 'S27', mode: 'part', edges: [], order: [] }, { sprint: 'S27', edges: {}, order: [] }, { sprint: 'S27', edges: [] }]) {
    assert.throws(() => parsePlanDraft(bad, ['QRD-1']), OrchestratorInputError);
  }
});

test('the work order covers owner tickets only, skips manual ones, and a ticket run keeps the others in place', () => {
  assert.deepStrictEqual(planOrder({ mode: 'full', order: ['QRD-2', 'QRD-1', 'QRD-3'], tickets: [] }, new Map(), new Set(['QRD-1'])), ['QRD-2', 'QRD-3']);
  assert.deepStrictEqual(planOrder({ mode: 'ticket', order: ['QRD-1', 'QRD-3', 'QRD-2'], tickets: ['QRD-3'] }, new Map([['QRD-2', 1], ['QRD-1', 2]]), new Set()), ['QRD-2', 'QRD-3', 'QRD-1']);
});

test('ingest stores inferred edges as pending, keeps the order as a suggestion without touching TicketOrder, and Map again keeps accepted and rejected states', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3'), ticket('QRD-4', { sprintName: 'S28' })]);
  world.manual.add('QRD-3');
  world.orders.set('QRD-4', 7);
  await world.store.saveSprintPlan('S27', { status: 'mapping', mappingKeys: ['QRD-1', 'QRD-2', 'QRD-3'], startedAt: NOW });
  const first = { sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2', 'QRD-3'], order: ['QRD-3', 'QRD-2', 'QRD-1', 'QRD-4'], groups: [['QRD-1', 'QRD-3']], edges: [
    { ticket: 'QRD-1', dependsOn: 'QRD-2', reason: 'a' }, { ticket: 'QRD-3', dependsOn: 'QRD-9', reason: 'b' }, { ticket: 'QRD-2', dependsOn: 'QRD-8', reason: 'c' }, { ticket: 'QRD-4', dependsOn: 'QRD-1', reason: 'other sprint' },
  ] };
  assert.deepStrictEqual(await world.planner.ingest(first), { sprint: 'S27', edges: 3, order: ['QRD-2', 'QRD-1'] });
  assert.deepStrictEqual(world.edges.map((edge) => edge.state), ['pending', 'pending', 'pending']);
  assert.deepStrictEqual([...world.orders], [['QRD-4', 7]]);
  assert.deepStrictEqual(await world.planner.suggestedOrder('S27'), ['QRD-2', 'QRD-1']);
  assert.strictEqual(world.settings.get('planSuggestedOrder:S27'), '["QRD-2","QRD-1"]');
  const plan = world.plans.get('S27')!;
  assert.deepStrictEqual([plan.status, plan.mappingKeys, plan.mappedKeys, plan.groups, plan.mappedAt, plan.error], ['idle', '[]', '["QRD-1","QRD-2","QRD-3"]', '[["QRD-1","QRD-3"]]', NOW, null]);

  await world.planner.decide('S27', world.edges[0].id, 'accept');
  await world.planner.decide('S27', world.edges[1].id, 'reject');
  await world.planner.ingest({ ...first, edges: [{ ticket: 'QRD-1', dependsOn: 'QRD-2' }, { ticket: 'QRD-3', dependsOn: 'QRD-9' }] });
  assert.deepStrictEqual(world.edges.map((edge) => [edge.ticketKey, edge.dependsOnKey, edge.state]), [['QRD-1', 'QRD-2', 'accepted'], ['QRD-3', 'QRD-9', 'rejected']]);
  assert.deepStrictEqual(await world.planner.heldKeys(), new Set());
});

test('an accept that would close a loop is refused', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2')]);
  await world.store.replaceJiraEdges('S27', [{ ticketKey: 'QRD-1', dependsOnKey: 'QRD-2' }]);
  world.edges.push({ id: 'x', sprint: 'S27', ticketKey: 'QRD-2', dependsOnKey: 'QRD-1', source: 'inferred', reason: null, state: 'pending' });
  await assert.rejects(world.planner.decide('S27', 'x', 'accept'), /loop/);
  assert.strictEqual((await world.planner.decide('S27', 'x', 'reject')).state, 'rejected');
});

test('the /plan ingest route stores a draft and refuses a malformed one', async () => {
  const seen: unknown[] = [];
  const service = { authenticateMachine: async () => 'workspace' };
  const planner = { ingest: async (body: unknown) => { seen.push(body); const draft = parsePlanDraft(body, ['QRD-1']); return { sprint: draft.sprint, edges: draft.edges.length, order: draft.order }; } };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service as never, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, undefined, planner));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/plan`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dock_ing_token' }, body: JSON.stringify(body) });
  try {
    const ok = await post({ sprint: 'S27', order: ['QRD-1'], edges: [] });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual((await ok.json()).result.order, ['QRD-1']);
    const bad = await post({ sprint: 'S27', edges: 'nope', order: [] });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(await bad.json(), { error: 'edges must be an array' });
    assert.strictEqual(seen.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an edge without a kind is a dependency; a file edge never becomes a wait and is kept as merge-conflict risk', async () => {
  const draft = parsePlanDraft({ sprint: 'S27', order: [], edges: [
    { ticket: 'QRD-1', dependsOn: 'QRD-2', reason: 'needs the playbook API' },
    { ticket: 'QRD-3', dependsOn: 'QRD-1', kind: 'file', reason: 'playbook.schema.ts' },
    { ticket: 'QRD-2', dependsOn: 'QRD-1', kind: 'file', reason: 'would loop as a dependency' },
    { ticket: 'QRD-3', dependsOn: 'QRD-2', kind: 'dependency', reason: 'data shape' },
  ] }, ['QRD-1', 'QRD-2', 'QRD-3']);
  assert.deepStrictEqual(draft.edges.map((edge) => `${edge.ticketKey}>${edge.dependsOnKey}`), ['QRD-1>QRD-2', 'QRD-3>QRD-2']);
  assert.deepStrictEqual(draft.fileEdges, [{ ticketKey: 'QRD-3', dependsOnKey: 'QRD-1', reason: 'playbook.schema.ts' }, { ticketKey: 'QRD-2', dependsOnKey: 'QRD-1', reason: 'would loop as a dependency' }]);

  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  await world.planner.ingest({ sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2', 'QRD-3'], order: [], edges: [{ ticket: 'QRD-3', dependsOn: 'QRD-1', kind: 'file', reason: 'playbook.schema.ts' }] });
  assert.deepStrictEqual(world.edges, []);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.deepStrictEqual(await world.planner.heldKeys(), new Set());
  assert.deepStrictEqual(await world.planner.fileEdges('S27'), [{ ticketKey: 'QRD-3', dependsOnKey: 'QRD-1', reason: 'playbook.schema.ts' }]);
  await world.planner.ingest({ sprint: 'S27', mode: 'ticket', tickets: ['QRD-2'], order: [], edges: [{ ticket: 'QRD-2', dependsOn: 'QRD-1', kind: 'file', reason: 'menu.tsx' }] });
  assert.deepStrictEqual((await world.planner.fileEdges('S27')).map((edge) => edge.reason), ['playbook.schema.ts', 'menu.tsx'], 'a ticket run keeps the other tickets file edges');
});

const FREE = 'How it starts without waiting: against the frozen fixture of the parent API.';

test('the suggested order starts from Jira #N, keeps dependencies, lets without-waiting tickets keep their place and puts at-risk tickets last', () => {
  const hubWaiters = ['QRD-1700', 'QRD-1701', 'QRD-1702', 'QRD-1703', 'QRD-1704', 'QRD-1705'].map((key) => ({ key, relation: 'blocks' as const }));
  const tickets = [
    ticket('QRD-1593', { labels: ['#17'] }),
    ticket('QRD-1580', { labels: ['#8', 'sprint-28-wave-2'] }),
    ticket('QRD-1579', { labels: ['#1', 'sprint-28-wave-1'] }),
    ticket('QRD-1641', { labels: ['#2', 'sprint-28-wave-1'], links: hubWaiters }),
    ticket('QRD-1570', { labels: ['#3', 'sprint-28-wave-1'] }),
    ticket('QRD-1639', { labels: ['#4'], description: FREE, links: [{ key: 'QRD-1638', relation: 'blockedBy' }] }),
    ticket('QRD-1647', { labels: ['#5'] }),
    ticket('QRD-1582', { labels: ['#6'], links: [{ key: 'QRD-1570', relation: 'blockedBy' }, { key: 'QRD-1579', relation: 'blockedBy' }] }),
    ticket('QRD-1646', { labels: ['#7'], description: FREE, links: [{ key: 'QRD-1580', relation: 'blockedBy' }] }),
    ticket('QRD-1650', { labels: ['#9'], links: [{ key: 'QRD-1660', relation: 'blockedBy' }] }),
    ticket('QRD-1594', { labels: ['#10'] }),
  ];
  const edges: OrderEdge[] = [
    ...jiraEdges(tickets).map((edge) => ({ ...edge, source: 'jira', state: 'accepted' })),
    { ticketKey: 'QRD-1580', dependsOnKey: 'QRD-1579', source: 'inferred', state: 'accepted' },
    { ticketKey: 'QRD-1647', dependsOnKey: 'QRD-1580', source: 'inferred', state: 'pending' },
    { ticketKey: 'QRD-1593', dependsOnKey: 'QRD-1594', source: 'inferred', state: 'rejected' },
  ];
  const teammates: Record<string, { status: string; assignee: string }> = { 'QRD-1638': { status: 'To Do', assignee: 'Yusril' }, 'QRD-1660': { status: 'To Do', assignee: 'Yusril' } };
  const agentOrder = ['QRD-1579', 'QRD-1580', 'QRD-1582', 'QRD-1570', 'QRD-1593', 'QRD-1641'];
  const rows = suggestOrder(tickets, edges, (key) => teammates[key] ?? null, agentOrder);
  assert.deepStrictEqual(rows.map((row) => [row.key, row.jiraOrder, row.reason]), [
    ['QRD-1579', 1, null],
    ['QRD-1641', 2, '6 tickets wait on it'],
    ['QRD-1570', 3, null],
    ['QRD-1639', 4, 'starts without waiting'],
    ['QRD-1582', 6, null],
    ['QRD-1646', 7, 'starts without waiting'],
    ['QRD-1580', 8, null],
    ['QRD-1647', 5, 'after QRD-1580: dependency'],
    ['QRD-1594', 10, null],
    ['QRD-1593', 17, null],
    ['QRD-1650', 9, 'moved after: waits on QRD-1660 (To Do, Yusril)'],
  ]);
  assert.deepStrictEqual(rows.filter((row) => row.atRisk).map((row) => row.key), ['QRD-1650']);
  assert.strictEqual(rows.find((row) => row.key === 'QRD-1641')!.waitedOn, 6);
  assert.deepStrictEqual([rows.find((row) => row.key === 'QRD-1580')!.wave, rows.find((row) => row.key === 'QRD-1647')!.jiraPosition], [2, 5]);
});

test('a ticket already in progress keeps its Jira place even when it waits on a teammate To Do ticket, and its dependants follow it', () => {
  const rows = suggestOrder([
    ticket('QRD-1579', { labels: ['#1'], status: 'PR Review' }),
    ticket('QRD-1570', { labels: ['#3'], status: 'In Progress', links: [{ key: 'QRD-1569', relation: 'blockedBy' }] }),
    ticket('QRD-1582', { labels: ['#6'], links: [{ key: 'QRD-1570', relation: 'blockedBy' }] }),
    ticket('QRD-1593', { labels: ['#17'] }),
  ], [
    { ticketKey: 'QRD-1570', dependsOnKey: 'QRD-1569', source: 'jira', state: 'accepted' },
    { ticketKey: 'QRD-1582', dependsOnKey: 'QRD-1570', source: 'jira', state: 'accepted' },
  ], () => ({ status: 'To Do', assignee: 'Dwi Indra' }));
  assert.deepStrictEqual(rows.map((row) => [row.key, row.atRisk, row.reason]), [
    ['QRD-1579', false, 'already PR Review'],
    ['QRD-1570', false, 'already In Progress'],
    ['QRD-1582', false, null],
    ['QRD-1593', false, null],
  ]);
});

test('a ticket many tickets wait on moves up past tickets nobody waits on, never past a startable lower #N or an earlier wave', () => {
  const waiters = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `QRD-${900 + index}`, relation: 'blocks' as const }));
  const rows = suggestOrder([
    ticket('QRD-1', { labels: ['#1'] }),
    ticket('QRD-2', { labels: ['#2'], links: [{ key: 'QRD-50', relation: 'blockedBy' }] }),
    ticket('QRD-3', { labels: ['#3'], links: waiters(3) }),
    ticket('QRD-4', { labels: ['sprint-28-wave-1'] }),
    ticket('QRD-5', { labels: ['sprint-28-wave-2'] }),
    ticket('QRD-6', { labels: ['sprint-28-wave-2'] }),
    ticket('QRD-7', { labels: ['sprint-28-wave-2'], links: waiters(4) }),
  ], [{ ticketKey: 'QRD-2', dependsOnKey: 'QRD-50', source: 'jira', state: 'accepted' }], () => ({ status: 'In Progress', assignee: 'Rina' }));
  assert.deepStrictEqual(rows.map((row) => [row.key, row.reason, row.atRisk]), [
    ['QRD-1', null, false],
    ['QRD-3', 'moved up: 3 tickets wait on it', false],
    ['QRD-2', null, false],
    ['QRD-4', null, false],
    ['QRD-7', 'moved up: 4 tickets wait on it', false],
    ['QRD-5', null, false],
    ['QRD-6', null, false],
  ]);
});

test('the prompt gives each owner ticket its Jira place, without-waiting paragraph and the teammates tickets it waits on, and asks for a kind on every edge', async () => {
  const world = planner([
    ticket('QRD-2', { labels: ['#1', 'sprint-27-wave-1'], description: FREE, links: [{ key: 'QRD-9', relation: 'blockedBy' }] }),
    ticket('QRD-1', { labels: ['#2'] }),
  ], { sprintIssues: async () => [{ key: 'QRD-1' }, { key: 'QRD-2' }, { key: 'QRD-9', status: 'To Do', assignee: 'Yusril' }] });
  await world.planner.map();
  const text = world.sessions[0].text;
  assert.match(text, /This order is the baseline/);
  assert.match(text, /- QRD-2 #1 sprint-27-wave-1 nowait waits QRD-9 \(To Do, Yusril\)\n- QRD-1 #2 no-wave/);
  assert.match(text, /"edges":\[\{"ticket","dependsOn","kind","reason"\}\]/);
  assert.match(text, /Never add an edge whose only reason is a shared file as a dependency/);
  assert.match(text, /keys startable together now/);
});

test('a big sprint still fits one chat message: details, lessons, the link list and last facts give way in that order', () => {
  const keys = Array.from({ length: 60 }, (_, i) => `QRD-${1600 + i}`);
  const facts = keys.map((key, i) => ({ key, order: i + 1, wave: 'sprint-1-wave-1', withoutWaiting: i % 3 === 0, waitsOn: [{ key: `QRD-${1700 + i}`, status: 'To Do', assignee: 'Yusril Izza' }, { key: `QRD-${1800 + i}`, status: 'In Progress', assignee: 'Alvin Theofilus Sutikno' }] }));
  const jiraEdges = keys.flatMap((key, i) => [{ ticketKey: key, dependsOnKey: `QRD-${1700 + i}` }, { ticketKey: key, dependsOnKey: `QRD-${1800 + i}` }, { ticketKey: key, dependsOnKey: `QRD-${1900 + i}` }]);
  const tryLines = Array.from({ length: 12 }, (_, i) => `Lesson ${i}: ${'a reason that is long enough to matter '.repeat(3)}`);
  const input = { sprint: 'QRD Sprint 28', mode: 'full' as const, ownerKeys: keys, otherKeys: jiraEdges.map((edge) => edge.dependsOnKey), jiraEdges, previousSprint: 'QRD Sprint 27', tryLines, mapKeys: [], order: [], facts };
  const text = planPrompt(input);
  assert.ok(text.length <= PLAN_PROMPT_MAX, `prompt is ${text.length} characters`);
  assert.match(text, /Post it: node "\$K\/dock-push.cjs" plan <file.json>\./, 'the instructions at the end survive');
  const small = planPrompt({ ...input, ownerKeys: keys.slice(0, 3), otherKeys: [], jiraEdges: jiraEdges.slice(0, 3), tryLines: [], facts: facts.slice(0, 3) });
  assert.match(small, /QRD-1600 < QRD-1700 QRD-1800 QRD-1900/, 'links are grouped per waiting ticket');
  assert.match(small, /waits QRD-1700 \(To Do, Yusril Izza\)/, 'a small sprint keeps the details');
});
