import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CronInputError, DEFAULT_CRON_SETTINGS, HOLD_WAIT_TEXT, OrchestratorCron, SPRINT_STARTED_KEY, candidates, orderOf, orderSourceOf, parseSprintStarts, sprintHeld, startPreview,
  type CronDeps, type CronTicket,
} from '../integrations/orchestrator-cron';
import { HOLD_NEW_SPRINT_KEY, OpsRulesInputError, parseHoldNewSprint, readHoldNewSprint } from '../integrations/ops-rules';
import { WORK_ORDER_RESET_KEY, WorkOrderReset } from '../integrations/work-order-reset';

const AC = 'Acceptance criteria\n\nThe page shows the plan status.';
const SPRINT = 'QRD Sprint 28';
const ticket = (key: string, labels: string[] = [], over: Partial<CronTicket> = {}): CronTicket => ({ key, title: `${key} title`, description: AC, status: 'To Do', sprintState: 'ACTIVE', sprintName: SPRINT, labels, ...over });
const keys = (list: Array<{ key: string }>) => list.map((item) => item.key);

function world(tickets: CronTicket[], options: { hold?: string | null; started?: Record<string, string>; parallel?: number; deps?: Array<{ ticketKey: string; dependsOnKey: string }>; order?: Map<string, number>; held?: Set<string>; busy?: number; taken?: string[] } = {}) {
  const settings = new Map<string, string>();
  settings.set('orchestratorCronConfig', JSON.stringify({ ...DEFAULT_CRON_SETTINGS, enabled: true, parallel: options.parallel ?? 2, workDays: [1, 2, 3, 4, 5, 6, 7], workStart: 0, workEnd: 24 }));
  if (options.hold !== undefined && options.hold !== null) settings.set(HOLD_NEW_SPRINT_KEY, options.hold);
  if (options.started) settings.set(SPRINT_STARTED_KEY, JSON.stringify(options.started));
  const opened: string[] = [];
  const cache = new Map<string, unknown>();
  const deps: CronDeps = {
    now: () => new Date('2026-11-23T03:00:00Z'),
    settingValue: async (key) => settings.get(key) ?? null,
    saveSetting: async (key, value) => { settings.set(key, value); },
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    cacheDelete: async (key) => { cache.delete(key); },
    tickets: async () => tickets,
    ticket: async (key) => tickets.find((item) => item.key === key) ?? null,
    moveTicket: async () => true,
    dependencies: async () => options.deps ?? [],
    heldKeys: async () => options.held ?? new Set(),
    planWatch: async () => null,
    recordWait: async () => undefined,
    dockOrder: async () => options.order ?? new Map(),
    manualKeys: async () => new Set(),
    slots: async () => ({ busy: options.busy ?? 0, waiting: 0 }),
    machines: async () => ['workspace'],
    online: () => true,
    limitsUsed: () => ({ fiveHour: null, sevenDay: null }),
    takenKeys: async () => options.taken ?? [],
    deadStarts: async () => [],
    runs: async () => [],
    saveRun: async () => undefined,
    park: async () => undefined,
    cronSessions: async () => new Map(),
    openSession: async (input) => { opened.push(input.ticketKey); return { id: `s-${opened.length}` }; },
    machineOptions: async (_machine, opts) => opts,
    deleteSession: async () => undefined,
    ownerSessionBusy: async () => false,
    send: async () => undefined,
    ownerReplySession: async () => 'new',
    lastTaskSession: async () => null,
    runningSessions: async () => [],
    stopTurn: async () => undefined,
    hasPushDevices: async () => false,
    push: async () => undefined,
  };
  return { cron: new OrchestratorCron(deps), opened, settings };
}

test('hold rule: on by default, saved as { enabled }, a wrong value is refused and a broken row reads as the default', () => {
  assert.deepEqual(parseHoldNewSprint(null), { enabled: true });
  assert.deepEqual(parseHoldNewSprint('{"enabled":false}'), { enabled: false });
  assert.throws(() => parseHoldNewSprint('{"enabled":"no"}'), OpsRulesInputError);
  assert.throws(() => parseHoldNewSprint('[]'), OpsRulesInputError);
  assert.deepEqual(readHoldNewSprint('not json'), { enabled: true });
});

test('a held sprint: the fill takes nothing and defers every candidate with the Start reason', async () => {
  const { cron, opened } = world([ticket('QRD-1', ['#1']), ticket('QRD-2', ['#2'])]);
  const log = await cron.runFill();
  assert.equal(log.skipped, null);
  assert.deepEqual(log.started, []);
  assert.deepEqual(log.parked, []);
  assert.deepEqual(log.deferred, [{ key: 'QRD-1', reason: HOLD_WAIT_TEXT }, { key: 'QRD-2', reason: HOLD_WAIT_TEXT }]);
  assert.deepEqual(opened, []);
});

test('after Start sprint work the fill takes the sprint, and a ticket that joins later is taken as before', async () => {
  const tickets = [ticket('QRD-1', ['#1']), ticket('QRD-2', ['#2']), ticket('QRD-3')];
  const { cron, opened, settings } = world(tickets, { parallel: 1 });
  const view = await cron.startSprintWork(SPRINT);
  assert.equal(view.held, false);
  assert.equal(view.startedAt, '2026-11-23T03:00:00.000Z');
  assert.deepEqual(parseSprintStarts(settings.get(SPRINT_STARTED_KEY)), { [SPRINT]: '2026-11-23T03:00:00.000Z' });
  const log = await cron.runFill();
  assert.deepEqual(log.started, ['QRD-1']);
  assert.ok(!log.deferred.some((item) => item.reason === HOLD_WAIT_TEXT));
  assert.deepEqual(opened, ['QRD-1']);
  tickets.push(ticket('QRD-9'));
  assert.ok((await cron.runFill()).deferred.some((item) => item.key === 'QRD-9' && item.reason.startsWith('slots full')));
});

test('the hold off: tickets are taken as before; a sprint started earlier keeps its first start time', async () => {
  const { cron } = world([ticket('QRD-1')], { hold: '{"enabled":false}' });
  assert.deepEqual((await cron.runFill()).started, ['QRD-1']);
  const started = world([ticket('QRD-1')], { started: { [SPRINT]: '2026-11-20T01:00:00.000Z' } });
  assert.equal((await started.cron.startSprintWork(SPRINT)).startedAt, '2026-11-20T01:00:00.000Z');
  assert.equal(sprintHeld(null, true, {}), false, 'a ticket without a sprint is never held');
  assert.equal(sprintHeld(SPRINT, true, {}), true);
});

test('Start sprint work refuses an empty or unknown sprint', async () => {
  const { cron } = world([ticket('QRD-1')]);
  await assert.rejects(cron.startSprintWork(' '), CronInputError);
  await assert.rejects(cron.startSprintWork('QRD Sprint 99'), /No ticket of QRD Sprint 99/);
});

test('preview: free slots go to the first tickets in Jira order, blocked ones say what they wait on, the next come after, no AC parks', async () => {
  const tickets = [
    ticket('QRD-1579', ['#1']), ticket('QRD-1641', ['#2']), ticket('QRD-1570', ['#3']), ticket('QRD-1580', ['#4']),
    ticket('QRD-1592', ['#14']), ticket('QRD-1593', ['#17']), ticket('QRD-1600', ['#20'], { description: 'TBD' }), ticket('QRD-1610', [], { sprintName: 'QRD Sprint 29' }),
  ];
  const { cron } = world(tickets, { parallel: 3, deps: [{ ticketKey: 'QRD-1580', dependsOnKey: 'QRD-1579' }] });
  const view = (await cron.sprintStart(null))!;
  assert.equal(view.sprint, SPRINT);
  assert.equal(view.held, true);
  assert.equal(view.holdOn, true);
  assert.equal(view.startedAt, null);
  assert.equal(view.preview.slots, 3);
  assert.deepEqual(keys(view.preview.first), ['QRD-1579', 'QRD-1641', 'QRD-1570']);
  assert.deepEqual(view.preview.first.map((item) => [item.order, item.orderSource]), [[1, 'jira'], [2, 'jira'], [3, 'jira']]);
  assert.deepEqual(view.preview.blocked.map((item) => [item.key, item.waitsOn]), [['QRD-1580', 'QRD-1579']]);
  assert.deepEqual(keys(view.preview.next), ['QRD-1592', 'QRD-1593']);
  assert.deepEqual(view.preview.parked, ['QRD-1600']);
});

test('preview: busy slots and the daily cap shrink the free slots; an undecided inferred edge blocks as pending', () => {
  const open = [ticket('QRD-1'), ticket('QRD-2')];
  const preview = startPreview(open, { blocked: new Set(), waitsOn: new Map() }, new Set(['QRD-1']), new Map(), 0, 2);
  assert.deepEqual(preview.blocked.map((item) => [item.key, item.waitsOn]), [['QRD-1', 'pending']]);
  assert.deepEqual(keys(preview.first), []);
  assert.deepEqual(keys(preview.next), ['QRD-2']);
});

test('order: the owner order beats the Jira label, the label beats nothing, then the ticket number', () => {
  const settings = { ...DEFAULT_CRON_SETTINGS };
  const tickets = [ticket('QRD-30'), ticket('QRD-20', ['#5']), ticket('QRD-10'), ticket('QRD-40', ['#2', 'plan-published-r1'])];
  assert.deepEqual(keys(candidates(tickets, new Set(), new Set(), settings)), ['QRD-40', 'QRD-20', 'QRD-10', 'QRD-30']);
  const owner = new Map([['QRD-30', 1]]);
  assert.deepEqual(keys(candidates(tickets, new Set(), new Set(), settings, owner)), ['QRD-30', 'QRD-40', 'QRD-20', 'QRD-10']);
  assert.deepEqual([orderOf(tickets[0], owner), orderSourceOf(tickets[0], owner), orderSourceOf(tickets[1], owner), orderSourceOf(tickets[2], owner)], [1, 'owner', 'jira', null]);
});

function resetWorld(orders: Map<string, number>, manual: Set<string>) {
  const settings = new Map<string, string>();
  const cleared: string[] = [];
  const reset = () => new WorkOrderReset({
    now: () => new Date('2026-11-23T03:00:00Z'),
    settingValue: async (key) => settings.get(key) ?? null,
    saveSetting: async (key, value) => { settings.set(key, value); },
    orders: async () => new Map(orders),
    manualKeys: async () => new Set(manual),
    clearOrder: async (key) => { cleared.push(key); orders.delete(key); },
  });
  return { settings, cleared, reset };
}

test('work order reset: once per database, clears only labelled non-manual positions, and a second start does nothing', async () => {
  const log = console.log;
  console.log = () => undefined;
  try {
    const orders = new Map([['QRD-1', 32], ['QRD-2', 1], ['QRD-3', 4], ['QRD-4', 2]]);
    const { settings, cleared, reset } = resetWorld(orders, new Set(['QRD-3']));
    const tickets = [ticket('QRD-1', ['#17']), ticket('QRD-2'), ticket('QRD-3', ['#3']), ticket('QRD-4', ['#2'])];
    const first = reset();
    assert.equal(await first.run([]), null, 'no tickets yet: waits for a tick that has them');
    assert.equal(settings.has(WORK_ORDER_RESET_KEY), false);
    assert.equal(await first.run(tickets), 2);
    assert.deepEqual(cleared, ['QRD-1', 'QRD-4']);
    assert.deepEqual([...orders], [['QRD-2', 1], ['QRD-3', 4]]);
    assert.equal(settings.get(WORK_ORDER_RESET_KEY), '2026-11-23T03:00:00.000Z');
    assert.equal(await first.run(tickets), null);
    orders.set('QRD-4', 9);
    assert.equal(await reset().run(tickets), null, 'a restart finds the key and does nothing');
    assert.deepEqual(cleared, ['QRD-1', 'QRD-4']);
  } finally {
    console.log = log;
  }
});

test('the first start records the sprint already in progress as started, so only the next sprint is held', async () => {
  const log = console.log;
  console.log = () => undefined;
  try {
    const { settings, reset } = resetWorld(new Map(), new Set());
    const tickets = [ticket('QRD-1', ['#1']), ticket('QRD-2', [], { sprintName: 'QRD Sprint 29', sprintState: 'FUTURE' })];
    await reset().run(tickets);
    const starts = parseSprintStarts(settings.get(SPRINT_STARTED_KEY));
    assert.deepEqual(starts, { [SPRINT]: '2026-11-23T03:00:00.000Z' });
    assert.equal(sprintHeld(SPRINT, true, starts), false);
    assert.equal(sprintHeld('QRD Sprint 29', true, starts), true);

    const kept = resetWorld(new Map(), new Set());
    kept.settings.set(SPRINT_STARTED_KEY, JSON.stringify({ 'QRD Sprint 27': '2026-11-09T01:00:00.000Z' }));
    await kept.reset().run(tickets);
    assert.deepEqual(parseSprintStarts(kept.settings.get(SPRINT_STARTED_KEY)), { 'QRD Sprint 27': '2026-11-09T01:00:00.000Z' }, 'an existing start map is left as the owner made it');
  } finally {
    console.log = log;
  }
});
