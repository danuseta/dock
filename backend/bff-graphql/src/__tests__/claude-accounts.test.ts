import assert from 'node:assert';
import test from 'node:test';
import { ClaudeAccounts, ROTATION_DEFAULTS, decide, overLimit, parseCycleList, parseProbe, type AccountUsage, type ClaudeAccountsDeps, type ProbeRow, type Rotation, type RotationEntry } from '../integrations/claude-accounts';

const NOW = new Date('2026-10-27T05:00:00.000Z');
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const seen = (fiveHour: number | null, sevenDay: number | null, weekReset = later(80), fiveReset = later(2)): AccountUsage => ({
  fiveHour: fiveHour === null ? null : { usedPercentage: fiveHour, resetsAt: fiveReset },
  sevenDay: sevenDay === null ? null : { usedPercentage: sevenDay, resetsAt: weekReset },
  receivedAt: NOW,
});
const ON: Rotation = { ...ROTATION_DEFAULTS, enabled: true };

test('cycle.py list gives the accounts in order and the active one', () => {
  assert.deepStrictEqual(parseCycleList('[1] * main  (your own login)\n[2]   account2\n'), { accounts: ['main', 'account2'], active: 'main' });
  assert.deepStrictEqual(parseCycleList('[1]   main  (your own login: a@b.c)\n[2] * account2\n  ! the settings hold a token that belongs to none of these accounts'), { accounts: ['main', 'account2'], active: 'account2' });
  assert.deepStrictEqual(parseCycleList('No extra accounts yet.'), { accounts: [], active: null });
});

test('an account is over a limit only by a window that has not reset', () => {
  assert.strictEqual(overLimit(seen(91, 10), ON, NOW), '5h at 91%');
  assert.strictEqual(overLimit(seen(10, 96), ON, NOW), '7d at 96%');
  assert.strictEqual(overLimit(seen(89, 94), ON, NOW), null);
  assert.strictEqual(overLimit(seen(99, 10, later(80), later(-1)), ON, NOW), null, 'the 5h window already reset');
  assert.strictEqual(overLimit(undefined, ON, NOW), null, 'never seen');
});

test('auto rotate moves past an account over its limit, stays when all are over, and goes back to main after its own move', () => {
  const accounts = ['main', 'account2', 'account3'];
  const base = { accounts, rule: ON, last: null as RotationEntry | null, now: NOW };
  assert.deepStrictEqual(decide({ ...base, active: 'main', usage: { main: seen(91, 30), account2: seen(95, 10) } }), { to: 'account3', reason: 'main 5h at 91%' });
  assert.deepStrictEqual(decide({ ...base, active: 'account3', usage: { main: seen(91, 30), account2: seen(10, 10), account3: seen(92, 10) } }), { to: 'account2', reason: 'account3 5h at 92%' }, 'wraps past the end of the list');
  assert.deepStrictEqual(decide({ ...base, active: 'main', usage: { main: seen(91, 30), account2: seen(95, 10), account3: seen(10, 99) } }), { stuck: 'main 5h at 91%, account2 5h at 95%, account3 7d at 99%' });
  assert.strictEqual(decide({ ...base, rule: ROTATION_DEFAULTS, active: 'main', usage: { main: seen(99, 99) } }), null, 'off by default');

  const moved: RotationEntry = { at: NOW, from: 'main', to: 'account2', reason: 'main 5h at 91%', auto: true };
  const mainReset = { main: seen(91, 30, later(80), later(-0.1)), account2: seen(20, 10) };
  assert.deepStrictEqual(decide({ ...base, active: 'account2', usage: mainReset, last: moved }), { to: 'main', reason: 'main is below the limits again' });
  assert.strictEqual(decide({ ...base, active: 'account2', usage: { main: seen(91, 30), account2: seen(20, 10) }, last: moved }), null, 'main not reset yet');
  assert.strictEqual(decide({ ...base, active: 'account2', usage: mainReset, last: { ...moved, auto: false } }), null, 'a switch by hand stays');
  assert.strictEqual(decide({ ...base, rule: { ...ON, backToMain: false }, active: 'account2', usage: mainReset, last: moved }), null);
});

function world(options: { active?: string; rule?: Rotation; usage?: Record<string, AccountUsage>; machine?: AccountUsage; names?: string[]; rows?: ProbeRow[] } = {}) {
  let active = options.active ?? 'main';
  let usage = options.usage ?? {};
  let log: RotationEntry[] = [];
  let rule = options.rule ?? ON;
  let clock = NOW;
  let probes = 0;
  let rows: ProbeRow[] | null = options.rows ?? null;
  const switches: string[] = [];
  const pushes: string[] = [];
  let forgot = 0;
  const deps: ClaudeAccountsDeps = {
    list: async () => ({ accounts: options.names ?? ['main', 'account2'], active }),
    switchTo: async (name) => { switches.push(name); active = name; },
    rotation: async () => rule,
    saveRotation: async (value) => { rule = value; },
    probe: async () => { probes += 1; return rows; },
    usage: async () => ({ ...usage }),
    saveUsage: async (value) => { usage = value; },
    log: async () => log,
    saveLog: async (value) => { log = value; },
    switched: () => { forgot += 1; },
    machineUsage: () => options.machine ?? null,
    push: async (message) => { pushes.push(message.title); },
    now: () => clock,
  };
  return { accounts: new ClaudeAccounts(deps), setClock: (at: Date) => { clock = at; }, get probes() { return probes; }, switches, pushes, get log() { return log; }, get usage() { return usage; }, get forgot() { return forgot; } };
}

test('a turn over the limit rotates once, logs it, tells the owner and forgets the old snapshot', async () => {
  const w = world();
  await w.accounts.report({ fiveHour: { usedPercentage: 92, resetsAt: later(2) }, sevenDay: { usedPercentage: 30, resetsAt: later(80) } });
  assert.deepStrictEqual(w.switches, ['account2']);
  assert.deepStrictEqual(w.log.map((entry) => [entry.from, entry.to, entry.reason, entry.auto]), [['main', 'account2', 'main 5h at 92%', true]]);
  assert.deepStrictEqual(w.pushes, ['Claude account: account2']);
  assert.strictEqual(w.forgot, 1);
  await w.accounts.report({ fiveHour: { usedPercentage: 93, resetsAt: later(2) }, sevenDay: { usedPercentage: 30, resetsAt: later(80) } });
  assert.deepStrictEqual(w.switches, ['account2'], 'a report belongs to the active account and moves nothing');
  assert.strictEqual(w.usage.account2.fiveHour?.usedPercentage, 93);
});

test('every account over the limit tells the owner once', async () => {
  const w = world({ usage: { account2: seen(97, 10, later(100)) } });
  const over = { fiveHour: { usedPercentage: 95, resetsAt: later(2) }, sevenDay: { usedPercentage: 30, resetsAt: later(80) } };
  await w.accounts.report(over);
  await w.accounts.report(over);
  assert.deepStrictEqual(w.switches, []);
  assert.deepStrictEqual(w.pushes, ['Every Claude account is over its limit']);
});

test('the owner switches by hand and sets the limits; a bad name or limit is refused', async () => {
  const w = world({ rule: ROTATION_DEFAULTS });
  const state = await w.accounts.use('account2');
  assert.deepStrictEqual(state.accounts.map((account) => [account.name, account.active]), [['main', false], ['account2', true]]);
  assert.deepStrictEqual(w.log.map((entry) => [entry.to, entry.auto]), [['account2', false]]);
  await assert.rejects(w.accounts.use('nobody'), /No account named nobody/);
  await assert.rejects(w.accounts.use('../x'), /Unknown account/);
  await assert.rejects(w.accounts.setRotation({ ...ON, fiveHour: 120 }), /50 to 100/);
  assert.deepStrictEqual((await w.accounts.setRotation({ ...ON, fiveHour: 80 })).rotation, { ...ON, fiveHour: 80 });
});

test('the state hides a window past its reset', async () => {
  const w = world({ usage: { main: seen(70, 30, later(80), later(-1)) } });
  const [main] = (await w.accounts.state()).accounts;
  assert.deepStrictEqual([main.fiveHour, main.sevenDay?.usedPercentage], [null, 30]);
});

test('before any switch, the machine\'s last snapshot starts the active account\'s usage; after a switch it does not', async () => {
  const fresh = world({ machine: seen(17, 39) });
  const [main, account2] = (await fresh.accounts.state()).accounts;
  assert.deepStrictEqual([main.fiveHour?.usedPercentage, main.seenAt, account2.seenAt], [17, NOW.toISOString(), null]);
  assert.strictEqual(fresh.usage.main.sevenDay?.usedPercentage, 39);

  const moved = world({ machine: seen(17, 39), rule: ROTATION_DEFAULTS });
  await moved.accounts.use('account2');
  assert.strictEqual((await moved.accounts.state()).accounts[1].seenAt, null, 'the snapshot may be main\'s: account2 waits for its own turn');
});

const row = (name: string, status: string, fiveHour: number | null, sevenDay: number | null): ProbeRow => ({
  name,
  status,
  fiveHour: fiveHour === null ? null : { usedPercentage: fiveHour, resetsAt: later(2) },
  sevenDay: sevenDay === null ? null : { usedPercentage: sevenDay, resetsAt: later(80) },
});

test('the probe output parses with a 7d-only account and a rejected one; a broken row is dropped', () => {
  const rows = parseProbe(JSON.stringify([
    { name: 'claude1', status: 'allowed', fiveHour: null, sevenDay: { usedPercentage: 34, resetsAt: '2026-11-08T04:00:00Z' } },
    { name: 'claude4', status: 'rejected', fiveHour: null, sevenDay: { usedPercentage: 100, resetsAt: '2026-11-05T10:00:00Z' } },
    { name: 'IT', status: 'no-token', fiveHour: null, sevenDay: null, error: 'x' },
    { status: 'allowed' },
  ]));
  assert.deepStrictEqual(rows.map((entry) => [entry.name, entry.status, entry.fiveHour, entry.sevenDay?.usedPercentage ?? null]), [['claude1', 'allowed', null, 34], ['claude4', 'rejected', null, 100], ['IT', 'no-token', null, null]]);
  assert.strictEqual(rows[0].sevenDay?.resetsAt?.toISOString(), '2026-11-08T04:00:00.000Z');
  assert.throws(() => parseProbe('{"error":"cycle.py not found"}'), /did not return a list/);
});

test('the probe keeps one row per name cycle.py lists, drops the others and moves main to claude1', async () => {
  const w = world({
    names: ['claude1', 'claude2', 'IT'],
    active: 'claude1',
    usage: { main: seen(5, 20), account2: seen(1, 1) },
    rows: [row('claude2', 'allowed', null, 55), row('claude4', 'rejected', null, 100), row('IT', 'error', null, null)],
  });
  await w.accounts.probe();
  assert.deepStrictEqual(Object.keys(w.usage).sort(), ['IT', 'claude1', 'claude2']);
  assert.strictEqual(w.usage.claude1.sevenDay?.usedPercentage, 20, 'the legacy main row');
  assert.deepStrictEqual([w.usage.claude2.status, w.usage.claude2.sevenDay?.usedPercentage, w.usage.claude2.checkedAt], ['allowed', 55, NOW]);
  assert.deepStrictEqual([w.usage.IT.status, w.usage.IT.sevenDay], ['error', null]);
});

test('a probe error keeps the windows stored before and notes the status', async () => {
  const w = world({ names: ['main', 'account2'], usage: { account2: seen(null, 40) }, rows: [row('account2', 'error', null, null)] });
  await w.accounts.probe();
  assert.deepStrictEqual([w.usage.account2.status, w.usage.account2.sevenDay?.usedPercentage], ['error', 40]);
});

test('rotation skips an account the probe rejected less than 2 hours ago, not an older verdict', async () => {
  const blocked = (hours: number): AccountUsage => ({ ...seen(null, 100), status: 'rejected', checkedAt: later(-hours) });
  const base = { accounts: ['a', 'b', 'c'], active: 'a', rule: ON, last: null as RotationEntry | null, now: NOW };
  const usage = { a: seen(91, 30), c: seen(10, 10) };
  assert.deepStrictEqual(decide({ ...base, usage: { ...usage, b: blocked(1) } }), { to: 'c', reason: 'a 5h at 91%' });
  assert.deepStrictEqual(decide({ ...base, usage: { ...usage, b: { ...blocked(3), sevenDay: { usedPercentage: 100, resetsAt: later(-1) } } } }), { to: 'b', reason: 'a 5h at 91%' }, 'stale: unknown, so allowed');
  assert.strictEqual(overLimit(blocked(1), ON, NOW), 'rejected by the usage probe');
});

test('the refresh runs a probe, then returns the stored data when asked again within a minute', async () => {
  const w = world({ rows: [row('main', 'allowed', 10, 20)] });
  await w.accounts.refresh();
  await w.accounts.refresh();
  assert.strictEqual(w.probes, 1);
  w.setClock(new Date(NOW.getTime() + 61_000));
  const state = await w.accounts.refresh();
  assert.strictEqual(w.probes, 2);
  assert.deepStrictEqual([state.accounts[0].status, state.accounts[0].checkedAt], ['allowed', new Date(NOW.getTime() + 61_000).toISOString()]);
});
