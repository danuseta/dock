import assert from 'node:assert';
import test from 'node:test';
import { AutoReview, ON_IT_WINDOW_MS, currentReviews, reviewPrompt, type AutoReviewDeps, type AutoReviewRecord, type PushMessage } from '../integrations/auto-review';
import type { ThreadRow } from '../integrations/discord-threads';
import type { Orchestration } from '../integrations/orchestrator';

const NOW = new Date('2026-10-27T03:00:00.000Z');
const PR = 'https://github.com/qonekid/ms-admin-worker-backend/pull/412';

const row = (extra: Partial<ThreadRow> = {}): ThreadRow => ({
  version: 1, id: 't1', channelId: 'c1', channel: 'pr-review', kind: 'pr', title: 'QRD-1473 size column', url: 'https://discord.com/channels/g/t1',
  state: 'FLOW_1', why: '', needsYou: false, createdBy: 'Indra', createdByAvatar: null, createdAt: NOW.toISOString(), lastActivity: NOW.toISOString(), lastMessageId: null,
  messageCount: 2, tags: [], slots: 2, tickets: ['QRD-1473'], prs: [`${PR}/files`],
  claim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - 60_000).toISOString() },
  onIt: ['Danu'], claimerRepliedAt: null, mentionedAt: null, repliedAt: null, messages: [], ...extra,
});

function world(options: { enabled?: boolean; autoLgtm?: boolean; rows?: ThreadRow[]; open?: boolean; headSha?: string; approve?: boolean; failOpen?: boolean } = {}) {
  const records: AutoReviewRecord[] = [];
  const opened: Array<{ key: string; prompt: string }> = [];
  const approved: string[] = [];
  const pushes: PushMessage[] = [];
  let n = 0;
  const deps: AutoReviewDeps = {
    settings: async () => ({ enabled: options.enabled ?? true, autoLgtm: options.autoLgtm ?? false }),
    rows: async () => options.rows ?? [row()],
    pull: async () => ({ open: options.open ?? true, headSha: options.headSha ?? 'abc1234' }),
    latest: async (prUrl) => [...records].reverse().find((record) => record.prUrl === prUrl) ?? null,
    running: async (key) => [...records].reverse().find((record) => record.ticketKey === key && record.status === 'running') ?? null,
    create: async (data) => { const record = { id: `r${(n += 1)}`, sessionId: null, status: 'running', detail: null, finishedAt: null, ...data }; records.push(record); return record; },
    update: async (id, data) => { Object.assign(records.find((record) => record.id === id) as AutoReviewRecord, data); },
    openReview: async (key, prompt) => { if (options.failOpen) throw new Error('No slot'); opened.push({ key, prompt }); return `s${opened.length}`; },
    approve: async (key) => { approved.push(key); return options.approve ?? true; },
    push: async (message) => { pushes.push(message); },
    now: () => NOW,
  };
  return { review: new AutoReview(deps), records, opened, approved, pushes, deps };
}

const verdict = (extra: Partial<Orchestration> = {}) => ({
  key: 'QRD-1473', kind: 'review', verdict: 'approve', findings: [], updatedAt: new Date(NOW.getTime() + 600_000).toISOString(), ...extra,
}) as unknown as Orchestration;

test('the owner\'s on it in a pr-review thread starts one Review session for the pull request; the setting off or another person does nothing', async () => {
  const on = world();
  assert.strictEqual(await on.review.tick(), 1);
  assert.deepStrictEqual(on.records.map((record) => [record.prUrl, record.headSha, record.ticketKey, record.sessionId]), [[PR, 'abc1234', 'QRD-1473', 's1']]);
  assert.strictEqual(on.opened[0].key, 'QRD-1473');
  assert.strictEqual(on.opened[0].prompt, reviewPrompt('QRD-1473', [PR], 'https://discord.com/channels/g/t1'));
  assert.match(on.opened[0].prompt, /Jangan komentar di PR, Jira, atau Discord/);
  assert.strictEqual(await on.review.tick(), 0, 'a second look, or the same on it again, starts nothing');

  for (const quiet of [
    world({ enabled: false }),
    world({ rows: [row({ claim: { messageId: 'm2', authorId: 'x', author: 'Aken', mine: false, at: NOW.toISOString() } })] }),
    world({ rows: [row({ kind: 'bug' })] }),
    world({ rows: [row({ claim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - ON_IT_WINDOW_MS - 1).toISOString() } })] }),
    world({ rows: [row({ tickets: [] })] }),
    world({ open: false }),
  ]) {
    assert.strictEqual(await quiet.review.tick(), 0);
    assert.strictEqual(quiet.opened.length, 0);
  }
});

test('a new head commit needs a new on it; a new on it on the same commit does not review it again', async () => {
  const w = world();
  await w.review.tick();
  w.records[0].startedAt = new Date(NOW.getTime() - 30 * 60_000);
  const later = world({ headSha: 'def5678' });
  later.records.push(...w.records);
  assert.strictEqual(await later.review.tick(), 1, 'the on it at 02:59 is newer than the review at 02:30, and the head moved');
  const same = world();
  same.records.push({ ...w.records[0] });
  assert.strictEqual(await same.review.tick(), 0, 'same head commit');
  const stale = world({ headSha: 'def5678' });
  stale.records.push({ ...w.records[0], startedAt: NOW });
  assert.strictEqual(await stale.review.tick(), 0, 'the head moved but the owner has not said on it since the last review');
});

test('a session that cannot start is recorded as failed', async () => {
  const w = world({ failOpen: true });
  assert.strictEqual(await w.review.tick(), 0);
  assert.strictEqual(w.records[0].status, 'failed');
  assert.strictEqual(w.records[0].detail, 'No slot');
});

test('a clean verdict is LGTM\'d like the button when the owner allows it, and the owner is told; otherwise it waits for the owner', async () => {
  const auto = world({ autoLgtm: true });
  await auto.review.tick();
  await auto.review.ledger(verdict());
  assert.deepStrictEqual(auto.approved, ['QRD-1473']);
  assert.strictEqual(auto.records[0].status, 'lgtm');
  assert.strictEqual(auto.pushes[0].title, 'QRD-1473: auto LGTM');
  await auto.review.ledger(verdict());
  assert.strictEqual(auto.approved.length, 1, 'the ledger the LGTM pushes back does not approve twice');

  const manual = world();
  await manual.review.tick();
  await manual.review.ledger(verdict());
  assert.deepStrictEqual(manual.approved, []);
  assert.strictEqual(manual.records[0].status, 'clean');

  const failing = world({ autoLgtm: true, approve: false });
  await failing.review.tick();
  await failing.review.ledger(verdict());
  assert.strictEqual(failing.records[0].status, 'clean');
  assert.strictEqual(failing.pushes[0].title, 'QRD-1473: LGTM failed');
});

test('a blocker or a request change is handed to the owner; a resolved blocker does not count; other ledgers are ignored', async () => {
  const blocked = world({ autoLgtm: true });
  await blocked.review.tick();
  await blocked.review.ledger(verdict({ findings: [
    { at: '', severity: 'blocker', text: 'No tooltip', resolvedAt: null, resolvedWhy: null },
    { at: '', severity: 'blocker', text: 'Old', resolvedAt: '2026-10-27', resolvedWhy: 'fixed' },
  ] } as Partial<Orchestration>));
  assert.deepStrictEqual(blocked.approved, []);
  assert.deepStrictEqual([blocked.records[0].status, blocked.records[0].detail, blocked.pushes[0].title], ['blockers', '1 blocker', 'QRD-1473: 1 blocker']);

  const change = world({ autoLgtm: true });
  await change.review.tick();
  await change.review.ledger(verdict({ verdict: 'request-change' } as Partial<Orchestration>));
  assert.strictEqual(change.records[0].detail, 'Request change');

  const ignored = world({ autoLgtm: true });
  await ignored.review.tick();
  await ignored.review.ledger(verdict({ kind: 'build' } as Partial<Orchestration>));
  await ignored.review.ledger(verdict({ verdict: null } as Partial<Orchestration>));
  await ignored.review.ledger(verdict({ updatedAt: new Date(NOW.getTime() - 3_600_000).toISOString() }));
  await ignored.review.ledger(verdict({ key: 'QRD-9' }));
  assert.strictEqual(ignored.records[0].status, 'running');
  assert.deepStrictEqual(ignored.approved, []);
});

const FE = 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/88';

test('a thread with a BE and an FE pull request starts one Review session for both, and its verdict settles both records', async () => {
  const w = world({ autoLgtm: true, rows: [row({ prs: [`${PR}/files`, FE, PR] })] });
  assert.strictEqual(await w.review.tick(), 1);
  assert.strictEqual(w.opened.length, 1, 'one session for the ticket');
  assert.strictEqual(w.opened[0].prompt, reviewPrompt('QRD-1473', [PR, FE], 'https://discord.com/channels/g/t1'));
  assert.deepStrictEqual(w.records.map((record) => [record.prUrl, record.sessionId]), [[PR, 's1'], [FE, 's1']]);
  await w.review.ledger(verdict());
  assert.deepStrictEqual(w.approved, ['QRD-1473'], 'one LGTM for the ticket');
  assert.deepStrictEqual(w.records.map((record) => record.status), ['lgtm', 'lgtm']);
  assert.strictEqual(w.pushes.length, 1);

  const failing = world({ failOpen: true, rows: [row({ prs: [PR, FE] })] });
  assert.strictEqual(await failing.review.tick(), 0);
  assert.deepStrictEqual(failing.records.map((record) => record.status), ['failed', 'failed']);
});

test('the Agents list drops an auto review the pull request has moved past, keeps a running one and one GitHub cannot be asked about', async () => {
  const BE = 'https://github.com/qonekid/ms-admin-worker-backend/pull/1307';
  const FE = 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1081';
  const MERGED = 'https://github.com/qonekid/ms-client-dashboard-frontend/pull/1000';
  const DOWN = 'https://github.com/qonekid/ms-admin-worker-backend/pull/9';
  const asked: string[] = [];
  const pull: AutoReviewDeps['pull'] = async (owner, repo, number) => {
    asked.push(`${repo}#${number}`);
    if (number === 9) throw new Error('GitHub token is not configured in Settings');
    if (number === 1000) return { open: false, headSha: 'm1' };
    return { open: true, headSha: number === 1307 ? 'a28502d' : 'e25f2ad' };
  };
  const rows = [
    { id: 'pushed-past', prUrl: BE, headSha: '4adfd14', status: 'blockers' },
    { id: 'same-head', prUrl: FE, headSha: 'e25f2ad', status: 'blockers' },
    { id: 'running', prUrl: BE, headSha: 'a28502d', status: 'running' },
    { id: 'merged', prUrl: MERGED, headSha: 'm1', status: 'lgtm' },
    { id: 'unknown', prUrl: DOWN, headSha: 'x', status: 'clean' },
  ];
  assert.deepStrictEqual((await currentReviews(rows, pull)).map((item) => item.id), ['same-head', 'running', 'unknown']);
  assert.deepStrictEqual(asked.sort(), ['ms-admin-worker-backend#1307', 'ms-admin-worker-backend#9', 'ms-client-dashboard-frontend#1000', 'ms-client-dashboard-frontend#1081'], 'each pull request is asked once');
});
