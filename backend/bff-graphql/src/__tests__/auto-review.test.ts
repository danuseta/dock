import assert from 'node:assert';
import test from 'node:test';
import { AutoReview, ON_IT_WINDOW_MS, answeredFindings, currentReviews, reviewBody, reviewMarker, reviewPost, reviewPrompt, withMarker, type AutoReviewDeps, type AutoReviewRecord, type AutoReviewSettings, type PushMessage } from '../integrations/auto-review';
import { sortThread } from '../integrations/discord-reader';
import type { ThreadRow } from '../integrations/discord-threads';
import type { Orchestration } from '../integrations/orchestrator';

const NOW = new Date('2026-10-27T03:00:00.000Z');
const PR = 'https://github.com/qonekid/ms-admin-worker-backend/pull/412';

const row = (extra: Partial<ThreadRow> = {}): ThreadRow => ({
  version: 1, id: 't1', channelId: 'c1', channel: 'pr-review', kind: 'pr', title: 'QRD-1473 size column', url: 'https://discord.com/channels/g/t1',
  state: 'FLOW_1', why: '', needsYou: false, createdBy: 'Indra', createdByAvatar: null, createdAt: NOW.toISOString(), lastActivity: NOW.toISOString(), lastMessageId: null,
  messageCount: 2, tags: [], slots: 2, tickets: ['QRD-1473'], prs: [`${PR}/files`],
  claim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - 60_000).toISOString() },
  ownClaim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - 60_000).toISOString() },
  onIt: ['Danu'], claimerRepliedAt: null, mentionedAt: null, repliedAt: null, messages: [], ...extra,
});

const SETTINGS: AutoReviewSettings = { enabled: true, autoLgtm: false, post: true, postDelayMinutes: 2, reReviewWaitMinutes: 10, maxRounds: 3 };

function world(options: { enabled?: boolean; autoLgtm?: boolean; rows?: ThreadRow[]; open?: boolean; headSha?: string; approve?: boolean; failOpen?: boolean } = {}) {
  const records: AutoReviewRecord[] = [];
  const opened: Array<{ key: string; prompt: string }> = [];
  const approved: string[] = [];
  const pushes: PushMessage[] = [];
  let n = 0;
  const deps: AutoReviewDeps = {
    settings: async () => ({ ...SETTINGS, enabled: options.enabled ?? true, autoLgtm: options.autoLgtm ?? false }),
    rows: async () => options.rows ?? [row()],
    pull: async () => ({ open: options.open ?? true, headSha: options.headSha ?? 'abc1234' }),
    commitAt: async () => null,
    get: async (id) => records.find((record) => record.id === id) ?? null,
    duePosts: async (now) => records.filter((record) => record.postStatus === 'pending' && record.postAt && record.postAt <= now),
    latest: async (prUrl) => [...records].reverse().find((record) => record.prUrl === prUrl) ?? null,
    running: async (key) => [...records].reverse().find((record) => record.ticketKey === key && record.status === 'running') ?? null,
    create: async (data) => { const record: AutoReviewRecord = { id: `r${(n += 1)}`, sessionId: null, status: 'running', detail: null, finishedAt: null, postStatus: null, postAt: null, postText: null, postMessageId: null, postDetail: null, ...data }; records.push(record); return record; },
    update: async (id, data) => { Object.assign(records.find((record) => record.id === id) as AutoReviewRecord, data); },
    updatePending: async (id, data) => {
      const record = records.find((item) => item.id === id);
      if (record?.postStatus !== 'pending') return false;
      Object.assign(record, data);
      return true;
    },
    openReview: async (key, prompt) => { if (options.failOpen) throw new Error('No slot'); opened.push({ key, prompt }); return `s${opened.length}`; },
    approve: async (key) => { approved.push(key); return options.approve ?? true; },
    push: async (message) => { pushes.push(message); },
    owner: async () => ({ discordUserId: '111', webhookUrl: 'https://discord.com/api/webhooks/9/hook', name: 'Danu' }),
    postDiscord: async () => 'msg1',
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
    world({ rows: [row({ claim: { messageId: 'm2', authorId: 'x', author: 'Aken', mine: false, at: NOW.toISOString() }, ownClaim: null })] }),
    world({ rows: [row({ kind: 'bug' })] }),
    world({ rows: [row({ ownClaim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - ON_IT_WINDOW_MS - 1).toISOString() } })] }),
    world({ rows: [row({ tickets: [] })] }),
    world({ open: false }),
  ]) {
    assert.strictEqual(await quiet.review.tick(), 0);
    assert.strictEqual(quiet.opened.length, 0);
  }
});

test("a second reviewer saying on it later does not stop the review, and the 72 h window counts from the owner's on it", async () => {
  const later = { messageId: 'm3', authorId: 'x', author: 'Aken', mine: false, at: NOW.toISOString() };
  const w = world({ rows: [row({ claim: later })] });
  assert.strictEqual(await w.review.tick(), 1);
  assert.strictEqual(w.review.skipReason('t1'), null);

  const old = new Date(NOW.getTime() - ON_IT_WINDOW_MS - 1).toISOString();
  const stale = world({ rows: [row({ claim: later, ownClaim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: old } })] });
  assert.strictEqual(await stale.review.tick(), 0, "the other reviewer's fresh on it does not restart the window");
  assert.strictEqual(stale.review.skipReason('t1'), 'older than 72 h');
});

test('a skipped pull request thread records why', async () => {
  const reasonOf = async (options: Parameters<typeof world>[0], extra: Partial<ThreadRow> = {}) => {
    const w = world({ ...options, rows: [row(extra)] });
    await w.review.tick();
    return w.review.skipReason('t1');
  };
  assert.strictEqual(await reasonOf({}, { tickets: [] }), 'no ticket key');
  assert.strictEqual(await reasonOf({}, { prs: [] }), 'no pull request link');
  assert.strictEqual(await reasonOf({ open: false }), 'pull request closed');

  const same = world();
  await same.review.tick();
  same.records[0].startedAt = new Date(NOW.getTime() - 3_600_000);
  same.records[0].headSha = 'abc1234';
  same.deps.rows = async () => [row({ ownClaim: { messageId: 'm9', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - 60_000).toISOString() } })];
  await same.review.tick();
  assert.strictEqual(same.review.skipReason('t1'), 'same head commit, already reviewed');

  const noSlot = world({ failOpen: true });
  await noSlot.review.tick();
  assert.strictEqual(noSlot.review.skipReason('t1'), 'session did not start: No slot');

  const older = world({ rows: [row({ ownClaim: undefined as unknown as ThreadRow['ownClaim'] })] });
  assert.strictEqual(await older.review.tick(), 1, 'a row stored before ownClaim falls back to its own claim');

  const failing = world();
  failing.deps.pull = async () => { throw new Error('rate limit'); };
  await failing.review.tick();
  assert.strictEqual(failing.review.skipReason('t1'), 'GitHub fetch failed');
});

test('a new on it on a new head commit opens a new arena; a new on it on the same commit does not review it again', async () => {
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
  assert.strictEqual(await stale.review.tick(), 0, 'the head moved while the review of the earlier head is still running');
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

test('an on it said while the workspace was off starts the review when DOCK comes back the next morning', async () => {
  const night = new Date(NOW.getTime() - 11 * 60 * 60 * 1000).toISOString();
  const w = world({ rows: [row({ ownClaim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: night } })] });
  assert.strictEqual(await w.review.tick(), 1);
  assert.strictEqual(w.opened[0].key, 'QRD-1473');
});

test('turning the setting on does not start reviews for on its said before it', async () => {
  let enabled = false;
  const w = world({ rows: [row({ ownClaim: { messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: new Date(NOW.getTime() - 60_000).toISOString() } })] });
  w.deps.settings = async () => ({ ...SETTINGS, enabled });
  assert.strictEqual(await w.review.tick(), 0);
  enabled = true;
  assert.strictEqual(await w.review.tick(), 0);
  assert.strictEqual(w.review.skipReason('t1'), 'said before the setting was turned on');
  assert.strictEqual(w.opened.length, 0);
});

const THREAD = 'https://discord.com/channels/1/222';
const message = (id: string, at: Date, text: string, extra: Partial<ThreadRow['messages'][number]> = {}): ThreadRow['messages'][number] => ({
  id, authorId: 'u2', author: 'Indra', avatar: '', mine: false, at: at.toISOString(), text, mentions: [], attachments: [], ...extra,
});
const finding = (severity: string, text: string, resolvedAt: string | null = null) => ({ at: '', severity, text, resolvedAt, resolvedWhy: resolvedAt ? 'fixed' : null });

test('the review post carries the verdict, open blockers and non-blocking findings with their text, only a count of nits, and the fixed marker', () => {
  const pulls = [{ url: PR, headSha: 'abc1234def' }];
  const change = reviewPost({ key: 'QRD-1473', verdict: 'request-change', findings: [
    finding('blocker', 'Empty state still says No data yet, EmptyState.tsx:42'),
    finding('non-blocking', 'Retry button has no aria-label'),
    finding('nit', 'Trailing space'),
    finding('blocker', 'Old one', '2026-10-27'),
  ] } as unknown as Orchestration, pulls, 1, '111');
  assert.strictEqual(change, [
    'QRD-1473 · Request change · 1 blocker, 1 non-blocking',
    `<${PR}> @ abc1234`,
    '1) blocker: Empty state still says No data yet, EmptyState.tsx:42',
    '2) non-blocking: Retry button has no aria-label',
    'nit: 1, di ledger',
    'DOCK-REVIEW on it by <@111> · round 1 · @ abc1234',
  ].join('\n'));

  const comments = reviewPost({ key: 'QRD-1473', verdict: 'approve', findings: [finding('non-blocking', 'Badge is faint in light mode')] } as unknown as Orchestration, pulls, 2, '111');
  assert.match(comments, /^QRD-1473 · Approve with comments · 1 non-blocking\n/);
  assert.match(comments, /\nDOCK-REVIEW on it by <@111> · round 2 · @ abc1234$/);

  const nits = reviewPost({ key: 'QRD-1473', verdict: 'approve', findings: [finding('nit', 'a'), finding('nit', 'b')] } as unknown as Orchestration, pulls, 1, '111');
  assert.strictEqual(nits, ['QRD-1473 · Approve', `<${PR}> @ abc1234`, 'nit: 2, di ledger', 'DOCK-REVIEW on it by <@111> · round 1 · @ abc1234'].join('\n'));
  assert.strictEqual(reviewMarker('111', 3, 'b71e0d4aa'), 'DOCK-REVIEW on it by <@111> · round 3 · @ b71e0d4');

  const long = reviewPost({ key: 'QRD-1473', verdict: 'request-change', findings: [finding('blocker', 'x'.repeat(3000))] } as unknown as Orchestration, pulls, 1, '111');
  assert.ok(long.length <= 2000 && long.endsWith('DOCK-REVIEW on it by <@111> · round 1 · @ abc1234'), 'a long post is cut, the marker stays');
});

test('a finding the author answered "tidak diubah karena" in a DOCK-FIX reply is not posted again', () => {
  const at = NOW.toISOString();
  const answered = answeredFindings([
    { text: 'mas danu, 1) blocker: Rename the column to size: tidak diubah karena kontrak bilang size_kb.\nDOCK-FIX round 1 · head def5678', at, webhookId: '7' },
    { text: 'Tooltip is missing on the chart: tidak diubah karena ini bukan balasan DOCK', at, webhookId: '7' },
    { text: 'Tooltip is missing on the chart: tidak diubah karena\nDOCK-FIX round 1 · head def5678', at },
    { text: 'Tooltip is missing on the chart: tidak diubah karena\nDOCK-FIX round 0 · head 0000000', at: new Date(NOW.getTime() - 3_600_000).toISOString(), webhookId: '7' },
  ], NOW.getTime() - 60_000);
  assert.deepStrictEqual(answered, ['mas danu 1 blocker rename the column to size'], 'only DOCK-FIX replies a webhook posted since the arena opened count');
  const post = reviewBody({ key: 'QRD-1473', verdict: 'request-change', findings: [finding('blocker', 'Rename the column to size'), finding('blocker', 'Tooltip is missing on the chart')] } as unknown as Orchestration, [{ url: PR, headSha: 'def5678' }], answered);
  assert.doesNotMatch(post, /Rename/);
  assert.match(post, /1\) blocker: Tooltip is missing on the chart/);

  const loose = ['the 1 blocker about the size of the column and also rename the column to size here please and more words'];
  const short = ['size'];
  const kept = (answers: string[], text: string) => reviewBody({ key: 'QRD-1473', verdict: 'request-change', findings: [finding('blocker', text)] } as unknown as Orchestration, [{ url: PR, headSha: 'def5678' }], answers);
  assert.match(kept(loose, 'Rename the column to size'), /Rename/, 'a finding under half of the answered line is not the same finding');
  assert.match(kept(short, 'size'), /size/, 'a finding under 15 characters is always posted');
});

test('a verdict schedules the post for later; the tick sends it to the thread through the webhook once it is due', async () => {
  const w = world({ rows: [row({ url: THREAD })] });
  const sent: Array<{ webhookUrl: string; content: string; options: { threadId: string; username: string } }> = [];
  w.deps.postDiscord = async (webhookUrl, content, options) => { sent.push({ webhookUrl, content, options }); return 'msg42'; };
  await w.review.tick();
  await w.review.ledger(verdict({ verdict: 'request-change', findings: [finding('blocker', 'No tooltip')] } as Partial<Orchestration>));
  const record = w.records[0];
  assert.strictEqual(record.postStatus, 'pending');
  assert.strictEqual(record.postAt?.getTime(), NOW.getTime() + 2 * 60_000);
  assert.match(record.postText ?? '', /DOCK-REVIEW on it by <@111> · round 1 · @ abc1234$/);
  await w.review.tick();
  assert.strictEqual(sent.length, 0, 'not before the delay');
  w.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  await w.review.tick();
  assert.deepStrictEqual(sent.map((item) => [item.webhookUrl, item.options.threadId, item.options.username]), [['https://discord.com/api/webhooks/9/hook', '222', 'Danu (DOCK)']]);
  assert.strictEqual(sent[0].content, record.postText);
  assert.deepStrictEqual([record.postStatus, record.postMessageId], ['sent', 'msg42']);
  await w.review.tick();
  assert.strictEqual(sent.length, 1, 'sent once');

  const off = world({ rows: [row({ url: THREAD })] });
  off.deps.settings = async () => ({ ...SETTINGS, post: false });
  await off.review.tick();
  await off.review.ledger(verdict());
  assert.strictEqual(off.records[0].postStatus, null, 'the setting off schedules nothing');

  const noId = world({ rows: [row({ url: THREAD })] });
  noId.deps.owner = async () => ({ discordUserId: null, webhookUrl: 'https://discord.com/api/webhooks/9/hook', name: 'Danu' });
  await noId.review.tick();
  await noId.review.ledger(verdict());
  assert.deepStrictEqual([noId.records[0].postStatus, noId.records[0].postDetail], ['skipped', 'No Discord user id in Settings']);

  const failing = world({ rows: [row({ url: THREAD })] });
  failing.deps.postDiscord = async () => { throw new Error('Unknown Webhook'); };
  await failing.review.tick();
  await failing.review.ledger(verdict());
  failing.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  await failing.review.tick();
  assert.deepStrictEqual([failing.records[0].postStatus, failing.records[0].postDetail], ['failed', 'Unknown Webhook']);
  assert.strictEqual(failing.pushes.at(-1)?.title, 'QRD-1473: review post failed');
});

test('a pending post can be cancelled or edited; the marker line stays as DOCK wrote it, and a sent post cannot be changed', async () => {
  const w = world({ rows: [row({ url: THREAD })] });
  let posts = 0;
  w.deps.postDiscord = async () => { posts += 1; return 'msg1'; };
  await w.review.tick();
  await w.review.ledger(verdict());
  const record = w.records[0];
  const marker = (record.postText ?? '').split('\n').pop();
  assert.strictEqual(await w.review.editPost(record.id, 'mas indra, gak ada blocker.\nDOCK-REVIEW on it by <@999> · round 9 · @ fake'), true);
  assert.strictEqual(record.postText, `mas indra, gak ada blocker.\n${marker}`);
  await assert.rejects(w.review.editPost(record.id, '  \n'), /empty/);
  assert.strictEqual(await w.review.cancelPost(record.id), true);
  assert.strictEqual(record.postStatus, 'cancelled');
  w.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  await w.review.tick();
  assert.strictEqual(posts, 0, 'a cancelled post is not sent');
  await assert.rejects(w.review.cancelPost(record.id), /pending/);
  await assert.rejects(w.review.editPost(record.id, 'x'), /pending/);

  const closed = world({ rows: [row({ url: THREAD })] });
  closed.deps.postDiscord = async () => { posts += 1; return 'msg1'; };
  await closed.review.tick();
  await closed.review.ledger(verdict());
  closed.deps.pull = async () => ({ open: false, headSha: 'abc1234' });
  closed.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  await closed.review.tick();
  assert.deepStrictEqual([closed.records[0].postStatus, closed.records[0].postDetail, posts], ['cancelled', 'pull request closed', 0]);
});

const ON_IT_AT = new Date(NOW.getTime() - 60 * 60_000);
const claimAt = (at: Date) => ({ messageId: 'm2', authorId: 'me', author: 'Danu', mine: true, at: at.toISOString() });

/** A thread whose arena had a round at abc1234, and a pull request now at def5678. */
function arena(options: { round?: number; status?: string; startedAt?: Date; messages?: ThreadRow['messages']; claim?: Date; commitAt?: Date | null; open?: boolean } = {}) {
  const w = world({ headSha: 'def5678', open: options.open, rows: [row({ url: THREAD, ownClaim: claimAt(options.claim ?? ON_IT_AT), messages: options.messages ?? [] })] });
  w.records.push({
    id: 'r0', prUrl: PR, headSha: 'abc1234', ticketKey: 'QRD-1473', threadUrl: THREAD, sessionId: 's0', status: options.status ?? 'blockers', detail: '1 blocker',
    startedAt: options.startedAt ?? new Date(NOW.getTime() - 50 * 60_000), finishedAt: null, round: options.round ?? 1,
    postStatus: 'sent', postAt: null, postText: null, postMessageId: 'msg1', postDetail: null,
  });
  w.deps.commitAt = async () => options.commitAt ?? null;
  return w;
}

test('while the arena is open, a new head is reviewed again after the DOCK-FIX for it, or once the last commit is old enough', async () => {
  const fixed = arena({ messages: [message('m5', new Date(NOW.getTime() - 5 * 60_000), 'mas danu, fixed di def5678.\nDOCK-FIX round 1 · head def5678', { webhookId: '7' })], commitAt: new Date(NOW.getTime() - 60_000) });
  assert.strictEqual(await fixed.review.tick(), 1);
  assert.deepStrictEqual(fixed.records.map((record) => [record.headSha, record.round]), [['abc1234', 1], ['def5678', 2]]);

  const quiet = arena({ commitAt: new Date(NOW.getTime() - 11 * 60_000) });
  assert.strictEqual(await quiet.review.tick(), 1, 'the author fixed it by hand and stopped pushing');
  assert.strictEqual(quiet.records[1].round, 2);

  const pushing = arena({ commitAt: new Date(NOW.getTime() - 2 * 60_000), messages: [message('m5', NOW, 'DOCK-FIX round 1 · head abc1234', { webhookId: '7' })] });
  assert.strictEqual(await pushing.review.tick(), 0, 'no review in the middle of a push');
  assert.strictEqual(pushing.review.skipReason('t1'), 'waiting for DOCK-FIX or 10 min after the last commit');

  const typed = arena({ commitAt: new Date(NOW.getTime() - 2 * 60_000), messages: [message('m5', NOW, 'DOCK-FIX round 1 · head def5678')] });
  assert.strictEqual(await typed.review.tick(), 0, 'a person typing DOCK-FIX does not skip the wait');
  const before = arena({ commitAt: new Date(NOW.getTime() - 2 * 60_000), messages: [message('m5', new Date(NOW.getTime() - 55 * 60_000), 'DOCK-FIX round 1 · head def5678', { webhookId: '7' })] });
  assert.strictEqual(await before.review.tick(), 0, 'a DOCK-FIX from before the last round started does not count');

  const sameHead = arena();
  sameHead.deps.pull = async () => ({ open: true, headSha: 'abc1234' });
  assert.strictEqual(await sameHead.review.tick(), 0);
  assert.strictEqual(sameHead.review.skipReason('t1'), 'same head commit, already reviewed');
});

test('the arena closes on approve, on a closed pull request, after the last round, on stop dock and after 72 h without a commit', async () => {
  const fresh = new Date(NOW.getTime() - 20 * 60_000);
  const cases: Array<[Parameters<typeof arena>[0], string]> = [
    [{ status: 'clean', commitAt: fresh }, 'arena closed: approved'],
    [{ status: 'lgtm', commitAt: fresh }, 'arena closed: approved'],
    [{ open: false, commitAt: fresh }, 'pull request closed'],
    [{ round: 3, commitAt: fresh }, 'arena closed: 3 rounds'],
    [{ messages: [message('m6', new Date(NOW.getTime() - 10 * 60_000), 'stop dock ya, kita ngobrol langsung')], commitAt: fresh }, 'arena closed: stop dock'],
    [{ claim: new Date(NOW.getTime() - 100 * 3_600_000), startedAt: new Date(NOW.getTime() - 90 * 3_600_000), commitAt: new Date(NOW.getTime() - 3_600_000) }, 'arena closed: 72 h without a new commit'],
  ];
  for (const [options, reason] of cases) {
    const w = arena(options);
    assert.strictEqual(await w.review.tick(), 0, reason);
    assert.strictEqual(w.review.skipReason('t1'), reason);
    assert.strictEqual(w.opened.length, 0);
  }

  const future = arena({ commitAt: new Date(NOW.getTime() + 100 * 3_600_000) });
  assert.strictEqual(await future.review.tick(), 0);
  assert.strictEqual(future.review.skipReason('t1'), 'arena closed: 72 h without a new commit', 'the later of the commit date and the moment DOCK saw the head counts');

  let asked = 0;
  const stale = arena({ claim: new Date(NOW.getTime() - 100 * 3_600_000), startedAt: new Date(NOW.getTime() - 90 * 3_600_000) });
  stale.deps.pull = async () => { asked += 1; return { open: true, headSha: 'def5678' }; };
  stale.deps.commitAt = async () => { asked += 1; return null; };
  await stale.review.tick();
  await stale.review.tick();
  assert.strictEqual(asked, 0, 'an arena quiet for 72 h does not ask GitHub on every tick');

  const quoted = arena({ messages: [message('m6', NOW, 'kalau mau berhenti tulis stop dock\nDOCK-FIX round 1 · head def5678', { webhookId: '7' })] });
  assert.strictEqual(await quoted.review.tick(), 1, 'a DOCK post quoting stop dock is not a person asking');

  const last = world({ rows: [row({ url: THREAD })] });
  await last.review.tick();
  last.records[0].round = 3;
  await last.review.ledger(verdict({ verdict: 'request-change', findings: [finding('blocker', 'Retry count resets')] } as Partial<Orchestration>));
  assert.strictEqual(last.pushes.at(-1)?.title, 'QRD-1473: 3 rounds, still 1 blocker');
  assert.match(last.records[0].postText ?? '', /round 3 · @ abc1234$/, 'the last round is still posted');
});

test('a new on it after the arena closed opens a new arena, counting rounds from 1 again', async () => {
  const w = arena({ status: 'clean', round: 2, claim: new Date(NOW.getTime() - 60_000), startedAt: new Date(NOW.getTime() - 30 * 60_000) });
  assert.strictEqual(await w.review.tick(), 1);
  assert.deepStrictEqual(w.records.map((record) => [record.headSha, record.round]), [['abc1234', 2], ['def5678', 1]]);
});

test("the owner's own DOCK-REVIEW post in the thread is not an on it: it opens no arena and restarts no round count", async () => {
  const claimed = new Date(NOW.getTime() - 60 * 60_000);
  const messages = [
    message('m1', new Date(NOW.getTime() - 2 * 3_600_000), `PR QRD-1473 ready review ya ${PR}`),
    message('m2', claimed, 'on it', { authorId: 'me', author: 'Danu', mine: true }),
    message('m3', new Date(NOW.getTime() - 10 * 60_000), 'QRD-1473 · Request change · 1 blocker\nDOCK-REVIEW on it by <@me> · round 1 · @ abc1234', { authorId: '9', author: 'Danu (DOCK)', webhookId: '9' }),
    message('m4', new Date(NOW.getTime() - 5 * 60_000), 'QRD-1473 · Approve\nDOCK-REVIEW on it by <@me> · round 1 · @ abc1234', { authorId: 'me', author: 'Danu', mine: true }),
  ];
  const sorted = sortThread('pr', false, 'u2', false, messages, 'me');
  assert.strictEqual(sorted.ownClaim?.messageId, 'm2', "the owner's claim stays the real on it");
  assert.strictEqual(sorted.claim?.messageId, 'm2', 'a marker post is no claim for anyone');

  const w = arena({ claim: new Date(sorted.ownClaim?.at ?? 0), messages, commitAt: new Date(NOW.getTime() - 2 * 60_000) });
  assert.strictEqual(await w.review.tick(), 0);
  assert.strictEqual(w.review.skipReason('t1'), 'waiting for DOCK-FIX or 10 min after the last commit', 'still round 1 of the same arena');
});

test('a post taken for sending cannot be cancelled or edited, goes out with the last edit, and two senders post it once', async () => {
  const w = world({ rows: [row({ url: THREAD })] });
  const sent: string[] = [];
  let during: Promise<unknown> | null = null;
  w.deps.postDiscord = async (_url, content) => {
    sent.push(content);
    during = Promise.allSettled([w.review.cancelPost('r1'), w.review.editPost('r1', 'too late')]);
    return 'msg1';
  };
  await w.review.tick();
  await w.review.ledger(verdict());
  await w.review.editPost('r1', 'edited before the delay ran out');
  w.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  const other = new AutoReview(w.deps);
  await Promise.all([w.review.tick(), other.tick()]);
  assert.strictEqual(sent.length, 1, 'one post however many senders look');
  assert.match(sent[0], /^edited before the delay ran out\nDOCK-REVIEW on it by <@111>/);
  const [cancel, edit] = (await during) as unknown as PromiseSettledResult<boolean>[];
  assert.match(String((cancel as PromiseRejectedResult).reason), /Only a pending post can be changed/);
  assert.match(String((edit as PromiseRejectedResult).reason), /Only a pending post can be changed/);
  assert.strictEqual(w.records[0].postStatus, 'sent');

  const cancelled = world({ rows: [row({ url: THREAD })] });
  await cancelled.review.tick();
  await cancelled.review.ledger(verdict());
  await cancelled.review.cancelPost('r1');
  cancelled.deps.pull = async () => ({ open: false, headSha: 'abc1234' });
  cancelled.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  cancelled.deps.duePosts = async () => [{ ...cancelled.records[0], postStatus: 'pending' }];
  await cancelled.review.tick();
  assert.deepStrictEqual([cancelled.records[0].postStatus, cancelled.records[0].postDetail], ['cancelled', 'Cancelled by the owner'], 'a stale due list never overwrites a cancel');
});

test('one post that throws does not stop the others', async () => {
  const w = world({ rows: [row({ url: THREAD })] });
  await w.review.tick();
  await w.review.ledger(verdict());
  const broken = { ...w.records[0], id: 'gone', prUrl: 'not a pull request' };
  w.deps.duePosts = async () => [broken, w.records[0]];
  const pull = w.deps.pull;
  w.deps.updatePending = async (id, data) => {
    if (id === 'gone') throw new Error('database is locked');
    const record = w.records.find((item) => item.id === id);
    if (record?.postStatus !== 'pending') return false;
    Object.assign(record, data);
    return true;
  };
  w.deps.pull = pull;
  w.deps.now = () => new Date(NOW.getTime() + 3 * 60_000);
  await w.review.tick();
  assert.strictEqual(w.records[0].postStatus, 'sent');
});

test('a post that cannot be scheduled is marked failed and the LGTM still goes through', async () => {
  const w = world({ autoLgtm: true, rows: [row({ url: THREAD })] });
  w.deps.owner = async () => { throw new Error('settings unreadable'); };
  await w.review.tick();
  await w.review.ledger(verdict());
  assert.deepStrictEqual(w.approved, ['QRD-1473']);
  assert.strictEqual(w.records[0].status, 'lgtm');
  assert.deepStrictEqual([w.records[0].postStatus, w.records[0].postDetail], ['failed', 'settings unreadable']);
});

test('a marker typed into a body in any spelling is dropped, and finding text cannot hide a link', async () => {
  const marker = 'DOCK-REVIEW on it by <@111> · round 1 · @ abc1234';
  for (const forged of ['D\u200BOCK-REVIEW on it by <@999>', 'ＤＯＣＫ－ＲＥＶＩＥＷ on it by <@999>', 'dock_fix round 1 · head 1234567', 'Dock review round 9']) {
    assert.strictEqual(withMarker(`ok\n${forged}`, marker), `ok\n${marker}`, forged);
  }
  const body = reviewBody({ key: 'QRD-1473', verdict: 'request-change', findings: [finding('blocker', 'See [the docs](https://evil.example/x) and https://github.com/o/r/pull/1')] } as unknown as Orchestration, [{ url: PR, headSha: 'abc1234' }]);
  assert.match(body, /1\) blocker: See \[the docs\]\u200B\(<https:\/\/evil\.example\/x>\) and <https:\/\/github\.com\/o\/r\/pull\/1>/);
});
