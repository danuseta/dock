import assert from 'node:assert';
import test from 'node:test';
import { TICKET_TITLE, isTaskTitle, nextSessionTitle, ticketSessionTitle } from '../integrations/session-titles';
import {
  CronInputError, DEFAULT_CRON_SETTINGS, MAX_RESUMES, OrchestratorCron, PARKED_TEXT, RESUME_GAVE_UP_TEXT, START_FAILED_TEXT, candidates, hasAcceptanceCriteria, labelOrder, ticketHasAcceptanceCriteria, outsideWindow, parseCronSettings,
  OWNER_BUSY_TEXT, confirmedPrompt, isStackable, stackLine, ownerReplyPrompt, resumePrompt, sousConfirmedPrompt, sousStartPrompt, startPrompt, wib, type CronDeps, type CronRun, type CronSettings, type CronTicket,
} from '../integrations/orchestrator-cron';

const AC = 'Context.\n\nAcceptance criteria\n\nReloading the page still shows Disconnected.\n\nA manually disabled channel keeps its status.';
const ticket = (key: string, overrides: Partial<CronTicket> = {}): CronTicket => ({ key, title: `Title ${key}`, description: AC, status: 'To Do', sprintState: 'ACTIVE', labels: [], ...overrides });
const settings = (overrides: Partial<CronSettings> = {}): CronSettings => ({ ...DEFAULT_CRON_SETTINGS, ...overrides });
/** Wednesday 2026-10-14, 09:05 WIB. */
const WED_0905 = new Date('2026-10-14T02:05:00.000Z');

test('settings: defaults when nothing is saved, saved fields win, v1 keys are ignored, wrong values are refused', () => {
  assert.deepStrictEqual(parseCronSettings(null), DEFAULT_CRON_SETTINGS);
  assert.deepStrictEqual(
    [DEFAULT_CRON_SETTINGS.enabled, DEFAULT_CRON_SETTINGS.workStart, DEFAULT_CRON_SETTINGS.workEnd, DEFAULT_CRON_SETTINGS.workDays, DEFAULT_CRON_SETTINGS.maxPerDay, DEFAULT_CRON_SETTINGS.mode],
    [false, 9, 17, [1, 2, 3, 4, 5], 6, null],
  );
  const saved = parseCronSettings(JSON.stringify({ enabled: true, hoursWib: [9], perRound: 3, workDays: [5, 1, 1], parallel: 1, labels: [' be ', 'be'], epicBase: { 'QRD-1232': 'feat/V1-Playbook' } }));
  assert.deepStrictEqual([saved.enabled, saved.workDays, saved.parallel, saved.labels], [true, [1, 5], 1, ['be']]);
  assert.ok(!('hoursWib' in saved) && !('perRound' in saved) && !('epicBase' in saved), 'keys from older configs are dropped');
  for (const bad of [
    '{', '[]', '{"parallel":0}', '{"workStart":17,"workEnd":9}', '{"workEnd":25}', '{"workDays":[]}', '{"workDays":[8]}', '{"maxPerDay":0}',
    '{"activeFrom":"2026-10-20","activeUntil":"2026-10-01"}', '{"activeFrom":"14-10-2026"}', '{"mode":"bypassPermissions"}',
    '{"sprint":"next"}', '{"todoStatuses":[]}', '{"usageBrakePercent":101}',
    '{"enabled":"yes"}', '{"machine":""}', '{"engine":"codex"}',
  ]) {
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

test('candidates: only To Do tickets in scope, without a run or an open dependency; ordered tickets first, then by ticket number', () => {
  const tickets = [
    ticket('QRD-30'), ticket('QRD-4'), ticket('QRD-5', { status: 'In Progress' }), ticket('QRD-6', { sprintState: 'FUTURE' }),
    ticket('QRD-7'), ticket('QRD-8'), ticket('QRD-9', { status: 'to do', labels: ['FE'] }),
  ];
  const keys = (list: CronTicket[]) => list.map((item) => item.key);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(['QRD-7']), new Set(['QRD-8']), settings())), ['QRD-4', 'QRD-9', 'QRD-30']);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(), new Set(), settings({ sprint: 'any', labels: ['fe'] }))), ['QRD-9']);

  const playbook = [ticket('QRD-10', { labels: ['#2'] }), ticket('QRD-11'), ticket('QRD-12', { labels: ['playbook', '#1'] }), ticket('QRD-3'), ticket('QRD-13', { labels: ['#3'] })];
  assert.deepStrictEqual(keys(candidates(playbook, new Set(), new Set(), settings())), ['QRD-12', 'QRD-10', 'QRD-13', 'QRD-3', 'QRD-11'], 'Jira #N labels first, the rest by number');
  assert.deepStrictEqual(keys(candidates(playbook, new Set(), new Set(), settings(), new Map([['QRD-13', 1], ['QRD-12', 5]]))), ['QRD-13', 'QRD-10', 'QRD-12', 'QRD-3', 'QRD-11'], 'a number set in DOCK wins over the label');
  assert.deepStrictEqual([labelOrder(['#7', '#2']), labelOrder(['#x', 'v1']), labelOrder(undefined)], [2, null, null]);
});

test('work window: hours, work days and active dates, all in WIB', () => {
  assert.deepStrictEqual(wib(WED_0905), { date: '2026-10-14', hour: 9, day: 3 });
  assert.strictEqual(outsideWindow(WED_0905, settings()), null);
  assert.match(String(outsideWindow(new Date('2026-10-14T01:59:00.000Z'), settings())), /09:00-17:00 WIB/, '08:59 WIB');
  assert.match(String(outsideWindow(new Date('2026-10-14T10:00:00.000Z'), settings())), /09:00-17:00 WIB/, '17:00 WIB is already out');
  assert.match(String(outsideWindow(new Date('2026-10-17T03:00:00.000Z'), settings())), /not a work day/, 'Saturday');
  assert.strictEqual(outsideWindow(new Date('2026-10-17T03:00:00.000Z'), settings({ workDays: [6] })), null);
  assert.match(String(outsideWindow(WED_0905, settings({ activeFrom: '2026-10-15' }))), /active from 2026-10-15/);
  assert.match(String(outsideWindow(WED_0905, settings({ activeUntil: '2026-10-13' }))), /active until 2026-10-13/);
  assert.strictEqual(outsideWindow(WED_0905, settings({ activeFrom: '2026-10-14', activeUntil: '2026-10-14' })), null, 'both ends are inclusive');
});

test('the start prompt does not ask on a ticket with AC, lists decisions, and leaves the pull request to the owner', () => {
  const prompt = startPrompt('QRD-1240');
  assert.match(prompt, /do not stop to ask/);
  assert.match(prompt, /status\.cjs decide QRD-1240/);
  assert.match(prompt, /decision taken without the owner in your last chat message/);
  assert.match(prompt, /committed on the ticket branch and ready for review/);
  for (const text of [prompt, confirmedPrompt('QRD-1240')]) {
    assert.match(text, /Do not push and do not open a pull request/);
    assert.doesNotMatch(text, /develop|feat\/V1-Playbook|against/);
  }
});

test('both prompts send the session to the contract rule and to the vault', () => {
  for (const prompt of [startPrompt('QRD-1240'), confirmedPrompt('QRD-1240')]) {
    assert.match(prompt, /rules\/ticket-contract\.md/);
    assert.match(prompt, /cannot be read, stop and report/);
    assert.match(prompt, /brain\.py save/);
  }
});

interface Start {
  tickets?: CronTicket[];
  config?: Partial<CronSettings>;
  runs?: CronRun[];
  online?: boolean;
  used?: { usedPercentage: number; resetsAt: string | null } | null;
  moves?: boolean;
  dependencies?: Array<{ ticketKey: string; dependsOnKey: string }>;
  pushDevices?: boolean;
  dockOrder?: Map<string, number>;
  manual?: Set<string>;
  now?: Date;
}

type SessionState = 'queued' | 'running' | 'idle' | 'error';

/**
 * The cron against fakes. Sessions model the chat side: a message sent to a session queues it, and `claim` is the
 * bridge's claim with the slot gate (the oldest queued cron session runs while fewer than `parallel` run).
 */
function world(start: Start = {}) {
  const state = {
    now: start.now ?? WED_0905,
    // The older build-ticket flow unless a test picks the sous engine, the default.
    settings: new Map<string, string>([['orchestratorCronConfig', JSON.stringify({ ...DEFAULT_CRON_SETTINGS, enabled: true, engine: 'omc', ...start.config })]]),
    cache: new Map<string, unknown>(),
    tickets: start.tickets ?? [],
    runs: start.runs ?? [] as CronRun[],
    online: start.online ?? true,
    sessions: [] as Array<{ id: string; ticketKey: string; machine: string; title?: string; origin: string; options: Record<string, string>; state: SessionState; queuedAt: number; replied: boolean; cronSlot?: boolean }>,
    sent: [] as Array<{ sessionId: string; text: string; options: Record<string, string>; extra?: { cronSlot?: boolean; queue?: boolean } }>,
    moved: [] as string[],
    movedTo: [] as Array<[string, string]>,
    stopped: [] as string[],
    pushes: [] as Array<{ title: string; body: string; url: string }>,
    clock: 0,
    ownerStopped: new Set<string>(),
    otherActive: new Set<string>(),
    failSend: false,
    // What the machine's reported capabilities make of the cron options; a throw is a refusal.
    machineOptions: (options: Record<string, string>): Record<string, string> => options,
  };
  const parallel = () => JSON.parse(state.settings.get('orchestratorCronConfig') as string).parallel as number;
  const deps: CronDeps = {
    now: () => state.now,
    settingValue: async (key) => state.settings.get(key) || null,
    saveSetting: async (key, value) => { state.settings.set(key, value); },
    cacheGet: async (key) => state.cache.get(key) ?? null,
    cacheSet: async (key, value) => { state.cache.set(key, JSON.parse(JSON.stringify(value))); },
    cacheDelete: async (key) => { state.cache.delete(key); },
    tickets: async () => state.tickets,
    ticket: async (key) => state.tickets.find((item) => item.key === key) ?? null,
    moveTicket: async (key, statusName) => { state.moved.push(key); state.movedTo.push([key, statusName]); return start.moves ?? true; },
    dependencies: async () => start.dependencies ?? [],
    dockOrder: async () => start.dockOrder ?? new Map(),
    manualKeys: async () => start.manual ?? new Set(),
    slots: async () => ({ busy: state.sessions.filter((s) => s.state === 'running' && s.cronSlot !== false).length, waiting: state.sessions.filter((s) => s.state === 'queued' && s.cronSlot !== false).length }),
    machines: async () => ['laptop', 'workspace'],
    online: () => state.online,
    fiveHourUsed: () => start.used ?? null,
    takenKeys: async () => state.runs.map((run) => run.key),
    deadStarts: async () => [...new Set(state.sessions.map((s) => s.ticketKey))]
      .map((key) => state.sessions.filter((s) => s.ticketKey === key).at(-1)!)
      .filter((s) => s.state === 'idle' && s.queuedAt > 0 && !s.replied)
      .map((s) => s.ticketKey),
    runs: async () => state.runs,
    saveRun: async (ledger, machine) => {
      const run: CronRun = { key: String(ledger.key), machine, title: String(ledger.title), waiting: String(ledger.waiting) || null, activity: 'IDLE' };
      state.runs = [...state.runs.filter((item) => item.key !== run.key), run];
    },
    park: async (key, waiting) => { state.runs = state.runs.map((run) => (run.key === key ? { ...run, waiting, stalled: false } : run)); },
    cronSessions: async (keys) => new Map(state.sessions.filter((s) => keys.includes(s.ticketKey)).map((s) => [s.ticketKey, { id: s.id, status: s.state, stopped: state.ownerStopped.has(s.ticketKey), otherActive: state.otherActive.has(s.ticketKey) }])),
    openSession: async (input) => {
      const session = { id: `s-${state.sessions.length + 1}`, ...input, state: 'idle' as SessionState, queuedAt: 0, replied: false };
      state.sessions.push(session);
      return session;
    },
    send: async (sessionId, text, options, extra) => {
      if (state.failSend) throw new Error('send refused');
      state.sent.push({ sessionId, text, options, ...(extra ? { extra } : {}) });
      const session = state.sessions.find((item) => item.id === sessionId)!;
      // A message queued behind a running turn leaves that turn running.
      if (session.state !== 'running') Object.assign(session, { state: 'queued', queuedAt: ++state.clock, cronSlot: extra?.cronSlot !== false });
    },
    ownerReplySession: async () => (state.settings.get('ownerReplySession') === 'last' ? 'last' : 'new'),
    lastTaskSession: async (key) => state.sessions.filter((s) => s.ticketKey === key && isTaskTitle(s.title ?? '', key)).at(-1) ?? null,
    machineOptions: async (_machine, options) => state.machineOptions(options),
    deleteSession: async (sessionId) => { state.sessions = state.sessions.filter((session) => session.id !== sessionId); },
    ownerSessionBusy: async (key) => state.sessions.some((s) => s.ticketKey === key && isTaskTitle(s.title ?? '', key) && (s.state === 'queued' || s.state === 'running')),
    runningSessions: async () => ['s-1', 's-2'],
    stopTurn: async (sessionId) => { state.stopped.push(sessionId); },
    hasPushDevices: async () => start.pushDevices ?? false,
    push: async (message) => { state.pushes.push(message); },
  };
  const cron = new OrchestratorCron(deps);
  const byKey = (key: string) => state.sessions.filter((session) => session.ticketKey === key).at(-1)!;
  /** The bridge claiming until the gate says no. Only a message that takes a cron slot waits for one. */
  const claim = () => {
    for (const session of state.sessions) if (session.state === 'queued' && session.cronSlot === false) session.state = 'running';
    for (;;) {
      const next = state.sessions.filter((s) => s.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt)[0];
      if (!next || state.sessions.filter((s) => s.state === 'running' && s.cronSlot !== false).length >= parallel()) return;
      next.state = 'running';
    }
  };
  /** A turn ends: the agent asks the owner, or the PR is open. Either way the slot is free. */
  const endTurn = (key: string) => { Object.assign(byKey(key), { state: 'idle', replied: true }); };
  /** The turn ends before the agent says anything, as when a hook blocks the prompt. */
  const dieOnStart = (key: string) => { byKey(key).state = 'idle'; };
  /** The owner answers in the chat: the session queues again, behind messages queued earlier. */
  const answer = (key: string) => Object.assign(byKey(key), { state: 'queued', queuedAt: ++state.clock });
  const step = async () => { await cron.runFill(); claim(); };
  const running = () => state.sessions.filter((s) => s.state === 'running').map((s) => s.ticketKey).sort();
  return { state, cron, claim, endTurn, dieOnStart, answer, step, running };
}

test('the agreed scenario: a stuck ticket frees its slot, the answer takes the next free slot before new tickets, a parked ticket takes none', async () => {
  const order = new Map([['QRD-1', 1], ['QRD-2', 2], ['QRD-3', 3], ['QRD-4', 4], ['QRD-5', 5], ['QRD-6', 6]]);
  const tickets = ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4', 'QRD-5', 'QRD-6'].map((key) => ticket(key, key === 'QRD-5' ? { description: 'No criteria.' } : {}));
  const w = world({ tickets, dockOrder: order, config: { parallel: 2, maxPerDay: 10 } });

  await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-2'], '09:00 #1 and #2');
  assert.deepStrictEqual((await w.cron.lastFill())!.deferred.map((d) => d.key), ['QRD-3', 'QRD-4', 'QRD-6'], 'the rest is logged as slots full');

  w.endTurn('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2', 'QRD-3'], '09:40 #1 stuck: #3 takes its slot');

  w.answer('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2', 'QRD-3'], '10:00 answer while both slots are busy: it waits, nothing exceeds 2');

  w.endTurn('QRD-2'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-3'], '10:20 #2 done: the answer to #1 goes before #4');

  w.endTurn('QRD-3'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-4'], '11:00 #3 done: #4 starts');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-5')?.waiting, PARKED_TEXT, '#5 is parked and took no slot');

  w.endTurn('QRD-4'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-6'], '11:30 #4 stuck: #6 takes its slot');

  w.answer('QRD-4'); await w.step();
  w.endTurn('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-4', 'QRD-6'], '12:10 #1 done: the answer to #4 runs');
});

test('acceptance criteria also count when they live in the Jira Acceptance Criteria field', () => {
  const pointer = 'Technical detail only. Problem Definition, User Story and Acceptance Criteria live in their own fields.';
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: '* The tool set is rebuilt between steps' }), true);
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: AC, acceptanceCriteria: null }), true, 'the description heading still works');
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: null }), false);
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: '.' }), false, 'a lone dot is not a criterion');
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: pointer, acceptanceCriteria: '* Size is shown per datapoint' }), true);
});

test('a ticket whose criteria are only in the Jira field is started, not parked', async () => {
  const tickets = [
    ticket('QRD-1', { description: 'Board ID: h-reveal', acceptanceCriteria: '* The tool set is rebuilt between steps' }),
    ticket('QRD-2', { description: 'Board ID: g-stack', acceptanceCriteria: null }),
  ];
  const w = world({ tickets, config: { parallel: 2 } });
  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.started, log.parked], [['QRD-1'], ['QRD-2']]);
});

test('two answers take slots in the order they were given', async () => {
  const w = world({ tickets: ['QRD-1', 'QRD-2', 'QRD-3'].map((key) => ticket(key)), config: { parallel: 1 } });
  await w.step();
  w.endTurn('QRD-1'); await w.step();
  w.endTurn('QRD-2'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-3']);
  w.answer('QRD-2'); w.answer('QRD-1');
  w.endTurn('QRD-3'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2'], 'answered first, runs first');
});

test('the daily cap stops new tickets and parked tickets; the next day starts again', async () => {
  const tickets = [...['QRD-1', 'QRD-2', 'QRD-3'].map((key) => ticket(key)), ticket('QRD-8', { description: '' }), ticket('QRD-9', { description: '' })];
  const w = world({ tickets, config: { parallel: 5, maxPerDay: 1 } });
  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.started, log.parked], [['QRD-1'], ['QRD-8']]);
  assert.deepStrictEqual(log.deferred, [
    { key: 'QRD-2', reason: 'daily cap reached: 1 started today' },
    { key: 'QRD-3', reason: 'daily cap reached: 1 started today' },
    { key: 'QRD-9', reason: 'daily cap reached: 1 parked today' },
  ]);
  w.state.now = new Date('2026-10-15T02:05:00.000Z');
  assert.deepStrictEqual((await w.cron.runFill()).started, ['QRD-2']);
  assert.deepStrictEqual((await w.cron.status()).startedToday, 1);
});

test('outside the work window nothing is taken, but a queued answer still runs when a slot is free', async () => {
  const w = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')], config: { parallel: 1 } });
  await w.step();
  w.endTurn('QRD-1');
  w.state.now = new Date('2026-10-17T03:00:00.000Z');
  w.answer('QRD-1');
  const log = await w.cron.runFill();
  assert.match(String(log.skipped), /not a work day/);
  w.claim();
  assert.deepStrictEqual(w.running(), ['QRD-1'], 'the Saturday answer runs');
  assert.strictEqual(w.state.sessions.length, 1, 'QRD-2 was not started');
  assert.deepStrictEqual((await w.cron.runFill(true)).started, [], '"Run now" ignores the window, but the slot is still in use');
});

test('a fill starts in the chosen mode with model and effort and opens cron sessions', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1', { parentKey: 'QRD-1232' })], config: { model: 'opus', effort: 'high', mode: 'manual' } });
  await cron.runFill();
  assert.deepStrictEqual(state.sessions.map((s) => [s.ticketKey, s.machine, s.origin]), [['QRD-1', 'workspace', 'cron']]);
  assert.deepStrictEqual(state.sent[0].options, { permissionMode: 'default', model: 'opus', effort: 'high' });
  assert.match(state.sent[0].text, /^Build ticket QRD-1 with the build-ticket skill\. The ticket has acceptance criteria: do not stop to ask/);
  assert.deepStrictEqual(state.moved, ['QRD-1']);
  const settings = world({ tickets: [ticket('QRD-1')] });
  await settings.cron.runFill();
  assert.deepStrictEqual(settings.state.sent[0].options, {}, 'without a cron mode the chat defaults in System Settings apply');
});

test('a fill is skipped when the machine is offline or the usage brake is reached; a limit whose window has passed does not brake', async () => {
  const offline = world({ tickets: [ticket('QRD-1')], online: false });
  assert.deepStrictEqual([(await offline.cron.runFill()).skipped, offline.state.sessions.length], ['machine workspace is offline', 0]);

  const braked = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 71.4, resetsAt: '2026-10-14T05:00:00.000Z' } });
  assert.strictEqual((await braked.cron.runFill()).skipped, 'usage brake: 5 hour usage is at 71%, the brake is 70%');

  const stale = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 99, resetsAt: '2026-10-14T01:00:00.000Z' } });
  assert.deepStrictEqual((await stale.cron.runFill()).started, ['QRD-1']);
});

test('a ticket whose dependency is not settled waits; a ticket Jira would not move still starts and is reported', async () => {
  const { cron } = world({
    tickets: [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-10', { status: 'PR Review' }), ticket('QRD-11', { status: 'Done / MERGED' })],
    dependencies: [{ ticketKey: 'QRD-1', dependsOnKey: 'QRD-10' }, { ticketKey: 'QRD-2', dependsOnKey: 'QRD-11' }],
    moves: false,
  });
  const log = await cron.runFill();
  assert.deepStrictEqual([log.started, log.notMoved], [['QRD-2'], ['QRD-2']]);
});

test('confirming a parked ticket queues it in a cron session with the asking-allowed prompt; anything else is refused', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-2', { description: '' })] });
  await cron.runFill();
  await assert.rejects(() => cron.confirm('QRD-404'), CronInputError);
  await cron.confirm('QRD-2');
  assert.deepStrictEqual(state.sessions.map((session) => [session.ticketKey, session.origin, session.state]), [['QRD-2', 'cron', 'queued']]);
  assert.doesNotMatch(state.sent[0].text, /do not stop to ask/);
  assert.strictEqual(state.runs.find((run) => run.key === 'QRD-2')?.waiting, null, 'the gate is cleared');
  await assert.rejects(() => cron.confirm('QRD-2'), CronInputError, 'it no longer waits for a confirmation');
});

test('each run that waits on the owner pushes to the phone once; the first look after a phone is set up stays quiet', async () => {
  const waiting: CronRun = { key: 'QRD-7', machine: 'workspace', title: 'Old gate', waiting: 'Which endpoint?', activity: 'WAITING' };
  const { state, cron } = world({ runs: [waiting], pushDevices: true });
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'what already waited is remembered, not announced');

  state.runs = [waiting, { key: 'QRD-8', machine: 'workspace', title: 'New work', waiting: PARKED_TEXT, activity: 'IDLE' }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-8']);
  assert.deepStrictEqual(state.pushes.map((push) => push.title), ['QRD-8 waits on you']);
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'no second push for the same reason');

  state.runs = [{ ...waiting, waiting: 'Ready for review: waiting for the owner' }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-7'], 'a new reason on the same run pushes again');
  assert.deepStrictEqual(state.pushes[1], { title: 'QRD-7 waits on you', body: 'Ready for review: waiting for the owner', url: '/detail/QRD-7', tag: 'wait-QRD-7' });

  const silent = world({ runs: [waiting] });
  assert.deepStrictEqual([await silent.cron.notifyWaiting(), silent.state.pushes.length], [[], 0], 'no phone, no push');
});

test('a run that goes stalled pushes once; the first look and a run waiting on the owner stay quiet', async () => {
  const stalled: CronRun = { key: 'QRD-7', machine: 'workspace', title: 'Quiet', waiting: null, activity: 'IDLE', stalled: true };
  const { state, cron } = world({ runs: [stalled], pushDevices: true });
  assert.deepStrictEqual(await cron.notifyStalled(), [], 'what was stalled already is remembered, not announced');

  state.runs = [stalled, { ...stalled, key: 'QRD-8', stalledDetail: 'Lead ended its turn while 2 subagents were still running' }, { ...stalled, key: 'QRD-9', waiting: 'Which endpoint?' }];
  assert.deepStrictEqual(await cron.notifyStalled(), ['QRD-8']);
  assert.deepStrictEqual(state.pushes.map((push) => [push.title, push.url]), [['QRD-8 is stalled', '/detail/QRD-8']]);
  assert.deepStrictEqual(await cron.notifyStalled(), [], 'no second push for the same stall');

  const silent = world({ runs: [stalled] });
  assert.deepStrictEqual([await silent.cron.notifyStalled(), silent.state.pushes.length], [[], 0], 'no phone, no push');
});

test('settings are saved after validation; every tick fills while enabled', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')], config: { enabled: false, parallel: 1 } });
  await assert.rejects(() => cron.updateSettings('{"machine":"mars"}'), /Unknown machine mars/);
  await cron.tick();
  assert.strictEqual(state.sessions.length, 0, 'disabled: the tick starts nothing');

  await cron.updateSettings('{"enabled":true,"parallel":1}');
  assert.strictEqual(JSON.parse((await cron.getSettings()).config).enabled, true);
  await cron.tick();
  await cron.tick();
  assert.deepStrictEqual(state.sessions.map((session) => session.ticketKey), ['QRD-1'], 'the queued start holds the only slot');
});

test('stop all asks every running session to stop', async () => {
  const { state, cron } = world();
  assert.strictEqual(await cron.stopAll(), 2);
  assert.deepStrictEqual(state.stopped, ['s-1', 's-2']);
});

test('a cron session that dies before the agent answers frees its quota, waits on the owner and goes back to To Do; retry starts it again', async () => {
  const w = world({ tickets: [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')], config: { parallel: 2, maxPerDay: 2 } });
  await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-2']);

  w.dieOnStart('QRD-1');
  w.endTurn('QRD-2');
  await w.step();
  const fill = (await w.cron.lastFill())!;
  assert.deepStrictEqual(fill.released, ['QRD-1'], 'only the session without a reply is released');
  assert.deepStrictEqual(fill.started, ['QRD-3'], 'the freed quota goes to the next ticket');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, START_FAILED_TEXT);
  assert.deepStrictEqual(w.state.movedTo.filter(([key]) => key === 'QRD-1'), [['QRD-1', 'In Progress'], ['QRD-1', 'To Do']]);
  assert.strictEqual((await w.cron.status()).startedToday, 2);

  await w.step();
  assert.deepStrictEqual((await w.cron.lastFill())!.released, [], 'a released run is not released again');
  assert.strictEqual(w.state.movedTo.filter(([key]) => key === 'QRD-1').length, 2);

  await w.cron.confirm('QRD-1');
  assert.strictEqual(w.state.sent.at(-1)?.text, startPrompt('QRD-1'), 'the retry uses the normal prompt, not the asking-allowed one');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, null);
  w.claim();
  await w.step();
  assert.deepStrictEqual((await w.cron.lastFill())!.released, [], 'the old dead session no longer counts once a new one is open');
});

test('candidates skip a ticket the owner works by hand', () => {
  const keys = candidates([ticket('QRD-1'), ticket('QRD-2')], new Set(), new Set(), settings(), new Map(), new Set(['QRD-1'])).map((item) => item.key);
  assert.deepStrictEqual(keys, ['QRD-2']);
});

test('every cron prompt keeps the lead in its turn while members run and asks for Bahasa Indonesia in chat', () => {
  for (const prompt of [startPrompt('QRD-1'), confirmedPrompt('QRD-1'), resumePrompt('QRD-1')]) {
    assert.match(prompt, /oh-my-claudecode:team skill/);
    assert.match(prompt, /Do not end your turn while a subagent you started is still running/);
    assert.match(prompt, /Bahasa Indonesia; code, comments, commit messages and pull request text stay in English/);
  }
  assert.match(resumePrompt('QRD-1'), /^Lanjutkan tiket QRD-1 dari ledger: cek status\.cjs show QRD-1 dan worktree-nya, jangan mulai dari awal\./);
});

test('a cron session is opened with the options its messages carry', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1')], config: { model: 'opus', mode: 'auto' } });
  await cron.runFill();
  assert.deepStrictEqual(state.sessions[0].options, { permissionMode: 'auto', model: 'opus' });
  assert.deepStrictEqual(state.sessions[0].options, state.sent[0].options);
});

const LEFT_RUNNING = 'Lead ended its turn while 2 subagents were still running';

/** QRD-1 started by the cron and its turn ended; the run is then marked stalled as given. QRD-2 waits in To Do. */
async function stalledWorld(run: Partial<CronRun>, manual?: Set<string>) {
  const w = world({ tickets: [ticket('QRD-1')], config: { parallel: 2, maxPerDay: 10, effort: 'high' }, manual });
  await w.cron.runFill();
  w.endTurn('QRD-1');
  w.state.tickets = [ticket('QRD-2')];
  w.state.runs = w.state.runs.map((item) => ({ ...item, stalled: true, ...run }));
  return w;
}

test('a run whose lead left subagents running is resumed in its own session before any new ticket, at most three times, then waits on the owner', async () => {
  const w = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  const sentBefore = w.state.sent.length;
  for (let round = 1; round <= MAX_RESUMES; round += 1) {
    const log = await w.cron.runFill();
    assert.deepStrictEqual([log.resumed, log.started], [['QRD-1'], []], `resume ${round} takes no new ticket`);
    assert.match(String(log.skipped), /stalled runs are resumed first: QRD-1/);
    assert.deepStrictEqual(w.state.sent.at(-1), { sessionId: 's-1', text: resumePrompt('QRD-1'), options: { effort: 'high' } });
    assert.strictEqual(w.state.cache.get('resumes:QRD-1'), round, 'the count is kept in the cron cache');
    w.endTurn('QRD-1');
  }
  assert.strictEqual(w.state.sent.length - sentBefore, MAX_RESUMES);
  assert.strictEqual(w.state.sessions.length, 1, 'no new session was opened for the stalled ticket');

  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.parked, log.started], [[], ['QRD-1'], ['QRD-2']], 'the fourth stall waits on the owner and the queue moves on');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, RESUME_GAVE_UP_TEXT);
});

test('a run whose cron session failed is resumed', async () => {
  const failed = await stalledWorld({});
  failed.state.sessions[0].state = 'error';
  assert.deepStrictEqual((await failed.cron.runFill()).resumed, ['QRD-1']);
});

test('a run that only went quiet is resumed, at most three times although its turns end cleanly, then waits on the owner', async () => {
  const w = await stalledWorld({});
  for (let round = 1; round <= MAX_RESUMES; round += 1) {
    const log = await w.cron.runFill();
    assert.deepStrictEqual([log.resumed, log.started], [['QRD-1'], []], `quiet resume ${round} takes no new ticket`);
    assert.deepStrictEqual(w.state.sent.at(-1)?.text, resumePrompt('QRD-1'));
    w.endTurn('QRD-1');
    await w.cron.resetResumes('QRD-1');
  }
  assert.strictEqual(w.state.cache.get(`quietResumes:QRD-1`), MAX_RESUMES, 'a clean turn end does not reset the quiet count');

  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.parked, log.started], [[], ['QRD-1'], ['QRD-2']], 'the fourth quiet stall waits on the owner and the queue moves on');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, RESUME_GAVE_UP_TEXT);
});

test('a quiet run whose session still runs a turn is not resumed', async () => {
  const w = await stalledWorld({});
  w.state.sessions[0].state = 'running';
  assert.deepStrictEqual((await w.cron.runFill()).resumed, []);
});

test('a stalled run is left alone when the owner stopped it, works it in another session, gates it, marks it manual, or its session is busy', async () => {
  const stopped = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  stopped.state.ownerStopped.add('QRD-1');
  assert.deepStrictEqual((await stopped.cron.runFill()).resumed, [], 'the owner stopped the last turn');

  const elsewhere = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  elsewhere.state.otherActive.add('QRD-1');
  assert.deepStrictEqual((await elsewhere.cron.runFill()).resumed, [], 'a manual session of the ticket is active');

  const gated = await stalledWorld({ stalledDetail: LEFT_RUNNING, waiting: 'Which endpoint?' });
  assert.deepStrictEqual((await gated.cron.runFill()).resumed, []);

  const marked = new Set<string>();
  const manual = await stalledWorld({ stalledDetail: LEFT_RUNNING }, marked);
  marked.add('QRD-1');
  const log = await manual.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.started], [[], ['QRD-2']], 'a manual ticket is never resumed and does not hold the queue');

  const busy = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  busy.answer('QRD-1');
  assert.deepStrictEqual((await busy.cron.runFill()).resumed, [], 'the session is still queued');
});

test('the resume count grows only after the message is sent, and starts again on a new start or a clean turn end', async () => {
  const refused = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  refused.state.failSend = true;
  const log = await refused.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.failed[0], refused.state.cache.has('resumes:QRD-1')], [[], 'QRD-1', false]);

  const w = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  await w.cron.runFill();
  assert.strictEqual(w.state.cache.get('resumes:QRD-1'), 1);
  await w.cron.resetResumes('QRD-1');
  assert.strictEqual(w.state.cache.has('resumes:QRD-1'), false, 'a turn that ended without subagents running');

  const fresh = world({ tickets: [ticket('QRD-5')] });
  fresh.state.cache.set('resumes:QRD-5', 2);
  await fresh.cron.runFill();
  assert.strictEqual(fresh.state.cache.has('resumes:QRD-5'), false, 'a start, a retry or a confirmed ticket starts at zero');
});

test('the sous engine is the default; its start prompt runs the sous skill to a pull request and keeps the contract, vault, lanes and language lines', async () => {
  assert.strictEqual(DEFAULT_CRON_SETTINGS.engine, 'sous');
  assert.strictEqual(parseCronSettings(JSON.stringify({ enabled: true })).engine, 'sous', 'a config saved before engines existed runs sous');
  assert.strictEqual(parseCronSettings(JSON.stringify({ engine: 'omc' })).engine, 'omc', 'the older flow can be switched back on');
  const prompt = sousStartPrompt('QRD-7');
  assert.match(prompt, /^Pakai skill sous: kerjakan QRD-7\./);
  assert.match(prompt, /no GATE 1/);
  assert.match(prompt, /opened pull request \(draft when the ledger has draft=true\)/);
  assert.match(prompt, /demo video before the pull request/);
  for (const line of [/rules\/ticket-contract\.md/, /brain\.py save/, /Do not end your turn while a subagent/, /Bahasa Indonesia/]) assert.match(prompt, line);
  assert.doesNotMatch(prompt, /Do not push and do not open a pull request|Do not make the demo video until/);
  assert.doesNotMatch(sousConfirmedPrompt('QRD-7'), /no GATE 1/, 'a ticket without AC keeps GATE 1');

  const w = world({ tickets: [ticket('QRD-7')], config: { engine: 'sous' } });
  await w.cron.runFill();
  assert.strictEqual(w.state.sent[0].text, prompt);
  assert.match(resumePrompt('QRD-7', 'sous'), /^Pakai skill sous\. Lanjutkan tiket QRD-7 dari blackboard dan ledger \(node \$K\/status\.cjs show QRD-7\)/);
});

test('a stalled sous run is resumed with the sous prompt even when the cron is switched back to the older flow', async () => {
  const w = await stalledWorld({ stalledDetail: LEFT_RUNNING, engine: 'sous' });
  await w.cron.runFill();
  assert.strictEqual(w.state.sent.at(-1)?.text, resumePrompt('QRD-1', 'sous'));
});

const sousRun = (overrides: Partial<CronRun> = {}): CronRun => ({
  key: 'QRD-9', machine: 'laptop', title: 'Sous ticket', waiting: 'I-2: Keep the old export? [Keep|Drop]', activity: 'IDLE', engine: 'sous',
  issues: [{ n: 1, level: 'arbiter', status: 'resolved' }, { n: 2, level: 'owner', status: 'open' }, { n: 3, level: 'owner', status: 'open' }],
  decisions: [{ n: 1, status: 'DECIDED' }, { n: 2, status: 'GUESS' }, { n: 3, status: 'CANCELLED' }, { n: 4, status: 'USULAN' }],
  ...overrides,
});

test('an owner answer on a sous ticket opens a new cron session on the ticket machine with the contract prompt; the old session is not resumed', async () => {
  const w = world({ runs: [sousRun()] });
  assert.strictEqual(await w.cron.answer('QRD-9', 'Drop'), 2, 'the I-n the ledger waits on');
  assert.strictEqual(w.state.sessions.length, 1);
  assert.deepStrictEqual([w.state.sessions[0].ticketKey, w.state.sessions[0].machine, w.state.sessions[0].origin], ['QRD-9', 'laptop', 'cron']);
  assert.strictEqual(w.state.sent[0].text, ownerReplyPrompt('QRD-9', 'Jawaban owner untuk I-2: Drop'));
  assert.strictEqual(w.state.sent[0].text, 'Pakai skill sous. Lanjutkan tiket QRD-9 dari blackboard dan ledger (node $K/status.cjs show QRD-9), jangan mulai dari awal.\nJawaban owner untuk I-2: Drop');

  w.endTurn('QRD-9');
  assert.strictEqual(await w.cron.answer('QRD-9', 'Use the new table', 3), 3, 'a chosen open issue');
  assert.strictEqual(w.state.sessions.length, 2, 'every answer opens its own session');
  await assert.rejects(w.cron.answer('QRD-9', 'x', 1), CronInputError, 'a resolved issue is not answered');
  await assert.rejects(w.cron.answer('QRD-9', '   '), CronInputError);

  const free = world({ runs: [sousRun({ waiting: 'Ready for review: waiting for the owner', issues: [] })] });
  assert.strictEqual(await free.cron.answer('QRD-9', 'Go'), null);
  assert.match(free.state.sent[0].text, /\nJawaban owner: Go$/);

  const old = world({ runs: [sousRun({ engine: null })] });
  assert.strictEqual(await old.cron.sousRun('QRD-9'), null, 'a ticket on the older flow keeps answering its own session');
  await assert.rejects(old.cron.answer('QRD-9', 'Drop'), CronInputError);
});

test('the owner answer sheet sends every answer and change of a ticket in one new session', async () => {
  const w = world({ runs: [sousRun()] });
  await w.cron.submit('QRD-9', [{ issue: 2, text: 'Drop' }, { issue: 3, text: 'Use the new table' }], [{ n: 4, choice: 'not now' }]);
  assert.strictEqual(w.state.sessions.length, 1, 'one session for the whole sheet');
  assert.strictEqual(w.state.sent[0].text, ownerReplyPrompt('QRD-9', 'Jawaban owner untuk I-2: Drop\nJawaban owner untuk I-3: Use the new table\nOwner mengubah D-4: not now'));

  const fresh = () => world({ runs: [sousRun()] });
  await assert.rejects(fresh().cron.submit('QRD-9', [{ issue: 1, text: 'x' }], []), CronInputError, 'a resolved issue');
  await assert.rejects(fresh().cron.submit('QRD-9', [], [{ n: 1, choice: 'x' }]), CronInputError, 'a decided decision');
  await assert.rejects(fresh().cron.submit('QRD-9', [{ issue: 2, text: '   ' }], []), CronInputError, 'an empty answer');
  await assert.rejects(fresh().cron.submit('QRD-9', [], []), CronInputError, 'nothing to send');
  const refused = fresh();
  await assert.rejects(refused.cron.submit('QRD-9', [{ issue: 2, text: 'Drop' }], [{ n: 3, choice: 'x' }]), CronInputError, 'one wrong line refuses the sheet');
  assert.strictEqual(refused.state.sessions.length, 0);
  await assert.rejects(world({ runs: [sousRun({ engine: null })] }).cron.submit('QRD-9', [{ issue: 2, text: 'Drop' }], []), CronInputError, 'the older flow');
});

test('an owner reply waits for the previous owner session of the ticket to finish its first turn', async () => {
  const w = world({ runs: [sousRun()] });
  await w.cron.answer('QRD-9', 'Drop');
  await assert.rejects(w.cron.answer('QRD-9', 'Drop'), (error: Error) => error instanceof CronInputError && error.message === OWNER_BUSY_TEXT, 'a second click while the first is queued');
  await assert.rejects(w.cron.submit('QRD-9', [], [{ n: 2, choice: 'no' }]), CronInputError, 'a change waits too');
  w.claim();
  await assert.rejects(w.cron.answer('QRD-9', 'Drop'), CronInputError, 'and while it runs');
  w.endTurn('QRD-9');
  assert.strictEqual(await w.cron.answer('QRD-9', 'Keep', 3), 3, 'after its first turn a new reply goes through');
  assert.strictEqual(w.state.sessions.length, 2);

  const racing = world({ runs: [sousRun()] });
  const both = await Promise.allSettled([racing.cron.answer('QRD-9', 'A'), racing.cron.answer('QRD-9', 'B')]);
  assert.deepStrictEqual(both.map((result) => result.status).sort(), ['fulfilled', 'rejected'], 'two clicks at once open one session');
  assert.strictEqual(racing.state.sessions.length, 1);
});

test('an owner session uses only the options its machine takes and leaves no empty session when the message is refused', async () => {
  const unknown = world({ runs: [sousRun()] });
  unknown.state.machineOptions = () => ({});
  await unknown.cron.answer('QRD-9', 'Drop');
  assert.deepStrictEqual([unknown.state.sessions[0].options, unknown.state.sent[0].options], [{}, {}], 'a machine without reported capabilities gets no permission mode');

  const refused = world({ runs: [sousRun()] });
  refused.state.machineOptions = () => { throw new Error('This machine does not offer that permission mode'); };
  await assert.rejects(refused.cron.answer('QRD-9', 'Drop'), /does not offer that permission mode/);
  assert.strictEqual(refused.state.sessions.length, 0, 'refused before any session is opened');

  const failing = world({ runs: [sousRun()] });
  failing.state.failSend = true;
  await assert.rejects(failing.cron.submit('QRD-9', [], [{ n: 2, choice: 'no' }]), /send refused/);
  assert.strictEqual(failing.state.sessions.length, 0, 'the session whose first message failed is removed');
  failing.state.failSend = false;
  await failing.cron.submit('QRD-9', [], [{ n: 2, choice: 'no' }]);
  assert.strictEqual(failing.state.sessions.length, 1, 'the owner can try again');
});

test('on engine sous a ticket whose dependency has an open PR is stacked on it; a blocking or settled dependency behaves as before', async () => {
  const parentRun = (key: string, overrides: Partial<CronRun> = {}): CronRun => ({ key, machine: 'workspace', title: key, waiting: null, activity: 'IDLE', ...overrides });
  const w = world({
    config: { engine: 'sous', parallel: 5 },
    tickets: [
      ticket('QRD-1346'), ticket('QRD-1345', { status: 'PR Review' }),
      ticket('QRD-21'), ticket('QRD-20', { status: 'In Progress' }),
      ticket('QRD-31'), ticket('QRD-30', { status: 'In Progress' }),
      ticket('QRD-41'), ticket('QRD-40', { status: 'UAT CHECK' }),
    ],
    dependencies: [
      { ticketKey: 'QRD-1346', dependsOnKey: 'QRD-1345' },
      { ticketKey: 'QRD-21', dependsOnKey: 'QRD-20' },
      { ticketKey: 'QRD-31', dependsOnKey: 'QRD-30' },
      { ticketKey: 'QRD-41', dependsOnKey: 'QRD-40' },
    ],
    runs: [parentRun('QRD-20', { prBe: 'https://github.com/o/be/pull/7' }), parentRun('QRD-30')],
  });
  const log = await w.cron.runFill();
  assert.deepStrictEqual(log.started.sort(), ['QRD-1346', 'QRD-21', 'QRD-41'], 'PR Review and an open ledger PR stack; no PR blocks; settled runs normally');
  const prompt = (key: string) => w.state.sent[w.state.sessions.findIndex((session) => session.ticketKey === key)].text;
  assert.match(prompt('QRD-1346'), /Stack on QRD-1345: base each repo on that ticket's open PR head branch \(status\.cjs set QRD-1346 stackedOn=QRD-1345\), open this PR against it, and say in the PR body that QRD-1345's PR merges first\./);
  assert.ok(prompt('QRD-21').includes(stackLine('QRD-21', 'QRD-20')));
  assert.doesNotMatch(prompt('QRD-41'), /Stack on/, 'only a stacked child gets the line');

  const omc = world({ tickets: [ticket('QRD-1346'), ticket('QRD-1345', { status: 'PR Review' })], dependencies: [{ ticketKey: 'QRD-1346', dependsOnKey: 'QRD-1345' }] });
  assert.deepStrictEqual((await omc.cron.runFill()).started, [], 'the older flow cannot stack, so it still waits');
});

test('a parent is stackable while its PR is open or it is in PR Review, not once the PR is merged', () => {
  assert.strictEqual(isStackable('pr review', null), true);
  assert.strictEqual(isStackable('In Progress', { prFe: 'https://github.com/o/fe/pull/2', review: 'open' }), true);
  assert.strictEqual(isStackable('In Progress', { prFe: 'https://github.com/o/fe/pull/2', review: 'merged' }), false);
  assert.strictEqual(isStackable('In Progress', {}), false);
});

test('a ticket session is titled Task-KEY, the next one Task-KEY (2); a review Review-KEY', () => {
  assert.strictEqual(ticketSessionTitle('Task', 'QRD-1230'), 'Task-QRD-1230');
  assert.strictEqual(nextSessionTitle('Task-QRD-1230', []), 'Task-QRD-1230');
  assert.strictEqual(nextSessionTitle('Task-QRD-1230', ['Task-QRD-1230']), 'Task-QRD-1230 (2)');
  assert.strictEqual(nextSessionTitle('Task-QRD-1230', ['Task-QRD-1230', 'Task-QRD-1230 (3)', 'Task-QRD-12300', 'Task-QRD-1230 copy']), 'Task-QRD-1230 (4)');
  assert.strictEqual(nextSessionTitle('Review-QRD-7', ['Task-QRD-7']), 'Review-QRD-7');
  assert.ok(TICKET_TITLE.test('Review-QRD-7') && !TICKET_TITLE.test('Task-QRD-7 (2)') && !TICKET_TITLE.test('QRD-7 (cron)'));
  assert.ok(isTaskTitle('Task-QRD-7 (2)', 'QRD-7') && !isTaskTitle('Task-QRD-70', 'QRD-7') && !isTaskTitle('Review-QRD-7', 'QRD-7'));
});

test('an auto review opens a Review-KEY session on the cron machine with the cron options; a refused first message removes it', async () => {
  const w = world({ config: { machine: 'workspace' } });
  const id = await w.cron.openReview('QRD-1473', 'review it');
  const session = w.state.sessions.find((item) => item.id === id)!;
  assert.deepStrictEqual([session.ticketKey, session.machine, session.title, session.origin], ['QRD-1473', 'workspace', 'Review-QRD-1473', 'cron']);
  assert.strictEqual(w.state.sent[0].text, 'review it');
  assert.strictEqual(w.state.sent[0].extra?.cronSlot, false, 'a review waits for Turns at once, not for a cron slot');
  const refused = world();
  refused.state.failSend = true;
  await assert.rejects(refused.cron.openReview('QRD-1473', 'review it'), /send refused/);
  assert.strictEqual(refused.state.sessions.length, 0);
});

test('an owner answer and a review never wait for a cron slot', async () => {
  const w = world({ config: { parallel: 1 }, runs: [sousRun()], tickets: [ticket('QRD-1')] });
  await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1'], 'the one cron slot is taken');
  await w.cron.answer('QRD-9', 'Drop');
  await w.cron.openReview('QRD-7', 'review it');
  w.claim();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-7', 'QRD-9'], 'both run beside the full cron');
  assert.deepStrictEqual(w.state.sent.slice(1).map((sent) => sent.extra?.cronSlot), [false, false]);
});

test('with Settings on last session an owner answer queues in the ticket last Task session instead of opening one', async () => {
  const w = world({ runs: [sousRun()] });
  w.state.settings.set('ownerReplySession', 'last');
  await w.cron.answer('QRD-9', 'Drop');
  assert.strictEqual(w.state.sessions.length, 1, 'no Task session yet: a new one is opened');
  w.claim();
  await w.cron.answer('QRD-9', 'Keep', 3);
  await w.cron.submit('QRD-9', [], [{ n: 2, choice: 'no' }]);
  assert.strictEqual(w.state.sessions.length, 1, 'later answers go to that session, even while it runs');
  assert.deepStrictEqual(w.state.sent.slice(1).map((sent) => [sent.sessionId, sent.extra]), [['s-1', { cronSlot: false, queue: true }], ['s-1', { cronSlot: false, queue: true }]]);
});
