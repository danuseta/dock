import assert from 'node:assert';
import test from 'node:test';
import {
  CronInputError, DEFAULT_CRON_SETTINGS, OrchestratorCron, PARKED_TEXT, candidates, hasAcceptanceCriteria, hourKeyWib, isDue, parseCronSettings,
  type CronDeps, type CronRun, type CronSettings, type CronTicket,
} from '../integrations/orchestrator-cron';

const AC = 'Context.\n\nAcceptance criteria\n\nReloading the page still shows Disconnected.\n\nA manually disabled channel keeps its status.';
const ticket = (key: string, overrides: Partial<CronTicket> = {}): CronTicket => ({ key, title: `Title ${key}`, description: AC, status: 'To Do', sprintState: 'ACTIVE', labels: [], ...overrides });
const settings = (overrides: Partial<CronSettings> = {}): CronSettings => ({ ...DEFAULT_CRON_SETTINGS, ...overrides });

test('settings: defaults when nothing is saved, saved fields win, wrong values are refused', () => {
  assert.deepStrictEqual(parseCronSettings(null), DEFAULT_CRON_SETTINGS);
  assert.strictEqual(DEFAULT_CRON_SETTINGS.enabled, false);
  const saved = parseCronSettings(JSON.stringify({ enabled: true, hoursWib: [14, 9, 9], parallel: 1, labels: [' be ', 'be'] }));
  assert.deepStrictEqual([saved.enabled, saved.hoursWib, saved.parallel, saved.labels, saved.machine], [true, [9, 14], 1, ['be'], 'workspace']);
  for (const bad of ['{', '[]', '{"hoursWib":[]}', '{"hoursWib":[24]}', '{"parallel":0}', '{"perRound":11}', '{"sprint":"next"}', '{"todoStatuses":[]}', '{"usageBrakePercent":101}', '{"notifyUserId":"danu"}', '{"enabled":"yes"}', '{"machine":""}']) {
    assert.throws(() => parseCronSettings(bad), CronInputError, bad);
  }
});

test('acceptance criteria need the heading and at least one criterion under it', () => {
  assert.strictEqual(hasAcceptanceCriteria(AC), true);
  assert.strictEqual(hasAcceptanceCriteria('Acceptance criteria\n\n- Button works'), true, 'one short criterion is enough');
  assert.strictEqual(hasAcceptanceCriteria('ACCEPTANCE CRITERIA: Backend\n\n1. Three new models exist, as in the RFC database section.'), true);
  for (const none of [null, '', 'Token counts are not in the audit log. They are written per agent run.', 'Acceptance criteria\n\n.', 'Acceptance criteria\n\n- TBD']) {
    assert.strictEqual(hasAcceptanceCriteria(none), false, String(none));
  }
});

test('candidates: only To Do tickets in scope, without a run or an open dependency, oldest first', () => {
  const tickets = [
    ticket('QRD-30'), ticket('QRD-4'), ticket('QRD-5', { status: 'In Progress' }), ticket('QRD-6', { sprintState: 'FUTURE' }),
    ticket('QRD-7'), ticket('QRD-8'), ticket('QRD-9', { status: 'to do', labels: ['FE'] }),
  ];
  const keys = (list: CronTicket[]) => list.map((item) => item.key);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(['QRD-7']), new Set(['QRD-8']), settings())), ['QRD-4', 'QRD-9', 'QRD-30']);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(), new Set(), settings({ sprint: 'any', labels: ['fe'] }))), ['QRD-9']);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(), new Set(), settings({ sprint: 'any' }))), ['QRD-4', 'QRD-6', 'QRD-7', 'QRD-8', 'QRD-9', 'QRD-30']);
});

test('a scheduled hour runs once, in WIB, and only while enabled', () => {
  const at = new Date('2026-10-14T02:05:00.000Z');
  assert.strictEqual(hourKeyWib(at), '2026-10-14T09');
  assert.strictEqual(isDue(at, settings({ enabled: true }), null), true);
  assert.strictEqual(isDue(at, settings({ enabled: true }), '2026-10-14T09'), false, 'this hour already ran');
  assert.strictEqual(isDue(at, settings({ enabled: true }), '2026-10-13T09'), true, 'yesterday does not count');
  assert.strictEqual(isDue(at, settings({ enabled: false }), null), false);
  assert.strictEqual(isDue(new Date('2026-10-14T03:05:00.000Z'), settings({ enabled: true }), null), false, '10:00 WIB is not scheduled');
});

interface Start {
  tickets?: CronTicket[];
  config?: Partial<CronSettings>;
  runs?: CronRun[];
  online?: boolean;
  used?: { usedPercentage: number; resetsAt: string | null } | null;
  webhook?: string;
  moves?: boolean;
  dependencies?: Array<{ ticketKey: string; dependsOnKey: string }>;
  pushDevices?: boolean;
}

function world(start: Start = {}) {
  const state = {
    now: new Date('2026-10-14T02:05:00.000Z'),
    settings: new Map<string, string>([['orchestratorCronConfig', JSON.stringify({ ...DEFAULT_CRON_SETTINGS, enabled: true, ...start.config })]]),
    cache: new Map<string, unknown>(),
    tickets: start.tickets ?? [],
    runs: start.runs ?? [] as CronRun[],
    online: start.online ?? true,
    sessions: [] as Array<{ id: string; ticketKey: string; machine: string }>,
    sent: [] as Array<{ sessionId: string; text: string; options: Record<string, string> }>,
    moved: [] as string[],
    stopped: [] as string[],
    posts: [] as Array<{ url: string; body: unknown }>,
    pushes: [] as Array<{ title: string; body: string; url: string }>,
  };
  if (start.webhook) state.settings.set('orchestratorCronWebhookUrl', start.webhook);
  const deps: CronDeps = {
    now: () => state.now,
    settingValue: async (key) => state.settings.get(key) || null,
    saveSetting: async (key, value) => { state.settings.set(key, value); },
    cacheGet: async (key) => state.cache.get(key) ?? null,
    cacheSet: async (key, value) => { state.cache.set(key, JSON.parse(JSON.stringify(value))); },
    tickets: async () => state.tickets,
    ticket: async (key) => state.tickets.find((item) => item.key === key) ?? null,
    moveTicket: async (key) => { state.moved.push(key); return start.moves ?? true; },
    dependencies: async () => start.dependencies ?? [],
    machines: async () => ['laptop', 'workspace'],
    online: () => state.online,
    fiveHourUsed: () => start.used ?? null,
    takenKeys: async () => state.runs.map((run) => run.key),
    runs: async () => state.runs,
    saveRun: async (ledger, machine) => {
      const run: CronRun = { key: String(ledger.key), machine, title: String(ledger.title), waiting: String(ledger.waiting) || null, activity: 'IDLE' };
      state.runs = [...state.runs.filter((item) => item.key !== run.key), run];
    },
    openSession: async (input) => { const session = { id: `s-${state.sessions.length + 1}`, ...input }; state.sessions.push(session); return session; },
    send: async (sessionId, text, options) => { state.sent.push({ sessionId, text, options }); },
    runningSessions: async () => ['s-1', 's-2'],
    stopTurn: async (sessionId) => { state.stopped.push(sessionId); },
    post: async (url, body) => { state.posts.push({ url, body }); },
    hasPushDevices: async () => start.pushDevices ?? false,
    push: async (message) => { state.pushes.push(message); },
  };
  return { state, cron: new OrchestratorCron(deps) };
}

test('a round starts tickets with acceptance criteria up to the free slots, parks the ones that have none, and never picks one twice', async () => {
  const { state, cron } = world({
    tickets: [ticket('QRD-1'), ticket('QRD-2', { description: 'No criteria here.' }), ticket('QRD-3'), ticket('QRD-4'), ticket('QRD-5')],
    config: { parallel: 2, perRound: 4, model: 'opus', effort: 'high' },
  });
  const log = await cron.runRound();
  assert.deepStrictEqual([log.skipped, log.started, log.parked, log.notMoved, log.failed], [null, ['QRD-1', 'QRD-3'], ['QRD-2'], [], []]);
  assert.deepStrictEqual(state.sessions.map((session) => [session.ticketKey, session.machine]), [['QRD-1', 'workspace'], ['QRD-3', 'workspace']]);
  assert.match(state.sent[0].text, /^Build ticket QRD-1 with the build-ticket skill\. Stop when the pull request is open/);
  assert.deepStrictEqual(state.sent[0].options, { model: 'opus', effort: 'high' });
  assert.deepStrictEqual(state.moved, ['QRD-1', 'QRD-3'], 'only started tickets move to In Progress');
  assert.strictEqual(state.runs.find((run) => run.key === 'QRD-2')?.waiting, PARKED_TEXT);
  assert.deepStrictEqual(await cron.lastRound(), log);

  const second = await cron.runRound();
  assert.deepStrictEqual([second.started, second.parked], [['QRD-4', 'QRD-5'], []], 'QRD-4 had no free slot in the first round; nothing is started twice');
});

test('active runs on the machine use up the slots', async () => {
  const busy: CronRun[] = [
    { key: 'QRD-90', machine: 'workspace', title: 'a', waiting: null, activity: 'ACTIVE' },
    { key: 'QRD-91', machine: 'laptop', title: 'b', waiting: null, activity: 'ACTIVE' },
    { key: 'QRD-92', machine: 'workspace', title: 'c', waiting: 'gate', activity: 'WAITING' },
  ];
  const { cron } = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')], runs: busy, config: { parallel: 2 } });
  assert.deepStrictEqual((await cron.runRound()).started, ['QRD-1']);
});

test('a round is skipped when the machine is offline or the usage brake is reached; a limit whose window has passed does not brake', async () => {
  const offline = world({ tickets: [ticket('QRD-1')], online: false });
  assert.deepStrictEqual([(await offline.cron.runRound()).skipped, offline.state.sessions.length], ['machine workspace is offline', 0]);

  const braked = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 71.4, resetsAt: '2026-10-14T05:00:00.000Z' } });
  assert.strictEqual((await braked.cron.runRound()).skipped, '5 hour usage is at 71%, the brake is 70%');

  const stale = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 99, resetsAt: '2026-10-14T01:00:00.000Z' } });
  assert.deepStrictEqual((await stale.cron.runRound()).started, ['QRD-1']);
});

test('a ticket whose dependency is not settled waits; a ticket Jira would not move still starts and is reported', async () => {
  const { cron } = world({
    tickets: [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-10', { status: 'PR Review' }), ticket('QRD-11', { status: 'Done / MERGED' })],
    dependencies: [{ ticketKey: 'QRD-1', dependsOnKey: 'QRD-10' }, { ticketKey: 'QRD-2', dependsOnKey: 'QRD-11' }],
    moves: false,
  });
  const log = await cron.runRound();
  assert.deepStrictEqual([log.started, log.notMoved], [['QRD-2'], ['QRD-2']]);
});

test('confirming a parked ticket starts it on the machine that holds it; anything else is refused', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-2', { description: '' })] });
  await cron.runRound();
  await assert.rejects(() => cron.confirm('QRD-404'), CronInputError);
  await cron.confirm('QRD-2');
  assert.deepStrictEqual(state.sessions.map((session) => session.ticketKey), ['QRD-2']);
  assert.strictEqual(state.runs.find((run) => run.key === 'QRD-2')?.waiting, null, 'the gate is cleared');
  await assert.rejects(() => cron.confirm('QRD-2'), CronInputError, 'it no longer waits for a confirmation');
});

test('each run that waits on the owner pings Discord once; the first look after a webhook is set stays quiet', async () => {
  const waiting: CronRun = { key: 'QRD-7', machine: 'workspace', title: 'Old gate', waiting: 'Which endpoint?', activity: 'WAITING' };
  const { state, cron } = world({ runs: [waiting], webhook: 'https://discord.com/api/webhooks/1/abc', config: { notifyUserId: '123456789' } });
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'what already waited is remembered, not announced');

  state.runs = [waiting, { key: 'QRD-8', machine: 'workspace', title: 'New work', waiting: PARKED_TEXT, activity: 'IDLE' }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-8']);
  assert.deepStrictEqual(state.posts, [{ url: 'https://discord.com/api/webhooks/1/abc', body: { content: `<@123456789> **QRD-8** New work\n${PARKED_TEXT}`, allowed_mentions: { users: ['123456789'] } } }]);
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'no second ping for the same reason');

  state.runs = [{ ...waiting, waiting: "PR open: waiting for the owner's review" }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-7'], 'a new reason on the same run pings again');

  const silent = world({ runs: [waiting] });
  assert.deepStrictEqual([await silent.cron.notifyWaiting(), silent.state.posts.length], [[], 0], 'no webhook, no ping');

  const phone = world({ runs: [], pushDevices: true });
  await phone.cron.notifyWaiting();
  phone.state.runs = [waiting];
  assert.deepStrictEqual(await phone.cron.notifyWaiting(), ['QRD-7']);
  assert.deepStrictEqual([phone.state.posts.length, phone.state.pushes], [0, [{ title: 'QRD-7 waits on you', body: 'Which endpoint?', url: '/agents' }]], 'a phone alone gets the push, with no Discord post');
});

test('settings are saved after validation; the webhook is kept, replaced or cleared; the tick runs a due round once', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1')], config: { enabled: false } });
  await assert.rejects(() => cron.updateSettings('{"machine":"mars"}'), /Unknown machine mars/);
  await assert.rejects(() => cron.updateSettings('{}', 'https://example.com/hook'), /Discord webhook URL/);
  await cron.tick();
  assert.strictEqual(state.sessions.length, 0, 'disabled: the tick starts nothing');

  await cron.updateSettings('{"enabled":true}', 'https://discord.com/api/webhooks/1/abc');
  assert.deepStrictEqual([(await cron.getSettings()).webhookSet, JSON.parse((await cron.getSettings()).config).enabled], [true, true]);
  await cron.updateSettings('{"enabled":true}');
  assert.strictEqual((await cron.getSettings()).webhookSet, true, 'no webhook argument keeps the saved one');
  await cron.tick();
  await cron.tick();
  assert.deepStrictEqual(state.sessions.map((session) => session.ticketKey), ['QRD-1'], 'the scheduled hour ran once');
  await cron.updateSettings('{"enabled":true}', '');
  assert.strictEqual((await cron.getSettings()).webhookSet, false);
});

test('stop all asks every running session to stop', async () => {
  const { state, cron } = world();
  assert.strictEqual(await cron.stopAll(), 2);
  assert.deepStrictEqual(state.stopped, ['s-1', 's-2']);
});
