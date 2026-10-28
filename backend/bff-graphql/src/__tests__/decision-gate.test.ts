import assert from 'node:assert';
import test from 'node:test';
import { DecisionGate, PRODUCTION_DATA_HELD, heldWaiting, ownerPending, type GateDeps } from '../integrations/decision-gate';
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

test('reviews, production data and builds without a pull request are never released; a GitHub failure is retried on the next push', async () => {
  const w = world();
  const settled = { decisions: [decision(1, 'DECIDED')] };
  assert.deepStrictEqual(await w.gate.settle(build({ ...settled, kind: 'review' })), []);
  assert.deepStrictEqual(await w.gate.settle(build({ ...settled, productionData: true })), []);
  assert.deepStrictEqual(await w.gate.settle(build({ ...settled, prBe: null, prFe: null })), []);
  assert.deepStrictEqual(w.calls, []);

  let fail = true;
  const flaky = world(async () => { if (fail) throw Object.assign(new Error('x'), { response: { status: 502 } }); return true; });
  assert.deepStrictEqual(await flaky.gate.settle(build({ ...settled, prFe: null })), []);
  assert.ok(flaky.events.includes('PR_READY_FAILED https://github.com/o/be/pull/1: 502'));
  fail = false;
  assert.deepStrictEqual(await flaky.gate.settle(build({ ...settled, prFe: null })), ['https://github.com/o/be/pull/1']);
});

test('a production-data build that waits on nobody but the owner says so, instead of the stale ledger line', () => {
  const run = {
    kind: 'build' as const,
    productionData: true,
    draft: true,
    prBe: 'https://github.com/o/be/pull/1',
    prFe: null,
    waiting: 'D-39 (GUESS): confirm, then DOCK marks the pull requests ready',
    issues: [{ n: 17, status: 'resolved' }],
    decisions: [{ n: 39, status: 'GUESS' }],
  } as unknown as Parameters<typeof heldWaiting>[0];
  assert.strictEqual(heldWaiting(run, [39]), PRODUCTION_DATA_HELD);
  assert.strictEqual(heldWaiting(run, []), run.waiting);
  assert.strictEqual(heldWaiting({ ...run, issues: [{ n: 17, status: 'open' }] } as typeof run, [39]), run.waiting);
  assert.strictEqual(heldWaiting({ ...run, productionData: false }, [39]), run.waiting);
  assert.strictEqual(heldWaiting({ ...run, draft: false }, [39]), run.waiting);
});
