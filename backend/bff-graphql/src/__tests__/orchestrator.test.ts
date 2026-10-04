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
  OrchestratorInputError,
  OrchestratorService,
  attentionItems,
  parseLedger,
  parseTranscript,
  reduceHookEvent,
  toOrchestration,
} from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

function memoryStorage() {
  const runs = new Map<string, any>();
  const events: any[] = [];
  const tokens: any[] = [];
  let sequence = 0;
  const storage = {
    getOrchestratorRuns: async () => [...runs.values()],
    getOrchestratorRun: async (key: string) => runs.get(key) ?? null,
    upsertOrchestratorRun: async (key: string, data: any) => {
      const row = {
        activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null,
        ...runs.get(key), key, ...data, dismissedAt: null,
      };
      runs.set(key, row);
      return row;
    },
    updateOrchestratorRun: async (key: string, data: any) => {
      const row = { ...runs.get(key), ...data };
      runs.set(key, row);
      return row;
    },
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
      const token = { id: String(sequence += 1), ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
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
  assert.deepStrictEqual(parsed.ac.map((item) => item.state), ['PASS', 'FAIL', 'TODO']);
  assert.strictEqual(parsed.prBe, 'https://github.com/example/be/pull/1');
  assert.strictEqual(parsed.prFe, null, 'non-HTTP PR links are dropped');
  assert.strictEqual(parsed.updatedAt, '2026-10-04T08:15:33.256Z');
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
    assert.strictEqual(await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse' }, now), null, 'unknown tickets are not created by hooks');

    const run = await service.ingestLedger(ledger, now);
    assert.strictEqual(run.activity, 'WAITING');
    assert.deepStrictEqual([run.acPassed, run.acFailed, run.acTotal], [1, 1, 3]);
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING']);

    assert.deepStrictEqual((await service.needsAttention(now)).map((item) => item.type), ['AGENT_WAITING', 'AGENT_AC_FAILED']);

    await service.ingestLedger({ ...ledger, waiting: '', stage: 'pr', ac: [] }, now);
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING', 'STAGE', 'RESUMED']);

    const working = await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Bash' }, now);
    assert.strictEqual(working?.activity, 'ACTIVE');
    await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Read' }, now);
    assert.strictEqual(events.filter((event) => event.kind === 'AGENT_ACTIVE').length, 1, 'repeated tool calls do not grow the event log');

    const later = new Date(now.getTime() + 45 * 60 * 1000);
    assert.deepStrictEqual(attentionItems(await service.list(later)).map((item) => item.type), ['AGENT_STALLED']);

    assert.strictEqual(await service.readTranscript('QRD-1387'), null);
    const stats = await service.saveTranscript({
      key: 'QRD-1387', files: [{ path: 'abc.jsonl', text: '{"type":"user"}\n' }], stats: { masked: 3 },
    }, now);
    assert.deepStrictEqual(stats, { files: 1, bytes: 16, masked: 3 });
    assert.deepStrictEqual(JSON.parse(await service.readTranscript('QRD-1387') || '{}').files[0].path, 'abc.jsonl');
    assert.strictEqual((await service.get('QRD-1387', now))?.hasTranscript, true);
    assert.throws(() => parseTranscript({ key: 'QRD-1', files: [{ path: '../../etc/passwd', text: '' }] }), OrchestratorInputError);
    assert.strictEqual(await service.readTranscript('../QRD-1387'), null);

    assert.strictEqual(await service.dismiss('QRD-1387'), true);
    assert.deepStrictEqual(await service.list(now), []);
    await service.ingestLedger(ledger, now);
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

  assert.strictEqual(await service.authenticate(created.token), true);
  assert.strictEqual(await service.authenticate(generateIngestToken().token), false);
  assert.strictEqual(await service.revokeToken(created.record.id), true);
  assert.strictEqual(await service.authenticate(created.token), false);
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
