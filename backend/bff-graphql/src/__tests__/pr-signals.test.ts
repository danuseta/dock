import assert from 'node:assert';
import test from 'node:test';
import { GitHubClient, GitHubService } from '../integrations/github';
import { checkRunsState, combineChecks, commitStatusState, reviewDecisionOf, reviewSignalOf } from '../integrations/pr-signals';

const review = (login: string, state: string) => ({ user: { login }, state });

test('the latest review of each reviewer decides', () => {
  assert.strictEqual(reviewDecisionOf([]), 'none');
  assert.strictEqual(reviewDecisionOf([review('ann', 'CHANGES_REQUESTED')]), 'changes_requested');
  assert.strictEqual(reviewDecisionOf([review('ann', 'CHANGES_REQUESTED'), review('ann', 'APPROVED')]), 'approved', 'a later approval from the same reviewer clears it');
  assert.strictEqual(reviewDecisionOf([review('ann', 'CHANGES_REQUESTED'), review('bob', 'APPROVED')]), 'changes_requested', 'another reviewer approving does not');
  assert.strictEqual(reviewDecisionOf([review('ann', 'CHANGES_REQUESTED'), review('ann', 'DISMISSED')]), 'none', 'a dismissed review does not count');
  assert.strictEqual(reviewDecisionOf([review('ann', 'APPROVED'), review('ann', 'COMMENTED')]), 'approved', 'a comment changes nothing');
  assert.strictEqual(reviewDecisionOf([review('ann', 'CHANGES_REQUESTED'), review('ann', 'COMMENTED')]), 'changes_requested');
  assert.strictEqual(reviewDecisionOf([review('ann', 'COMMENTED'), review('bob', 'PENDING')]), 'none');
});

test('check runs and commit statuses fold into one state', () => {
  const done = (conclusion: string) => ({ status: 'completed', conclusion });
  assert.strictEqual(checkRunsState([]), 'none');
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) assert.strictEqual(checkRunsState([done('success'), done(conclusion)]), 'failing', conclusion);
  assert.strictEqual(checkRunsState([done('success'), { status: 'queued', conclusion: null }]), 'pending');
  assert.strictEqual(checkRunsState([done('success'), { status: 'in_progress', conclusion: null }, done('failure')]), 'failing', 'failing outranks pending');
  assert.strictEqual(checkRunsState([done('success'), done('neutral'), done('skipped')]), 'passing');

  assert.strictEqual(commitStatusState({ state: 'pending', total_count: 0 }), 'none', 'a repository without statuses reports pending with no entries');
  assert.strictEqual(commitStatusState({ state: 'failure', total_count: 2 }), 'failing');
  assert.strictEqual(commitStatusState({ state: 'success', total_count: 1 }), 'passing');
  assert.strictEqual(combineChecks(checkRunsState([done('success')]), commitStatusState({ state: 'failure', total_count: 1 })), 'failing');
  assert.strictEqual(combineChecks('none', 'none'), 'none');
});

test('the run signal takes the worst of its open pull requests', () => {
  const pr = (status: string, reviewDecision: any, checks: any) => ({ status, reviewDecision, checks });
  assert.strictEqual(reviewSignalOf([]), null);
  assert.strictEqual(reviewSignalOf([pr('open', 'none', 'none')]), null);
  assert.strictEqual(reviewSignalOf([pr('open', 'approved', 'passing')]), 'approved');
  assert.strictEqual(reviewSignalOf([pr('open', 'approved', 'none')]), 'approved');
  assert.strictEqual(reviewSignalOf([pr('open', 'approved', 'passing'), pr('open', 'none', 'none')]), null, 'approved needs every open pull request approved');
  assert.strictEqual(reviewSignalOf([pr('open', 'approved', 'pending')]), 'checks_pending');
  assert.strictEqual(reviewSignalOf([pr('open', 'approved', 'failing')]), 'checks_failing');
  assert.strictEqual(reviewSignalOf([pr('open', 'none', 'pending'), pr('draft', 'none', 'failing')]), 'checks_failing');
  assert.strictEqual(reviewSignalOf([pr('open', 'changes_requested', 'passing'), pr('open', 'approved', 'failing')]), 'changes_requested');
  assert.strictEqual(reviewSignalOf([pr('open', 'changes_requested', 'failing')]), 'changes_requested');
  assert.strictEqual(reviewSignalOf([pr('merged', 'changes_requested', 'failing'), pr('open', 'approved', 'passing')]), 'approved', 'merged and closed pull requests are ignored');
  assert.strictEqual(reviewSignalOf([pr('closed', 'changes_requested', 'failing')]), null);
});

function serviceWith(getPRSignal: () => Promise<unknown>) {
  const cache = new Map<string, unknown>();
  const storage = {
    getCache: async (_: string, key: string) => cache.get(key) ?? null,
    upsertCache: async (_: string, key: string, value: unknown) => { cache.set(key, value); },
  };
  const calls = { n: 0 };
  const original = GitHubClient.prototype.getPRSignal;
  GitHubClient.prototype.getPRSignal = (async () => { calls.n += 1; return getPRSignal(); }) as typeof original;
  const restore = () => { GitHubClient.prototype.getPRSignal = original; };
  return { service: new GitHubService(storage as never), calls, restore };
}
const sample = (number: number, status = 'open') => ({ url: `https://github.com/a/b/pull/${number}`, status, owner: 'a', repo: 'b', number });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('signals come from the cache, are refreshed in the background and are bounded', async () => {
  const { service, calls, restore } = serviceWith(async () => ({ reviewDecision: 'changes_requested', checks: 'failing' }));
  try {
    const prs = [1, 2, 3, 4, 5, 6, 7].map((n) => sample(n)).concat([sample(8, 'merged'), sample(9, 'closed')]);
    assert.deepStrictEqual(await service.getPRSignals('pat', 'QRD-1', prs), {}, 'the first call answers at once with nothing');
    await settle();
    assert.strictEqual(calls.n, 5, 'only the newest 5 open pull requests are asked about');
    const signals = await service.getPRSignals('pat', 'QRD-1', prs);
    assert.deepStrictEqual(Object.keys(signals).sort(), [3, 4, 5, 6, 7].map((n) => `https://github.com/a/b/pull/${n}`).sort());
    await service.getPRSignals('pat', 'QRD-1', prs);
    await settle();
    assert.strictEqual(calls.n, 5, 'a fresh cache entry is not refreshed again');
    assert.deepStrictEqual(await service.getPRSignals('pat', 'QRD-2', [sample(8, 'merged')]), {}, 'nothing is asked for merged or closed pull requests');
    await settle();
    assert.strictEqual(calls.n, 5);
  } finally { restore(); }
});

test('a failing GitHub call leaves the run without signals instead of failing', async () => {
  const { service, restore } = serviceWith(async () => { throw new Error('rate limited'); });
  const log = console.error;
  console.error = () => undefined;
  try {
    assert.deepStrictEqual(await service.getPRSignals('pat', 'QRD-1', [sample(1)]), {});
    await settle();
    assert.deepStrictEqual(await service.getPRSignals('pat', 'QRD-1', [sample(1)]), {}, 'no answer, so the run reads as it did before');
  } finally { console.error = log; restore(); }
});
