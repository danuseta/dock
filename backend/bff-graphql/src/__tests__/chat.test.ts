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
  STALE_TEXT,
  cutMessageText,
  parseClaim,
  parseDelta,
  parseSessionSync,
  searchSnippet,
} from '../integrations/chat';
import { OrchestratorInputError, OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

function memoryStorage() {
  const sessions = new Map<string, any>();
  let messages: any[] = [];
  const tokens: any[] = [];
  let sequence = 0;
  const ofSession = (sessionId: string) => messages.filter((message) => message.sessionId === sessionId);
  const storage = {
    getChatSessions: async (source: string | null, take: number) => [...sessions.values()]
      .filter((session) => !source || session.source === source)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, take),
    getChatSession: async (id: string) => sessions.get(id) ?? null,
    getChatSessionsByIds: async (ids: string[]) => ids.flatMap((id) => (sessions.has(id) ? [sessions.get(id)] : [])),
    getChatSessionsWithTicket: async (source: string, since: Date) => [...sessions.values()]
      .filter((session) => session.source === source && session.ticketKey && session.lastMessageAt >= since),
    getStaleChatSessions: async (before: Date) => [...sessions.values()]
      .filter((session) => session.status === 'running' && session.lastDeltaAt && session.lastDeltaAt < before),
    createChatSession: async (data: any) => {
      const row = { forkFrom: null, claudeSessionId: null, status: 'idle', statusDetail: null, messageCount: 0, lastDeltaAt: null, ...data };
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
    getQueuedChatMessages: async (take: number) => messages
      .filter((message) => message.state === 'queued' && message.role === 'user').slice(0, take).map((message) => ({ ...message })),
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
    searchChatMessages: async (query: string, take: number) => messages
      .filter((message) => message.text.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
      .slice(0, take),
    getChatLastTexts: async (sessionIds: string[], length: number) => new Map(sessionIds.flatMap((id): Array<[string, string]> => {
      const last = ofSession(id).filter((message) => message.role !== 'tool').at(-1);
      return last ? [[id, last.text.slice(0, length)]] : [];
    })),
    countIngestTokens: async () => tokens.length,
    createIngestToken: async (data: any) => {
      const token = { id: String(sequence += 1), ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash) ?? null,
    touchIngestToken: async () => undefined,
  };
  return { storage: storage as unknown as StorageService, sessions, messages: () => messages };
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

  assert.deepStrictEqual(await service.syncSession(syncBody()), { id: CLI_ID, messageCount: 3 });
  assert.deepStrictEqual(await service.syncSession(syncBody({ replace: false, messages: [syncBody().messages[0]] })), { id: CLI_ID, messageCount: 4 });
  assert.deepStrictEqual(await service.syncSession(syncBody()), { id: CLI_ID, messageCount: 3 }, 'replace drops what was there');

  const [listed] = await service.sessions('cli');
  assert.deepStrictEqual(
    [listed.source, listed.title, listed.status, listed.messageCount, listed.startedAt, listed.lastMessageAt],
    ['cli', 'Fix the login redirect', 'idle', 3, '2026-10-07T08:00:00.000Z', '2026-10-07T09:00:00.000Z'],
  );
  assert.strictEqual(listed.lastText, 'The guard runs before the session is restored.', 'tool lines are not the last text');
  assert.deepStrictEqual(await service.sessions('dock'), []);
  await assert.rejects(service.sessions('other'), OrchestratorInputError);

  await service.syncSession(syncBody({ messages: [{ role: 'assistant', text: 'y'.repeat(MAX_MESSAGE_CHARS + 500), at: '2026-10-07T08:00:00.000Z' }] }));
  assert.strictEqual(messages()[0].text.length, MAX_MESSAGE_CHARS);
  assert.ok(messages()[0].text.endsWith(CUT_SUFFIX));

  const batch = (from: number) => Array.from({ length: 500 }, (_, index) => ({ role: 'assistant', text: `m${from + index}`, at: '2026-10-07T08:00:00.000Z' }));
  await service.syncSession(syncBody({ messages: batch(0) }));
  let last = { id: CLI_ID, messageCount: 0 };
  for (let from = 500; from < 5500; from += 500) last = await service.syncSession(syncBody({ replace: false, messages: batch(from) }));
  assert.strictEqual(last.messageCount, MAX_MESSAGES_KEPT);
  assert.strictEqual(messages().length, MAX_MESSAGES_KEPT);
  assert.strictEqual(messages()[0].text, 'm500', 'the oldest are dropped');
  assert.strictEqual(messages().at(-1).text, 'm5499');
});

test('a DOCK session takes one turn at a time and the bridge moves it through its states', async () => {
  const { service, sessions, advance } = clockedService();
  await service.syncSession(syncBody());

  await assert.rejects(service.createSession({ forkFrom: 'does-not-exist' }), OrchestratorInputError);
  await assert.rejects(service.createSession({ ticketKey: 'nope' }), OrchestratorInputError);
  const dock = await service.createSession({ title: `  ${'n'.repeat(130)}`, ticketKey: 'qrd-1258', forkFrom: CLI_ID });
  assert.deepStrictEqual(
    [dock.source, dock.title.length, dock.ticketKey, dock.forkFrom, dock.status, dock.messageCount, dock.lastText],
    ['dock', 120, 'QRD-1258', CLI_ID, 'idle', 0, null],
  );
  await assert.rejects(service.createSession({ forkFrom: dock.id }), OrchestratorInputError, 'only a cli session can be continued');
  await assert.rejects(service.syncSession(syncBody({ session: { ...syncBody().session, id: dock.id } })), OrchestratorInputError, 'history sync never overwrites a DOCK session');

  await assert.rejects(service.sendMessage(CLI_ID, 'hello'), OrchestratorInputError, 'cli sessions are read-only');
  await assert.rejects(service.sendMessage('unknown-session', 'hello'), OrchestratorInputError);
  await assert.rejects(service.sendMessage(dock.id, '   '), OrchestratorInputError);
  await assert.rejects(service.sendMessage(dock.id, 'x'.repeat(8001)), OrchestratorInputError);

  assert.deepStrictEqual(await service.claim({ wait: 0 }), { message: null });

  const sent = await service.sendMessage(dock.id, '  What changed in the guard?  ');
  assert.deepStrictEqual([sent.role, sent.text, sent.state, sent.sessionId], ['user', 'What changed in the guard?', 'queued', dock.id]);
  assert.strictEqual((await service.session(dock.id))?.status, 'queued');
  await assert.rejects(service.sendMessage(dock.id, 'second'), OrchestratorInputError, 'refused while a message is queued');

  const other = await service.createSession({ title: 'Other' });
  const otherSent = await service.sendMessage(other.id, 'Second session');

  const [first, second, third] = await Promise.all([service.claim({ wait: 0 }), service.claim({ wait: 0 }), service.claim({ wait: 0 })]);
  assert.deepStrictEqual(
    [first.message?.id, second.message?.id, third.message].sort(),
    [sent.id, otherSent.id, null].sort(),
    'no message is handed to two bridges',
  );
  const claimed = [first, second].map((claim) => claim.message).find((message) => message?.id === sent.id);
  assert.deepStrictEqual(claimed, { id: sent.id, sessionId: dock.id, text: 'What changed in the guard?', claudeSessionId: null, forkFrom: CLI_ID });
  assert.strictEqual((await service.session(dock.id))?.status, 'running');
  await assert.rejects(service.sendMessage(dock.id, 'second'), OrchestratorInputError, 'refused while a message is taken');

  const claude = 'c1a0de00-aaaa-4bbb-8ccc-ddddeeeeffff';
  advance(2000);
  const progress = await service.delta({
    sessionId: dock.id, replyTo: sent.id, claudeSessionId: claude, detail: 'Bash',
    items: [{ role: 'tool', text: 'Bash · git log', at: '2026-10-08T00:00:01.000Z' }, { role: 'assistant', text: 'Looking at the history.', at: '2026-10-08T00:00:02.000Z' }],
  });
  assert.deepStrictEqual(progress, { id: dock.id, status: 'running', messageCount: 3 });
  assert.deepStrictEqual(
    [sessions.get(dock.id).claudeSessionId, sessions.get(dock.id).statusDetail],
    [claude, 'Bash'],
  );
  assert.strictEqual((await service.session(dock.id))?.lastText, 'Looking at the history.');

  assert.strictEqual(await service.delta({ sessionId: 'unknown-session', replyTo: sent.id }), null, 'unknown session is a 404');
  await assert.rejects(service.delta({ sessionId: dock.id, replyTo: otherSent.id }), OrchestratorInputError, 'replyTo must belong to the session');
  await assert.rejects(service.delta({ sessionId: CLI_ID, replyTo: 1 }), OrchestratorInputError);

  const finished = await service.delta({ sessionId: dock.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: 'Done.', at: '2026-10-08T00:00:03.000Z' }] });
  assert.deepStrictEqual(finished, { id: dock.id, status: 'idle', messageCount: 4 });
  const thread = await service.messages(dock.id);
  assert.deepStrictEqual(thread.map((message) => [message.role, message.state]), [['user', 'done'], ['tool', 'done'], ['assistant', 'done'], ['assistant', 'done']]);
  assert.strictEqual(sessions.get(dock.id).statusDetail, null);

  const next = await service.sendMessage(dock.id, 'And the tests?');
  const resumed = await service.claim({ wait: 0 });
  assert.deepStrictEqual([resumed.message?.id, resumed.message?.claudeSessionId], [next.id, claude], 'the next turn resumes the Claude session');
  const failed = await service.delta({ sessionId: dock.id, replyTo: next.id, done: true, error: 'claude exited with code 1' });
  assert.strictEqual(failed?.status, 'error');
  assert.strictEqual(sessions.get(dock.id).statusDetail, 'claude exited with code 1');
  assert.strictEqual((await service.messages(dock.id)).find((message) => message.id === next.id)?.state, 'failed');
  await service.sendMessage(dock.id, 'Try again');
  assert.strictEqual((await service.session(dock.id))?.status, 'queued', 'a failed turn does not lock the session');

  const renamed = await service.renameSession(dock.id, `${'r'.repeat(125)}`);
  assert.strictEqual(renamed.title.length, 120);
  await assert.rejects(service.renameSession('unknown-session', 'x'), OrchestratorInputError);

  assert.strictEqual(await service.deleteSession(dock.id), true);
  assert.strictEqual(await service.deleteSession(dock.id), false);
  assert.strictEqual(await service.session(dock.id), null);
  assert.deepStrictEqual(await service.messages(dock.id), []);
  assert.deepStrictEqual((await service.claim({ wait: 0 })).message, null, 'a deleted session leaves nothing queued');
});

test('claim skips a session that already has a taken message', async () => {
  const { service, storage } = clockedService();
  const busy = await service.createSession({ title: 'Busy' });
  const free = await service.createSession({ title: 'Free' });
  await storage.createChatMessage({ sessionId: busy.id, role: 'user', text: 'in flight', state: 'taken', at: new Date() });
  await storage.createChatMessage({ sessionId: busy.id, role: 'user', text: 'raced in', state: 'queued', at: new Date() });
  const waiting = await service.sendMessage(free.id, 'pick me');

  assert.strictEqual((await service.claim({ wait: 0 })).message?.id, waiting.id);
  assert.strictEqual((await service.claim({ wait: 0 })).message, null);
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
  assert.deepStrictEqual(await service.claim({ wait: 2 }), { message: null });
  assert.deepStrictEqual(sleeps, [500, 500, 500, 500]);
  assert.deepStrictEqual(service.bridge(), { online: true, lastSeenAt: '2026-10-08T00:00:02.000Z' });
  clock.at += 60_000;
  assert.strictEqual(service.bridge().online, true);
  clock.at += 1;
  assert.deepStrictEqual(service.bridge(), { online: false, lastSeenAt: '2026-10-08T00:00:02.000Z' });

  const dock = await service.createSession({});
  sleeps.length = 0;
  onSleep = async () => {
    if (sleeps.length === 3) await service.sendMessage(dock.id, 'arrives while waiting');
  };
  const claimed = await service.claim({ wait: 25 });
  assert.strictEqual(claimed.message?.text, 'arrives while waiting');
  assert.strictEqual(sleeps.length, 3, 'returns as soon as a message is queued');

  const hangup = new AbortController();
  const second = await service.createSession({});
  sleeps.length = 0;
  onSleep = async () => {
    hangup.abort();
    await service.sendMessage(second.id, 'nobody is listening');
  };
  assert.deepStrictEqual(await service.claim({ wait: 25 }, hangup.signal), { message: null });
  assert.strictEqual(sleeps.length, 1);
  assert.strictEqual((await service.messages(second.id))[0].state, 'queued', 'a message is not taken for a bridge that left');
});

test('a taken message with no delta for 15 minutes is failed on the next list or claim', async () => {
  const { service, advance, sessions } = clockedService();
  const dock = await service.createSession({ title: 'Stale' });
  const sent = await service.sendMessage(dock.id, 'long task');
  await service.claim({ wait: 0 });

  advance(14 * 60 * 1000);
  await service.delta({ sessionId: dock.id, replyTo: sent.id, detail: 'Bash' });
  advance(14 * 60 * 1000);
  assert.strictEqual((await service.sessions())[0].status, 'running', 'a delta restarts the clock');

  advance(2 * 60 * 1000);
  const [listed] = await service.sessions();
  assert.deepStrictEqual([listed.status, listed.statusDetail], ['error', STALE_TEXT]);
  assert.strictEqual((await service.messages(dock.id))[0].state, 'failed');

  const late = await service.delta({ sessionId: dock.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: 'late answer', at: '2026-10-08T00:00:00.000Z' }] });
  assert.deepStrictEqual([late?.status, late?.messageCount], ['error', 2], 'late output is kept but the turn stays failed');
  assert.strictEqual(sessions.get(dock.id).statusDetail, STALE_TEXT);

  const again = await service.sendMessage(dock.id, 'retry');
  await service.claim({ wait: 0 });
  advance(16 * 60 * 1000);
  assert.deepStrictEqual(await service.claim({ wait: 0 }), { message: null });
  assert.strictEqual((await service.messages(dock.id)).find((message) => message.id === again.id)?.state, 'failed', 'claim sweeps too');
});

test('messages page by id, search returns snippets and balloons show fresh answers on ticket sessions', async () => {
  const { service, advance } = clockedService();
  await service.syncSession(syncBody({ messages: Array.from({ length: 10 }, (_, index) => ({ role: 'assistant', text: `line ${index + 1}`, at: `2026-10-07T08:00:${String(index).padStart(2, '0')}.000Z` })) }));

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
    const sent = await service.sendMessage(session.id, 'status?');
    await service.claim({ wait: 0 });
    await service.delta({ sessionId: session.id, replyTo: sent.id, done: true, items: [{ role: 'assistant', text: `answer for ${session.id}`, at: '2026-10-08T00:00:00.000Z' }] });
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

  const synced = await post('/sessions', syncBody());
  assert.strictEqual(synced.status, 200);
  assert.deepStrictEqual(await synced.json(), { ok: true, result: { id: CLI_ID, messageCount: 3 } });
  assert.strictEqual((await post('/sessions', syncBody({ messages: 'x' }))).status, 400);
  assert.strictEqual((await post('/sessions', '{not json')).status, 400);
  assert.strictEqual((await post('/sessions', syncBody({ messages: [{ role: 'user', text: 'x'.repeat(2 * 1024 * 1024), at: '2026-10-07T08:00:00.000Z' }] }))).status, 413);
  assert.strictEqual((await post('/chat/delta', { sessionId: CLI_ID, replyTo: 1, items: [{ role: 'assistant', text: 'x'.repeat(300 * 1024), at: '2026-10-07T08:00:00.000Z' }] })).status, 413);

  const dock = await chat.createSession({ title: 'From the browser' });
  const refused = await post('/sessions', syncBody({ session: { ...syncBody().session, id: dock.id } }));
  assert.strictEqual(refused.status, 400);

  const empty = await post('/chat/claim', { wait: 0 });
  assert.deepStrictEqual([empty.status, await empty.json()], [200, { ok: true, result: { message: null } }]);
  assert.strictEqual((await post('/chat/claim', { wait: 60 })).status, 400);

  const started = Date.now();
  const pending = post('/chat/claim', { wait: 5 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const sent = await chat.sendMessage(dock.id, 'over http');
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
  const stored = await post('/chat/status', statusBody());
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

test('status keeps the latest line per session and the latest account limits, and marks old ones stale', () => {
  const { service, advance } = clockedService();
  assert.deepStrictEqual(service.statusSnapshot(), { limits: null, sessions: [] });

  service.ingestStatus(statusBody());
  service.ingestStatus(statusBody({ sessionId: 'other-session', costUsd: 1, fiveHour: undefined, sevenDay: undefined }));
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
    { sessionId: CLI_ID, model: 'Opus 4.7 (1M context)', effort: 'high', fastMode: false, contextPercentage: 40, contextTokens: 395000, contextSize: 1000000, costUsd: 12.5, cacheWarm: true, cacheHitRatio: 0.93, receivedAt: undefined, stale: false },
  );

  advance(5 * 60 * 1000);
  assert.strictEqual(service.statusSnapshot().sessions[0].stale, false);
  advance(1);
  service.ingestStatus(statusBody({ sessionId: 'other-session', fiveHour: undefined, sevenDay: undefined }));
  const later = service.statusSnapshot();
  assert.deepStrictEqual(later.sessions.map((status) => [status.sessionId, status.stale]), [[CLI_ID, true], ['other-session', false]]);
  assert.strictEqual(later.limits?.stale, true, 'a push without limits does not refresh them');

  service.ingestStatus({ sessionId: 'bare' });
  assert.deepStrictEqual(service.statusSnapshot().sessions.at(-1), {
    sessionId: 'bare', model: null, effort: null, fastMode: null, contextPercentage: null, contextTokens: null, contextSize: null,
    costUsd: null, cacheWarm: null, cacheHitRatio: null, receivedAt: '2026-10-08T00:05:00.001Z', stale: false,
  });
});

test('status rejects what is not a status', () => {
  const { service } = clockedService();
  for (const body of [null, [], 'x', {}, { sessionId: 7 }, statusBody({ costUsd: -1 }), statusBody({ contextPercentage: Number.NaN }), statusBody({ fastMode: 'yes' }), statusBody({ fiveHour: 'x' })]) {
    assert.throws(() => service.ingestStatus(body), OrchestratorInputError);
  }
});
