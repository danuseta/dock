import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPassLabels, type PassLabelSyncDeps, type ReviewedPull } from '../integrations/pass-label-sync';
import { TEAM_PASS_LABELS, passLabelOf } from '../integrations/review-approval';
import { reviewerVote } from '../integrations/pr-signals';

const pull = (number: number, title: string): ReviewedPull => ({ title, url: `https://github.com/qonekid/fe/pull/${number}`, owner: 'qonekid', repo: 'fe', number });

function fake(options: { pulls: ReviewedPull[]; votes?: Record<number, 'APPROVED' | 'CHANGES_REQUESTED' | null | Error>; labels?: Record<string, string[] | null>; failAdd?: string[] }) {
  const labels = new Map(Object.entries(options.labels ?? {}));
  const settled = new Map<string, number>();
  const calls = { votes: [] as number[], added: [] as string[], events: [] as string[], since: '' };
  const deps: PassLabelSyncDeps = {
    passLabel: async () => 'kenPass',
    reviewed: async (since) => { calls.since = since; return options.pulls; },
    vote: async (item) => {
      calls.votes.push(item.number);
      const vote = options.votes?.[item.number] ?? null;
      if (vote instanceof Error) throw vote;
      return vote;
    },
    labels: async (key) => (labels.has(key) ? labels.get(key)! : []),
    addLabel: async (key, label) => {
      if (options.failAdd?.includes(key)) throw new Error('Jira 503');
      calls.added.push(`${key} ${label}`);
      labels.set(key, [...(labels.get(key) ?? []), label]);
    },
    event: async (key, kind, detail) => { calls.events.push(`${key} ${kind} ${detail}`); },
    settled: async (url, label) => settled.has(`${label} ${url}`),
    settle: async (url, label, ttl) => { settled.set(`${label} ${url}`, ttl); },
    now: () => new Date('2026-11-27T03:00:00Z'),
  };
  return { deps, calls, settled };
}

test('Aken has kenPass without any sprint roster', () => {
  assert.equal(passLabelOf('Aken Setiawan', []), 'kenPass');
  assert.equal(passLabelOf('Dwi Indra'), 'indraPass');
  assert.equal(Object.keys(TEAM_PASS_LABELS).length, 6);
  assert.throws(() => passLabelOf('Someone New', []), /TEAM_PASS_LABELS/);
});

test('an approval made straight on GitHub puts the Pass label on the ticket', async () => {
  const { deps, calls, settled } = fake({ pulls: [pull(1239, 'QRD-1653 feat: save a Custom Agent node')], votes: { 1239: 'APPROVED' }, labels: { 'QRD-1653': ['shovianPass'] } });
  assert.equal(await syncPassLabels(deps), 1);
  assert.deepEqual(calls.added, ['QRD-1653 kenPass']);
  assert.equal(calls.since, '2026-11-13');
  assert.match(calls.events[0], /^QRD-1653 APPROVED Jira label kenPass: approved on GitHub https:\/\/github\.com\/qonekid\/fe\/pull\/1239$/);
  assert.equal(settled.get('kenPass https://github.com/qonekid/fe/pull/1239'), 0);
});

test('the BE and FE pull requests of one ticket add the label once', async () => {
  const { deps, calls } = fake({ pulls: [pull(1239, 'QRD-1653 feat: frontend'), pull(1475, 'QRD-1653 feat: backend')], votes: { 1239: 'APPROVED', 1475: 'APPROVED' } });
  assert.equal(await syncPassLabels(deps), 1);
  assert.deepEqual(calls.added, ['QRD-1653 kenPass']);
  assert.deepEqual(calls.votes, [1239]);
});

test('a ticket that already has the label costs no GitHub call and is settled for good', async () => {
  const { deps, calls, settled } = fake({ pulls: [pull(1, 'QRD-1641 feat: x')], labels: { 'QRD-1641': ['kenPass'] } });
  assert.equal(await syncPassLabels(deps), 0);
  assert.deepEqual(calls.votes, []);
  assert.equal(settled.get('kenPass https://github.com/qonekid/fe/pull/1'), 0);
  assert.equal(await syncPassLabels(deps), 0);
});

test('changes requested or no vote adds nothing and is asked again later', async () => {
  const { deps, calls, settled } = fake({ pulls: [pull(2, 'feat(QRD-1700): y'), pull(3, 'QRD-1701 z')], votes: { 2: 'CHANGES_REQUESTED', 3: null } });
  assert.equal(await syncPassLabels(deps), 0);
  assert.deepEqual(calls.added, []);
  assert.equal(settled.get('kenPass https://github.com/qonekid/fe/pull/2'), 30 * 60);
  assert.equal(settled.get('kenPass https://github.com/qonekid/fe/pull/3'), 30 * 60);
});

test('a failed Jira label or GitHub read stays unsettled and is tried again on the next run', async () => {
  const first = fake({ pulls: [pull(4, 'QRD-1652 a'), pull(5, 'QRD-1642 b')], votes: { 4: 'APPROVED', 5: new Error('502') }, failAdd: ['QRD-1652'] });
  assert.equal(await syncPassLabels(first.deps), 0);
  assert.equal(first.settled.size, 0);
  assert.match(first.calls.events[0], /^QRD-1652 APPROVE_FAILED Jira label kenPass: Jira 503$/);
});

test('a pull request without a ticket key or an unreadable ticket is skipped', async () => {
  const { deps, calls } = fake({ pulls: [pull(6, 'chore: bump deps'), pull(7, 'QRD-9 x')], labels: { 'QRD-9': null } });
  assert.equal(await syncPassLabels(deps), 0);
  assert.deepEqual(calls.votes, []);
});

test('reviewerVote keeps the latest approve or request of that login and drops a dismissal', () => {
  const reviews = [
    { state: 'APPROVED', user: { login: 'akensetiawan-qonek' } },
    { state: 'COMMENTED', user: { login: 'akensetiawan-qonek' } },
    { state: 'CHANGES_REQUESTED', user: { login: 'shovian' } },
  ];
  assert.equal(reviewerVote(reviews, 'AkenSetiawan-Qonek'), 'APPROVED');
  assert.equal(reviewerVote([...reviews, { state: 'CHANGES_REQUESTED', user: { login: 'akensetiawan-qonek' } }], 'akensetiawan-qonek'), 'CHANGES_REQUESTED');
  assert.equal(reviewerVote([...reviews, { state: 'DISMISSED', user: { login: 'akensetiawan-qonek' } }], 'akensetiawan-qonek'), null);
  assert.equal(reviewerVote(reviews, 'danuseta'), null);
});
