import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  await service.dismiss('ZED-103', 'laptop');
  assert.strictEqual((await push('laptop', 'Revived')).ignored, false, 'the owner revives its own dismissed ticket');
  const revived = await storage.getOrchestratorRun('ZED-103');
  assert.deepStrictEqual([revived?.title, revived?.dismissedAt, revived?.activity], ['Revived', null, 'ACTIVE']);

  await service.dismiss('ZED-103', 'laptop');
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

test('SQLite storage keeps chat interactions unique per request, caps them, and removes them with the turn or the session', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  const at = new Date('2026-10-12T03:00:00.000Z');
  const later = (seconds: number) => new Date(at.getTime() + seconds * 1000);
  const sessionId = 'aaaaaaaa-0000-4000-8000-000000000021';
  await storage.createChatSession({ id: sessionId, source: 'dock', title: 'ZED-201', ticketKey: null, startedAt: at, lastMessageAt: at });
  const turn = await storage.createChatMessage({ sessionId, role: 'user', text: 'go', state: 'queued', at, options: '{"model":"sonnet"}' });
  assert.strictEqual(await storage.moveChatMessage(turn.id, sessionId, 'queued', 'taken', { takenAt: at }), true);
  const taken = await storage.getChatMessage(turn.id);
  assert.deepStrictEqual([taken?.state, taken?.takenAt?.getTime(), taken?.options, taken?.stopRequestedAt], ['taken', at.getTime(), '{"model":"sonnet"}', null]);
  assert.deepStrictEqual(await storage.getOverdueChatSessions(later(1)), [{ id: sessionId }]);
  assert.deepStrictEqual(await storage.getOverdueChatSessions(at), [], 'a turn taken exactly at the limit is not overdue');
  await storage.updateChatSession(sessionId, { status: 'running', lastDeltaAt: at });
  const quietOf = async (silent: number, stop: number) => (await storage.getQuietChatTurns(later(silent), later(stop)));
  assert.deepStrictEqual(await quietOf(0, 0), { silent: [], unstopped: [] });
  assert.deepStrictEqual((await quietOf(1, 0)).silent, [{ sessionId, turnId: turn.id }]);
  assert.strictEqual(await storage.requestChatStop(turn.id, sessionId, at), true);
  assert.deepStrictEqual((await quietOf(0, 1)).unstopped, [{ sessionId, turnId: turn.id }]);
  assert.deepStrictEqual((await quietOf(0, 0)).unstopped, []);
  assert.strictEqual(await storage.requestChatStop(turn.id, sessionId, later(5)), false, 'the first stop request is kept');
  assert.strictEqual((await storage.getOpenChatMessage(sessionId))?.id, turn.id);
  await storage.updateChatSession(sessionId, { options: '{"model":"sonnet"}' });
  assert.strictEqual((await storage.getChatSession(sessionId))?.options, '{"model":"sonnet"}');

  const ask = (requestId: string, expiresAt = later(600)) => ({ sessionId, turnId: turn.id, requestId, kind: 'permission', title: 'Bash', body: '{}', expiresAt });
  const limits = { pending: 4, perTurn: 6 };
  const first = await storage.createChatInteraction(ask('r1'), limits, at);
  assert.strictEqual(first.refused, null);
  const again = await storage.createChatInteraction(ask('r1'), limits, at);
  assert.strictEqual(again.row?.id, first.row?.id, 'the same session, turn and request id is one row');
  await assert.rejects(
    prisma.chatInteraction.create({ data: ask('r1') }),
    /Unique constraint/,
    'the table refuses a second row for the same session, turn and request',
  );

  for (const id of ['r2', 'r3', 'r4']) assert.strictEqual((await storage.createChatInteraction(ask(id), limits, at)).refused, null);
  const extra: Array<string | null> = [];
  for (const id of ['r5', 'r6', 'r7']) extra.push((await storage.createChatInteraction(ask(id), limits, at)).refused);
  assert.deepStrictEqual(extra, ['pending', 'pending', 'pending'], 'a fifth pending ask of a turn is refused');
  const rowOf = (requestId: string) => prisma.chatInteraction.findFirstOrThrow({ where: { sessionId, requestId } });

  assert.deepStrictEqual((await storage.getPendingChatInteractions(sessionId, 4)).map((row) => row.requestId), ['r1', 'r2', 'r3', 'r4']);
  assert.deepStrictEqual([...await storage.getWaitingChatSessionIds([sessionId, 'other'], at)], [sessionId]);
  assert.strictEqual(await storage.answerChatInteraction(first.row!.id, '{"decision":"allow","note":null}', later(10)), true);
  assert.strictEqual(await storage.answerChatInteraction(first.row!.id, '{"decision":"deny","note":null}', later(11)), false, 'only a pending ask can be answered');
  assert.deepStrictEqual((await storage.getUndeliveredChatInteractions(sessionId, turn.id)).map((row) => [row.requestId, row.state]), [['r1', 'answered']]);
  await storage.markChatInteractionsDelivered(sessionId, turn.id, ['r1', 'r2'], later(12));
  assert.deepStrictEqual(await storage.getUndeliveredChatInteractions(sessionId, turn.id), [], 'a pending ask is not marked delivered');
  assert.strictEqual((await rowOf('r2')).deliveredAt, null);

  assert.strictEqual(await storage.answerChatInteraction((await rowOf('r2')).id, '{}', later(700)), false, 'an overdue ask cannot be answered');
  await storage.expireChatInteractions(sessionId, later(700));
  assert.deepStrictEqual(
    (await storage.getUndeliveredChatInteractions(sessionId, turn.id)).map((row) => [row.requestId, row.state]),
    [['r2', 'expired'], ['r3', 'expired'], ['r4', 'expired']],
  );

  const more = await storage.createChatInteraction(ask('r5', later(1500)), limits, later(700));
  assert.strictEqual(more.refused, null);
  await storage.cancelChatInteractions(sessionId, turn.id);
  assert.strictEqual((await rowOf('r5')).state, 'cancelled');
  assert.strictEqual((await storage.createChatInteraction(ask('r6'), limits, later(700))).refused, null);
  assert.strictEqual((await storage.createChatInteraction(ask('r7'), limits, later(700))).refused, 'turn', 'a seventh ask of a turn is refused');

  const cancellable = await storage.createChatInteraction(ask('c1', later(1500)), { pending: 4, perTurn: 20 }, later(700));
  const answeredOne = await storage.createChatInteraction(ask('c2', later(1500)), { pending: 4, perTurn: 20 }, later(700));
  await storage.answerChatInteraction(answeredOne.row!.id, '{}', later(701));
  assert.strictEqual(await storage.cancelChatInteractionsByRequest(sessionId, turn.id + 1, ['c1']), 0, 'another turn is not touched');
  assert.strictEqual(await storage.cancelChatInteractionsByRequest('other-session', turn.id, ['c1']), 0, 'another session is not touched');
  assert.strictEqual((await rowOf('c1')).state, 'pending');
  assert.strictEqual(await storage.cancelChatInteractionsByRequest(sessionId, turn.id, ['c1', 'c2', 'nothing']), 1, 'only the pending match is cancelled');
  assert.deepStrictEqual([(await rowOf('c1')).state, (await rowOf('c2')).state], ['cancelled', 'answered']);
  assert.strictEqual(await storage.answerChatInteraction(cancellable.row!.id, '{}', later(702)), false, 'a cancelled ask cannot be answered');

  const pruned = await storage.pruneChatInteractions({ before: later(1), maxRows: 2 });
  assert.strictEqual(pruned.expired, 0);
  assert.strictEqual(pruned.evicted, 6);
  assert.strictEqual(await prisma.chatInteraction.count({ where: { sessionId } }), 2, 'the newest rows are kept');
  assert.strictEqual((await storage.pruneChatInteractions({ before: new Date('2999-01-01T00:00:00.000Z'), maxRows: 5000 })).expired, 2);

  await storage.createChatInteraction(ask('r8'), limits, later(700));
  await storage.upsertChatMachineInfo('laptop', { caps: '{"v":2}' });
  await storage.upsertChatMachineInfo('laptop', { catalog: '{"hash":"h"}', catalogHash: 'h' });
  const info = await storage.getChatMachineInfo('laptop');
  assert.deepStrictEqual([info?.caps, info?.catalog, info?.catalogHash], ['{"v":2}', '{"hash":"h"}', 'h']);
  assert.strictEqual(await storage.getChatMachineInfo('workspace'), null);
  await prisma.chatMachineInfo.deleteMany({ where: { machine: 'laptop' } });

  assert.strictEqual(await storage.deleteChatSession(sessionId), true);
  assert.strictEqual(await prisma.chatInteraction.count({ where: { sessionId } }), 0);
});

test('SQLite chat service survives concurrent asks, answers and activity writes on one file', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { ChatService }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/chat'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());
  const service = new ChatService(storage);

  const dock = await service.createSession({ title: 'Concurrent' });
  const sent = await service.sendMessage(dock.id, 'go', ['laptop']);
  const claim = await service.claim({ wait: 0, caps: { v: 2, kit: '1.0.0', claude: '2.1.296', features: ['interactive'], modes: ['default'], catalogHash: null } }, undefined, 'laptop');
  assert.strictEqual(claim.message?.id, sent.id);
  const turn = { sessionId: dock.id, replyTo: sent.id };
  const ask = (requestId: string) => ({
    ...turn, requestId, kind: 'permission', title: 'Run', ttlSeconds: 600,
    body: { tool: 'Bash', label: 'Bash', summary: 'ls', detail: 'ls', agent: null, alwaysLabel: null },
  });
  const events = (id: string) => ({ v: 1, ...turn, events: [{ id, kind: 'tool', name: 'Bash', status: 'running', startedAt: new Date().toISOString() }] });

  const first = await Promise.all([
    service.ask(ask('c1'), 'laptop'), service.ask(ask('c2'), 'laptop'), service.ask(ask('c3'), 'laptop'),
    service.activity(events('t1'), 'laptop'), service.activity(events('t2'), 'laptop'),
    service.wait({ ...turn, wait: 0 }, undefined, 'laptop'),
  ]);
  assert.strictEqual(first.filter(Boolean).length, 6);

  const pending = await service.pending(dock.id, 'running', 'laptop');
  assert.strictEqual(pending.length, 3);
  const waiting = service.wait({ ...turn, wait: 5 }, undefined, 'laptop');
  await new Promise((resolve) => setTimeout(resolve, 50));
  await Promise.all([
    service.answerInteraction(dock.id, pending[0].id, 'allow', undefined, undefined),
    service.activity(events('t3'), 'laptop'),
    service.answerInteraction(dock.id, pending[1].id, 'deny', undefined, 'no'),
  ]);
  const woken = await waiting;
  assert.ok(woken && woken.answers.length >= 1 && woken.answers.length <= 2);
  assert.strictEqual(service.waiters(), 0);

  await service.delta({ ...turn, done: true }, 'laptop');
  const states = (await prisma.chatInteraction.findMany({ where: { sessionId: dock.id }, orderBy: { id: 'asc' } })).map((row) => row.state);
  assert.deepStrictEqual(states, ['answered', 'answered', 'cancelled']);
  assert.strictEqual(await service.deleteSession(dock.id), true);
});

test('SQLite attachment store and session lookup keep their contract on a real file', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { prismaChatAttachmentStore: store, prismaChatSessionLookup: lookup }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../storage/chat-attachments'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());
  const at = new Date('2026-10-12T00:00:00.000Z');
  const sessionId = `att-${Date.now()}`;
  await storage.createChatSession({ id: sessionId, source: 'dock', machine: 'laptop', title: '', ticketKey: null, startedAt: at, lastMessageAt: at });
  const message = await storage.createChatMessage({ sessionId, role: 'user', text: 'files', state: 'draft', at });

  assert.deepStrictEqual([(await lookup.session(sessionId))?.machine, (await lookup.message(message.id))?.state, (await lookup.message(message.id))?.sessionId], ['laptop', 'draft', sessionId]);
  assert.strictEqual(await lookup.session('missing-session'), null);
  assert.strictEqual(await lookup.message(2_000_000_000), null);

  const row = (id: string, extra: Partial<Parameters<typeof store.create>[0]> = {}) => ({
    id, sessionId, messageId: null, name: `${id}.txt`, mime: 'text/plain', size: 3, sha256: 'a'.repeat(64),
    state: 'uploaded', createdAt: new Date(at.getTime() + Number(id.slice(-1)) * 1000), fetchedAt: null, ...extra,
  });
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
  for (const id of ids) await store.create(row(id));
  assert.strictEqual((await store.get(ids[0]))?.name, `${ids[0]}.txt`);
  assert.strictEqual(await store.get('00000000-0000-4000-8000-0000000000ff'), null);
  assert.deepStrictEqual((await store.getMany([ids[2], ids[0]])).map((item) => item.id).sort(), [ids[0], ids[2]]);
  assert.strictEqual(await store.countBySessionState(sessionId, 'uploaded'), 3);

  assert.strictEqual(await store.claim(sessionId, [ids[0], ids[1]], message.id), 2);
  assert.strictEqual(await store.claim(sessionId, [ids[0], ids[2]], message.id), 1, 'a file already attached is not claimed again');
  assert.strictEqual(await store.claim('another-session', [ids[2]], message.id), 0);
  assert.deepStrictEqual((await store.forMessages([message.id])).map((item) => [item.id, item.state, item.messageId]), ids.map((id) => [id, 'attached', message.id]));
  assert.deepStrictEqual((await store.forMessages([])).length, 0);

  await store.release(message.id);
  assert.deepStrictEqual((await store.forSession(sessionId)).map((item) => [item.state, item.messageId]), ids.map(() => ['uploaded', null]));
  assert.strictEqual(await store.removeUploaded(ids[2]), true);
  assert.strictEqual(await store.removeUploaded(ids[2]), false);
  assert.strictEqual(await store.claim(sessionId, [ids[0]], message.id), 1);
  assert.strictEqual(await store.removeUploaded(ids[0]), false, 'an attached file is not removed as an unsent upload');

  const fetchedAt = new Date(at.getTime() + 5000);
  await store.update(ids[0], { state: 'fetched', fetchedAt });
  assert.deepStrictEqual([(await store.get(ids[0]))?.state, (await store.get(ids[0]))?.fetchedAt?.getTime()], ['fetched', fetchedAt.getTime()]);
  await store.update(ids[1], { state: 'deleted' });
  assert.deepStrictEqual((await store.live()).filter((item) => item.sessionId === sessionId).map((item) => item.id), [ids[0]]);
  await store.purgeDeleted(new Date(at.getTime() - 1000));
  assert.ok(await store.get(ids[1]), 'a deleted row inside the retention period stays');
  await store.purgeDeleted(new Date(at.getTime() + 60_000));
  assert.strictEqual(await store.get(ids[1]), null);
  assert.ok(await store.get(ids[0]));

  await store.remove(ids[0]);
  assert.strictEqual(await store.get(ids[0]), null);
  await store.create(row('00000000-0000-4000-8000-000000000004'));
  await store.removeSession(sessionId);
  assert.deepStrictEqual(await store.forSession(sessionId), []);
});

test('SQLite never shows a draft in the thread, search or last text, and sweeps stale drafts and overdue asks', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { ChatService }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/chat'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());
  const at = new Date('2026-10-12T00:00:00.000Z');
  const sessionId = `draft-${Date.now()}`;
  await storage.createChatSession({ id: sessionId, source: 'dock', machine: 'laptop', title: '', ticketKey: null, startedAt: at, lastMessageAt: at });
  const done = await storage.createChatMessage({ sessionId, role: 'user', text: 'sent zebra', state: 'done', at });
  const draft = await storage.createChatMessage({ sessionId, role: 'user', text: 'half zebra', state: 'draft', at: new Date(at.getTime() + 1000) });

  assert.deepStrictEqual((await storage.getChatMessages(sessionId, {}, 50)).map((item) => item.id), [done.id]);
  assert.deepStrictEqual((await storage.getChatMessages(sessionId, { afterId: 0 }, 50)).map((item) => item.id), [done.id]);
  assert.deepStrictEqual((await storage.searchChatMessages('zebra', 50)).filter((item) => item.sessionId === sessionId).map((item) => item.id), [done.id]);
  assert.deepStrictEqual((await storage.searchChatMessages('zebra', 50, 'laptop')).filter((item) => item.sessionId === sessionId).map((item) => item.id), [done.id]);
  assert.deepStrictEqual((await storage.searchChatMessages('zebra', 50, 'workspace')).filter((item) => item.sessionId === sessionId), [], 'search keeps to the machine');
  assert.ok((await storage.getChatSessions(null, 300, 'laptop')).some((item) => item.id === sessionId));
  assert.ok(!(await storage.getChatSessions(null, 300, 'workspace')).some((item) => item.id === sessionId));
  assert.strictEqual((await storage.getChatLastTexts([sessionId], 50)).get(sessionId), 'sent zebra');
  assert.deepStrictEqual((await storage.getStaleChatDrafts(new Date(at.getTime() + 500))).filter((item) => item.sessionId === sessionId), []);
  assert.deepStrictEqual((await storage.getStaleChatDrafts(new Date(at.getTime() + 2000))).filter((item) => item.sessionId === sessionId), [{ id: draft.id, sessionId }]);
  assert.strictEqual(await storage.moveChatMessage(draft.id, sessionId, 'draft', 'queued'), true);
  assert.strictEqual(await storage.deleteChatDraft(draft.id), false, 'a message that was queued is not a draft any more');
  assert.strictEqual(await storage.moveChatMessage(draft.id, sessionId, 'queued', 'draft'), true);
  assert.strictEqual(await storage.deleteChatDraft(draft.id), true);
  assert.strictEqual(await storage.getChatMessage(draft.id), null);

  const base = { sessionId, turnId: done.id, kind: 'permission', title: 't', body: '{}' };
  const limits = { pending: 4, perTurn: 100 };
  await storage.createChatInteraction({ ...base, requestId: 'old', expiresAt: new Date(at.getTime() + 1000) }, limits, at);
  await storage.createChatInteraction({ ...base, requestId: 'new', expiresAt: new Date(at.getTime() + 600_000) }, limits, at);
  const later = new Date(at.getTime() + 5000);
  assert.strictEqual(await storage.hasOverdueChatInteractions(sessionId, at), false);
  assert.strictEqual(await storage.hasOverdueChatInteractions(sessionId, later), true);
  assert.deepStrictEqual((await storage.getPendingChatInteractions(sessionId, 10, later)).map((item) => item.requestId), ['new']);
  assert.deepStrictEqual((await storage.getPendingChatInteractions(sessionId, 10)).map((item) => item.requestId), ['old', 'new']);
  await storage.expireChatInteractions(sessionId, later);
  assert.strictEqual(await storage.hasOverdueChatInteractions(sessionId, later), false);

  const service = new ChatService(storage, () => later);
  assert.strictEqual(await service.deleteSession(sessionId), true);
});

test('prisma db push adds only the new chat tables and columns to a database with data', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const { PrismaClient } = await import('@prisma/client');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dock-additive-'));
  const databaseUrl = `file:${path.join(directory, 'current.db').replaceAll('\\', '/')}`;
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const cli = require.resolve('prisma/build/index.js');
  const prismaCli = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { env, stdio: 'pipe' });
  const legacy = path.join(directory, 'legacy.prisma');
  writeFileSync(legacy, `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model ChatSession {
  id              String    @id
  source          String
  machine         String    @default("laptop")
  title           String    @default("")
  ticketKey       String?
  forkFrom        String?
  claudeSessionId String?
  status          String    @default("idle")
  statusDetail    String?
  messageCount    Int       @default(0)
  startedAt       DateTime
  lastMessageAt   DateTime
  lastDeltaAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([source, lastMessageAt])
}

model ChatMessage {
  id        Int      @id @default(autoincrement())
  sessionId String
  role      String
  text      String
  state     String   @default("done")
  at        DateTime

  @@index([sessionId, id])
}
`);
  prismaCli('db', 'push', '--skip-generate', '--schema', legacy);
  const seed = path.join(directory, 'seed.sql');
  writeFileSync(seed, `INSERT INTO "ChatSession" ("id","source","startedAt","lastMessageAt","updatedAt") VALUES ('legacy-1','dock',0,0,0);
INSERT INTO "ChatMessage" ("sessionId","role","text","at") VALUES ('legacy-1','user','kept',0);`);
  prismaCli('db', 'execute', '--file', seed, '--schema', legacy);

  prismaCli('db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../../prisma/schema.prisma'));

  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => {
    await client.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
  const session = await client.chatSession.findUnique({ where: { id: 'legacy-1' } });
  const message = await client.chatMessage.findFirst({ where: { sessionId: 'legacy-1' } });
  assert.deepStrictEqual([session?.options, message?.text, message?.options, message?.takenAt, message?.stopRequestedAt], [null, 'kept', null, null, null]);
  assert.deepStrictEqual(
    [await client.chatInteraction.count(), await client.chatAttachment.count(), await client.chatMachineInfo.count()],
    [0, 0, 0],
  );
  assert.strictEqual(await client.chatSession.count(), 1);
  assert.strictEqual(await client.chatMessage.count(), 1);
});

test('SQLite storage counts cron slots per machine and keeps DOCK work orders', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  const at = new Date('2026-10-14T00:00:00.000Z');
  const id = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
  const open = (n: number, origin: 'cron' | 'manual', machine = 'workspace') => storage.createChatSession({ id: id(n), source: 'dock', machine, title: String(n), ticketKey: null, startedAt: at, lastMessageAt: at, origin });
  await open(1, 'cron'); await open(2, 'cron'); await open(3, 'cron'); await open(4, 'manual'); await open(5, 'cron', 'laptop');
  const say = (n: number, state: string, role = 'user') => storage.createChatMessage({ sessionId: id(n), role, text: 'x', state, at });
  await say(1, 'taken');
  await say(2, 'taken'); await say(2, 'queued');
  await say(3, 'queued'); await say(3, 'done', 'assistant');
  await say(4, 'taken');
  await say(5, 'taken');
  assert.deepStrictEqual(await storage.countCronSlots('workspace'), { busy: 2, waiting: 1 }, 'a queued message behind a running turn is not waiting for a slot; manual and other machines do not count');
  assert.deepStrictEqual(await storage.countCronSlots('phone'), { busy: 0, waiting: 0 });
  assert.deepStrictEqual((await storage.getQueuedChatMessages('workspace', 10)).map((m) => [m.sessionId, m.origin]), [[id(2), 'cron'], [id(3), 'cron']]);
  assert.strictEqual((await storage.getChatSession(id(4)))?.origin, 'manual');

  await storage.setTicketOrder('QRD-7', 3);
  await storage.setTicketOrder('QRD-7', 1);
  await storage.setTicketOrder('QRD-8', 2);
  await storage.deleteTicketOrder('QRD-8');
  await storage.deleteTicketOrder('QRD-404');
  assert.deepStrictEqual([...(await storage.getTicketOrders()).entries()], [['QRD-7', 1]]);

  await storage.setTicketManual('QRD-7', true);
  await storage.setTicketManual('QRD-9', true);
  assert.deepStrictEqual([...(await storage.getManualTicketKeys())].sort(), ['QRD-7', 'QRD-9'], 'a ticket without a number can be manual');
  assert.deepStrictEqual([...(await storage.getTicketOrders()).entries()], [['QRD-7', 1]], 'a manual ticket without a number has no order');
  await storage.deleteTicketOrder('QRD-7');
  assert.deepStrictEqual([[...(await storage.getTicketOrders()).keys()], [...(await storage.getManualTicketKeys())].sort()], [[], ['QRD-7', 'QRD-9']], 'removing the number keeps the manual mark');
  await storage.setTicketManual('QRD-7', false);
  await storage.setTicketManual('QRD-9', false);
  assert.deepStrictEqual([await storage.getManualTicketKeys(), await prisma.ticketOrder.count()], [new Set(), 0], 'an empty row is removed');

  const later = new Date(at.getTime() + 1000);
  const session = (n: number, ticketKey: string, origin: 'cron' | 'manual', startedAt: Date, source = 'dock') => storage.createChatSession({ id: `cccccccc-0000-4000-8000-0000000000${n}`, source, machine: 'workspace', title: String(n), ticketKey, startedAt, lastMessageAt: startedAt, origin });
  await session(11, 'QRD-1', 'cron', at); await session(12, 'QRD-1', 'cron', later);
  await session(13, 'QRD-2', 'cron', at); await session(14, 'QRD-2', 'manual', later);
  await session(15, 'QRD-3', 'cron', later); await session(16, 'QRD-3', 'manual', at);
  await session(17, 'QRD-4', 'cron', at);
  const states = await storage.getCronSessionStates(['QRD-1', 'QRD-2', 'QRD-3', 'QRD-404']);
  assert.deepStrictEqual([...states.entries()], [
    ['QRD-1', { id: 'cccccccc-0000-4000-8000-000000000012', status: 'idle', statusDetail: null, otherActive: false }],
    ['QRD-2', { id: 'cccccccc-0000-4000-8000-000000000013', status: 'idle', statusDetail: null, otherActive: true }],
    ['QRD-3', { id: 'cccccccc-0000-4000-8000-000000000015', status: 'idle', statusDetail: null, otherActive: false }],
  ], 'only the asked tickets; a manual session that spoke after the cron one counts as active');
  await storage.updateChatSession('cccccccc-0000-4000-8000-000000000016', { status: 'running' });
  assert.strictEqual((await storage.getCronSessionStates(['QRD-3'])).get('QRD-3')?.otherActive, true, 'a running manual session counts');
});

test('SQLite switches to write-ahead logging and stays there', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const { prisma, useWriteAheadLog } = await import('../storage/client');
  t.after(() => prisma.$disconnect());

  assert.strictEqual(await useWriteAheadLog(), 'wal');
  assert.strictEqual(await useWriteAheadLog(), 'wal', 'a second call changes nothing');
  const [row] = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
  assert.strictEqual(row.journal_mode, 'wal');
});

test('SQLite storage finds tickets whose latest cron session died before the agent answered', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  const id = (n: number) => `dddddddd-0000-4000-8000-00000000000${n}`;
  const minute = (m: number) => new Date(Date.UTC(2026, 9, 15, 8, m));
  const open = (n: number, ticketKey: string, m: number, origin: 'cron' | 'manual' = 'cron') =>
    storage.createChatSession({ id: id(n), source: 'dock', machine: 'workspace', title: ticketKey, ticketKey, startedAt: minute(m), lastMessageAt: minute(m), origin });
  const say = (n: number, state: string, role = 'user') => storage.createChatMessage({ sessionId: id(n), role, text: 'x', state, at: minute(30) });
  await open(1, 'QRD-1', 1); await say(1, 'done');
  await open(2, 'QRD-2', 1); await say(2, 'done'); await say(2, 'done', 'assistant');
  await open(3, 'QRD-3', 1); await say(3, 'taken');
  await open(4, 'QRD-4', 1); await say(4, 'done');
  await open(5, 'QRD-4', 5); await say(5, 'queued');
  await open(6, 'QRD-6', 1, 'manual'); await say(6, 'done');
  await open(7, 'QRD-7', 1);

  assert.deepStrictEqual((await storage.getDeadCronStartKeys(minute(0))).sort(), ['QRD-1'], 'a reply, a running or queued turn, a newer session, a manual session and an empty session all keep a ticket out');
  assert.deepStrictEqual(await storage.getDeadCronStartKeys(minute(2)), [], 'sessions opened before the lookback are ignored');
});

test('SQLite keeps session options, an auto title, saved status lines and an agent file as an assistant message', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { ChatService }, { ChatAttachmentService }, { prismaChatAttachmentStore, prismaChatSessionLookup }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/chat'),
    import('../integrations/chat-attachments'),
    import('../storage/chat-attachments'),
  ]);
  const storage = new StorageService(prisma);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-ux-'));
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });
  const chat = new ChatService(storage, undefined, undefined, new ChatAttachmentService(prismaChatAttachmentStore, prismaChatSessionLookup, { dir: () => dir }));
  const caps = { v: 2, kit: '1.0.0', claude: '2.1.296', features: ['interactive', 'model', 'effort'], modes: ['default', 'auto'], catalogHash: 'ux1' };

  const dock = await chat.createSession({ machine: 'laptop' });
  assert.deepStrictEqual((await storage.getChatSession(dock.id))?.options, JSON.stringify({ model: null, effort: null, permissionMode: 'auto', fast: null }), 'a new DOCK session starts in auto mode');
  const cron = await chat.createSession({ machine: 'laptop', title: 'QRD-1', origin: 'cron' });
  assert.strictEqual((await storage.getChatSession(cron.id))?.options, null, 'a cron session sends its mode with each message');

  await chat.claim({ wait: 0, caps }, undefined, 'laptop');
  await chat.ingestCatalog({ hash: 'ux1', commands: [], models: [{ value: 'sonnet', label: 'Sonnet', efforts: ['low', 'high'], fast: false }], fast: { available: false, reason: null }, defaults: { model: 'sonnet', effort: 'high', permissionMode: 'default' } }, 'laptop');
  assert.deepStrictEqual((await chat.machineOptions('laptop', ['laptop']))?.defaults, { model: 'sonnet', effort: 'high', permissionMode: 'default' });
  const restartedChat = new ChatService(storage);
  assert.deepStrictEqual((await restartedChat.machineOptions('laptop', ['laptop']))?.defaults, { model: 'sonnet', effort: 'high', permissionMode: 'default' }, 'the defaults are stored with the catalogue');

  await chat.setSessionOptions(dock.id, { model: 'sonnet', effort: 'low', permissionMode: 'auto' });
  const sent = await chat.sendMessage(dock.id, '  Check <b>this</b> PR  ', ['laptop'], { options: { effort: 'high' } });
  const queued = await storage.getChatMessage(sent.id);
  assert.deepStrictEqual(JSON.parse(queued?.options ?? 'null'), { model: 'sonnet', effort: 'high', permissionMode: 'auto', fast: null });
  assert.strictEqual((await storage.getChatSession(dock.id))?.title, 'Check this PR');
  assert.strictEqual((await storage.getChatSession(dock.id))?.options, JSON.stringify({ model: 'sonnet', effort: 'low', permissionMode: 'auto', fast: null }));

  await chat.claim({ wait: 0, caps }, undefined, 'laptop');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
  const { Readable } = await import('node:stream');
  const { messageId } = await chat.receiveUpload(
    { sessionId: dock.id, replyTo: String(sent.id), name: 'shot.png' },
    { contentType: 'image/png', contentLength: png.length, body: Readable.from([png]) },
    'laptop',
  );
  const reply = await storage.getChatMessage(messageId);
  assert.deepStrictEqual([reply?.role, reply?.state, reply?.text], ['assistant', 'done', 'Attachment: shot.png']);
  const [shown] = await chat.withAttachments([{ id: messageId, role: 'assistant' }]);
  assert.deepStrictEqual(shown.attachments.map((item) => [item.name, item.mime, item.state]), [['shot.png', 'image/png', 'attached']]);
  assert.strictEqual((await storage.getChatSession(dock.id))?.messageCount, 2);

  await chat.ingestStatus({ sessionId: dock.id, model: 'sonnet', turnCostUsd: 0.5 }, 'laptop');
  await chat.ingestStatus({ sessionId: dock.id, turnCostUsd: 0.25 }, 'laptop');
  const restarted = new ChatService(storage);
  await restarted.restoreLimits();
  assert.deepStrictEqual(restarted.statusSnapshot('laptop').sessions.map((line) => [line.sessionId, line.model, line.costUsd]), [[dock.id, 'sonnet', 0.75]]);
});

test('SQLite counts and removes every session of one machine with its rows', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { ChatService }, { removeMachineSessions }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/chat'),
    import('../integrations/chat-cleanup'),
  ]);
  const storage = new StorageService(prisma);
  const chat = new ChatService(storage);
  t.after(() => prisma.$disconnect());
  const at = new Date('2026-10-15T00:00:00.000Z');
  const machine = `gone-${Date.now().toString(36)}`;
  const ids = [`${machine}-cli`, `${machine}-dock`];
  await storage.createChatSession({ id: ids[0], source: 'cli', machine, title: '', ticketKey: null, startedAt: at, lastMessageAt: at });
  await storage.createChatSession({ id: ids[1], source: 'dock', machine, title: '', ticketKey: null, startedAt: at, lastMessageAt: at });
  await storage.addChatMessages(ids[0], [{ role: 'user', text: 'one', at }, { role: 'assistant', text: 'two', at }], 5000);
  await storage.createChatMessage({ sessionId: ids[1], role: 'user', text: 'three', state: 'done', at });

  const deps = {
    sessions: (name: string) => storage.getChatSessionsOnMachine(name),
    counts: (name: string) => storage.countChatRowsOnMachine(name),
    deleteSession: (id: string) => chat.deleteSession(id),
    forgetStatus: (name: string) => chat.forgetStatus(name),
  };
  const dry = await removeMachineSessions(deps, machine, false);
  assert.deepStrictEqual([dry.sessions, dry.messages, dry.activity, dry.interactions, dry.attachments, dry.attachmentBytes], [{ total: 2, cli: 1, dock: 1 }, 3, 0, 0, 0, 0]);
  assert.strictEqual((await storage.getChatSessionsOnMachine(machine)).length, 2, 'a dry run changes nothing');

  const applied = await removeMachineSessions(deps, machine, true);
  assert.deepStrictEqual([applied.deleted, applied.failed], [2, []]);
  assert.deepStrictEqual(await storage.getChatSessionsOnMachine(machine), []);
  assert.strictEqual((await storage.getChatMessages(ids[0], {}, 50)).length, 0);
});

test('SQLite keeps ElevenLabs keys encrypted, masked in the list, full in the store, and rotates the current one', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ LocalElevenLabsKeys }, { prisma }] = await Promise.all([import('../integrations/elevenlabs-keys'), import('../storage/client')]);
  t.after(() => prisma.$disconnect());
  let now = new Date('2026-10-17T10:00:00.000Z');
  const keys = new LocalElevenLabsKeys(prisma, () => now);

  await keys.add('suryo', 'sk_aaaaaaaaaaaaaaaa1111');
  await keys.add('sem', 'sk_bbbbbbbbbbbbbbbb2222');
  const raw = await prisma.elevenLabsKey.findUnique({ where: { name: 'suryo' } });
  assert.ok(raw && !raw.key.includes('aaaaaaaa'), 'the key is stored encrypted');
  assert.deepStrictEqual((await keys.list()).map((item) => [item.name, item.masked, item.current]), [['suryo', 'sk_aaa...1111', true], ['sem', 'sk_bbb...2222', false]]);

  await keys.park('suryo', new Date('2026-10-17T11:00:00.000Z'));
  await keys.setCurrent('sem');
  let store = await keys.store();
  assert.deepStrictEqual(store.order, ['suryo', 'sem']);
  assert.strictEqual(store.keys.sem, 'sk_bbbbbbbbbbbbbbbb2222');
  assert.strictEqual(store.current, 1);
  assert.deepStrictEqual(store.cooldowns, { suryo: new Date('2026-10-17T11:00:00.000Z').getTime() });

  now = new Date('2026-10-17T12:00:00.000Z');
  store = await keys.store();
  assert.deepStrictEqual(store.cooldowns, {}, 'a park that ran out is gone');

  await keys.add('suryo', 'sk_cccccccccccccccc3333');
  assert.deepStrictEqual((await keys.list()).map((item) => item.name), ['suryo', 'sem'], 'adding a name again replaces its key in place');
  assert.strictEqual(await keys.remove('suryo'), true);
  assert.strictEqual(await keys.remove('suryo'), false);
  await assert.rejects(keys.add('bad name', 'sk_x1234567'), /key name/);
  await assert.rejects(keys.add('ok', 'short'), /8 to 200/);
});

test('SQLite storage removes a reset run with its events and keeps the reset', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }] = await Promise.all([import('../storage/service'), import('../storage/client')]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());
  const fields = { title: 'Reset', stage: 'code', waiting: '', payload: '{}', ledgerUpdatedAt: new Date(), machine: 'workspace', ledgerRaw: null };
  await storage.upsertOrchestratorRun('ZED-480', fields);
  await storage.addOrchestratorEvent('ZED-480', 'STAGE', 'code', 60);
  await storage.updateOrchestratorRun('ZED-480', { jiraStatus: 'In Progress', jiraStage: null });
  assert.strictEqual((await storage.getOrchestratorRun('ZED-480'))?.jiraStatus, 'In Progress');

  const at = new Date();
  await storage.resetOrchestratorRun('ZED-480', 'workspace', at);
  assert.strictEqual(await storage.getOrchestratorRun('ZED-480'), null);
  assert.deepStrictEqual(await storage.getOrchestratorEvents('ZED-480', 10), []);
  assert.strictEqual((await storage.getOrchestratorReset('ZED-480'))?.resetAt.getTime(), at.getTime());
  assert.deepStrictEqual((await storage.getOrchestratorResets('workspace')).map((reset) => reset.key), ['ZED-480']);
  assert.deepStrictEqual(await storage.getOrchestratorResets('laptop'), []);
});
