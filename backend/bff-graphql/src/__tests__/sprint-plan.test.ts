import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { JiraService, blockLinks } from '../integrations/jira';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { SprintPlanner, parsePlanDraft, planOrder, planPrompt, planTriggers, type PlanDeps, type PlanTicket } from '../integrations/sprint-plan';
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
  };
  return { store, edges, plans, orders, manual, events, retro };
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
    sprintKeys: async () => ['QRD-1', 'QRD-2', 'QRD-9'],
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

test('triggers: no plan runs full, a joined owner key runs ticket mode, an Epic is skipped, a stale run fails', () => {
  const tickets = [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-5', { issueType: 'Epic' })];
  assert.deepStrictEqual(planTriggers(tickets, null, NOW), { kind: 'full', sprint: 'S27', keys: ['QRD-1', 'QRD-2'] });
  assert.deepStrictEqual(planTriggers(tickets, row({ mappedKeys: '["QRD-1"]' }), NOW), { kind: 'ticket', sprint: 'S27', keys: ['QRD-2'] });
  assert.strictEqual(planTriggers(tickets, row({ mappedKeys: '["QRD-1","QRD-2"]' }), NOW), null);
  assert.strictEqual(planTriggers(tickets, row({ status: 'mapping', startedAt: new Date(NOW.getTime() - 3600_000) }), NOW), null);
  assert.deepStrictEqual(planTriggers(tickets, row({ status: 'mapping', startedAt: new Date(NOW.getTime() - 3 * 3600_000) }), NOW), { kind: 'expire', sprint: 'S27' });
  assert.strictEqual(planTriggers([ticket('QRD-1', { status: 'In Progress' })], null, NOW), null);
});

test('sprint start runs one full plan session; a later tick does not start another', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2')]);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  assert.strictEqual(world.sessions.length, 1);
  assert.strictEqual(world.sessions[0].title, 'Plan-S27');
  assert.strictEqual(world.sessions[0].text.split('\n')[0], 'Pakai skill sous: plan S27.');
  assert.match(world.sessions[0].text, /Owner tickets to order: QRD-1, QRD-2\. Other tickets of the sprint, read only as something an owner ticket may wait for: QRD-9\./);
  assert.deepStrictEqual([world.plans.get('S27')?.status, world.plans.get('S27')?.mappingKeys, world.plans.get('S27')?.sessionId], ['mapping', '["QRD-1","QRD-2"]', 'session-1']);
});

test('a send that fails deletes the new session, marks the plan failed, and holds off new starts for 30 minutes', async () => {
  let now = NOW;
  const deleted: string[] = [];
  let sends = 0;
  const world = planner([], {
    now: () => now,
    send: async () => { sends += 1; throw new Error('bridge went away'); },
    deleteSession: async (sessionId) => { deleted.push(sessionId); },
  });
  await assert.rejects(world.planner.watch([ticket('QRD-1')]), /bridge went away/);
  assert.deepStrictEqual(deleted, ['session-1']);
  assert.deepStrictEqual([world.plans.get('S27')?.status, world.plans.get('S27')?.error], ['failed', 'bridge went away']);
  now = new Date(NOW.getTime() + 29 * 60_000);
  await world.planner.watch([ticket('QRD-1')]);
  assert.strictEqual(sends, 1);
  now = new Date(NOW.getTime() + 30 * 60_000);
  await assert.rejects(world.planner.watch([ticket('QRD-1')]), /bridge went away/);
  assert.strictEqual(sends, 2);
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

test('an expired run is not retried; only a newly joined owner ticket starts a run, and its own expiry is not retried either', async () => {
  let now = NOW;
  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')], { now: () => now });
  const hours = (n: number) => { now = new Date(NOW.getTime() + n * 3600_000); };
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  hours(3);
  assert.deepStrictEqual(await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]), { kind: 'expire', sprint: 'S27' });
  assert.strictEqual(world.plans.get('S27')?.status, 'failed');
  hours(4);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2')]);
  assert.strictEqual(world.sessions.length, 1);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.strictEqual(world.sessions.length, 2);
  assert.match(world.sessions[1].text, /^Map only QRD-3 against the rest./m);
  hours(7);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  hours(8);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.deepStrictEqual([world.sessions.length, world.plans.get('S27')?.status, world.plans.get('S27')?.mappingKeys], [2, 'failed', '["QRD-1","QRD-2","QRD-3"]']);
  assert.strictEqual(typeof (await world.planner.map()), 'string');
  assert.strictEqual(world.sessions.length, 3);
});

test('a session sent but not saved as mapping does not open a second session on the next tick', async () => {
  let now = NOW;
  const world = planner([], { now: () => now });
  const save = world.store.saveSprintPlan;
  world.store.saveSprintPlan = async (sprint, data) => { if (data.status === 'mapping') throw new Error('db locked'); return save(sprint, data); };
  await assert.rejects(world.planner.watch([ticket('QRD-1')]), /db locked/);
  now = new Date(NOW.getTime() + 60_000);
  await world.planner.watch([ticket('QRD-1')]);
  assert.strictEqual(world.sessions.length, 1);
});

test('an owner ticket joining the sprint runs a ticket-mode session for it only; a teammate ticket starts nothing', async () => {
  const world = planner([]);
  await world.store.saveSprintPlan('S27', { status: 'idle', mappedKeys: ['QRD-1', 'QRD-2'] });
  await world.store.setTicketOrder('QRD-2', 1);
  await world.store.setTicketOrder('QRD-1', 2);
  await world.planner.watch([ticket('QRD-1', { links: [{ key: 'QRD-77', relation: 'blockedBy' }] }), ticket('QRD-2')]);
  assert.strictEqual(world.sessions.length, 0);
  await world.planner.watch([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')]);
  assert.strictEqual(world.sessions.length, 1);
  assert.match(world.sessions[0].text, /^Map only QRD-3 against the rest\. The order of the other tickets stays: QRD-2, QRD-1\.$/m);
  assert.strictEqual(world.plans.get('S27')?.mappingKeys, '["QRD-3"]');
});

test('the prompt carries only the accepted Try lines of the previous sprint', async () => {
  const world = planner([]);
  world.retro.push(
    { sprint: 'S26', kind: 'try', status: 'accepted', text: 'Map shared API files first' },
    { sprint: 'S26', kind: 'try', status: 'open', text: 'Open try line' },
    { sprint: 'S26', kind: 'try', status: 'closed', text: 'Closed try line' },
    { sprint: 'S26', kind: 'keep', status: 'accepted', text: 'Accepted keep line' },
    { sprint: 'S27', kind: 'try', status: 'accepted', text: 'This sprint line' },
  );
  await world.planner.watch([ticket('QRD-1')]);
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

test('ingest stores inferred edges as pending, writes the order, and Map again keeps accepted and rejected states', async () => {
  const world = planner([ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3'), ticket('QRD-4', { sprintName: 'S28' })]);
  world.manual.add('QRD-3');
  await world.store.saveSprintPlan('S27', { status: 'mapping', mappingKeys: ['QRD-1', 'QRD-2', 'QRD-3'], startedAt: NOW });
  const first = { sprint: 'S27', mode: 'full', tickets: ['QRD-1', 'QRD-2', 'QRD-3'], order: ['QRD-3', 'QRD-2', 'QRD-1', 'QRD-4'], groups: [['QRD-1', 'QRD-3']], edges: [
    { ticket: 'QRD-1', dependsOn: 'QRD-2', reason: 'a' }, { ticket: 'QRD-3', dependsOn: 'QRD-9', reason: 'b' }, { ticket: 'QRD-2', dependsOn: 'QRD-8', reason: 'c' }, { ticket: 'QRD-4', dependsOn: 'QRD-1', reason: 'other sprint' },
  ] };
  assert.deepStrictEqual(await world.planner.ingest(first), { sprint: 'S27', edges: 3, order: ['QRD-2', 'QRD-1'] });
  assert.deepStrictEqual(world.edges.map((edge) => edge.state), ['pending', 'pending', 'pending']);
  assert.deepStrictEqual([...world.orders], [['QRD-2', 1], ['QRD-1', 2]]);
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
