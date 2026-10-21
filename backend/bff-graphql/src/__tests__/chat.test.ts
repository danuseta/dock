import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import {
  ChatService,
  CUT_SUFFIX,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES_KEPT,
  MAX_STATUS_SESSIONS,
  STALE_TEXT,
  cutMessageText,
  parseClaim,
  parseDelta,
  parseStatus,
  parseSessionSync,
  searchSnippet,
} from '../integrations/chat';
import { CAPS_VERSION } from '../integrations/chat-interactions';
import { OrchestratorInputError, OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

const MACHINES = ['laptop', 'workspace'];

function memoryStorage() {
  const sessions = new Map<string, any>();
  let messages: any[] = [];
  const tokens: any[] = [];
  let sequence = 0;
  const cache = new Map<string, string>();
  const workerRows: Array<{ sessionId: string; eventId: string; parentId: string | null; turnId: number; name: string; label: string; status: string; startedAt: Date; endedAt: Date | null }> = [];
  const ofSession = (sessionId: string) => messages.filter((message) => message.sessionId === sessionId);
  const storage = {
    getSettingValues: async () => [] as Array<{ key: string; value: string }>,
    getCache: async (namespace: string, key: string) => JSON.parse(cache.get(`${namespace}:${key}`) ?? 'null'),
    upsertCache: async (namespace: string, key: string, value: unknown) => { cache.set(`${namespace}:${key}`, JSON.stringify(value)); },
    getChatSessions: async (source: string | null, take: number, machine: string | null = null) => [...sessions.values()]
      .filter((session) => (!source || session.source === source) && (!machine || session.machine === machine))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, take),
    getChatSession: async (id: string) => sessions.get(id) ?? null,
    getChatSessionsByIds: async (ids: string[]) => ids.flatMap((id) => (sessions.has(id) ? [sessions.get(id)] : [])),
    getChatSessionsWithTicket: async (source: string, since: Date) => [...sessions.values()]
      .filter((session) => session.source === source && session.ticketKey && session.lastMessageAt >= since),
    getStaleChatSessions: async (before: Date) => [...sessions.values()]
      .filter((session) => session.status === 'running' && session.lastDeltaAt && session.lastDeltaAt < before),
    createChatSession: async (data: any) => {
      const row = { machine: 'laptop', forkFrom: null, claudeSessionId: null, status: 'idle', statusDetail: null, messageCount: 0, lastDeltaAt: null, ...data };
      sessions.set(row.id, row);
      return row;
    },
    updateChatSession: async (id: string, data: any) => {
      const row = { ...sessions.get(id), ...data };
      sessions.set(id, row);
      return row;
    },
    deleteChatSession: async (id: string) => {
      messages = messages.filter((message) => message.sessionId !== id);
      return sessions.delete(id);
    },
    deleteChatMessages: async (sessionId: string) => {
      messages = messages.filter((message) => message.sessionId !== sessionId);
    },
    createChatMessage: async (data: any) => {
      const row = { id: sequence += 1, ...data };
      messages.push(row);
      return row;
    },
    addChatMessages: async (sessionId: string, items: any[], keep: number) => {
      for (const item of items) messages.push({ id: sequence += 1, sessionId, state: 'done', ...item });
      return storage.trimChatMessages(sessionId, keep);
    },
    trimChatMessages: async (sessionId: string, keep: number) => {
      const dropped = new Set(ofSession(sessionId).slice(0, -keep).map((message) => message.id));
      messages = messages.filter((message) => !dropped.has(message.id));
      return ofSession(sessionId).length;
    },
    getChatMessage: async (id: number) => messages.find((message) => message.id === id) ?? null,
    getChatMessages: async (sessionId: string, cursor: { afterId?: number | null; beforeId?: number | null }, take: number) => {
      const rows = ofSession(sessionId).filter((message) => (
        (cursor.afterId == null || message.id > cursor.afterId) && (cursor.beforeId == null || message.id < cursor.beforeId)
      ));
      return cursor.afterId != null ? rows.slice(0, take) : rows.slice(-take);
    },
    countChatMessagesInState: async (sessionId: string, states: string[]) => ofSession(sessionId)
      .filter((message) => states.includes(message.state)).length,
    getQueuedChatMessages: async (machine: string, take: number) => messages
      .filter((message) => {
        const session = sessions.get(message.sessionId);
        return message.state === 'queued' && message.role === 'user' && session?.source === 'dock' && session.machine === machine;
      })
      .slice(0, take).map((message) => ({ id: message.id, sessionId: message.sessionId, text: message.text, origin: sessions.get(message.sessionId)?.origin ?? 'manual' })),
    countCronSlots: async (machine: string) => {
      const cron = [...sessions.values()].filter((session) => session.origin === 'cron' && session.source === 'dock' && session.machine === machine);
      const has = (id: string, state: string) => ofSession(id).some((message) => message.state === state);
      return { busy: cron.filter((session) => has(session.id, 'taken')).length, waiting: cron.filter((session) => has(session.id, 'queued') && !has(session.id, 'taken')).length };
    },
    moveChatMessage: async (id: number, sessionId: string, from: string, to: string) => {
      const row = messages.find((message) => message.id === id && message.sessionId === sessionId && message.state === from);
      if (row) row.state = to;
      return Boolean(row);
    },
    moveChatMessages: async (sessionId: string, from: string, to: string) => {
      const rows = ofSession(sessionId).filter((message) => message.state === from);
      for (const row of rows) row.state = to;
      return { count: rows.length };
    },
    getNewestChatMessage: async (sessionId: string, role: string) => ofSession(sessionId)
      .filter((message) => message.role === role).at(-1) ?? null,
    searchChatMessages: async (query: string, take: number, machine: string | null = null) => messages
      .filter((message) => message.text.toLowerCase().includes(query.toLowerCase()))
      .filter((message) => !machine || sessions.get(message.sessionId)?.machine === machine)
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
      .slice(0, take),
    getChatWorkerCounts: async (sessionIds: string[]) => new Map(sessionIds.map((id): [string, number] => [id, workerRows.filter((row) => row.sessionId === id).length])),
    getChatWorkers: async (sessionId: string) => workerRows.filter((row) => row.sessionId === sessionId),
    getChatLastTexts: async (sessionIds: string[], length: number) => new Map(sessionIds.flatMap((id): Array<[string, string]> => {
      const last = ofSession(id).filter((message) => message.role !== 'tool').at(-1);
      return last ? [[id, last.text.slice(0, length)]] : [];
    })),
    getOverdueChatSessions: async () => [],
    getQuietChatTurns: async () => ({ silent: [], unstopped: [] }),
    getChatMessageIdsInState: async (sessionId: string, states: string[]) => ofSession(sessionId)
      .filter((message) => states.includes(message.state)).map((message) => message.id),
    cancelChatInteractions: async () => ({ count: 0 }),
    getPendingChatInteractions: async () => [],
    getStaleChatDrafts: async () => [],
    hasOverdueChatInteractions: async () => false,
    expireChatInteractions: async () => ({ count: 0 }),
    getWaitingChatSessionIds: async () => new Set<string>(),
    pruneChatInteractions: async () => ({ expired: 0, evicted: 0 }),
    getChatMachineInfo: async () => null,
    countIngestTokens: async () => tokens.length,
    createIngestToken: async (data: any) => {
      const token = { id: String(sequence += 1), ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash) ?? null,
    touchIngestToken: async () => undefined,
  };
  return { storage: storage as unknown as StorageService, sessions, messages: () => messages, workerRows };
}

function clockedService() {
  const memory = memoryStorage();
  const clock = { at: new Date('2026-10-08T00:00:00.000Z').getTime() };
  const advance = (ms: number) => { clock.at += ms; };
  const service = new ChatService(memory.storage, () => new Date(clock.at), async (ms) => advance(ms));
  return { ...memory, service, advance, now: () => new Date(clock.at) };
}

const CLI_ID = '0b0f6a0e-1111-4222-8333-444455556666';
const syncBody = (overrides: object = {}) => ({
  session: { id: CLI_ID, title: 'Fix the login redirect', ticketKey: null, startedAt: '2026-10-07T08:00:00.000Z', lastMessageAt: '2026-10-07T09:00:00.000Z' },
  replace: true,
  messages: [
    { role: 'user', text: 'Why does the Redirect loop?', at: '2026-10-07T08:00:00.000Z' },
    { role: 'tool', text: 'Read · src/auth/login.ts', at: '2026-10-07T08:00:05.000Z' },
    { role: 'assistant', text: 'The guard runs before the session is restored.', at: '2026-10-07T08:00:09.000Z' },
  ],
  ...overrides,
});

test('chat input is validated before anything is stored', () => {
  const now = new Date('2026-10-08T00:00:00.000Z');
  const parsed = parseSessionSync(syncBody({ session: { ...syncBody().session, title: `  ${'t'.repeat(200)}`, ticketKey: 'qrd-1258' } }), now);
  assert.strictEqual(parsed.title.length, 120);
  assert.strictEqual(parsed.ticketKey, 'QRD-1258');
  assert.strictEqual(parsed.replace, true);
  assert.deepStrictEqual(parsed.messages.map((message) => message.role), ['user', 'tool', 'assistant']);
  assert.strictEqual(parseSessionSync(syncBody({ replace: undefined }), now).replace, false);

  const bad = (overrides: object, session: object = {}) => () => parseSessionSync(
    syncBody({ ...overrides, session: { ...syncBody().session, ...session } }), now,
  );
  assert.throws(() => parseSessionSync(null, now), OrchestratorInputError);
  assert.throws(bad({}, { id: '../etc/passwd' }), OrchestratorInputError);
  assert.throws(bad({}, { id: 'a'.repeat(65) }), OrchestratorInputError);
  assert.throws(bad({}, { startedAt: 'yesterday' }), OrchestratorInputError);
  assert.throws(bad({}, { lastMessageAt: 1759900000000 }), OrchestratorInputError);
  assert.throws(bad({}, { ticketKey: 'not a key' }), OrchestratorInputError);
  assert.throws(bad({ replace: 'yes' }), OrchestratorInputError);
  assert.throws(bad({ messages: 'none' }), OrchestratorInputError);
  assert.throws(bad({ messages: [{ role: 'system', text: 'x', at: '2026-10-07T08:00:00.000Z' }] }), OrchestratorInputError);
  assert.throws(bad({ messages: [{ role: 'user', text: 5, at: '2026-10-07T08:00:00.000Z' }] }), OrchestratorInputError);
  assert.throws(bad({ messages: [{ role: 'user', text: 'x', at: 'soon' }] }), OrchestratorInputError);
  assert.throws(bad({ messages: Array.from({ length: 501 }, () => syncBody().messages[0]) }), OrchestratorInputError);
  assert.strictEqual(
    parseSessionSync(syncBody({ messages: [{ role: 'user', text: 'x', at: '2999-01-01T00:00:00.000Z' }] }), now).messages[0].at.toISOString(),
    now.toISOString(),
    'a clock ahead of the server is clamped',
  );

  assert.deepStrictEqual(parseClaim({ wait: 25 }), { wait: 25 });
  assert.deepStrictEqual(parseClaim({}), { wait: 0 });
  assert.throws(() => parseClaim({ wait: 26 }), OrchestratorInputError);
  assert.throws(() => parseClaim({ wait: -1 }), OrchestratorInputError);
  assert.throws(() => parseClaim({ wait: '5' }), OrchestratorInputError);

  const delta = { sessionId: CLI_ID, replyTo: 12, items: [{ role: 'assistant', text: 'ok', at: '2026-10-07T08:00:00.000Z' }] };
  assert.deepStrictEqual(
    { ...parseDelta(delta, now), items: 1 },
    { sessionId: CLI_ID, replyTo: 12, claudeSessionId: null, items: 1, detail: null, done: false, error: null },
  );
  assert.throws(() => parseDelta({ ...delta, replyTo: '12' }, now), OrchestratorInputError);
  assert.throws(() => parseDelta({ ...delta, sessionId: 'no spaces allowed' }, now), OrchestratorInputError);
  assert.throws(() => parseDelta({ ...delta, claudeSessionId: 'a b' }, now), OrchestratorInputError);
  assert.throws(() => parseDelta({ ...delta, done: 'true' }, now), OrchestratorInputError);
  assert.throws(() => parseDelta({ ...delta, error: { message: 'x' } }, now), OrchestratorInputError);
  assert.throws(() => parseDelta({ ...delta, items: [{ role: 'user', text: 'x', at: '2026-10-07T08:00:00.000Z' }] }, now), OrchestratorInputError, 'the bridge never writes user messages');

  const cut = cutMessageText('x'.repeat(MAX_MESSAGE_CHARS + 1));
  assert.strictEqual(cut.length, MAX_MESSAGE_CHARS);
  assert.ok(cut.endsWith(CUT_SUFFIX));
  assert.strictEqual(cutMessageText('x'.repeat(MAX_MESSAGE_CHARS)).length, MAX_MESSAGE_CHARS);
  assert.ok(!cutMessageText('short').endsWith(CUT_SUFFIX));

  const long = `${'a'.repeat(100)} NEEDLE\n${'b'.repeat(100)}`;
  const snippet = searchSnippet(long, 'needle');
  assert.strictEqual(snippet, `…${'a'.repeat(59)} NEEDLE ${'b'.repeat(59)}…`);
  assert.strictEqual(searchSnippet('needle at the start', 'NEEDLE'), 'needle at the start');
});

test('history sync upserts a cli session, replaces or appends, and keeps the newest 5 000 messages', async () => {
  const { service, messages } = clockedService();

  assert.deepStrictEqual(await service.syncSession(syncBody(), 'laptop'), { id: CLI_ID, messageCount: 3 });
  assert.deepStrictEqual(await service.syncSession(syncBody({ replace: false, messages: [syncBody().messages[0]] }), 'laptop'), { id: CLI_ID, messageCount: 4 });
  assert.deepStrictEqual(await service.syncSession(syncBody(), 'laptop'), { id: CLI_ID, messageCount: 3 }, 'replace drops what was there');

  const [listed] = await service.sessions('cli');
  assert.deepStrictEqual(
    [listed.source, listed.title, listed.status, listed.messageCount, listed.startedAt, listed.lastMessageAt],
    ['cli', 'Fix the login redirect', 'idle', 3, '2026-10-07T08:00:00.000Z', '2026-10-07T09:00:00.000Z'],
  );
  assert.strictEqual(listed.lastText, 'The guard runs before the session is restored.', 'tool lines are not the last text');
  assert.deepStrictEqual(await service.sessions('dock'), []);
  await assert.rejects(service.sessions('other'), OrchestratorInputError);

  await service.syncSession(syncBody({ messages: [{ role: 'assistant', text: 'y'.repeat(MAX_MESSAGE_CHARS + 500), at: '2026-10-07T08:00:00.000Z' }] }), 'laptop');
  assert.strictEqual(messages()[0].text.length, MAX_MESSAGE_CHARS);
  assert.ok(messages()[0].text.endsWith(CUT_SUFFIX));

  const batch = (from: number) => Array.from({ length: 500 }, (_, index) => ({ role: 'assistant', text: `m${from + index}`, at: '2026-10-07T08:00:00.000Z' }));
  await service.syncSession(syncBody({ messages: batch(0) }), 'laptop');
  let last = { id: CLI_ID, messageCount: 0 };
  for (let from = 500; from < 5500; from += 500) last = await service.syncSession(syncBody({ replace: false, messages: batch(from) }), 'laptop');
  assert.strictEqual(last.messageCount, MAX_MESSAGES_KEPT);
  assert.strictEqual(messages().length, MAX_MESSAGES_KEPT);
  assert.strictEqual(messages()[0].text, 'm500', 'the oldest are dropped');
  assert.strictEqual(messages().at(-1).text, 'm5499');
});

test('a DOCK session takes one turn at a time and the bridge moves it through its states', async () => {
  const { service, sessions, advance } = clockedService();
  await service.syncSession(syncBody(), 'laptop');

  await assert.rejects(service.createSession({ forkFrom: 'does-not-exist' }), OrchestratorInputError);
  await assert.rejects(service.createSession({ ticketKey: 'nope' }), OrchestratorInputError);
  const dock = await service.createSession({ title: `  ${'n'.repeat(130)}`, ticketKey: 'qrd-1258', forkFrom: CLI_ID });
  assert.deepStrictEqual(
    [dock.source, dock.title.length, dock.ticketKey, dock.forkFrom, dock.status, dock.messageCount, dock.lastText],
    ['dock', 120, 'QRD-1258', CLI_ID, 'idle', 0, null],
  );
  await assert.rejects(service.createSession({ forkFrom: dock.id }), OrchestratorInputError, 'only a cli session can be continued');
  await assert.rejects(service.syncSession(syncBody({ session: { ...syncBody().session, id: dock.id } }), 'laptop'), OrchestratorInputError, 'history sync never overwrites a DOCK session');

  await assert.rejects(service.sendMessage(CLI_ID, 'hello', MACHINES), OrchestratorInputError, 'cli sessions are read-only');
  await assert.rejects(service.sendMessage('unknown-session', 'hello', MACHINES), OrchestratorInputError);
  await assert.rejects(service.sendMessage(dock.id, '   ', MACHINES), OrchestratorInputError);
  await assert.rejects(service.sendMessage(dock.id, 'x'.repeat(8001), MACHINES), OrchestratorInputError);

  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'laptop'), { message: null });

  const sent = await service.sendMessage(dock.id, '  What changed in the guard?  ', MACHINES);
  assert.deepStrictEqual([sent.role, sent.text, sent.state, sent.sessionId], ['user', 'What changed in the guard?', 'queued', dock.id]);
  assert.strictEqual((await service.session(dock.id))?.status, 'queued');
  await assert.rejects(service.sendMessage(dock.id, 'second', MACHINES), OrchestratorInputError, 'refused while a message is queued');

  const other = await service.createSession({ title: 'Other' });
  const otherSent = await service.sendMessage(other.id, 'Second session', MACHINES);

  const [first, second, third] = await Promise.all([service.claim({ wait: 0 }, undefined, 'laptop'), service.claim({ wait: 0 }, undefined, 'laptop'), service.claim({ wait: 0 }, undefined, 'laptop')]);
  assert.deepStrictEqual(
    [first.message?.id, second.message?.id, third.message].sort(),
    [sent.id, otherSent.id, null].sort(),
    'no message is handed to two bridges',
  );
  const claimed = [first, second].map((claim) => claim.message).find((message) => message?.id === sent.id);
  assert.deepStrictEqual(claimed, { id: sent.id, sessionId: dock.id, text: 'What changed in the guard?', claudeSessionId: null, forkFrom: CLI_ID });
  assert.strictEqual((await service.session(dock.id))?.status, 'running');
  await assert.rejects(service.sendMessage(dock.id, 'second', MACHINES), OrchestratorInputError, 'refused while a message is taken');

  const claude = 'c1a0de00-aaaa-4bbb-8ccc-ddddeeeeffff';
  advance(2000);
  const progress = await service.delta({
    sessionId: dock.id, replyTo: sent.id, claudeSessionId: claude, detail: 'Bash',
    items: [{ role: 'tool', text: 'Bash · git log', at: '2026-10-08T00:00:01.000Z' }, { role: 'assistant', text: 'Looking at the history.', at: '2026-10-08T00:00:02.000Z' }],
  }, 'laptop');
  assert.deepStrictEqual(progress, { id: dock.id, status: 'running', messageCount: 3 });
  assert.deepStrictEqual(
    [sessions.get(dock.id).claudeSessionId, sessions.get(dock.id).statusDetail],
    [claude, 'Bash'],
  );
  assert.strictEqual((await service.session(dock.id))?.lastText, 'Looking at the history.');

  assert.strictEqual(await service.delta({ sessionId: 'unknown-session', replyTo: sent.id }, 'laptop'), null, 'unknown session is a 404');
  await assert.rejects(service.delta({ sessionId: dock.id, replyTo: otherSent.id }, 'laptop'), OrchestratorInputError, 'replyTo must belong to the session');
  await assert.rejects(service.delta({ sessionId: CLI_ID, replyTo: 1 }, 'laptop'), OrchestratorInputError);

  const finished = await service.delta({ sessionId: dock.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: 'Done.', at: '2026-10-08T00:00:03.000Z' }] }, 'laptop');
  assert.deepStrictEqual(finished, { id: dock.id, status: 'idle', messageCount: 4 });
  const thread = await service.messages(dock.id);
  assert.deepStrictEqual(thread.map((message) => [message.role, message.state]), [['user', 'done'], ['tool', 'done'], ['assistant', 'done'], ['assistant', 'done']]);
  assert.strictEqual(sessions.get(dock.id).statusDetail, null);

  const next = await service.sendMessage(dock.id, 'And the tests?', MACHINES);
  const resumed = await service.claim({ wait: 0 }, undefined, 'laptop');
  assert.deepStrictEqual([resumed.message?.id, resumed.message?.claudeSessionId], [next.id, claude], 'the next turn resumes the Claude session');
  const failed = await service.delta({ sessionId: dock.id, replyTo: next.id, done: true, error: 'claude exited with code 1' }, 'laptop');
  assert.strictEqual(failed?.status, 'error');
  assert.strictEqual(sessions.get(dock.id).statusDetail, 'claude exited with code 1');
  assert.strictEqual((await service.messages(dock.id)).find((message) => message.id === next.id)?.state, 'failed');
  await service.sendMessage(dock.id, 'Try again', MACHINES);
  assert.strictEqual((await service.session(dock.id))?.status, 'queued', 'a failed turn does not lock the session');

  const renamed = await service.renameSession(dock.id, `${'r'.repeat(125)}`);
  assert.strictEqual(renamed.title.length, 120);
  await assert.rejects(service.renameSession('unknown-session', 'x'), OrchestratorInputError);

  assert.strictEqual(await service.deleteSession(dock.id), true);
  assert.strictEqual(await service.deleteSession(dock.id), false);
  assert.strictEqual(await service.session(dock.id), null);
  assert.deepStrictEqual(await service.messages(dock.id), []);
  assert.deepStrictEqual((await service.claim({ wait: 0 }, undefined, 'laptop')).message, null, 'a deleted session leaves nothing queued');
});

test('claim skips a session that already has a taken message', async () => {
  const { service, storage } = clockedService();
  const busy = await service.createSession({ title: 'Busy' });
  const free = await service.createSession({ title: 'Free' });
  await storage.createChatMessage({ sessionId: busy.id, role: 'user', text: 'in flight', state: 'taken', at: new Date() });
  await storage.createChatMessage({ sessionId: busy.id, role: 'user', text: 'raced in', state: 'queued', at: new Date() });
  const waiting = await service.sendMessage(free.id, 'pick me', MACHINES);

  assert.strictEqual((await service.claim({ wait: 0 }, undefined, 'laptop')).message?.id, waiting.id);
  assert.strictEqual((await service.claim({ wait: 0 }, undefined, 'laptop')).message, null);
});

test('claim waits in 500 ms steps, marks the bridge seen and stops when the bridge hangs up', async () => {
  const memory = memoryStorage();
  const clock = { at: new Date('2026-10-08T00:00:00.000Z').getTime() };
  const sleeps: number[] = [];
  let onSleep: () => Promise<void> = async () => undefined;
  const service = new ChatService(memory.storage, () => new Date(clock.at), async (ms) => {
    sleeps.push(ms);
    clock.at += ms;
    await onSleep();
  });

  assert.deepStrictEqual(service.bridge(), { online: false, lastSeenAt: null });
  assert.deepStrictEqual(await service.claim({ wait: 2 }, undefined, 'laptop'), { message: null });
  assert.deepStrictEqual(sleeps, [500, 500, 500, 500]);
  assert.deepStrictEqual(service.bridge(), { online: true, lastSeenAt: '2026-10-08T00:00:02.000Z' });
  clock.at += 60_000;
  assert.strictEqual(service.bridge().online, true);
  clock.at += 1;
  assert.deepStrictEqual(service.bridge(), { online: false, lastSeenAt: '2026-10-08T00:00:02.000Z' });

  const dock = await service.createSession({});
  sleeps.length = 0;
  onSleep = async () => {
    if (sleeps.length === 3) await service.sendMessage(dock.id, 'arrives while waiting', MACHINES);
  };
  const claimed = await service.claim({ wait: 25 }, undefined, 'laptop');
  assert.strictEqual(claimed.message?.text, 'arrives while waiting');
  assert.strictEqual(sleeps.length, 3, 'returns as soon as a message is queued');

  const hangup = new AbortController();
  const second = await service.createSession({});
  sleeps.length = 0;
  onSleep = async () => {
    hangup.abort();
    await service.sendMessage(second.id, 'nobody is listening', MACHINES);
  };
  assert.deepStrictEqual(await service.claim({ wait: 25 }, hangup.signal, 'laptop'), { message: null });
  assert.strictEqual(sleeps.length, 1);
  assert.strictEqual((await service.messages(second.id))[0].state, 'queued', 'a message is not taken for a bridge that left');
});

test('a taken message with no delta for 15 minutes is failed on the next list or claim', async () => {
  const { service, advance, sessions } = clockedService();
  const dock = await service.createSession({ title: 'Stale' });
  const sent = await service.sendMessage(dock.id, 'long task', MACHINES);
  await service.claim({ wait: 0 }, undefined, 'laptop');

  advance(14 * 60 * 1000);
  await service.delta({ sessionId: dock.id, replyTo: sent.id, detail: 'Bash' }, 'laptop');
  advance(14 * 60 * 1000);
  assert.strictEqual((await service.sessions())[0].status, 'running', 'a delta restarts the clock');

  advance(2 * 60 * 1000);
  const [listed] = await service.sessions();
  assert.deepStrictEqual([listed.status, listed.statusDetail], ['error', STALE_TEXT]);
  assert.strictEqual((await service.messages(dock.id))[0].state, 'failed');

  const late = await service.delta({ sessionId: dock.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: 'late answer', at: '2026-10-08T00:00:00.000Z' }] }, 'laptop');
  assert.deepStrictEqual([late?.status, late?.messageCount], ['idle', 2], 'late output from the same machine revives the turn and the done settles it');
  assert.strictEqual((await service.messages(dock.id))[0].state, 'done');
  assert.strictEqual(sessions.get(dock.id).statusDetail, null);

  const again = await service.sendMessage(dock.id, 'retry', MACHINES);
  await service.claim({ wait: 0 }, undefined, 'laptop');
  advance(16 * 60 * 1000);
  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'laptop'), { message: null });
  assert.strictEqual((await service.messages(dock.id)).find((message) => message.id === again.id)?.state, 'failed', 'claim sweeps too');
});

test('messages page by id, search returns snippets and balloons show fresh answers on ticket sessions', async () => {
  const { service, advance } = clockedService();
  await service.syncSession(syncBody({ messages: Array.from({ length: 10 }, (_, index) => ({ role: 'assistant', text: `line ${index + 1}`, at: `2026-10-07T08:00:${String(index).padStart(2, '0')}.000Z` })) }), 'laptop');

  const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id);
  const all = ids(await service.messages(CLI_ID));
  assert.deepStrictEqual(all, [...all].sort((a, b) => a - b));
  assert.strictEqual(all.length, 10);
  assert.deepStrictEqual(ids(await service.messages(CLI_ID, null, null, 3)), all.slice(-3), 'no cursor: the newest, still ascending');
  assert.deepStrictEqual(ids(await service.messages(CLI_ID, all[3], null, 2)), all.slice(4, 6));
  assert.deepStrictEqual(ids(await service.messages(CLI_ID, null, all[5], 2)), all.slice(3, 5), 'beforeId: the page just above');
  assert.deepStrictEqual(ids(await service.messages(CLI_ID, all[1], all[4], 50)), all.slice(2, 4));
  assert.strictEqual((await service.messages(CLI_ID, null, null, 9999)).length, 10);
  await assert.rejects(service.messages(CLI_ID, -1), OrchestratorInputError);
  assert.deepStrictEqual(await service.messages('bad id'), []);

  assert.deepStrictEqual(await service.search('l'), [], 'needs two characters');
  const hits = await service.search('LINE 1');
  assert.deepStrictEqual(hits.map((hit) => hit.snippet), ['line 10', 'line 1'], 'newest first');
  assert.deepStrictEqual([hits[0].session.id, hits[0].messageId, hits[0].at], [CLI_ID, all[9], '2026-10-07T08:00:09.000Z']);
  assert.strictEqual((await service.search('line', 4)).length, 4);

  const ticket = await service.createSession({ ticketKey: 'QRD-1258' });
  const plain = await service.createSession({});
  for (const session of [ticket, plain]) {
    const sent = await service.sendMessage(session.id, 'status?', MACHINES);
    await service.claim({ wait: 0 }, undefined, 'laptop');
    await service.delta({ sessionId: session.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: `answer for ${session.id}`, at: '2026-10-08T00:00:00.000Z' }] }, 'laptop');
  }
  const balloons = await service.balloons();
  assert.deepStrictEqual(balloons.map((message) => [message.sessionId, message.role]), [[ticket.id, 'assistant']]);
  advance(29 * 60 * 1000);
  assert.strictEqual((await service.balloons()).length, 1);
  advance(2 * 60 * 1000);
  assert.deepStrictEqual(await service.balloons(), []);
});

test('chat ingest routes share the ingest token and the 404 / 400 conventions', async (t) => {
  const { storage } = memoryStorage();
  const orchestrator = new OrchestratorService(storage, os.tmpdir());
  const chat = new ChatService(storage);
  const { token } = await orchestrator.createToken('laptop');
  const history = (await orchestrator.createToken('workspace', 'workspace')).token;
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(5, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/ingest/orchestrator`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (route: string, body: unknown, bearer: string | null = token) => fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  assert.strictEqual((await post('/sessions', syncBody(), null)).status, 401);
  assert.strictEqual((await post('/chat/claim', { wait: 0 }, 'dock_ing_wrong')).status, 401);
  assert.strictEqual((await post('/chat/delta', {}, null)).status, 401);

  const fromLaptop = await post('/sessions', syncBody());
  assert.strictEqual(fromLaptop.status, 403, 'history from any machine but workspace is refused');
  assert.match((await fromLaptop.json()).error, /only kept for the workspace machine/);
  assert.strictEqual((await post('/sessions', '{not json')).status, 403, 'refused before the body is read');

  const synced = await post('/sessions', syncBody(), history);
  assert.strictEqual(synced.status, 200);
  assert.deepStrictEqual(await synced.json(), { ok: true, result: { id: CLI_ID, messageCount: 3 } });
  assert.strictEqual((await post('/sessions', syncBody({ messages: 'x' }), history)).status, 400);
  assert.strictEqual((await post('/sessions', '{not json', history)).status, 400);
  assert.strictEqual((await post('/sessions', syncBody({ messages: [{ role: 'user', text: 'x'.repeat(2 * 1024 * 1024), at: '2026-10-07T08:00:00.000Z' }] }), history)).status, 413);
  assert.strictEqual((await post('/chat/delta', { sessionId: CLI_ID, replyTo: 1, items: [{ role: 'assistant', text: 'x'.repeat(300 * 1024), at: '2026-10-07T08:00:00.000Z' }] })).status, 413);

  const dock = await chat.createSession({ title: 'From the browser' });
  const refused = await post('/sessions', syncBody({ session: { ...syncBody().session, id: dock.id } }), history);
  assert.strictEqual(refused.status, 400);

  const empty = await post('/chat/claim', { wait: 0 });
  assert.deepStrictEqual([empty.status, await empty.json()], [200, { ok: true, result: { message: null } }]);
  assert.strictEqual((await post('/chat/claim', { wait: 60 })).status, 400);

  const started = Date.now();
  const pending = post('/chat/claim', { wait: 5 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const sent = await chat.sendMessage(dock.id, 'over http', MACHINES);
  const claimed = await pending;
  assert.ok(Date.now() - started < 4000, 'the long poll answers as soon as a message is queued');
  assert.deepStrictEqual(await claimed.json(), {
    ok: true, result: { message: { id: sent.id, sessionId: dock.id, text: 'over http', claudeSessionId: null, forkFrom: null } },
  });

  assert.strictEqual((await post('/chat/delta', { sessionId: 'unknown-session', replyTo: sent.id })).status, 404);
  assert.strictEqual((await post('/chat/delta', { sessionId: dock.id, replyTo: 'x' })).status, 400);
  const done = await post('/chat/delta', { sessionId: dock.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: 'hi', at: '2026-10-08T00:00:00.000Z' }] });
  assert.deepStrictEqual([done.status, await done.json()], [200, { ok: true, result: { id: dock.id, status: 'idle', messageCount: 2 } }]);
  assert.strictEqual(chat.bridge().online, true);

  assert.strictEqual((await post('/chat/status', statusBody(), null)).status, 401);
  assert.strictEqual((await post('/chat/status', statusBody(), 'dock_ing_wrong')).status, 401);
  assert.strictEqual((await post('/chat/status', '{not json')).status, 400);
  assert.strictEqual((await post('/chat/status', statusBody({ sessionId: 'bad id' }))).status, 400);
  assert.strictEqual((await post('/chat/status', statusBody({ costUsd: 'free' }))).status, 400);
  assert.deepStrictEqual(chat.statusSnapshot(), { limits: null, sessions: [] });
  const stored = await post('/chat/status', statusBody(), history);
  assert.deepStrictEqual([stored.status, await stored.json()], [200, { ok: true, result: { sessionId: CLI_ID } }]);
  assert.strictEqual(chat.statusSnapshot().sessions[0].sessionId, CLI_ID);
});

const statusBody = (overrides: object = {}) => ({
  sessionId: CLI_ID,
  model: 'Opus 4.7 (1M context)',
  effort: 'high',
  fastMode: false,
  contextPercentage: 40,
  contextTokens: 395000,
  contextSize: 1000000,
  costUsd: 12.5,
  cacheWarm: true,
  cacheHitRatio: 0.93,
  fiveHour: { usedPercentage: 55, resetsAt: 1791417600 },
  sevenDay: { usedPercentage: 20, resetsAt: 1791936000 },
  ...overrides,
});

test('status keeps the latest line per session and the latest account limits, and marks old ones stale', async () => {
  const { service, advance } = clockedService();
  assert.deepStrictEqual(service.statusSnapshot(), { limits: null, sessions: [] });

  await service.ingestStatus(statusBody(), 'laptop');
  await service.ingestStatus(statusBody({ sessionId: 'other-session', costUsd: 1, fiveHour: undefined, sevenDay: undefined }), 'laptop');
  const fresh = service.statusSnapshot();
  assert.deepStrictEqual(fresh.limits, {
    fiveHour: { usedPercentage: 55, resetsAt: '2026-10-08T00:00:00.000Z' },
    sevenDay: { usedPercentage: 20, resetsAt: '2026-10-14T00:00:00.000Z' },
    receivedAt: '2026-10-08T00:00:00.000Z',
    stale: false,
  });
  assert.deepStrictEqual(fresh.sessions.map((status) => [status.sessionId, status.stale]), [[CLI_ID, false], ['other-session', false]]);
  assert.deepStrictEqual(
    { ...fresh.sessions[0], receivedAt: undefined },
    { sessionId: CLI_ID, machine: 'laptop', model: 'Opus 4.7 (1M context)', effort: 'high', fastMode: false, contextPercentage: 40, contextTokens: 395000, contextSize: 1000000, costUsd: 12.5, cacheWarm: true, cacheHitRatio: 0.93, files: [], receivedAt: undefined, stale: false },
  );

  advance(5 * 60 * 1000);
  assert.strictEqual(service.statusSnapshot().sessions[0].stale, false);
  advance(1);
  await service.ingestStatus(statusBody({ sessionId: 'other-session', fiveHour: undefined, sevenDay: undefined }), 'laptop');
  const later = service.statusSnapshot();
  assert.deepStrictEqual(later.sessions.map((status) => [status.sessionId, status.stale]), [[CLI_ID, true], ['other-session', false]]);
  assert.strictEqual(later.limits?.stale, true, 'a push without limits does not refresh them');

  await service.ingestStatus({ sessionId: 'bare' }, 'laptop');
  assert.deepStrictEqual(service.statusSnapshot().sessions.at(-1), {
    sessionId: 'bare', machine: 'laptop', model: null, effort: null, fastMode: null, contextPercentage: null, contextTokens: null, contextSize: null,
    costUsd: null, cacheWarm: null, cacheHitRatio: null, files: [], receivedAt: '2026-10-08T00:05:00.001Z', stale: false,
  });
});

test('status keeps the valid file changes, drops the bad ones, merges a push by path, and keeps the list when a push leaves it out', async () => {
  const { service } = clockedService();
  const files = [
    { path: 'src/a.ts', added: 3, removed: 1 },
    { path: '', added: 1, removed: 1 },
    { path: 'src/b.ts', added: -1, removed: 0 },
    { path: 'src/c.ts', added: 1.5, removed: 0 },
    { path: 7, added: 1, removed: 0 },
    'src/d.ts',
    { path: 'src/e.ts', added: 0, removed: 4 },
  ];
  assert.deepStrictEqual(parseStatus(statusBody({ files })).files, [{ path: 'src/a.ts', added: 3, removed: 1 }, { path: 'src/e.ts', added: 0, removed: 4 }]);
  assert.strictEqual(parseStatus(statusBody()).files, null);
  assert.strictEqual(parseStatus(statusBody({ files: 'x' })).files, null);

  const dock = await service.createSession({ title: 'Dock' });
  await service.ingestStatus(statusBody({ sessionId: dock.id, files }), 'laptop');
  const kept = [{ path: 'src/a.ts', added: 3, removed: 1 }, { path: 'src/e.ts', added: 0, removed: 4 }];
  assert.deepStrictEqual(service.statusSnapshot().sessions[0].files, kept);
  await service.ingestStatus(statusBody({ sessionId: dock.id }), 'laptop');
  assert.deepStrictEqual(service.statusSnapshot().sessions[0].files, kept);
  await service.ingestStatus(statusBody({ sessionId: dock.id, files: [] }), 'laptop');
  assert.deepStrictEqual(service.statusSnapshot().sessions[0].files, kept, 'an empty push changes nothing');
  await service.ingestStatus(statusBody({ sessionId: dock.id, files: [{ path: 'src/a.ts', added: 9, removed: 0 }, { path: 'wt-1/src/f.ts', added: 2, removed: 2 }] }), 'laptop');
  assert.deepStrictEqual(service.statusSnapshot().sessions[0].files, [
    { path: 'src/e.ts', added: 0, removed: 4 },
    { path: 'src/a.ts', added: 9, removed: 0 },
    { path: 'wt-1/src/f.ts', added: 2, removed: 2 },
  ], 'a pushed path overwrites its numbers and the other paths stay');
});

test('status rejects what is not a status', async () => {
  const { service } = clockedService();
  for (const body of [null, [], 'x', {}, { sessionId: 7 }, statusBody({ costUsd: -1 }), statusBody({ contextPercentage: Number.NaN }), statusBody({ fastMode: 'yes' }), statusBody({ fiveHour: 'x' })]) {
    await assert.rejects(service.ingestStatus(body, 'laptop'), OrchestratorInputError);
  }
});

const queuedFor = async (service: ChatService, machine: string, title: string) => {
  const session = await service.createSession({ title, machine });
  const message = await service.sendMessage(session.id, `for ${machine}`, MACHINES);
  return { session, message };
};

test('a claim only returns the messages of sessions that belong to the calling machine', async () => {
  const { service } = clockedService();
  const remote = await queuedFor(service, 'workspace', 'Remote');
  assert.strictEqual(remote.session.machine, 'workspace');

  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'laptop'), { message: null }, 'the workspace message is not the laptop one');
  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'laptop'), { message: null });
  assert.strictEqual((await service.claim({ wait: 0 }, undefined, 'workspace')).message?.id, remote.message.id);

  const local = await queuedFor(service, 'laptop', 'Local');
  const other = await queuedFor(service, 'workspace', 'Other remote');
  const [laptopClaim, workspaceClaim] = await Promise.all([
    service.claim({ wait: 0 }, undefined, 'laptop'),
    service.claim({ wait: 0 }, undefined, 'workspace'),
  ]);
  assert.strictEqual(laptopClaim.message?.id, local.message.id);
  assert.strictEqual(workspaceClaim.message?.id, other.message.id);
  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'laptop'), { message: null });
  assert.deepStrictEqual(await service.claim({ wait: 0 }, undefined, 'workspace'), { message: null });
});

test('bridge online and status limits are tracked per machine', async () => {
  const { service, advance } = clockedService();
  assert.deepStrictEqual(service.machines(['laptop', 'workspace']).map((machine) => machine.online), [false, false]);

  await service.claim({ wait: 0 }, undefined, 'workspace');
  assert.deepStrictEqual(service.machines(['laptop', 'workspace']), [
    { name: 'laptop', online: false, lastSeenAt: null },
    { name: 'workspace', online: true, lastSeenAt: '2026-10-08T00:00:00.000Z' },
  ]);
  assert.strictEqual(service.bridge('laptop').online, false);
  assert.strictEqual(service.bridge().online, true, 'without a machine it is online when any machine is');

  advance(61_000);
  await service.claim({ wait: 0 }, undefined, 'laptop');
  assert.deepStrictEqual(service.machines(['laptop', 'workspace']).map((machine) => machine.online), [true, false]);
  assert.deepStrictEqual(service.bridge(), { online: true, lastSeenAt: '2026-10-08T00:01:01.000Z' });

  await service.ingestStatus(statusBody({ fiveHour: { usedPercentage: 10, resetsAt: 1791417600 }, sevenDay: undefined }), 'workspace');
  advance(1000);
  await service.ingestStatus(statusBody({ sessionId: 'laptop-line', fiveHour: { usedPercentage: 90, resetsAt: 1791417600 }, sevenDay: undefined }), 'laptop');
  assert.strictEqual(service.statusSnapshot('workspace').limits?.fiveHour?.usedPercentage, 10);
  assert.strictEqual(service.statusSnapshot('laptop').limits?.fiveHour?.usedPercentage, 90);
  assert.strictEqual(service.statusSnapshot().limits?.fiveHour?.usedPercentage, 90, 'without a machine the newest limits win');
  assert.deepStrictEqual(service.statusSnapshot('workspace').sessions.map((status) => status.machine), ['workspace']);
  assert.deepStrictEqual(service.statusSnapshot('laptop').sessions.map((status) => status.sessionId), ['laptop-line']);
  assert.deepStrictEqual(service.statusSnapshot('nothing'), { limits: null, sessions: [] });
});

test('a session is created for a machine, keeps it, and is refused to any other machine', async () => {
  const { service, sessions } = clockedService();
  assert.strictEqual((await service.createSession({ title: 'No machine' })).machine, 'laptop');
  assert.strictEqual((await service.createSession({ machine: null })).machine, 'laptop');
  await assert.rejects(service.createSession({ machine: 'Not Valid' }), OrchestratorInputError);

  await service.syncSession(syncBody(), 'workspace');
  assert.strictEqual(sessions.get(CLI_ID).machine, 'workspace', 'a synced session takes the machine of the caller');
  await assert.rejects(service.syncSession(syncBody(), 'laptop'), OrchestratorInputError, 'history from another machine is refused');
  await assert.rejects(service.syncSession(syncBody(), 'laptop'), OrchestratorInputError);
  assert.deepStrictEqual(await service.syncSession(syncBody(), 'workspace'), { id: CLI_ID, messageCount: 3 });

  const fork = await service.createSession({ forkFrom: CLI_ID });
  assert.strictEqual(fork.machine, 'workspace', 'a fork inherits the machine that holds the transcript');
  assert.strictEqual((await service.createSession({ forkFrom: CLI_ID, machine: 'workspace' })).machine, 'workspace');
  await assert.rejects(service.createSession({ forkFrom: CLI_ID, machine: 'laptop' }), OrchestratorInputError);

  const sent = await service.sendMessage(fork.id, 'hello', MACHINES);
  await service.claim({ wait: 0 }, undefined, 'workspace');
  await assert.rejects(service.delta({ sessionId: fork.id, replyTo: sent.id, done: true }, 'laptop'), OrchestratorInputError, 'a delta from the wrong machine is refused');
  await assert.rejects(service.delta({ sessionId: fork.id, replyTo: sent.id, done: true }, 'laptop'), OrchestratorInputError);
  assert.strictEqual(sessions.get(fork.id).status, 'running');
  assert.strictEqual((await service.delta({ sessionId: fork.id, replyTo: sent.id, done: true }, 'workspace'))?.status, 'idle');

  await service.renameSession(fork.id, 'renamed');
  assert.strictEqual(sessions.get(fork.id).machine, 'workspace', 'no call moves a session to another machine');
});

test('a machine filter keeps the list, one session and search to that machine', async () => {
  const { service } = clockedService();
  await service.syncSession(syncBody(), 'laptop');
  const remote = await service.createSession({ title: 'Remote', machine: 'workspace' });
  const local = await service.createSession({ title: 'Local', machine: 'laptop' });
  await service.sendMessage(remote.id, 'the redirect on workspace', MACHINES);
  await service.sendMessage(local.id, 'the redirect on laptop', MACHINES);

  assert.deepStrictEqual((await service.sessions(null, null, 'workspace')).map((session) => session.id), [remote.id]);
  assert.deepStrictEqual((await service.sessions('cli', null, 'workspace')), [], 'the laptop history is left out');
  assert.strictEqual((await service.sessions()).length, 3, 'no filter lists every machine');

  assert.strictEqual((await service.session(remote.id, 'workspace'))?.id, remote.id);
  assert.strictEqual(await service.session(local.id, 'workspace'), null);
  assert.strictEqual(await service.session(CLI_ID, 'workspace'), null);
  assert.strictEqual((await service.session(local.id))?.id, local.id);

  assert.deepStrictEqual((await service.search('redirect', null, 'workspace')).map((hit) => hit.session.id), [remote.id]);
  assert.strictEqual((await service.search('redirect')).length, 3);
});

test('the ingest token decides the machine of a claim', async (t) => {
  const { storage } = memoryStorage();
  const orchestrator = new OrchestratorService(storage, os.tmpdir());
  const chat = new ChatService(storage);
  const laptop = await orchestrator.createToken('laptop');
  const workspace = await orchestrator.createToken('workspace', 'workspace');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(5, 60_000), chat));
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

  const remote = await queuedFor(chat, 'workspace', 'Remote');
  const asLaptop = await post('/chat/claim', { wait: 0 }, laptop.token);
  assert.deepStrictEqual(await asLaptop.json(), { ok: true, result: { message: null } });
  const asWorkspace = await post('/chat/claim', { wait: 0 }, workspace.token);
  assert.strictEqual((await asWorkspace.json()).result.message.id, remote.message.id);

  const wrong = await post('/chat/delta', { sessionId: remote.session.id, replyTo: remote.message.id, done: true }, laptop.token);
  assert.strictEqual(wrong.status, 400);
  const right = await post('/chat/delta', { sessionId: remote.session.id, replyTo: remote.message.id, done: true }, workspace.token);
  assert.strictEqual(right.status, 200);
  assert.deepStrictEqual(chat.machines(['laptop', 'workspace']).map((machine) => machine.online), [true, true]);
});

test('a queued message is claimed whatever the status of its session says', async () => {
  const { service, sessions, messages } = clockedService();
  const { session, message } = await queuedFor(service, 'laptop', 'Late status');
  for (const status of ['idle', 'error', 'running']) {
    sessions.set(session.id, { ...sessions.get(session.id), status });
    assert.deepStrictEqual(messages().filter((item) => item.id === message.id).map((item) => item.state), ['queued']);
    await assert.rejects(service.sendMessage(session.id, 'again', MACHINES), /still working on the previous message/, 'the resend is refused by the message, not the status');
  }
  sessions.set(session.id, { ...sessions.get(session.id), status: 'idle' });
  assert.strictEqual((await service.claim({ wait: 0 }, undefined, 'workspace')).message, null, 'the machine still decides');
  assert.strictEqual((await service.claim({ wait: 0 }, undefined, 'laptop')).message?.id, message.id);
  assert.strictEqual(sessions.get(session.id).status, 'running');
});

test('a message for a machine without a token is refused by name', async () => {
  const { service } = clockedService();
  const session = await service.createSession({ title: 'Orphan', machine: 'workspace' });
  await assert.rejects(service.sendMessage(session.id, 'hello', ['laptop']), (error: unknown) => (
    error instanceof OrchestratorInputError && error.message.includes('workspace')
  ));
  assert.strictEqual((await service.sendMessage(session.id, 'hello', MACHINES)).state, 'queued');
});

test('status lines are kept per machine, capped per machine and refused for a session of another machine', async () => {
  const { service } = clockedService();
  await service.ingestStatus(statusBody({ sessionId: 'shared-id', costUsd: 1 }), 'laptop');
  await service.ingestStatus(statusBody({ sessionId: 'shared-id', costUsd: 2 }), 'workspace');
  assert.deepStrictEqual(service.statusSnapshot().sessions.map((status) => [status.machine, status.costUsd]), [['laptop', 1], ['workspace', 2]], 'the same id on two machines is two lines');

  for (let n = 0; n < MAX_STATUS_SESSIONS + 5; n += 1) await service.ingestStatus(statusBody({ sessionId: `flood-${n}` }), 'workspace');
  assert.strictEqual(service.statusSnapshot('workspace').sessions.length, MAX_STATUS_SESSIONS, 'the cap is per machine');
  assert.deepStrictEqual(service.statusSnapshot('laptop').sessions.map((status) => status.sessionId), ['shared-id'], 'a flood cannot evict another machine');

  await service.syncSession(syncBody(), 'workspace');
  const refused = await service.ingestStatus(statusBody({ costUsd: 99 }), 'laptop');
  assert.deepStrictEqual(refused, { sessionId: CLI_ID, ignored: true, owner: 'workspace' });
  assert.deepStrictEqual(service.statusSnapshot('laptop').sessions.map((status) => status.sessionId), ['shared-id']);
  assert.deepStrictEqual(await service.ingestStatus(statusBody({ costUsd: 5 }), 'workspace'), { sessionId: CLI_ID });
});

test('every chat route acts as the machine of the token', async (t) => {
  const { storage, sessions } = memoryStorage();
  const orchestrator = new OrchestratorService(storage, os.tmpdir());
  const chat = new ChatService(storage);
  await orchestrator.createToken('laptop');
  const workspace = await orchestrator.createToken('workspace', 'workspace');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(5, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${workspace.token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };

  assert.strictEqual((await post('/sessions', syncBody())).status, 200);
  assert.strictEqual(sessions.get(CLI_ID).machine, 'workspace', '/sessions stores the session for the token machine');
  assert.strictEqual((await post('/chat/status', statusBody())).status, 200);
  assert.deepStrictEqual(chat.statusSnapshot('workspace').sessions.map((status) => status.sessionId), [CLI_ID], '/chat/status files the line under the token machine');
  assert.deepStrictEqual(chat.statusSnapshot('laptop').sessions, []);

  const remote = await queuedFor(chat, 'workspace', 'Remote');
  const claimed = await post('/chat/claim', { wait: 0 });
  assert.strictEqual(claimed.body.result.message.id, remote.message.id, '/chat/claim takes the message of the token machine');
  const delta = await post('/chat/delta', { sessionId: remote.session.id, replyTo: remote.message.id, done: true });
  assert.strictEqual(delta.status, 200, '/chat/delta is accepted for a session of the token machine');
});

test('limits survive a restart: a new service on the same storage restores them, per machine', async () => {
  const { service, storage, now } = clockedService();
  await service.ingestStatus(statusBody(), 'laptop');
  await service.ingestStatus(statusBody({ sessionId: 'ws-line', fiveHour: { usedPercentage: 10 }, sevenDay: undefined }), 'workspace');

  const restarted = new ChatService(storage, now);
  assert.deepStrictEqual(restarted.statusSnapshot(), { limits: null, sessions: [] }, 'nothing is known before the restore');
  await restarted.restoreLimits();
  assert.deepStrictEqual(restarted.statusSnapshot('laptop').limits, service.statusSnapshot('laptop').limits);
  assert.deepStrictEqual(restarted.statusSnapshot('workspace').limits, service.statusSnapshot('workspace').limits);
  assert.deepStrictEqual(restarted.statusSnapshot().sessions, [], 'session lines are not kept');
});

test('claim: a cron message waits while every cron slot is in use and runs in the first one that frees; manual sessions never wait', async () => {
  const memory = memoryStorage();
  const chat = new ChatService(memory.storage, () => new Date('2026-10-14T03:00:00.000Z'), async () => undefined);
  chat.cronLimit = async () => 2;
  const open = (origin: 'cron' | 'manual', ticketKey: string) => chat.createSession({ machine: 'workspace', ticketKey, title: ticketKey, origin });
  const [a, b, answered, manual] = await Promise.all([open('cron', 'QRD-1'), open('cron', 'QRD-2'), open('cron', 'QRD-3'), open('manual', 'QRD-9')]);
  for (const session of [a, b]) await chat.sendMessage(session.id, 'build', ['workspace']);
  assert.strictEqual((await chat.claim({ wait: 0 }, undefined, 'workspace')).message?.sessionId, a.id);
  assert.strictEqual((await chat.claim({ wait: 0 }, undefined, 'workspace')).message?.sessionId, b.id);

  await chat.sendMessage(answered.id, 'use the second endpoint', ['workspace']);
  await chat.sendMessage(manual.id, 'hi', ['workspace']);
  assert.strictEqual((await chat.claim({ wait: 0 }, undefined, 'workspace')).message?.sessionId, manual.id, 'the manual chat is not held');
  assert.strictEqual((await chat.claim({ wait: 0 }, undefined, 'workspace')).message, null, 'the answer waits: 2 of 2 in use');
  assert.strictEqual(memory.sessions.get(answered.id).statusDetail, 'Waiting for a cron slot (2 of 2 in use)');

  for (const message of memory.messages()) if (message.sessionId === a.id && message.state === 'taken') message.state = 'done';
  assert.strictEqual((await chat.claim({ wait: 0 }, undefined, 'workspace')).message?.sessionId, answered.id, 'the first free slot goes to the answer');
});

test('a cron session keeps the options the cron sends, so it shows Auto; a manual session keeps its defaults', async () => {
  const memory = memoryStorage();
  const chat = new ChatService(memory.storage, () => new Date('2026-10-14T03:00:00.000Z'), async () => undefined);
  const cron = await chat.createSession({ machine: 'workspace', ticketKey: 'QRD-1', title: 'QRD-1 (cron)', origin: 'cron', options: { permissionMode: 'auto', effort: 'high' } });
  assert.deepStrictEqual(cron.options, { model: null, effort: 'high', permissionMode: 'auto', fast: null });
  assert.strictEqual((await chat.createSession({ machine: 'workspace', ticketKey: 'QRD-2', title: 'QRD-2 (cron)', origin: 'cron' })).options, null);
  assert.deepStrictEqual((await chat.createSession({ machine: 'workspace', title: 'Manual' })).options, null);
});

test('a cron turn clears the stalled reason when it starts and reports the subagents its lead left running when it ends', async () => {
  const memory = memoryStorage();
  const chat = new ChatService(memory.storage, () => new Date('2026-10-14T03:00:00.000Z'), async () => undefined);
  const told: Array<[string, string | null, boolean]> = [];
  chat.cronTurn = async (ticketKey, detail, ended) => { told.push([ticketKey, detail, ended]); };
  const cron = await chat.createSession({ machine: 'workspace', ticketKey: 'QRD-1', title: 'QRD-1 (cron)', origin: 'cron' });
  const manual = await chat.createSession({ machine: 'workspace', ticketKey: 'QRD-9', title: 'Manual' });

  const turn = async (sessionId: string, end: object) => {
    await chat.sendMessage(sessionId, 'build', ['workspace']);
    const claimed = (await chat.claim({ wait: 0 }, undefined, 'workspace')).message!;
    await chat.delta({ sessionId, replyTo: claimed.id, items: [], ...end }, 'workspace');
  };
  await turn(cron.id, { done: true, subagentsRunning: 2 });
  assert.deepStrictEqual(told, [['QRD-1', null, false], ['QRD-1', 'Lead ended its turn while 2 subagents were still running', true]]);
  await turn(cron.id, { done: true, subagentsRunning: 1 });
  assert.deepStrictEqual(told.slice(2), [['QRD-1', null, false], ['QRD-1', 'Lead ended its turn while 1 subagent was still running', true]]);
  await turn(cron.id, { done: true });
  assert.deepStrictEqual(told.slice(4), [['QRD-1', null, false], ['QRD-1', null, true]], 'a clean end is reported so the resume count starts again');
  await turn(cron.id, { done: false, error: 'boom', subagentsRunning: 3 });
  assert.deepStrictEqual(told.slice(6), [['QRD-1', null, false]], 'a failed turn reports no end');
  await turn(manual.id, { done: true, subagentsRunning: 2 });
  assert.strictEqual(told.length, 7, 'a manual session is not a cron run');
  const running = (value: unknown) => parseDelta({ sessionId: cron.id, replyTo: 1, done: true, subagentsRunning: value }).subagentsRunning;
  assert.deepStrictEqual([running(2), running(1000), running(0), running('2'), running(undefined)], [2, 100, undefined, undefined, undefined]);
});

test('a DOCK turn adds its cost to the session total, keeps what a later push leaves out, and survives a restart', async () => {
  const { service, storage, now } = clockedService();
  const dock = await service.createSession({ title: 'Cost' });
  const turn = (overrides: object = {}) => ({ sessionId: dock.id, model: 'claude-opus-5-5', effort: 'high', contextTokens: 1000, contextSize: 200000, contextPercentage: 0.5, turnCostUsd: 0.5, ...overrides });
  const line = (chat: ChatService) => chat.statusSnapshot('laptop').sessions.find((status) => status.sessionId === dock.id);

  await service.ingestStatus(turn(), 'laptop');
  assert.strictEqual(line(service)?.costUsd, 0.5);
  assert.strictEqual('turnCostUsd' in (line(service) ?? {}), false, 'the turn cost is not part of the line');
  await service.ingestStatus(turn({ turnCostUsd: 0.25, contextTokens: 3000 }), 'laptop');
  assert.deepStrictEqual([line(service)?.costUsd, line(service)?.contextTokens], [0.75, 3000]);

  await service.ingestStatus({ sessionId: dock.id, fiveHour: { usedPercentage: 30 } }, 'laptop');
  assert.deepStrictEqual([line(service)?.costUsd, line(service)?.model, line(service)?.effort], [0.75, 'claude-opus-5-5', 'high'], 'a limits-only push does not blank the line');
  assert.strictEqual(service.statusSnapshot('laptop').limits?.fiveHour?.usedPercentage, 30);

  const restarted = new ChatService(storage, now);
  assert.deepStrictEqual(restarted.statusSnapshot().sessions, [], 'nothing is known before the restore');
  await restarted.restoreLimits();
  assert.deepStrictEqual(line(restarted), line(service), 'the line comes back as it was, receive time included');
  await restarted.ingestStatus(turn({ turnCostUsd: 1 }), 'laptop');
  assert.strictEqual(line(restarted)?.costUsd, 1.75, 'the total goes on from the saved one');

  await assert.rejects(service.ingestStatus(turn({ turnCostUsd: -1 }), 'laptop'), OrchestratorInputError);
  await assert.rejects(service.ingestStatus(turn({ turnCostUsd: 'free' }), 'laptop'), OrchestratorInputError);

  await service.syncSession(syncBody(), 'laptop');
  await service.ingestStatus(statusBody({ turnCostUsd: 3 }), 'laptop');
  assert.strictEqual(service.statusSnapshot('laptop').sessions.find((status) => status.sessionId === CLI_ID)?.costUsd, 12.5, 'a terminal session keeps the cost it pushed');
});

test('saved session lines are bounded per machine and a damaged save is ignored', async () => {
  const { service, storage, now } = clockedService();
  const dock = await service.createSession({ title: 'Many' });
  for (let n = 0; n < MAX_STATUS_SESSIONS + 5; n += 1) await service.ingestStatus({ sessionId: `flood-${n}` }, 'laptop');
  await service.ingestStatus({ sessionId: dock.id, turnCostUsd: 1 }, 'laptop');
  const restarted = new ChatService(storage, now);
  await restarted.restoreLimits();
  assert.strictEqual(restarted.statusSnapshot('laptop').sessions.length, MAX_STATUS_SESSIONS);
  assert.strictEqual(restarted.statusSnapshot('laptop').sessions.at(-1)?.sessionId, dock.id);

  await storage.upsertCache('chat', 'sessionStatus', { laptop: [{ sessionId: 'bad id' }, { sessionId: 'no-time' }, 'x', null], workspace: 'nope' });
  const damaged = new ChatService(storage, now);
  await damaged.restoreLimits();
  assert.deepStrictEqual(damaged.statusSnapshot().sessions, []);
});

test('a session counts its agent rows, and its workers come back in order with their place in the tree and their times', async () => {
  const { service, workerRows } = clockedService();
  const none = await service.createSession({ title: 'Alone' });
  const team = await service.createSession({ title: 'Team' });
  workerRows.push(
    { sessionId: team.id, eventId: 'toolu_1', parentId: null, turnId: 7, name: 'executor', label: 'Build the form', status: 'done', startedAt: new Date('2026-10-21T05:00:00Z'), endedAt: new Date('2026-10-21T05:03:00Z') },
    { sessionId: team.id, eventId: 'toolu_2', parentId: 'toolu_1', turnId: 7, name: 'test-engineer', label: 'Cover it', status: 'running', startedAt: new Date('2026-10-21T05:01:00Z'), endedAt: null },
  );
  const listed = await service.sessions('dock', null, 'laptop');
  assert.deepStrictEqual(listed.map((session) => [session.id, session.workerCount]).sort(), [[none.id, 0], [team.id, 2]].sort());
  assert.strictEqual((await service.session(team.id))?.workerCount, 2);
  assert.deepStrictEqual(await service.workers(team.id), [
    { id: 'toolu_1', parentId: null, turnId: 7, name: 'executor', label: 'Build the form', status: 'done', startedAt: '2026-10-21T05:00:00.000Z', endedAt: '2026-10-21T05:03:00.000Z' },
    { id: 'toolu_2', parentId: 'toolu_1', turnId: 7, name: 'test-engineer', label: 'Cover it', status: 'running', startedAt: '2026-10-21T05:01:00.000Z', endedAt: null },
  ]);
  assert.deepStrictEqual(await service.workers(none.id), []);
  assert.deepStrictEqual(await service.workers('not an id!'), []);
});

test('a cron owner session carries only the options its machine reported it can take', async () => {
  const { storage, service } = clockedService();
  const options = { permissionMode: 'default', effort: 'high' };
  assert.deepStrictEqual(await service.machineTurnOptions('workspace', options), {}, 'a machine that never reported its capabilities gets no options');

  (storage as unknown as { getChatMachineInfo: () => Promise<unknown> }).getChatMachineInfo = async () => ({
    machine: 'laptop', caps: JSON.stringify({ v: CAPS_VERSION, features: ['effort'], modes: ['auto'] }), catalog: '', catalogHash: '',
  });
  const reported = new ChatService(storage);
  await assert.rejects(reported.machineTurnOptions('laptop', { permissionMode: 'default' }), /does not offer that permission mode/);
  assert.deepStrictEqual(await reported.machineTurnOptions('laptop', { permissionMode: 'auto' }), { permissionMode: 'auto' });
});
