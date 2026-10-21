import assert from 'node:assert';
import test from 'node:test';
import { AutoBroadcast, sendBroadcast, type AutoBroadcastDeps, type BroadcastDeps } from '../integrations/broadcast';
import { DoctorReports, parseDoctorReport } from '../integrations/doctor';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { ApprovalRecords, approveReview, type ApprovalDeps } from '../integrations/review-approval';

function autoWorld(overrides: Partial<AutoBroadcastDeps> = {}) {
  const state = { posted: new Set<string>(), sent: [] as string[], events: [] as Array<[string, string, string | null]>, demo: true, open: true, accept: true, inReview: new Set<string>() };
  const deps: AutoBroadcastDeps = {
    posted: async (key) => state.posted.has(key),
    markPosted: async (key) => { state.posted.add(key); },
    hasDemo: async () => state.demo,
    reviewStarted: async (key) => state.inReview.has(key),
    hasOpenPullRequest: async () => state.open,
    broadcast: async (key) => { state.sent.push(key); return state.accept; },
    event: async (key, kind, detail) => { state.events.push([key, kind, detail]); },
    now: () => new Date('2026-10-20T03:00:00.000Z'),
    ...overrides,
  };
  return { state, auto: new AutoBroadcast(deps) };
}

test('a demo video for a ticket with an open pull request posts the broadcast once; a re-render does not post again', async () => {
  const { state, auto } = autoWorld();
  assert.strictEqual(await auto.afterDemoVideo('QRD-1'), 'posted');
  assert.strictEqual(await auto.afterDemoVideo('QRD-1'), 'already', 'a second upload of the same ticket');
  assert.deepStrictEqual(state.sent, ['QRD-1']);
  assert.deepStrictEqual(state.events, [['QRD-1', 'BROADCAST', 'posted to Discord after the demo video']]);
});

test('without an open pull request the video waits; the ledger that names the pull request posts it', async () => {
  const { state, auto } = autoWorld();
  state.open = false;
  assert.strictEqual(await auto.afterDemoVideo('QRD-2'), 'waiting');
  assert.deepStrictEqual(state.sent, []);
  assert.strictEqual(await auto.afterLedger({ key: 'QRD-2', prBe: null, prFe: null }), 'waiting', 'a ledger without a pull request');
  state.open = true;
  assert.strictEqual(await auto.afterLedger({ key: 'QRD-2', prBe: 'https://github.com/o/be/pull/4' }), 'posted');
  assert.strictEqual(await auto.afterLedger({ key: 'QRD-2', prBe: 'https://github.com/o/be/pull/4' }), 'waiting', 'posted once');
  state.demo = false;
  assert.strictEqual(await auto.afterLedger({ key: 'QRD-3', prFe: 'https://github.com/o/fe/pull/5' }), 'waiting', 'no video yet');
  assert.deepStrictEqual(state.sent, ['QRD-2']);
});

test('a failed broadcast is logged on the ticket and tried again on the next upload', async () => {
  const { state, auto } = autoWorld();
  state.accept = false;
  assert.strictEqual(await auto.afterDemoVideo('QRD-4'), 'failed');
  assert.strictEqual(state.events[0][1], 'BROADCAST_FAILED');
  const thrown = autoWorld({ broadcast: async () => { throw new Error('webhook 404'); } });
  assert.strictEqual(await thrown.auto.afterDemoVideo('QRD-4'), 'failed');
  assert.deepStrictEqual(thrown.state.events, [['QRD-4', 'BROADCAST_FAILED', 'webhook 404']]);
  state.accept = true;
  assert.strictEqual(await auto.afterDemoVideo('QRD-4'), 'posted');
});

test('the broadcast posts the ticket group with its demo links and moves tickets before review to PR Review', async () => {
  const payloads: any[] = [];
  const moves: string[] = [];
  const deps: BroadcastDeps = {
    relation: async () => ({ ticketKeys: ['QRD-5', 'QRD-6'], primaryKey: 'QRD-6' }),
    ticket: async (key) => ({ key, title: `T ${key}`, url: `https://jira/${key}`, status: key === 'QRD-5' ? 'In Progress' : 'PR Review' }),
    pullRequests: async (key) => [{ url: `https://github.com/o/be/pull/${key.slice(4)}` }],
    demoLink: async (key) => (key === 'QRD-5' ? { url: 'https://cdn/QRD-5.mp4' } : null),
    settings: async () => ({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessageTemplate: '{{demoUrl}}' }),
    send: async (payload) => { payloads.push(payload); return true; },
    move: async (key) => { moves.push(key); return true; },
  };
  assert.strictEqual(await sendBroadcast(deps, { ticketKey: 'QRD-5' }), true);
  assert.strictEqual(payloads[0].ticket.key, 'QRD-6');
  assert.strictEqual(payloads[0].prs.length, 2);
  assert.strictEqual(payloads[0].demoUrl, '- **QRD-5 + QRD-6:** https://cdn/QRD-5.mp4');
  assert.deepStrictEqual(moves, ['QRD-5']);
});

test('a ticket already in PR Review was announced before, so a fix round ledger or a new video does not post it again', async () => {
  const { state, auto } = autoWorld();
  state.inReview.add('QRD-7');
  assert.strictEqual(await auto.afterLedger({ key: 'QRD-7', prBe: 'https://github.com/o/be/pull/7' }), 'already');
  assert.strictEqual(await auto.afterDemoVideo('QRD-7'), 'already');
  assert.deepStrictEqual(state.sent, []);
  assert.ok(state.posted.has('QRD-7'), 'remembered, so Jira is not asked again');
});

test('a broadcast by hand is remembered, and a grouped ticket without a pull request is neither posted nor moved', async () => {
  const payloads: any[] = [];
  const moves: string[] = [];
  const marked: string[] = [];
  const deps: BroadcastDeps = {
    relation: async () => ({ ticketKeys: ['QRD-8', 'QRD-9'], primaryKey: 'QRD-8' }),
    ticket: async (key) => ({ key, title: `T ${key}`, url: `https://jira/${key}`, status: 'In Progress' }),
    pullRequests: async (key) => (key === 'QRD-8' ? [{ url: 'https://github.com/o/be/pull/8' }] : []),
    demoLink: async () => ({ url: 'https://cdn/QRD-8.mp4' }),
    settings: async () => ({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/x', discordMessageTemplate: '{{demoUrl}}' }),
    send: async (payload) => { payloads.push(payload); return true; },
    move: async (key) => { moves.push(key); return true; },
    markPosted: async (key) => { marked.push(key); },
  };
  assert.strictEqual(await sendBroadcast(deps, { ticketKey: 'QRD-8' }), true);
  assert.deepStrictEqual(payloads[0].relatedTickets.map((t: { key: string }) => t.key), ['QRD-8'], 'QRD-9 depends on QRD-8 but has no pull request yet');
  assert.deepStrictEqual(moves, ['QRD-8']);
  assert.deepStrictEqual(marked, ['QRD-8']);
});

function approvalWorld(overrides: Partial<ApprovalDeps> = {}) {
  const calls: string[] = [];
  const events: Array<[string, string | null]> = [];
  const deps: ApprovalDeps = {
    addLabel: async (key, label) => { calls.push(`label ${key} ${label}`); },
    pullRequests: async () => [
      { owner: 'o', repo: 'be', number: 1, status: 'open', url: 'https://github.com/o/be/pull/1' },
      { owner: 'o', repo: 'fe', number: 2, status: 'merged', url: 'https://github.com/o/fe/pull/2' },
      { owner: 'o', repo: 'fe', number: 3, status: 'draft', url: 'https://github.com/o/fe/pull/3' },
    ],
    approve: async (owner, repo, number) => { calls.push(`approve ${owner}/${repo}#${number}`); },
    event: async (_key, kind, detail) => { events.push([kind, detail]); },
    ...overrides,
  };
  return { calls, events, deps };
}

test('approving a review labels the Jira ticket pass and approves each open pull request on GitHub', async () => {
  const { calls, events, deps } = approvalWorld();
  const steps = await approveReview('QRD-7', deps);
  assert.deepStrictEqual(calls, ['label QRD-7 pass', 'approve o/be#1', 'approve o/fe#3']);
  assert.deepStrictEqual(steps.map((step) => [step.name, step.ok]), [['Jira label pass', true], ['GitHub approve o/be#1', true], ['GitHub approve o/fe#3', true]]);
  assert.deepStrictEqual(events.map(([kind]) => kind), ['APPROVED', 'APPROVED', 'APPROVED']);
});

test('each approval step reports its own failure and the others still run', async () => {
  const jiraDown = Object.assign(new Error('Request failed'), { response: { status: 403, data: { errorMessages: ['No permission to edit'] } } });
  const { calls, events, deps } = approvalWorld({
    addLabel: async () => { throw jiraDown; },
    approve: async (_owner, repo) => { if (repo === 'fe') throw Object.assign(new Error('x'), { response: { status: 422, data: { message: 'Can not approve your own pull request' } } }); },
  });
  const steps = await approveReview('QRD-8', deps);
  assert.deepStrictEqual(steps.map((step) => [step.ok, step.detail]), [
    [false, '403 No permission to edit'], [true, 'https://github.com/o/be/pull/1'], [false, '422 Can not approve your own pull request'],
  ]);
  assert.deepStrictEqual(events.map(([kind]) => kind), ['APPROVE_FAILED', 'APPROVED', 'APPROVE_FAILED']);
  assert.deepStrictEqual(calls, []);

  const named = approvalWorld({ pullRequests: async () => { throw new Error('no lookup when the verdict names the pull requests'); } });
  const steps2 = await approveReview('QRD-77', named.deps, ['https://github.com/o/fe/pull/9']);
  assert.deepStrictEqual(named.calls, ['label QRD-77 pass', 'approve o/fe#9']);
  assert.ok(steps2.every((step) => step.ok));

  const none = await approveReview('QRD-8', approvalWorld({ pullRequests: async () => [] }).deps);
  assert.deepStrictEqual(none.map((step) => [step.name, step.ok, step.detail]), [['Jira label pass', true, 'added to QRD-8'], ['GitHub approve', false, 'no open pull request found for QRD-8']]);
});

test('a doctor report keeps the latest report per machine with its checks', async () => {
  const now = new Date('2026-10-20T03:00:00.000Z');
  const report = { machine: 'DESKTOP-1', os: 'win32', at: '2026-10-20T02:59:00.000Z', kitVersion: 'abc123', checks: [{ name: 'rtk', ok: true, detail: '0.9' }, { name: 'ffmpeg', ok: false, detail: 'not on PATH' }] };
  assert.deepStrictEqual(parseDoctorReport(report, 'laptop', now), {
    machine: 'laptop', host: 'DESKTOP-1', os: 'win32', at: '2026-10-20T02:59:00.000Z', receivedAt: now.toISOString(), kitVersion: 'abc123',
    checks: [{ name: 'rtk', ok: true, detail: '0.9' }, { name: 'ffmpeg', ok: false, detail: 'not on PATH' }],
  });
  for (const bad of [null, { checks: [] }, { checks: [{ name: 'rtk' }] }, { checks: [{ ok: true }] }]) {
    assert.throws(() => parseDoctorReport(bad, 'laptop', now), OrchestratorInputError);
  }
  assert.strictEqual(parseDoctorReport({ ...report, at: '2099-01-01T00:00:00.000Z' }, 'laptop', now).at, now.toISOString(), 'a report from the future reads as now');

  const cache = new Map<string, unknown>();
  const reports = new DoctorReports({
    getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { cache.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
  });
  assert.deepStrictEqual(await reports.ingest(report, 'workspace', now), { machine: 'workspace', checks: 2, failing: 1 });
  await reports.ingest(report, 'laptop', now);
  await reports.ingest({ ...report, checks: [{ name: 'rtk', ok: true }] }, 'workspace', now);
  const list = await reports.list();
  assert.deepStrictEqual(list.map((item) => [item.machine, item.checks.length]), [['laptop', 2], ['workspace', 1]], 'the newest report replaces the older one of that machine');
});

test('an approval is remembered as done only when every step succeeded, so a reload shows it', async () => {
  const cache = new Map<string, unknown>();
  const records = new ApprovalRecords({
    getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { cache.set(`${namespace}:${key}`, value); },
  });
  assert.strictEqual(await records.approved('QRD-7'), false, 'never approved');
  await records.save('QRD-7', [{ name: 'Jira label pass', ok: true, detail: '' }, { name: 'GitHub approve o/be#1', ok: false, detail: '422' }]);
  assert.strictEqual(await records.approved('QRD-7'), false, 'a failed step leaves Approve open for a retry');
  await records.save('QRD-7', [{ name: 'Jira label pass', ok: true, detail: '' }, { name: 'GitHub approve o/be#1', ok: true, detail: '' }]);
  assert.strictEqual(await records.approved('QRD-7'), true);
  await records.save('QRD-8', []);
  assert.strictEqual(await records.approved('QRD-8'), false, 'nothing done is not done');
});
