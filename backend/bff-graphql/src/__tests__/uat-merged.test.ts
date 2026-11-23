import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UatMerged, type UatMergedDeps, type UatPullRequest } from '../integrations/uat-merged';
import { DEFAULT_STATUS_AFTER_MERGE, OpsRulesInputError, parseStatusAfterMerge, readStatusAfterMerge, type StatusAfterMerge } from '../integrations/ops-rules';

const pr = (n: number, status: string, repo = 'fe'): UatPullRequest => ({ url: `https://github.com/o/${repo}/pull/${n}`, status, owner: 'o', repo, number: n });

function setup(options: { cached?: UatPullRequest[] | null; fresh?: UatPullRequest[]; complete?: boolean; live?: Record<number, 'open' | 'merged' | 'closed'>; status?: string; moves?: 'moved' | 'not-offered' | 'error'; clock?: { t: number }; rules?: Partial<StatusAfterMerge>; statusNow?: () => string } = {}) {
  const calls: string[] = [];
  const events: string[] = [];
  let marker: string[] | null = null;
  const fresh = options.fresh ?? [];
  const deps: UatMergedDeps = {
    cachedPullRequests: async () => options.cached === undefined ? fresh : options.cached,
    pullStatus: async (_o, _r, n) => { calls.push(`pull:${n}`); return options.live?.[n] ?? 'open'; },
    freshPullRequests: async () => { calls.push('fresh'); return { prs: fresh, complete: options.complete ?? true }; },
    statusNow: async () => { calls.push('status'); return options.statusNow?.() ?? options.status ?? 'PR Review'; },
    move: async (key, status) => { calls.push(`move:${key}:${status}`); return options.moves ?? 'moved'; },
    marker: async () => marker,
    setMarker: async (_k, urls) => { marker = urls; },
    event: async (_k, kind) => { events.push(kind); },
    now: () => options.clock?.t ?? Date.now(),
    afterMove: async (key) => { calls.push(`after:${key}`); },
    ...(options.rules ? { settings: async () => ({ ...DEFAULT_STATUS_AFTER_MERGE, ...options.rules }) } : {}),
  };
  return { step: new UatMerged(deps), calls, events, marker: () => marker };
}

const review = [{ key: 'QRD-1', status: 'PR Review' }];

describe('UatMerged', () => {
  it('stays when FE is merged and BE is still open', async () => {
    const both = [pr(1, 'merged'), pr(2, 'open', 'be')];
    const t = setup({ cached: both, fresh: both });
    assert.deepEqual(await t.step.tick(review), []);
    assert.deepEqual(t.calls, ['pull:2']);
  });

  it('moves when both are merged, and writes the marker', async () => {
    const both = [pr(1, 'merged'), pr(2, 'merged', 'be')];
    const t = setup({ cached: both, fresh: both });
    assert.deepEqual(await t.step.tick(review), ['QRD-1']);
    assert.ok(t.calls.includes('move:QRD-1:UAT MERGED'));
    assert.equal(t.marker()?.length, 2);
  });

  it('moves when a cached open pull request has merged since', async () => {
    const t = setup({ cached: [pr(1, 'merged'), pr(2, 'open', 'be')], fresh: [pr(1, 'merged'), pr(2, 'merged', 'be')], live: { 2: 'merged' } });
    assert.deepEqual(await t.step.tick(review), ['QRD-1']);
  });

  it('does nothing when the ticket is not in PR Review', async () => {
    const t = setup({ fresh: [pr(1, 'merged')] });
    assert.deepEqual(await t.step.tick([{ key: 'QRD-1', status: 'UAT CHECK' }]), []);
    assert.deepEqual(t.calls, []);
  });

  it('does not move when Jira says another status now', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], status: 'UAT CHECK' });
    assert.deepEqual(await t.step.tick(review), []);
  });

  it('does not move when a pull request failed enrichment', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], complete: false });
    assert.deepEqual(await t.step.tick(review), []);
    assert.ok(!t.calls.some((call) => call.startsWith('move')));
  });

  it('does not move when the fresh list misses a cached pull request', async () => {
    const t = setup({ cached: [pr(1, 'merged'), pr(2, 'merged', 'be')], fresh: [pr(1, 'merged')] });
    assert.deepEqual(await t.step.tick(review), []);
  });

  it('moves once over two ticks', async () => {
    const t = setup({ fresh: [pr(1, 'merged')] });
    assert.deepEqual(await t.step.tick(review), ['QRD-1']);
    assert.deepEqual(await t.step.tick(review), []);
    assert.equal(t.calls.filter((call) => call.startsWith('move')).length, 1);
  });

  it('reports a failed move once and writes no marker', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], moves: 'not-offered' });
    await t.step.tick(review);
    await t.step.tick(review);
    assert.deepEqual(t.events, ['JIRA_MOVE_FAILED']);
    assert.equal(t.marker(), null);
  });

  it('ignores a closed unmerged pull request, but not when it is the only one', async () => {
    assert.deepEqual(await setup({ fresh: [pr(1, 'closed')] }).step.tick(review), []);
    assert.deepEqual(await setup({ fresh: [pr(1, 'closed'), pr(2, 'merged', 'be')] }).step.tick(review), ['QRD-1']);
  });

  it('does not move when the search failed', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], complete: false });
    assert.deepEqual(await t.step.tick(review), []);
    assert.ok(!t.calls.some((call) => call.startsWith('move')));
  });

  it('does not move a ticket the owner moved back with the same pull requests, until a new one merges', async () => {
    let list = [pr(1, 'merged')];
    const calls: string[] = [];
    let marker: string[] | null = null;
    const step = new UatMerged({
      cachedPullRequests: async () => list,
      pullStatus: async () => 'open',
      freshPullRequests: async () => ({ prs: list, complete: true }),
      statusNow: async () => 'PR Review',
      move: async (key) => { calls.push(key); return 'moved'; },
      marker: async () => marker,
      setMarker: async (_k, urls) => { marker = urls; },
      event: async () => undefined,
    });
    assert.deepEqual(await step.tick(review), ['QRD-1']);
    assert.deepEqual(await step.tick(review), []);
    list = [pr(1, 'merged'), pr(2, 'merged', 'be')];
    assert.deepEqual(await step.tick(review), ['QRD-1']);
    assert.equal(calls.length, 2);
  });

  it('moves when the pull request merged into develop', async () => {
    const develop = { ...pr(1, 'merged'), baseBranch: 'develop' };
    assert.deepEqual(await setup({ fresh: [develop] }).step.tick(review), ['QRD-1']);
  });

  it('records a missing transition but not a Jira error', async () => {
    const missing = setup({ fresh: [pr(1, 'merged')], moves: 'not-offered' });
    await missing.step.tick(review);
    assert.deepEqual(missing.events, ['JIRA_MOVE_FAILED']);
    const broken = setup({ fresh: [pr(1, 'merged')], moves: 'error' });
    await broken.step.tick(review);
    assert.deepEqual(broken.events, []);
  });

  it('skips a ticket for an hour after 3 failures in a row', async () => {
    const clock = { t: 0 };
    const t = setup({ fresh: [pr(1, 'merged')], moves: 'error', clock });
    for (let i = 0; i < 5; i++) await t.step.tick(review);
    assert.equal(t.calls.filter((call) => call.startsWith('move')).length, 3);
    clock.t = 60 * 60 * 1000 + 1;
    await t.step.tick(review);
    assert.equal(t.calls.filter((call) => call.startsWith('move')).length, 4);
  });
});

describe('UatMerged rules (Settings › Sous flow › Aturan)', () => {
  const docsSync = (n: number, status: string): UatPullRequest => ({ ...pr(n, status, 'be'), title: `docs: sync for #${n - 1} (QRD-1)`, headBranch: `docs/auto-update/QRD-1-pr-${n - 1}` });

  it('defaults keep the move on, to UAT MERGED, workspace only, with docs-sync ignored', () => {
    assert.deepEqual(readStatusAfterMerge(null), { enabled: true, next: 'UAT MERGED', ignoreDocsSync: true, laptop: false });
    assert.deepEqual(readStatusAfterMerge('{"next":""}'), DEFAULT_STATUS_AFTER_MERGE, 'a broken row falls back to the defaults');
    assert.deepEqual(parseStatusAfterMerge('{"next":" UAT  CHECK ","laptop":true}'), { enabled: true, next: 'UAT CHECK', ignoreDocsSync: true, laptop: true });
    assert.throws(() => parseStatusAfterMerge('{"enabled":"yes"}'), OpsRulesInputError);
    assert.throws(() => parseStatusAfterMerge('[]'), OpsRulesInputError);
  });

  it('an open docs-sync pull request does not hold the move when ignored, and does when the rule is off', async () => {
    const prs = [pr(1, 'merged'), docsSync(2, 'open')];
    const ignored = setup({ cached: prs, fresh: prs, rules: {} });
    assert.deepEqual(await ignored.step.tick(review), ['QRD-1']);
    assert.ok(!ignored.calls.includes('pull:2'), 'GitHub is not asked about the docs sync');
    assert.deepEqual(ignored.marker(), [pr(1, 'merged').url]);
    const counted = setup({ cached: prs, fresh: prs, rules: { ignoreDocsSync: false } });
    assert.deepEqual(await counted.step.tick(review), []);
  });

  it('a ticket with only a docs-sync pull request merged is not moved', async () => {
    assert.deepEqual(await setup({ fresh: [docsSync(2, 'merged')], rules: {} }).step.tick(review), []);
  });

  it('moves to the status Settings name, then writes the QA guide once', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], rules: { next: 'UAT CHECK' } });
    assert.deepEqual(await t.step.tick(review), ['QRD-1']);
    assert.deepEqual(await t.step.tick(review), []);
    assert.deepEqual(t.calls.filter((call) => call.startsWith('move') || call.startsWith('after')), ['move:QRD-1:UAT CHECK', 'after:QRD-1']);
  });

  it('switched off, nothing is read or moved', async () => {
    const t = setup({ fresh: [pr(1, 'merged')], rules: { enabled: false } });
    assert.deepEqual(await t.step.tick(review, 'workspace'), []);
    assert.deepEqual(t.calls, []);
  });

  it('the laptop DOCK moves only with the laptop rule on', async () => {
    const off = setup({ fresh: [pr(1, 'merged')], rules: {} });
    assert.deepEqual(await off.step.tick(review, 'laptop'), []);
    assert.deepEqual(off.calls, []);
    const on = setup({ fresh: [pr(1, 'merged')], rules: { laptop: true } });
    assert.deepEqual(await on.step.tick(review, 'laptop'), ['QRD-1']);
  });

  it('two DOCKs on: the second one finds the ticket moved and leaves it', async () => {
    let status = 'PR Review';
    const workspace = setup({ fresh: [pr(1, 'merged')], rules: { laptop: true }, statusNow: () => status });
    const laptop = setup({ fresh: [pr(1, 'merged')], rules: { laptop: true }, statusNow: () => status });
    assert.deepEqual(await workspace.step.tick(review, 'workspace'), ['QRD-1']);
    status = 'UAT MERGED';
    assert.deepEqual(await laptop.step.tick(review, 'laptop'), []);
    assert.ok(!laptop.calls.some((call) => call.startsWith('move') || call.startsWith('after')));
  });
});
