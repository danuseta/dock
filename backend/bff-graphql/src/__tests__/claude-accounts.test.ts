import assert from 'node:assert';
import test from 'node:test';
import { ClaudeAccounts, ROTATION_DEFAULTS, attribute, decide, overLimit, parseCycleList, type AccountUsage, type ClaudeAccountsDeps, type Rotation, type RotationEntry } from '../integrations/claude-accounts';

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

test('a report from a turn of the old account is kept under that account, by its weekly reset time', () => {
  const usage = { main: seen(91, 30, later(80)), account2: seen(5, 12, later(100)) };
  assert.strictEqual(attribute(seen(93, 31, later(80)), 'account2', usage), 'main');
  assert.strictEqual(attribute(seen(6, 12, later(100)), 'account2', usage), 'account2');
  assert.strictEqual(attribute(seen(6, null), 'account2', usage), 'account2');
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

function world(options: { active?: string; rule?: Rotation; usage?: Record<string, AccountUsage> } = {}) {
  let active = options.active ?? 'main';
  let usage = options.usage ?? {};
  let log: RotationEntry[] = [];
  let rule = options.rule ?? ON;
  const switches: string[] = [];
  const pushes: string[] = [];
  let forgot = 0;
  const deps: ClaudeAccountsDeps = {
    list: async () => ({ accounts: ['main', 'account2'], active }),
    switchTo: async (name) => { switches.push(name); active = name; },
    rotation: async () => rule,
    saveRotation: async (value) => { rule = value; },
    usage: async () => ({ ...usage }),
    saveUsage: async (value) => { usage = value; },
    log: async () => log,
    saveLog: async (value) => { log = value; },
    switched: () => { forgot += 1; },
    push: async (message) => { pushes.push(message.title); },
    now: () => NOW,
  };
  return { accounts: new ClaudeAccounts(deps), switches, pushes, get log() { return log; }, get usage() { return usage; }, get forgot() { return forgot; } };
}

test('a turn over the limit rotates once, logs it, tells the owner and forgets the old snapshot', async () => {
  const w = world();
  await w.accounts.report({ fiveHour: { usedPercentage: 92, resetsAt: later(2) }, sevenDay: { usedPercentage: 30, resetsAt: later(80) } });
  assert.deepStrictEqual(w.switches, ['account2']);
  assert.deepStrictEqual(w.log.map((entry) => [entry.from, entry.to, entry.reason, entry.auto]), [['main', 'account2', 'main 5h at 92%', true]]);
  assert.deepStrictEqual(w.pushes, ['Claude account: account2']);
  assert.strictEqual(w.forgot, 1);
  await w.accounts.report({ fiveHour: { usedPercentage: 93, resetsAt: later(2) }, sevenDay: { usedPercentage: 30, resetsAt: later(80) } });
  assert.deepStrictEqual(w.switches, ['account2'], 'a late report of a main turn is kept under main and moves nothing');
  assert.strictEqual(w.usage.main.fiveHour?.usedPercentage, 93);
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
