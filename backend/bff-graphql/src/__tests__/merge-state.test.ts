import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, ownPull, readMergeStates, type MergeGitHub } from '../integrations/merge-state';

test('a ticket is merged when a pull request merged and none is open; closed without merge is ignored', () => {
  assert.equal(mergeState([{ status: 'closed', merged: true }, { status: 'open', merged: false }]), 'open');
  assert.equal(mergeState([{ status: 'closed', merged: true }, { status: 'closed', merged: false }]), 'merged');
  assert.equal(mergeState([{ status: 'closed', merged: false }]), 'none');
  assert.equal(mergeState([]), 'none');
});

function fakeGitHub(pulls: Record<string, Array<{ number: number; status: string; title?: string; headBranch?: string }>>, details: Record<number, { state: string; merged_at: string | null; base: string }>) {
  let inFlight = 0;
  let peak = 0;
  const calls: number[] = [];
  const github: MergeGitHub = {
    client: async () => ({
      getPRStatus: async (_owner: string, _repo: string, number: number) => {
        calls.push(number);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        const detail = details[number];
        return { state: detail.state, merged_at: detail.merged_at, base: { ref: detail.base } };
      },
    }),
    cachedPullRequestsForTicket: async (key) => (pulls[key] ? pulls[key].map((pull) => ({ owner: 'qonekid', repo: 'web', headBranch: `feat/${key}-work`, ...pull })) : null),
    freshPullRequestsForTicket: async () => ({ prs: [], complete: true }),
  };
  return { github, calls, peak: () => peak };
}

test('the live reader reads merged_at, counts a merge into a feature branch, names the state of each pull request and keeps at most 6 requests in flight', async () => {
  const pulls: Record<string, Array<{ number: number; status: string }>> = {
    'QRD-1': [{ number: 1, status: 'open' }],
    'QRD-2': [{ number: 2, status: 'open' }, { number: 3, status: 'closed' }],
  };
  const details: Record<number, { state: string; merged_at: string | null; base: string }> = {
    1: { state: 'closed', merged_at: '2026-11-07T00:00:00Z', base: 'feat/V2-Playbook' },
    2: { state: 'open', merged_at: null, base: 'develop' },
    3: { state: 'closed', merged_at: null, base: 'develop' },
  };
  for (let n = 10; n < 30; n++) {
    pulls[`QRD-${n}`] = [{ number: n, status: 'open' }];
    details[n] = { state: 'closed', merged_at: '2026-11-07T00:00:00Z', base: 'develop' };
  }
  const { github, peak } = fakeGitHub(pulls, details);
  const states = (await readMergeStates([...Object.keys(pulls), 'QRD-99'], github))!;
  assert.deepEqual(states.get('QRD-1'), { merge: 'merged', pulls: ['qonekid/web#1 · merged'] });
  assert.deepEqual(states.get('QRD-2'), { merge: 'open', pulls: ['qonekid/web#2 · open', 'qonekid/web#3 · closed'] });
  assert.deepEqual(states.get('QRD-99'), { merge: 'none', pulls: [] });
  assert.equal(states.get('QRD-29')!.merge, 'merged');
  assert.ok(peak() <= 6 && peak() > 1, `peak ${peak()}`);
});

test('a search that came back incomplete is unknown; no token or a GitHub error gives null', async () => {
  const { github } = fakeGitHub({}, {});
  assert.deepEqual((await readMergeStates(['QRD-1'], { ...github, freshPullRequestsForTicket: async () => ({ prs: [], complete: false }) }))!.get('QRD-1'), { merge: 'unknown', pulls: [] });
  assert.equal(await readMergeStates(['QRD-1'], { ...github, client: async () => null }), null);
  assert.equal(await readMergeStates(['QRD-1'], { ...github, cachedPullRequestsForTicket: async () => { throw new Error('GitHub responded 502'); } }), null);
});

test('only the pull requests a ticket owns count: a docs sync or a PR that only mentions the key never holds it open', async () => {
  assert.equal(ownPull('QRD-1292', { title: 'feat(QRD-1292): version history', headBranch: 'feat/version-history' }), true);
  assert.equal(ownPull('QRD-1306', { title: 'QRD-1306 fix: show token figures', headBranch: 'fix/tokens' }), true);
  assert.equal(ownPull('QRD-1292', { title: 'anything', headBranch: 'feat/QRD-1292-history' }), true);
  assert.equal(ownPull('QRD-1292', { title: 'docs: sync for #1115 (QRD-1292)', headBranch: 'docs/sync-1115' }), false);
  assert.equal(ownPull('QRD-1292', { title: 'feat(QRD-1295): move pinned agents', headBranch: 'feat/QRD-1295-pinned' }), false);
  assert.equal(ownPull('QRD-129', { title: 'feat(QRD-1292): x', headBranch: '' }), false);
  const { github } = fakeGitHub({
    'QRD-1292': [
      { number: 1115, status: 'merged', title: 'feat(QRD-1292): version history', headBranch: 'feat/QRD-1292-history' },
      { number: 1152, status: 'open', title: 'docs: sync for #1115 (QRD-1292)', headBranch: 'docs/sync-1115' },
      { number: 1360, status: 'open', title: 'feat(QRD-1295): move pinned agents', headBranch: 'feat/QRD-1295-pinned' },
    ],
  }, {});
  assert.deepEqual((await readMergeStates(['QRD-1292'], github))!.get('QRD-1292'), { merge: 'merged', pulls: ['qonekid/web#1115 · merged'] });
});
