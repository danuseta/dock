import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Express } from 'express';

if (process.env.JIDIS_SQLITE_INTEGRATION === '1') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dock-sqlite-'));
  const url = `file:${path.join(directory, 'integration.db').replaceAll('\\', '/')}`;
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY ||= 'integration-test-key';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../../prisma/schema.prisma')], { env: process.env, stdio: 'pipe' });
  after(() => rmSync(directory, { recursive: true, force: true }));
}

async function listen(app: Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function graphql(baseUrl: string, query: string, cookie?: string) {
  return fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ query }),
  });
}

test('SQLite storage preserves settings, PIN, demo-link, and cache behavior', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { createApp }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../app'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  await storage.upsertSetting('jiraApiToken', 'encrypted-secret');
  await storage.upsertSetting('googleClientSecret', 'google-secret');
  const settings = await storage.getSettings();
  assert.strictEqual(settings.find((item) => item.key === 'jiraApiToken')?.value, 'encrypted-secret');
  assert.strictEqual(settings.find((item) => item.key === 'googleClientSecret')?.value, 'google-secret');

  await storage.createQuickLink({ title: 'GitHub', url: 'https://github.com', color: '#60a5fa' });
  assert.strictEqual((await storage.getQuickLinks())[0]?.title, 'GitHub');

  const monitor = await storage.createMonitorTarget({ name: 'Portfolio', url: 'https://example.com/health', expectedStatus: 200, timeoutMs: 5000 });
  await storage.updateMonitorResult(monitor.id, { lastStatus: 'UP', lastStatusCode: 200, lastLatencyMs: 42, lastCheckedAt: new Date(), lastError: null });
  assert.deepStrictEqual((await storage.getMonitorTargets()).map((item) => [item.name, item.lastStatus, item.lastLatencyMs]), [['Portfolio', 'UP', 42]]);

  await storage.setMasterPin('123456');
  assert.strictEqual(await storage.verifyMasterPin('123456'), true);
  assert.strictEqual(await storage.verifyMasterPin('654321'), false);

  await storage.upsertDemoLink('JID-1', 'https://example.test/demo');
  assert.strictEqual((await storage.getDemoLink('JID-1'))?.url, 'https://example.test/demo');

  await storage.upsertCache('jira', 'assigned', [{ key: 'JID-1' }], 60);
  assert.deepStrictEqual(await storage.getCache('jira', 'assigned'), [{ key: 'JID-1' }]);

  const shell = await createApp({ frontendDistPath: 'missing-for-integration-test' });
  const runtime = await listen(shell.app);
  t.after(async () => {
    await runtime.close();
    await shell.apolloServer.stop();
  });

  const locked = await graphql(runtime.baseUrl, '{ dashboard { status } }');
  const lockedBody: any = await locked.json();
  assert.strictEqual(lockedBody.errors?.[0]?.extensions?.code, 'UNAUTHENTICATED');

  const unlock = await graphql(
    runtime.baseUrl,
    'mutation { verifyMasterPin(pin: "123456") }',
  );
  const unlockBody: any = await unlock.json();
  assert.strictEqual(unlockBody.data?.verifyMasterPin, true);
  const cookie = unlock.headers.get('set-cookie')?.split(';', 1)[0];
  assert.match(cookie || '', /^jidis_session=/);

  const status = await graphql(runtime.baseUrl, '{ authStatus { authenticated hasMasterPin } }', cookie);
  assert.deepStrictEqual(await status.json(), {
    data: { authStatus: { authenticated: true, hasMasterPin: true } },
  });
});

test('SQLite storage defaults machine to laptop and queues chat per machine', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  const at = new Date('2026-10-05T00:00:00.000Z');
  const [laptopSession, workspaceSession, idleSession] = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'];
  await storage.createChatSession({ id: laptopSession, source: 'dock', title: 'ZED-101', ticketKey: 'ZED-101', startedAt: at, lastMessageAt: at });
  await storage.createChatSession({ id: workspaceSession, source: 'dock', machine: 'workspace', title: 'ZED-102', ticketKey: 'ZED-102', startedAt: at, lastMessageAt: at });
  await storage.createChatSession({ id: idleSession, source: 'dock', title: 'idle', ticketKey: null, startedAt: at, lastMessageAt: at });
  assert.strictEqual((await storage.getChatSession(laptopSession))?.machine, 'laptop');
  assert.strictEqual((await storage.getChatSession(workspaceSession))?.machine, 'workspace');

  for (const sessionId of [laptopSession, workspaceSession, idleSession]) {
    await storage.createChatMessage({ sessionId, role: 'user', text: sessionId, state: 'queued', at });
  }
  await storage.updateChatSession(laptopSession, { status: 'queued' });
  await storage.updateChatSession(workspaceSession, { status: 'queued' });
  const cliSession = 'aaaaaaaa-0000-4000-8000-000000000004';
  await storage.createChatSession({ id: cliSession, source: 'cli', title: 'cli', ticketKey: null, startedAt: at, lastMessageAt: at });
  await storage.createChatMessage({ sessionId: cliSession, role: 'user', text: cliSession, state: 'queued', at });

  const queuedIds = async (machine: string, take = 10) => (await storage.getQueuedChatMessages(machine, take)).map((message) => message.sessionId);
  assert.deepStrictEqual(await queuedIds('laptop'), [laptopSession, idleSession], 'a queued message is found by its own state, whatever the status of its session');
  assert.deepStrictEqual(await queuedIds('workspace'), [workspaceSession]);
  assert.deepStrictEqual(await queuedIds('laptop', 1), [laptopSession]);
  assert.deepStrictEqual(await queuedIds('phone'), []);
  const [queued] = await storage.getQueuedChatMessages('workspace', 1);
  assert.deepStrictEqual([typeof queued.id, queued.text], ['number', workspaceSession]);

  const token = await storage.createIngestToken({ name: 'zed', prefix: 'dock_ing_zed', tokenHash: 'zed-hash', machine: 'workspace' });
  assert.strictEqual(token.machine, 'workspace');
  const fields = { title: 'Zed', stage: 'code', waiting: '', payload: '{}', ledgerUpdatedAt: at, machine: 'workspace', ledgerRaw: '{"history":[]}' };
  const run = await storage.upsertOrchestratorRun('ZED-101', fields);
  assert.strictEqual(run.machine, 'workspace');
  assert.deepStrictEqual([run.ledgerRaw, run.handover], ['{"history":[]}', null]);
  const offered = await storage.updateOrchestratorRun('ZED-101', { handover: '{"to":"laptop"}' });
  assert.strictEqual(offered.handover, '{"to":"laptop"}');
  assert.strictEqual('ledgerRaw' in offered, false, 'the update answers without the ledger');

  const lists = [...await storage.getOrchestratorRuns(), await storage.getOrchestratorRun('ZED-101')];
  assert.ok(lists.every((row) => row && !('ledgerRaw' in row)), 'a list or a plain read never loads the ledger');
  assert.strictEqual((await storage.getOrchestratorRunWithLedger('ZED-101'))?.ledgerRaw, '{"history":[]}');
  assert.strictEqual(await storage.countLiveOrchestratorRuns('workspace'), 1);

  assert.strictEqual(await storage.changeOrchestratorRunOwner('ZED-101', { machine: 'workspace', handover: '{"to":"other"}' }, 'laptop'), false, 'an offer that changed blocks the accept');
  assert.strictEqual(await storage.changeOrchestratorRunOwner('ZED-101', { machine: 'workspace', handover: '{"to":"laptop"}' }, 'laptop'), true);
  assert.strictEqual(await storage.changeOrchestratorRunOwner('ZED-101', { machine: 'workspace', handover: '{"to":"laptop"}' }, 'laptop'), false, 'the second of two racing accepts loses');
  const moved = await storage.getOrchestratorRunWithLedger('ZED-101');
  assert.deepStrictEqual([moved?.machine, moved?.handover, moved?.ledgerRaw], ['laptop', null, '{"history":[]}']);

  const late = await storage.upsertOrchestratorRun('ZED-101', { ...fields, title: 'Late push' });
  assert.deepStrictEqual([late.machine, late.title], ['laptop', 'Zed'], 'a push that read the old owner changes nothing and cannot take the ticket back');
  assert.strictEqual((await storage.upsertOrchestratorRun('ZED-101', { ...fields, machine: 'laptop', title: 'Owner push' })).title, 'Owner push');
  assert.strictEqual((await storage.upsertOrchestratorRun('ZED-102', fields)).machine, 'workspace', 'the owner is written when the ticket is created');
  const raced = await storage.upsertOrchestratorRun('ZED-102', { ...fields, machine: 'laptop' });
  assert.strictEqual(raced.machine, 'workspace', 'a second creator gets the row of the first');

  await storage.updateOrchestratorRun('ZED-101', { dismissedAt: at, handover: '{"to":"workspace"}' });
  assert.strictEqual(await storage.countLiveOrchestratorRuns('laptop'), 0);
  const taken = await storage.takeDismissedOrchestratorRun('ZED-101', { ...fields, title: 'Taken' });
  assert.deepStrictEqual([taken.machine, taken.title, taken.dismissedAt, taken.handover], ['workspace', 'Taken', null, null]);
  const notDismissed = await storage.takeDismissedOrchestratorRun('ZED-101', { ...fields, machine: 'laptop', title: 'Not allowed' });
  assert.deepStrictEqual([notDismissed.machine, notDismissed.title], ['workspace', 'Taken'], 'only a dismissed ticket can be taken');

  await storage.deleteChatSession(laptopSession);
  await storage.deleteChatSession(workspaceSession);
  await storage.deleteChatSession(idleSession);
  await storage.deleteChatSession(cliSession);
  await storage.revokeIngestToken(token.id);
});

test('SQLite storage takes a dismissed ticket only for its own machine or a machine without a token', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { OrchestratorService }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/orchestrator'),
  ]);
  const storage = new StorageService(prisma);
  const service = new OrchestratorService(storage, os.tmpdir());
  t.after(() => prisma.$disconnect());

  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const push = (machine: string, title: string) => service.ingestLedger({ key: 'ZED-103', title, stage: 'code', waiting: '', updatedAt: now.toISOString() }, now, machine);

  await push('laptop', 'Laptop title');
  await service.ingestHookEvent({ key: 'ZED-103', event: 'PreToolUse', detail: 'Bash' }, now, 'laptop');
  await service.dismiss('ZED-103');
  assert.strictEqual((await push('laptop', 'Revived')).ignored, false, 'the owner revives its own dismissed ticket');
  const revived = await storage.getOrchestratorRun('ZED-103');
  assert.deepStrictEqual([revived?.title, revived?.dismissedAt, revived?.activity], ['Revived', null, 'ACTIVE']);

  await service.dismiss('ZED-103');
  const refused = await push('workspace', 'Pusher title');
  assert.deepStrictEqual([refused.ignored, refused.machine], [true, 'laptop']);
  const kept = await storage.getOrchestratorRun('ZED-103');
  assert.deepStrictEqual([kept?.machine, kept?.title, kept?.dismissedAt === null], ['laptop', 'Revived', false], 'the row stays dismissed under its owner');

  await service.revokeToken((await service.tokens()).find((token) => token.machine === 'laptop')!.id);
  const taken = await push('workspace', 'Pusher title');
  assert.deepStrictEqual([taken.ignored, taken.machine], [false, 'workspace']);
  const row = await storage.getOrchestratorRun('ZED-103');
  assert.deepStrictEqual(
    [row?.title, row?.dismissedAt, row?.activity, row?.activityDetail, row?.activityEndedAt, row?.lastEventAt, row?.transcriptAt],
    ['Pusher title', null, 'IDLE', null, null, null, null],
    'the old machine history is reset',
  );

  await service.revokeToken(workspace.record.id);
});

test('SQLite storage keeps chat activity per turn with its own seq and removes it with the session or the trimmed turn', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  const at = new Date('2026-10-11T03:00:00.000Z');
  const sessionId = 'aaaaaaaa-0000-4000-8000-000000000011';
  await storage.createChatSession({ id: sessionId, source: 'dock', title: 'ZED-101', ticketKey: 'ZED-101', startedAt: at, lastMessageAt: at });
  const first = await storage.createChatMessage({ sessionId, role: 'user', text: 'one', state: 'done', at });
  const second = await storage.createChatMessage({ sessionId, role: 'user', text: 'two', state: 'taken', at });
  const row = (eventId: string, extra: object = {}) => ({
    eventId, parentId: null, kind: 'tool', agent: 'main', name: 'Bash', label: 'Bash', summary: 'ls', detail: null, status: 'running', startedAt: at, endedAt: null, ...extra,
  });
  const upsert = (turnId: number, events: ReturnType<typeof row>[]) => storage.upsertChatActivity(sessionId, turnId, events, 400, 'dropped-server', at);

  assert.deepStrictEqual(await upsert(first.id, [row('toolu_01')]), { accepted: 1, dropped: 0, seq: 1 });
  assert.deepStrictEqual(await upsert(first.id, [row('toolu_01', { status: 'ok', endedAt: at, detail: 'out' })]), { accepted: 1, dropped: 0, seq: 2 });
  assert.deepStrictEqual(await upsert(first.id, [row('toolu_01', { status: 'ok', endedAt: at, detail: 'out' })]), { accepted: 1, dropped: 0, seq: 2 }, 'a repeat writes nothing');
  assert.deepStrictEqual(await upsert(second.id, [row('toolu_01'), row('toolu_02')]), { accepted: 2, dropped: 0, seq: 4 }, 'the same event id in another turn is another row');
  assert.strictEqual(await storage.countChatActivity(sessionId, first.id), 1);

  await assert.rejects(
    prisma.chatActivity.create({ data: { sessionId, turnId: first.id, ...row('toolu_01'), seq: 9 } }),
    /Unique constraint/,
    'the table refuses a second row for the same session, turn and event',
  );
  const listed = await storage.getChatActivity(sessionId, { afterSeq: 2 }, 10);
  assert.deepStrictEqual(listed.map((item) => [item.eventId, item.seq, item.hasDetail, 'detail' in item]), [['toolu_01', 3, false, false], ['toolu_02', 4, false, false]]);
  const all = await storage.getChatActivity(sessionId, {}, 10);
  assert.deepStrictEqual(all.map((item) => [item.turnId, item.seq, item.hasDetail]), [[first.id, 2, true], [second.id, 3, false], [second.id, 4, false]]);
  assert.strictEqual(await storage.getChatActivityDetail(sessionId, all[0].id), 'out');
  assert.strictEqual(await storage.getChatActivityDetail('another-session', all[0].id), null);
  assert.strictEqual(await storage.closeRunningChatActivity(sessionId, second.id, 'stopped', at), 2);

  await storage.trimChatMessages(sessionId, 1);
  assert.deepStrictEqual((await storage.getChatActivity(sessionId, {}, 10)).map((item) => [item.turnId, item.status]), [[second.id, 'stopped'], [second.id, 'stopped']], 'the turn of the trimmed message loses its activity');
  assert.strictEqual(await storage.deleteChatSession(sessionId), true);
  assert.strictEqual(await prisma.chatActivity.count({ where: { sessionId } }), 0);
});
