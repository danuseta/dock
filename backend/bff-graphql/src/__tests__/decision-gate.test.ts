import assert from 'node:assert';
import test from 'node:test';
import { DecisionGate, ownerPending, stillWorking, sweepReleases, type GateDeps } from '../integrations/decision-gate';
import { normalizeDecisions } from '../integrations/orchestrator';

const decision = (n: number, status: string) => ({ n, at: '', text: `D${n}`, status, by: 'sous', issue: null, cancelNote: null, effect: null, alts: [], replaces: null, supersededBy: null }) as never;
const issue = (n: number, status: 'open' | 'resolved') => ({ n, at: '', type: 'QUESTION', text: `I${n}`, level: 'owner', status, resolvedBy: null, resolvedAt: null, options: [], effects: [] }) as never;

const build = (overrides: Record<string, unknown> = {}) => ({
  key: 'ZED-1',
  kind: 'build' as const,
  productionData: false,
  prBe: 'https://github.com/o/be/pull/1',
  prFe: 'https://github.com/o/fe/pull/2',
  issues: [issue(1, 'resolved')],
  decisions: [decision(1, 'DECIDED'), decision(2, 'GUESS'), decision(3, 'USULAN'), decision(4, 'SUPERSEDED')],
  ...overrides,
});

function world(markReady: GateDeps['markReady'] = async () => true) {
  const cache = new Map<string, unknown>();
  const calls: string[] = [];
  const events: string[] = [];
  let broadcasts = 0;
  const gate = new DecisionGate({
    getCache: async (namespace, key) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace, key, value) => { cache.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
    markReady: async (owner, repo, number) => { calls.push(`${owner}/${repo}#${number}`); return markReady(owner, repo, number); },
    event: async (_key, kind, detail) => { events.push(`${kind} ${detail}`); },
    afterReady: async () => { broadcasts += 1; },
  });
  return { gate, calls, events, broadcasts: () => broadcasts };
}

test('only open issues and guessed decisions the owner has not confirmed wait on the owner', () => {
  const run = build({ issues: [issue(1, 'resolved'), issue(2, 'open')] });
  assert.deepStrictEqual(ownerPending(run, []), { issues: [2], decisions: [2, 3] });
  assert.deepStrictEqual(ownerPending(run, [2]), { issues: [2], decisions: [3] });
});

test('a ledger decision sent as SHOV by an older kit is read as GUESS and waits on the owner', () => {
  const decisions = normalizeDecisions([{ n: 1, text: 'Keep the export', status: 'SHOV', by: 'arbiter' }, { n: 2, text: 'Drop the cache', status: 'shov' }]);
  assert.deepStrictEqual(decisions.map((item) => item.status), ['GUESS', 'GUESS']);
  assert.deepStrictEqual(ownerPending(build({ decisions }), [2]), { issues: [], decisions: [1] });
});

test('the pull requests stay draft until every guessed decision is confirmed, then go up for review once', async () => {
  const w = world();
  assert.deepStrictEqual(await w.gate.settle(build()), [], 'D-2 and D-3 wait on the owner');
  assert.deepStrictEqual(w.calls, [], 'GitHub is not asked while something waits');

  await assert.rejects(w.gate.confirm(build(), [1, 4]), /D-1, D-4 is not a decision sous took on your behalf/);
  assert.deepStrictEqual(await w.gate.confirm(build(), [2]), [2]);
  assert.deepStrictEqual(await w.gate.settle(build()), [], 'D-3 still waits');
  assert.deepStrictEqual(await w.gate.confirm(build(), [3, 2]), [2, 3]);
  assert.deepStrictEqual(await w.gate.confirmed('ZED-1'), [2, 3]);

  assert.deepStrictEqual(await w.gate.settle(build()), ['https://github.com/o/be/pull/1', 'https://github.com/o/fe/pull/2']);
  assert.deepStrictEqual(w.calls, ['o/be#1', 'o/fe#2']);
  assert.strictEqual(w.broadcasts(), 1, 'the broadcast is told once the pull requests are up');
  assert.ok(w.events.includes('OWNER_CONFIRMED D-3, D-2') && w.events.includes('PR_READY https://github.com/o/be/pull/1 https://github.com/o/fe/pull/2'));

  assert.deepStrictEqual(await w.gate.settle(build()), [], 'a later ledger push asks GitHub nothing');
  assert.deepStrictEqual(w.calls.length, 2);
});

test('an open issue holds the gate, and a ready pull request is checked once without a broadcast', async () => {
  const w = world(async () => false);
  const run = build({ decisions: [decision(1, 'DECIDED')], issues: [issue(1, 'open')] });
  assert.deepStrictEqual(await w.gate.settle(run), []);
  assert.deepStrictEqual(w.calls, []);
  assert.deepStrictEqual(await w.gate.settle({ ...run, issues: [issue(1, 'resolved')] }), []);
  assert.deepStrictEqual([w.calls, w.broadcasts()], [['o/be#1', 'o/fe#2'], 0], 'not drafts: nothing marked');
  await w.gate.settle({ ...run, issues: [issue(1, 'resolved')] });
  assert.strictEqual(w.calls.length, 2, 'checked pull requests are not asked again');
});

test('reviews and builds without a pull request are never released; a GitHub failure is retried on the next push', async () => {
  const w = world();
  const settled = { decisions: [decision(1, 'DECIDED')] };
  assert.deepStrictEqual(await w.gate.settle(build({ ...settled, kind: 'review' })), []);
  assert.deepStrictEqual(await w.gate.settle(build({ ...settled, prBe: null, prFe: null })), []);
  assert.deepStrictEqual(w.calls, []);

  let fail = true;
  const flaky = world(async () => { if (fail) throw Object.assign(new Error('x'), { response: { status: 502 } }); return true; });
  assert.deepStrictEqual(await flaky.gate.settle(build({ ...settled, prFe: null })), []);
  assert.ok(flaky.events.includes('PR_READY_FAILED https://github.com/o/be/pull/1: 502'));
  fail = false;
  assert.deepStrictEqual(await flaky.gate.settle(build({ ...settled, prFe: null })), ['https://github.com/o/be/pull/1']);
});

test('a production-data build with no blocker goes up for review and out to Discord like any other', async () => {
  const w = world();
  const run = build({ productionData: true, decisions: [decision(39, 'GUESS')], issues: [issue(17, 'resolved')] });
  assert.deepStrictEqual(await w.gate.settle(run), [], 'D-39 still waits on the owner');
  await w.gate.confirm(run, [39]);
  assert.deepStrictEqual(await w.gate.settle(run), ['https://github.com/o/be/pull/1', 'https://github.com/o/fe/pull/2']);
  assert.strictEqual(w.broadcasts(), 1);
});

test('nothing is released while sous works on the build: an answer just reopened it, or a permission prompt is open', async () => {
  const w = world();
  await w.gate.confirm(build(), [2, 3]);
  assert.deepStrictEqual(await w.gate.settle(build({ activity: 'ACTIVE', activityDetail: 'Bash' })), [], 'a turn is under way');
  assert.deepStrictEqual(await w.gate.settle(build({ activity: 'WAITING', activityDetail: 'notification' })), [], 'a prompt mid-turn');
  assert.deepStrictEqual(await w.gate.settle(build({ activity: 'WAITING', activityDetail: 'gate' })), ['https://github.com/o/be/pull/1', 'https://github.com/o/fe/pull/2'], 'the ledger waits on the owner');
  assert.strictEqual(stillWorking({ activity: 'IDLE', activityDetail: null }), false);
});

test('an ACTIVE run with no hook event for ten minutes is not working: a ledger push does not keep it busy', () => {
  assert.strictEqual(stillWorking({ activity: 'ACTIVE', activityDetail: 'Bash', eventIdleSeconds: 30 }), true);
  assert.strictEqual(stillWorking({ activity: 'ACTIVE', activityDetail: 'Bash', eventIdleSeconds: 24 * 3600 }), false, 'QRD-1275 sat ACTIVE · Bash from the day before');
  assert.strictEqual(stillWorking({ activity: 'ACTIVE', activityDetail: 'Bash', eventIdleSeconds: null }), true);
});

test('the sweep releases and posts quiet builds at their pull request stage, and leaves the rest', async () => {
  const settled: string[] = [];
  const posted: string[] = [];
  const pr = (status: string) => [{ url: 'https://github.com/o/r/pull/1', number: 1, repo: 'o/r', status }];
  const runs = [
    { ...build(), key: 'QRD-1275', stage: 'pr', activity: 'ACTIVE', activityDetail: 'Bash', eventIdleSeconds: 86400, pullRequests: pr('open') },
    { ...build(), key: 'QRD-1286', stage: 'pr', activity: 'WAITING', activityDetail: 'gate', eventIdleSeconds: 60, pullRequests: pr('draft') },
    { ...build(), key: 'QRD-9', stage: 'pr', activity: 'ACTIVE', activityDetail: 'Bash', eventIdleSeconds: 20, pullRequests: pr('open') },
    { ...build(), key: 'QRD-7', stage: 'code', activity: 'IDLE', activityDetail: null, eventIdleSeconds: 9000, pullRequests: pr('open') },
    { ...build(), key: 'QRD-8', kind: 'review', stage: 'pr', activity: 'IDLE', activityDetail: null, eventIdleSeconds: 9000, pullRequests: pr('open') },
  ] as never[];
  await sweepReleases({
    list: async () => runs,
    gate: { settle: async (run) => { settled.push(run.key); return []; } },
    broadcast: async (run) => { posted.push(run.key); },
  });
  assert.deepStrictEqual(settled, ['QRD-1275', 'QRD-1286'], 'a fresh ACTIVE run, a run still at code and a review are left alone');
  assert.deepStrictEqual(posted, ['QRD-1275'], 'only a build with a pull request out of draft is offered to the broadcast');
});
