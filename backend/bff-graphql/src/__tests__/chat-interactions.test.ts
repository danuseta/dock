import assert from 'node:assert';
import http from 'node:http';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock, type TestContext } from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { ChatService, DRAFT_MAX_MS, SILENT_TAKEN_MS, SILENT_TEXT, STALE_TAKEN_MS, STOP_GRACE_MS } from '../integrations/chat';
import { ChatAttachmentService } from '../integrations/chat-attachments';
import {
  ASK_TTL_SECONDS,
  TAKEN_HARD_MS,
  TurnNotifier,
  checkAnswer,
  parseAsk,
  parseCaps,
  parseCatalog,
  parseTurnOptions,
  parseWait,
  searchCommands,
} from '../integrations/chat-interactions';
import { OrchestratorInputError, OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { ChatAttachmentStore } from '../storage/chat-attachments';
import type { StorageService } from '../storage/service';

const MACHINES = ['laptop', 'workspace'];
const NOW = new Date('2026-10-12T00:00:00.000Z');

function memoryStorage() {
  const sessions = new Map<string, any>();
  let messages: any[] = [];
  let interactions: any[] = [];
  const machineInfo = new Map<string, any>();
  const tokens: any[] = [];
  let sequence = 0;
  let interactionSequence = 0;
  const writes: string[] = [];
  const ofSession = (sessionId: string) => messages.filter((message) => message.sessionId === sessionId);
  const storage = {
    getChatSessions: async (source: string | null, take: number) => [...sessions.values()].filter((session) => !source || session.source === source).slice(0, take),
    getChatSession: async (id: string) => sessions.get(id) ?? null,
    getChatSessionsByIds: async (ids: string[]) => ids.flatMap((id) => (sessions.has(id) ? [sessions.get(id)] : [])),
    getStaleChatSessions: async (before: Date) => [...sessions.values()].filter((session) => session.status === 'running' && session.lastDeltaAt && session.lastDeltaAt < before),
    createChatSession: async (data: any) => {
      const row = { machine: 'laptop', forkFrom: null, claudeSessionId: null, status: 'idle', statusDetail: null, messageCount: 0, lastDeltaAt: null, options: null, ...data };
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
      interactions = interactions.filter((row) => row.sessionId !== id);
      return sessions.delete(id);
    },
    createChatMessage: async (data: any) => {
      const row = { id: sequence += 1, options: null, takenAt: null, stopRequestedAt: null, ...data };
      messages.push(row);
      return row;
    },
    deleteChatMessage: async (id: number) => {
      messages = messages.filter((message) => message.id !== id);
    },
    addChatMessages: async (sessionId: string, items: any[], keep: number) => {
      for (const item of items) messages.push({ id: sequence += 1, sessionId, state: 'done', ...item });
      return storage.trimChatMessages(sessionId, keep);
    },
    trimChatMessages: async (sessionId: string, _keep: number) => ofSession(sessionId).length,
    getChatMessage: async (id: number) => {
      const row = messages.find((message) => message.id === id);
      return row ? { ...row } : null;
    },
    getChatMessages: async (sessionId: string) => ofSession(sessionId),
    countChatMessagesInState: async (sessionId: string, states: string[]) => ofSession(sessionId).filter((message) => states.includes(message.state)).length,
    getQueuedChatMessages: async (machine: string, take: number) => messages
      .filter((message) => {
        const session = sessions.get(message.sessionId);
        return message.state === 'queued' && message.role === 'user' && session?.source === 'dock' && session.machine === machine;
      })
      .slice(0, take).map((message) => ({ id: message.id, sessionId: message.sessionId, text: message.text, options: message.options })),
    moveChatMessage: async (id: number, sessionId: string, from: string, to: string, extra: any = {}) => {
      const row = messages.find((message) => message.id === id && message.sessionId === sessionId && message.state === from);
      if (row) Object.assign(row, { state: to }, extra);
      return Boolean(row);
    },
    moveChatMessages: async (sessionId: string, from: string, to: string) => {
      const rows = ofSession(sessionId).filter((message) => message.state === from);
      for (const row of rows) row.state = to;
      return { count: rows.length };
    },
    getChatMessageIdsInState: async (sessionId: string, states: string[]) => ofSession(sessionId).filter((message) => states.includes(message.state)).map((message) => message.id),
    getOpenChatMessage: async (sessionId: string) => ofSession(sessionId).find((message) => message.role === 'user' && ['queued', 'taken'].includes(message.state)) ?? null,
    getOverdueChatSessions: async (before: Date) => [...new Set(messages.filter((message) => message.state === 'taken' && message.takenAt && message.takenAt < before).map((message) => message.sessionId))].map((id) => ({ id })),
    getQuietChatTurns: async (silentBefore: Date, stopBefore: Date) => {
      const quiet = new Set([...sessions.values()].filter((session) => session.status === 'running' && session.lastDeltaAt && session.lastDeltaAt < silentBefore).map((session) => session.id));
      const taken = messages.filter((message) => message.state === 'taken' && message.takenAt);
      return {
        silent: taken.filter((message) => quiet.has(message.sessionId)).map((message) => ({ sessionId: message.sessionId, turnId: message.id })),
        unstopped: taken.filter((message) => message.stopRequestedAt && message.stopRequestedAt < stopBefore).map((message) => ({ sessionId: message.sessionId, turnId: message.id })),
      };
    },
    requestChatStop: async (id: number, sessionId: string, at: Date) => {
      const row = messages.find((message) => message.id === id && message.sessionId === sessionId && message.state === 'taken' && !message.stopRequestedAt);
      if (row) row.stopRequestedAt = at;
      return Boolean(row);
    },
    getChatLastTexts: async () => new Map<string, string>(),
    closeRunningChatActivity: async () => 0,
    upsertChatActivity: async () => ({ accepted: 0, dropped: 0, seq: 0 }),
    pruneChatActivity: async () => ({}),
    createChatInteraction: async (data: any, limits: { pending: number; perTurn: number }, now: Date) => {
      writes.push('create');
      const known = interactions.find((row) => row.sessionId === data.sessionId && row.turnId === data.turnId && row.requestId === data.requestId);
      if (known) return { row: known, refused: null };
      for (const row of interactions) if (row.state === 'pending' && row.expiresAt < now) row.state = 'expired';
      const same = interactions.filter((row) => row.sessionId === data.sessionId && row.turnId === data.turnId);
      if (same.filter((row) => row.state === 'pending').length >= limits.pending) return { row: null, refused: 'pending' };
      if (same.length >= limits.perTurn) return { row: null, refused: 'turn' };
      const row = { id: interactionSequence += 1, state: 'pending', answer: null, createdAt: now, answeredAt: null, deliveredAt: null, ...data };
      interactions.push(row);
      return { row, refused: null };
    },
    getChatInteraction: async (id: number) => interactions.find((row) => row.id === id) ?? null,
    answerChatInteraction: async (id: number, answer: string, at: Date) => {
      const row = interactions.find((item) => item.id === id && item.state === 'pending' && item.expiresAt >= at);
      if (row) Object.assign(row, { state: 'answered', answer, answeredAt: at });
      return Boolean(row);
    },
    expireChatInteractions: async (sessionId: string | null, now: Date) => {
      writes.push('expire');
      for (const row of interactions) if ((sessionId === null || row.sessionId === sessionId) && row.state === 'pending' && row.expiresAt < now) row.state = 'expired';
    },
    cancelChatInteractions: async (sessionId: string, turnId: number | null) => {
      for (const row of interactions) if (row.sessionId === sessionId && row.state === 'pending' && (turnId === null || row.turnId === turnId)) row.state = 'cancelled';
    },
    cancelChatInteractionsByRequest: async (sessionId: string, turnId: number, requestIds: string[]) => {
      writes.push('cancel');
      for (const row of interactions) if (row.sessionId === sessionId && row.turnId === turnId && requestIds.includes(row.requestId) && row.state === 'pending') row.state = 'cancelled';
    },
    getPendingChatInteractions: async (sessionId: string, take: number, notBefore?: Date) => interactions
      .filter((row) => row.sessionId === sessionId && row.state === 'pending' && (!notBefore || row.expiresAt >= notBefore)).slice(0, take),
    getSettledChatInteractions: async (sessionId: string, turnId: number, take: number) => interactions
      .filter((row) => row.sessionId === sessionId && row.turnId === turnId && ['answered', 'expired', 'cancelled'].includes(row.state)).sort((a, b) => b.id - a.id).slice(0, take),
    hasOverdueChatInteractions: async (sessionId: string, now: Date) => interactions.some((row) => row.sessionId === sessionId && row.state === 'pending' && row.expiresAt < now),
    getStaleChatDrafts: async (before: Date) => messages.filter((message) => message.state === 'draft' && message.at < before).map((message) => ({ id: message.id, sessionId: message.sessionId })),
    deleteChatDraft: async (id: number) => {
      const before = messages.length;
      messages = messages.filter((message) => !(message.id === id && message.state === 'draft'));
      return messages.length < before;
    },
    getUndeliveredChatInteractions: async (sessionId: string, turnId: number) => interactions
      .filter((row) => row.sessionId === sessionId && row.turnId === turnId && ['answered', 'expired'].includes(row.state) && !row.deliveredAt),
    markChatInteractionsDelivered: async (sessionId: string, turnId: number, ids: string[], at: Date) => {
      for (const row of interactions) if (row.sessionId === sessionId && row.turnId === turnId && ids.includes(row.requestId) && !row.deliveredAt) row.deliveredAt = at;
    },
    getWaitingChatSessionIds: async (ids: string[], now: Date) => new Set(interactions.filter((row) => ids.includes(row.sessionId) && row.state === 'pending' && row.expiresAt >= now).map((row) => row.sessionId)),
    pruneChatInteractions: async () => ({ expired: 0, evicted: 0 }),
    getChatMachineInfo: async (machine: string) => machineInfo.get(machine) ?? null,
    upsertChatMachineInfo: async (machine: string, data: any) => {
      writes.push('machine');
      machineInfo.set(machine, { machine, caps: '', catalog: '', catalogHash: '', ...machineInfo.get(machine), ...data });
    },
    countIngestTokens: async () => tokens.length,
    createIngestToken: async (data: any) => {
      const token = { id: String(sequence += 1), ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash) ?? null,
    touchIngestToken: async () => undefined,
  };
  return { storage: storage as unknown as StorageService, sessions, messages: () => messages, interactions: () => interactions, machineInfo, writes };
}

const attachmentsStub = (calls: string[] = [], overrides: Partial<Pick<ChatAttachmentService, 'openForBridge'>> = {}) => ({
  attach: async (_sessionId: string, _messageId: number, ids: string[]) => {
    if (ids.includes('bad')) throw new OrchestratorInputError('Unknown attachment');
    calls.push(`attach:${ids.join(',')}`);
    return ids.map((id) => ({ id, name: `${id}.png`, mime: 'image/png', size: 10, state: 'attached' }));
  },
  forMessages: async (ids: number[]) => new Map(ids.map((id): [number, Array<{ id: string; name: string; mime: string; size: number; state: string }>] => [id, []])),
  forClaim: async () => [{ id: 'a1', name: 'a1.png', mime: 'image/png', size: 10, sha256: 'f'.repeat(64) }],
  openForBridge: async () => null,
  deleteForSession: async (sessionId: string) => { calls.push(`delete:${sessionId}`); },
  prune: async () => { calls.push('prune'); },
  release: async (messageId: number) => { calls.push(`release:${messageId}`); },
  receive: async () => { throw new OrchestratorInputError('no upload'); },
  discard: async () => 'missing' as const,
  ...overrides,
});

function wrap(storage: StorageService, name: keyof StorageService, around: (original: (...args: unknown[]) => unknown, args: unknown[]) => unknown) {
  const record = storage as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = record[name];
  record[name] = (...args: unknown[]) => around((...next: unknown[]) => original.apply(storage, next), args);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
}

function setup() {
  const memory = memoryStorage();
  const clock = { at: NOW.getTime() };
  const advance = (ms: number) => { clock.at += ms; };
  const calls: string[] = [];
  const sleeps: number[] = [];
  const service = new ChatService(memory.storage, () => new Date(clock.at), async (ms) => { sleeps.push(ms); advance(ms); }, attachmentsStub(calls));
  return { ...memory, service, advance, calls, sleeps, now: () => new Date(clock.at) };
}

const CAPS = {
  v: 2, kit: '1.0.0', claude: '2.1.296',
  features: ['interactive', 'questions', 'plan', 'stop', 'attachments', 'commands', 'model', 'effort'],
  modes: ['default', 'acceptEdits', 'plan'], catalogHash: null,
};

const CATALOG = {
  hash: 'abc123',
  commands: [
    { name: 'review', description: 'Review a pull request', argumentHint: '[pr]', kind: 'skill' },
    { name: 'context', description: 'Show context usage', argumentHint: '', kind: 'builtin' },
    { name: 'init', description: 'Review the repo and write CLAUDE.md', argumentHint: '', kind: 'builtin' },
  ],
  models: [
    { value: 'sonnet', label: 'Sonnet', efforts: ['low', 'medium', 'high'], fast: false },
    { value: 'haiku', label: 'Haiku', efforts: [], fast: false },
  ],
  fast: { available: false, reason: 'extra_usage_disabled' },
};

async function takenTurn(ctx: ReturnType<typeof setup>, caps: object | null = CAPS) {
  const dock = await ctx.service.createSession({ title: 'Chat' });
  const sent = await ctx.service.sendMessage(dock.id, 'Run the tests', MACHINES);
  const claim = await ctx.service.claim({ wait: 0, ...(caps ? { caps } : {}) }, undefined, 'laptop');
  assert.strictEqual(claim.message?.id, sent.id);
  return { sessionId: dock.id, replyTo: sent.id };
}

const permissionAsk = (turn: { sessionId: string; replyTo: number }, requestId = 'req-1', overrides: object = {}) => ({
  ...turn, requestId, kind: 'permission', title: 'Run a command', ttlSeconds: 600,
  body: { tool: 'Bash', label: 'Bash', summary: 'npm test', detail: 'npm test', agent: null, alwaysLabel: 'Bash(npm test)' },
  ...overrides,
});

const questionAsk = (turn: { sessionId: string; replyTo: number }, requestId = 'req-q') => ({
  ...turn, requestId, kind: 'question', title: 'Pick one',
  body: { questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: 'file' }, { label: 'Postgres', description: 'server' }] }] },
});

test('the bridge capabilities are parsed, capped and ignored when they are not version 2', () => {
  assert.strictEqual(parseCaps(undefined), null);
  assert.strictEqual(parseCaps({ ...CAPS, v: 1 }), null);
  const caps = parseCaps({ ...CAPS, kit: 'k'.repeat(60), features: ['stop', 'stop', 'teleport', 'fast'], modes: ['plan', 'bypassPermissions', 'auto', 'dontAsk', 'default'], catalogHash: 'not a hash!' });
  assert.deepStrictEqual(
    [caps?.kit.length, caps?.features, caps?.modes, caps?.catalogHash],
    [40, ['stop', 'fast'], ['plan', 'auto', 'default'], null],
  );
  assert.strictEqual(parseCaps({ ...CAPS, features: Array.from({ length: 40 }, () => 'stop') })?.features.length, 1);
});

test('wait and ask bodies are validated, masked and capped', () => {
  const wait = parseWait({ sessionId: 's1', replyTo: 4, wait: 25, ack: ['a', 'b'], caps: CAPS });
  assert.deepStrictEqual([wait.sessionId, wait.replyTo, wait.wait, wait.ack, wait.caps?.v], ['s1', 4, 25, ['a', 'b'], 2]);
  assert.strictEqual(parseWait({ sessionId: 's1', replyTo: 4 }).wait, 0);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, wait: 26 }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, ack: Array.from({ length: 21 }, (_, i) => `r${i}`) }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, ack: ['has space'] }), OrchestratorInputError);
  assert.deepStrictEqual(parseWait({ sessionId: 's1', replyTo: 4 }).cancelled, []);
  assert.deepStrictEqual(parseWait({ sessionId: 's1', replyTo: 4, cancelled: ['a', 'b'] }).cancelled, ['a', 'b']);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, cancelled: Array.from({ length: 21 }, (_, i) => `r${i}`) }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, cancelled: ['ok', 7] }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, cancelled: ['has space'] }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 4, cancelled: 'req-1' }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: '../x', replyTo: 4 }), OrchestratorInputError);
  assert.throws(() => parseWait({ sessionId: 's1', replyTo: 0 }), OrchestratorInputError);

  const base = permissionAsk({ sessionId: 's1', replyTo: 4 });
  const ask = parseAsk({ ...base, ttlSeconds: 5 }, NOW);
  assert.strictEqual(ask.expiresAt.getTime() - NOW.getTime(), ASK_TTL_SECONDS.min * 1000, 'ttl is clamped up');
  assert.strictEqual(parseAsk({ ...base, ttlSeconds: 99999 }, NOW).expiresAt.getTime() - NOW.getTime(), ASK_TTL_SECONDS.max * 1000);
  assert.strictEqual(parseAsk({ ...base, ttlSeconds: undefined }, NOW).expiresAt.getTime() - NOW.getTime(), ASK_TTL_SECONDS.fallback * 1000);
  assert.throws(() => parseAsk({ ...base, kind: 'other' }, NOW), OrchestratorInputError);
  assert.throws(() => parseAsk({ ...base, requestId: 'a b' }, NOW), OrchestratorInputError);
  assert.throws(() => parseAsk({ ...base, body: null }, NOW), OrchestratorInputError);

  const masked = parseAsk({ ...base, title: 'x'.repeat(300), body: { ...base.body, summary: 'curl -H "Authorization: Bearer abcdefghij1234567890"', detail: 'token=supersecretvalue1 '.repeat(2) + 'd'.repeat(5000) } }, NOW);
  const body = JSON.parse(masked.body);
  assert.strictEqual(masked.title.length, 120);
  assert.ok(!masked.body.includes('abcdefghij1234567890') && !masked.body.includes('supersecretvalue1'), 'the second masking pass runs on every string');
  assert.strictEqual(body.detail.length, 2000);

  const questions = (count: number, options = 2) => ({
    ...questionAsk({ sessionId: 's1', replyTo: 4 }),
    body: { questions: Array.from({ length: count }, () => ({ question: 'q', header: 'h', multiSelect: false, options: Array.from({ length: options }, (_, i) => ({ label: `o${i}`, description: 'd' })) })) },
  });
  assert.strictEqual(JSON.parse(parseAsk(questions(4, 4), NOW).body).questions.length, 4);
  assert.throws(() => parseAsk(questions(5), NOW), OrchestratorInputError);
  assert.throws(() => parseAsk(questions(1, 5), NOW), OrchestratorInputError);
  assert.throws(() => parseAsk(questions(0), NOW), OrchestratorInputError);
  assert.throws(
    () => parseAsk({ ...base, body: { ...base.body, detail: 'x', alwaysLabel: null, summary: 's', extra: 1 } , kind: 'plan' }, NOW),
    OrchestratorInputError,
    'a plan body needs planChars',
  );
  assert.strictEqual(JSON.parse(parseAsk({ ...base, kind: 'plan', body: { planChars: 1200 } }, NOW).body).planChars, 1200);
});

test('a body over 8 KB after masking is refused', () => {
  const fat = (n: number) => ({
    ...questionAsk({ sessionId: 's1', replyTo: 4 }),
    body: { questions: Array.from({ length: 4 }, () => ({ question: 'q'.repeat(n), header: 'h', multiSelect: false, options: Array.from({ length: 4 }, (_, index) => ({ label: `l${index}`, description: 'd'.repeat(200) })) })) },
  });
  assert.doesNotThrow(() => parseAsk(fat(300), NOW));
  assert.throws(() => parseAsk({
    ...permissionAsk({ sessionId: 's1', replyTo: 4 }),
    kind: 'question',
    body: { questions: Array.from({ length: 4 }, () => ({ question: 'é'.repeat(300), header: 'é'.repeat(40), multiSelect: true, options: Array.from({ length: 4 }, () => ({ label: 'é'.repeat(80), description: 'é'.repeat(200) })) })) },
  }, NOW), OrchestratorInputError);
});

test('the catalogue is parsed with its caps and searched by name first, then description', () => {
  const catalog = parseCatalog({
    ...CATALOG,
    commands: [...CATALOG.commands, { name: 'n'.repeat(100), description: 'd'.repeat(200), argumentHint: 'h'.repeat(100), kind: 'weird' }, null, { name: '' }],
  });
  assert.strictEqual(catalog.commands.length, 4);
  assert.deepStrictEqual([catalog.commands[3].name.length, catalog.commands[3].description.length, catalog.commands[3].argumentHint.length, catalog.commands[3].kind], [64, 100, 60, 'builtin']);
  assert.throws(() => parseCatalog({ ...CATALOG, commands: Array.from({ length: 2001 }, () => CATALOG.commands[0]) }), OrchestratorInputError);
  assert.throws(() => parseCatalog({ ...CATALOG, models: Array.from({ length: 41 }, () => CATALOG.models[0]) }), OrchestratorInputError);
  assert.throws(() => parseCatalog({ ...CATALOG, hash: 'no spaces' }), OrchestratorInputError);
  assert.throws(() => parseCatalog({ ...CATALOG, commands: Array.from({ length: 2000 }, (_, i) => ({ name: `c${i}`.padEnd(64, 'x'), description: 'd'.repeat(100), argumentHint: 'h'.repeat(60), kind: 'skill' })), models: [] }).commands.length === 0, OrchestratorInputError, 'over 300 KB');
  assert.deepStrictEqual(searchCommands(catalog.commands, 'review', null).map((command) => command.name), ['review', 'init']);
  assert.deepStrictEqual(searchCommands(catalog.commands, 'REV', 1).map((command) => command.name), ['review']);
  assert.strictEqual(searchCommands(catalog.commands, '', 2).length, 2);
  const named = (names: string[]) => names.map((name) => ({ ...CATALOG.commands[0], kind: 'skill' as const, name, description: name === 'zeta' ? 'shows context' : '' }));
  assert.deepStrictEqual(
    searchCommands(named(['audit-context-building', 'c4-context', 'zeta', 'xcontext', 'context', 'context-pack']), 'contex', null).map((command) => command.name),
    ['context', 'context-pack', 'audit-context-building', 'c4-context', 'xcontext', 'zeta'],
  );
  assert.deepStrictEqual(searchCommands(named(['b-ctx', 'a-ctx', 'ctx']), 'ctx', 2).map((command) => command.name), ['ctx', 'b-ctx'], 'stable inside a rank and still limited');
  assert.strictEqual(searchCommands(Array.from({ length: 80 }, (_, i) => ({ ...CATALOG.commands[0], kind: 'skill' as const, name: `c${i}` })), '', 500).length, 50);
});

test('turn options are parsed and checked against the machine capabilities and catalogue', async () => {
  assert.strictEqual(parseTurnOptions(null), null);
  assert.strictEqual(parseTurnOptions({ model: '', effort: null }), null);
  assert.throws(() => parseTurnOptions({ model: '--dangerously-skip-permissions' }), OrchestratorInputError);
  assert.throws(() => parseTurnOptions({ permissionMode: 'bypassPermissions' }), OrchestratorInputError);
  assert.throws(() => parseTurnOptions({ fast: 'yes' }), OrchestratorInputError);

  const ctx = setup();
  const dock = await ctx.service.createSession({ title: 'Options' });
  await takenTurn(ctx);
  await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123' } }, undefined, 'laptop');
  await ctx.service.ingestCatalog(CATALOG, 'laptop');

  const second = await ctx.service.createSession({ title: 'Second' });
  await assert.rejects(ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { model: 'opus' } }), /not offered/, 'a model outside the catalogue');
  await assert.rejects(ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { model: 'sonnet', effort: 'xhigh' } }), /effort/);
  await assert.rejects(ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { model: 'haiku', effort: 'low' } }), /effort/, 'haiku lists no efforts');
  await assert.rejects(ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { fast: true } }), /fast/, 'no fast capability');
  await assert.rejects(ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { permissionMode: 'auto' } }), /permission mode/, 'a bridge that does not offer auto');
  await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123', modes: [...CAPS.modes, 'auto'] } }, undefined, 'laptop');
  const cron = await ctx.service.createSession({ title: 'Cron' });
  const auto = await ctx.service.sendMessage(cron.id, 'build', MACHINES, { options: { permissionMode: 'auto' } });
  assert.strictEqual(JSON.parse(ctx.messages().find((message) => message.id === auto.id).options).permissionMode, 'auto', 'the cron starts tickets in auto mode');
  const sent = await ctx.service.sendMessage(second.id, 'hi', MACHINES, { options: { model: 'sonnet', effort: 'high', permissionMode: 'plan' } });
  assert.deepStrictEqual(JSON.parse(ctx.messages().find((message) => message.id === sent.id).options), { model: 'sonnet', effort: 'high', permissionMode: 'plan', fast: null });
  assert.deepStrictEqual(JSON.parse(ctx.sessions.get(second.id).options), { model: null, effort: null, permissionMode: 'auto', fast: null }, 'a choice sent with one message is not written to the session');
  assert.deepStrictEqual((await ctx.service.session(second.id))?.options, { model: null, effort: null, permissionMode: 'auto', fast: null });
  assert.deepStrictEqual((await ctx.service.session(dock.id))?.options, { model: null, effort: null, permissionMode: 'auto', fast: null }, 'a new DOCK session starts in auto mode');

  const noCaps = setup();
  const lone = await noCaps.service.createSession({ title: 'Old bridge', machine: 'workspace' });
  await assert.rejects(noCaps.service.sendMessage(lone.id, 'hi', MACHINES, { options: { permissionMode: 'plan' } }), OrchestratorInputError);
  await assert.rejects(noCaps.service.sendMessage(lone.id, '', MACHINES, { attachmentIds: ['a1'] }), /attachments/);
  const plain = await noCaps.service.sendMessage(lone.id, 'hi', MACHINES, { options: { model: null } });
  assert.strictEqual(noCaps.messages().find((message) => message.id === plain.id).options, null);
});

test('text may be empty when attachments are attached; a bad attachment id leaves no message', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.delta({ ...turn, done: true }, 'laptop');
  const dock = await ctx.service.createSession({ title: 'Files' });
  await assert.rejects(ctx.service.sendMessage(dock.id, '   ', MACHINES, { attachmentIds: [] }), OrchestratorInputError);
  await assert.rejects(ctx.service.sendMessage(dock.id, '', MACHINES, { attachmentIds: ['bad'] }), /Unknown attachment/);
  assert.strictEqual(ctx.messages().filter((message) => message.sessionId === dock.id).length, 0, 'the half-sent message is removed');
  assert.strictEqual(await ctx.storage.countChatMessagesInState(dock.id, ['queued', 'taken', 'draft']), 0);
  const sent = await ctx.service.sendMessage(dock.id, '', MACHINES, { attachmentIds: ['a1', 'a2'] });
  assert.deepStrictEqual([sent.text, sent.state], ['', 'queued']);
  assert.deepStrictEqual((sent as unknown as { attachments: Array<{ id: string }> }).attachments.map((item) => item.id), ['a1', 'a2']);
  const claim = await ctx.service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  assert.deepStrictEqual((claim.message as unknown as { attachments: Array<{ id: string }> }).attachments.map((item) => item.id), ['a1']);
});

test('the claim carries attachments and options only to a bridge that sent capabilities, and asks for the catalogue by hash', async () => {
  const old = setup();
  const oldDock = await old.service.createSession({ title: 'Old' });
  const oldSent = await old.service.sendMessage(oldDock.id, 'Hello', MACHINES);
  assert.deepStrictEqual(
    await old.service.claim({ wait: 0 }, undefined, 'laptop'),
    { message: { id: oldSent.id, sessionId: oldDock.id, text: 'Hello', claudeSessionId: null, forkFrom: null } },
  );
  assert.strictEqual(old.machineInfo.size, 0, 'an old bridge writes nothing');
  assert.deepStrictEqual(old.calls, []);

  const ctx = setup();
  const dock = await ctx.service.createSession({ title: 'New' });
  const sent = await ctx.service.sendMessage(dock.id, 'Hello', MACHINES);
  const first = await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123' } }, undefined, 'laptop');
  assert.deepStrictEqual(first.message, {
    id: sent.id, sessionId: dock.id, text: 'Hello', claudeSessionId: null, forkFrom: null,
    attachments: [{ id: 'a1', name: 'a1.png', mime: 'image/png', size: 10, sha256: 'f'.repeat(64) }], options: null,
  });
  assert.strictEqual((first as { wantCatalog?: boolean }).wantCatalog, true, 'the server holds no catalogue yet');
  assert.ok(ctx.calls.includes('prune'), 'attachment retention runs lazily from a claim');
  await ctx.service.ingestCatalog(CATALOG, 'laptop');
  assert.strictEqual((await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123' } }, undefined, 'laptop') as { wantCatalog?: boolean }).wantCatalog, undefined);
  assert.strictEqual((await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'newer' } }, undefined, 'laptop') as { wantCatalog?: boolean }).wantCatalog, true);
  assert.strictEqual((await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: null } }, undefined, 'laptop') as { wantCatalog?: boolean }).wantCatalog, undefined, 'a bridge without a catalogue has nothing to send');
  const writesBefore = ctx.writes.filter((item) => item === 'machine').length;
  await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: null } }, undefined, 'laptop');
  assert.strictEqual(ctx.writes.filter((item) => item === 'machine').length, writesBefore, 'unchanged capabilities are not written again');

  const machines = await ctx.service.machinesWithInfo(['laptop', 'workspace']);
  assert.deepStrictEqual(machines.map((machine) => [machine.name, machine.capabilities.length > 0, machine.claudeVersion]), [['laptop', true, '2.1.296'], ['workspace', false, null]]);
  assert.deepStrictEqual((await ctx.service.machineOptions('workspace', MACHINES)), null);
  const options = await ctx.service.machineOptions('laptop', MACHINES);
  assert.deepStrictEqual([options?.models.map((model) => model.value), options?.modes, options?.fastAvailable], [['sonnet', 'haiku'], ['default', 'acceptEdits', 'plan'], false]);
  assert.deepStrictEqual((await ctx.service.commands('laptop', 'review', null, MACHINES)).map((command) => command.name), ['review', 'init']);
  assert.deepStrictEqual(await ctx.service.commands('workspace', 'review', null, MACHINES), []);

  const replaced = { ...CATALOG, hash: 'second', commands: [CATALOG.commands[1]] };
  assert.deepStrictEqual(await ctx.service.ingestCatalog(replaced, 'laptop'), { hash: 'second' });
  assert.deepStrictEqual((await ctx.service.commands('laptop', null, null, MACHINES)).map((command) => command.name), ['context'], 'the cache follows the new hash');
});

test('an ask is stored once, capped at 4 pending and 100 per turn, and refused after the turn closed', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);

  assert.strictEqual(await ctx.service.ask({ ...permissionAsk(turn), sessionId: 'unknown-session' }, 'laptop'), null);
  assert.strictEqual(await ctx.service.ask(permissionAsk(turn), 'workspace'), null, 'another machine gets a 404');
  await assert.rejects(ctx.service.ask({ ...permissionAsk(turn), replyTo: 9999 }, 'laptop'), OrchestratorInputError);

  const first = await ctx.service.ask(permissionAsk(turn, 'req-1'), 'laptop');
  assert.deepStrictEqual([first?.closed, first?.expiresAt], [false, new Date(NOW.getTime() + 600_000).toISOString()]);
  const again = await ctx.service.ask(permissionAsk(turn, 'req-1', { title: 'changed' }), 'laptop');
  assert.strictEqual(again?.id, first?.id, 'the same request id is idempotent');
  assert.strictEqual(ctx.interactions().length, 1);

  for (const id of ['req-2', 'req-3', 'req-4']) await ctx.service.ask(permissionAsk(turn, id), 'laptop');
  await assert.rejects(ctx.service.ask(permissionAsk(turn, 'req-5'), 'laptop'), /pending/, 'a fifth pending ask is refused');
  assert.deepStrictEqual((await ctx.service.ask(permissionAsk(turn, 'req-4'), 'laptop'))?.closed, false, 'a repeat of a stored ask is still accepted');

  const session = await ctx.service.session(turn.sessionId);
  assert.strictEqual(session?.waiting, true);
  assert.strictEqual((await ctx.service.pending(turn.sessionId, 'running', 'laptop')).length, 4);
  assert.deepStrictEqual(await ctx.service.pending(turn.sessionId, 'idle', 'laptop'), []);

  for (let minute = 0; minute < 10; minute += 1) {
    ctx.advance(60_000);
    await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  }
  ctx.advance(1000);
  assert.strictEqual((await ctx.service.session(turn.sessionId))?.waiting, false, 'an overdue ask no longer makes the session wait');
  assert.deepStrictEqual(await ctx.service.pending(turn.sessionId, 'running', 'laptop'), []);
  assert.deepStrictEqual(ctx.interactions().map((row) => row.state), ['expired', 'expired', 'expired', 'expired']);

  for (let index = 5; index <= 100; index += 1) await ctx.service.ask(permissionAsk(turn, `req-${index}`, { ttlSeconds: 30 }), 'laptop').then(() => ctx.advance(31_000));
  assert.strictEqual(ctx.interactions().length, 100);
  await assert.rejects(ctx.service.ask(permissionAsk(turn, 'req-101'), 'laptop'), /too many|100/i, 'the 101st ask of a turn is refused');

  await ctx.service.delta({ ...turn, done: true }, 'laptop');
  const closed = await ctx.service.ask(permissionAsk(turn, 'req-late'), 'laptop');
  assert.strictEqual(closed?.closed, true);
  assert.strictEqual(ctx.interactions().length, 100, 'a closed turn writes nothing');
});

test('answers are checked against the stored ask before they are accepted', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  const permission = (await ctx.service.ask(permissionAsk(turn, 'req-p'), 'laptop'))!;
  const noRule = (await ctx.service.ask(permissionAsk(turn, 'req-n', { body: { tool: 'Write', label: 'Write', summary: 'a', detail: 'a', agent: null, alwaysLabel: null } }), 'laptop'))!;
  const question = (await ctx.service.ask(questionAsk(turn), 'laptop'))!;
  const plan = (await ctx.service.ask({ ...turn, requestId: 'req-plan', kind: 'plan', title: 'Plan ready', body: { planChars: 300 } }, 'laptop'))!;
  const answer = (id: number, decision: string, answers?: object[], note?: string) => ctx.service.answerInteraction(turn.sessionId, id, decision, answers as never, note);

  await assert.rejects(answer(9999, 'allow'), /Unknown/);
  await assert.rejects(ctx.service.answerInteraction('other-session', permission.id, 'allow', undefined, undefined), OrchestratorInputError, 'wrong session');
  await assert.rejects(answer(permission.id, 'approve'), /decision/);
  await assert.rejects(answer(permission.id, 'allow', undefined, 'n'.repeat(501)), /note/);
  await assert.rejects(answer(noRule.id, 'allow_session'), /session rule/);
  await assert.rejects(answer(question.id, 'allow'), /decision/);
  await assert.rejects(answer(question.id, 'answer', [{ index: 0, labels: ['MySQL'] }]), /options/);
  await assert.rejects(answer(question.id, 'answer', []), /Answer every/);
  await assert.rejects(answer(question.id, 'answer', [{ index: 3, labels: ['SQLite'] }]), /unknown question/);
  await assert.rejects(answer(question.id, 'answer', [{ index: 0, labels: ['SQLite', 'Postgres'] }]), /one answer/);
  await assert.rejects(answer(question.id, 'answer', [{ index: 0, labels: [], other: 'o'.repeat(501) }]), /other/);
  await assert.rejects(answer(plan.id, 'allow'), /decision/);

  const allowed = await answer(permission.id, 'allow_session', undefined, '  ok  ');
  assert.deepStrictEqual([allowed.state, allowed.id, allowed.kind, typeof allowed.body, allowed.answeredAt !== null], ['answered', permission.id, 'permission', 'string', true]);
  assert.deepStrictEqual(JSON.parse(ctx.interactions().find((row) => row.id === permission.id).answer), { decision: 'allow_session', note: 'ok' });
  await assert.rejects(answer(permission.id, 'deny'), /no longer pending/, 'an answered ask cannot be answered twice');

  const picked = await answer(question.id, 'answer', [{ index: 0, labels: [], other: 'DuckDB' }]);
  assert.strictEqual(picked.state, 'answered');
  assert.deepStrictEqual(JSON.parse(ctx.interactions().find((row) => row.id === question.id).answer), { decision: 'answer', answers: [{ index: 0, labels: [], other: 'DuckDB' }] });
  assert.strictEqual((await answer(plan.id, 'reject', undefined, 'split it')).state, 'answered');

  const quick = (await ctx.service.ask(permissionAsk(turn, 'req-short', { ttlSeconds: 30 }), 'laptop'))!;
  ctx.advance(31_000);
  await assert.rejects(answer(quick.id, 'allow'), /expired/);
  assert.strictEqual(ctx.interactions().find((row) => row.id === quick.id).state, 'expired');
});

test('checkAnswer accepts a multi-select with labels and an Other text together', () => {
  const body = JSON.stringify({ questions: [{ question: 'q', header: 'h', multiSelect: true, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }] });
  assert.deepStrictEqual(
    checkAnswer({ kind: 'question', body }, 'answer', [{ index: 0, labels: ['a', 'b'], other: ' more ' }], null),
    { decision: 'answer', answers: [{ index: 0, labels: ['a', 'b'], other: 'more' }] },
  );
  assert.deepStrictEqual(checkAnswer({ kind: 'question', body }, 'deny', null, null), { decision: 'deny', answers: [] });
});

test('wait returns at once for an answer, an expiry or a closed turn, and acks mark delivery', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  const body = (extra: object = {}) => ({ ...turn, wait: 0, ...extra });

  assert.strictEqual(await ctx.service.wait({ ...body(), sessionId: 'unknown-session' }, undefined, 'laptop'), null);
  assert.strictEqual(await ctx.service.wait(body(), undefined, 'workspace'), null);
  assert.deepStrictEqual(await ctx.service.wait(body(), undefined, 'laptop'), { stop: false, answers: [], closed: false });

  const asked = (await ctx.service.ask(permissionAsk(turn, 'req-1'), 'laptop'))!;
  const short = (await ctx.service.ask(permissionAsk(turn, 'req-2', { ttlSeconds: 30 }), 'laptop'))!;
  assert.deepStrictEqual(await ctx.service.wait(body(), undefined, 'laptop'), { stop: false, answers: [], closed: false }, 'pending asks are not delivered');

  await ctx.service.answerInteraction(turn.sessionId, asked.id, 'allow', undefined, undefined);
  ctx.advance(31_000);
  const result = await ctx.service.wait(body(), undefined, 'laptop');
  assert.deepStrictEqual(result?.answers, [
    { requestId: 'req-1', kind: 'permission', state: 'answered', answer: { decision: 'allow', note: null } },
    { requestId: 'req-2', kind: 'permission', state: 'expired', answer: null },
  ]);
  assert.strictEqual(result?.closed, false);
  assert.strictEqual((await ctx.service.wait(body(), undefined, 'laptop'))?.answers.length, 2, 'an answer is returned until it is acked');
  assert.deepStrictEqual((await ctx.service.wait(body({ ack: ['req-1'] }), undefined, 'laptop'))?.answers.map((item) => item.requestId), ['req-2']);
  assert.deepStrictEqual((await ctx.service.wait(body({ ack: ['req-2', 'unknown-id'] }), undefined, 'laptop'))?.answers, []);
  assert.ok(ctx.interactions().every((row) => row.deliveredAt), 'acked rows carry deliveredAt');

  await ctx.service.delta({ ...turn, done: true }, 'laptop');
  assert.deepStrictEqual(await ctx.service.wait(body(), undefined, 'laptop'), { stop: false, answers: [], closed: true });
  assert.deepStrictEqual(await ctx.service.wait(body(), undefined, 'laptop'), { stop: false, answers: [], closed: true }, 'closed stays true');
});

test('an answer wakes a waiting wait without a poll tick, and a hang-up releases the waiter', async () => {
  const memory = memoryStorage();
  const clock = { at: NOW.getTime() };
  const sleeps: number[] = [];
  const parked = (_ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    sleeps.push(_ms);
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  const service = new ChatService(memory.storage, () => new Date(clock.at), parked, attachmentsStub());
  const dock = await service.createSession({ title: 'Wake' });
  const sent = await service.sendMessage(dock.id, 'go', MACHINES);
  await service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  sleeps.length = 0;
  const turn = { sessionId: dock.id, replyTo: sent.id };
  const ask = (await service.ask(permissionAsk(turn), 'laptop'))!;

  const waiting = service.wait({ ...turn, wait: 25 }, undefined, 'laptop');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.waiters(), 1);
  await service.answerInteraction(dock.id, ask.id, 'deny', undefined, 'no');
  const result = await waiting;
  assert.deepStrictEqual(result?.answers.map((item) => item.answer), [{ decision: 'deny', note: 'no' }]);
  assert.strictEqual(service.waiters(), 0, 'the waiter removed itself');
  assert.deepStrictEqual(sleeps, [25_000], 'one timer, no poll loop');

  const hangup = new AbortController();
  const hung = service.wait({ ...turn, wait: 25, ack: ['req-1'] }, hangup.signal, 'laptop');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.waiters(), 1);
  hangup.abort();
  await hung;
  assert.strictEqual(service.waiters(), 0, 'a closed connection frees its waiter');

  const stopping = service.wait({ ...turn, wait: 25 }, undefined, 'laptop');
  await new Promise((resolve) => setImmediate(resolve));
  await service.stopTurn(dock.id);
  assert.deepStrictEqual(await stopping, { stop: true, answers: [], closed: false });
  assert.strictEqual(service.waiters(), 0);

  const other = await service.createSession({ title: 'Closing' });
  const otherSent = await service.sendMessage(other.id, 'go', MACHINES);
  await service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const closing = service.wait({ sessionId: other.id, replyTo: otherSent.id, wait: 25 }, undefined, 'laptop');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(service.waiters(), 1);
  await service.delta({ sessionId: other.id, replyTo: otherSent.id, done: true, stopped: true }, 'laptop');
  assert.deepStrictEqual(await closing, { stop: false, answers: [], closed: true });
  assert.strictEqual(service.waiters(), 0);
});

test('the turn notifier wakes only its own turn and forgets released waiters', async () => {
  const notifier = new TurnNotifier();
  const controller = new AbortController();
  let woken = 0;
  const one = notifier.wait(1, controller.signal).then(() => { woken += 1; });
  const two = notifier.wait(2, controller.signal).then(() => { woken += 10; });
  assert.strictEqual(notifier.size(), 2);
  notifier.wake(1);
  await one;
  assert.deepStrictEqual([woken, notifier.size()], [1, 1]);
  controller.abort();
  await two;
  assert.deepStrictEqual([woken, notifier.size()], [11, 0]);
  const late = new AbortController();
  late.abort();
  await notifier.wait(3, late.signal);
  assert.strictEqual(notifier.size(), 0);
});

test('a cancelled ask leaves the pending list, cannot be answered, and only the ask of this turn and session is touched', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  const body = (extra: object = {}) => ({ ...turn, wait: 0, ...extra });
  const first = (await ctx.service.ask(permissionAsk(turn, 'req-1'), 'laptop'))!;
  const second = (await ctx.service.ask(permissionAsk(turn, 'req-2'), 'laptop'))!;
  const done = (await ctx.service.ask(permissionAsk(turn, 'req-3'), 'laptop'))!;
  await ctx.service.answerInteraction(turn.sessionId, done.id, 'allow', undefined, undefined);

  const quiet = ctx.writes.length;
  await ctx.service.wait(body(), undefined, 'laptop');
  await ctx.service.wait(body({ cancelled: [] }), undefined, 'laptop');
  assert.strictEqual(ctx.writes.filter((item) => item === 'cancel').length, 0, 'a wait without cancelled performs no cancel write');
  assert.strictEqual(ctx.writes.length, quiet);

  const otherSession = await ctx.service.createSession({ title: 'Other' });
  const otherSent = await ctx.service.sendMessage(otherSession.id, 'Other run', MACHINES);
  await ctx.service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const other = { sessionId: otherSession.id, replyTo: otherSent.id };
  await ctx.service.ask(permissionAsk(other, 'req-1'), 'laptop');
  await ctx.service.wait({ ...other, wait: 0, cancelled: ['req-2'] }, undefined, 'laptop');
  assert.deepStrictEqual(ctx.interactions().map((row) => row.state), ['pending', 'pending', 'answered', 'pending'], 'an id from another session matches nothing there');

  assert.strictEqual(await ctx.service.wait(body({ cancelled: ['req-1'] }), undefined, 'workspace'), null, 'another machine gets a 404');
  assert.strictEqual(ctx.interactions()[0].state, 'pending');

  await ctx.service.wait(body({ cancelled: ['req-1', 'req-3', 'unknown-id'] }), undefined, 'laptop');
  assert.deepStrictEqual(ctx.interactions().map((row) => row.state), ['cancelled', 'pending', 'answered', 'pending'], 'an answered ask and an unknown id change nothing');
  assert.deepStrictEqual((await ctx.service.pending(turn.sessionId, 'running', 'laptop')).map((item) => item.id), [second.id]);
  await assert.rejects(ctx.service.answerInteraction(turn.sessionId, first.id, 'allow', undefined, undefined), /no longer pending/);
});

test('wait touches lastDeltaAt at most every 20 seconds so a long ask does not look stale', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  const touched = () => (ctx.sessions.get(turn.sessionId).lastDeltaAt as Date).getTime() - NOW.getTime();
  assert.strictEqual(touched(), 0);
  ctx.advance(10_000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.strictEqual(touched(), 0, 'inside the throttle window');
  ctx.advance(11_000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.strictEqual(touched(), 21_000);
  assert.strictEqual(ctx.service.bridge('laptop').online, true);
});

test('stop: a taken turn is flagged and woken, a queued one fails at once, an idle one is a no-op', async () => {
  const ctx = setup();
  await assert.rejects(ctx.service.stopTurn('unknown-session'), OrchestratorInputError);
  const dock = await ctx.service.createSession({ title: 'Stop' });
  assert.strictEqual((await ctx.service.stopTurn(dock.id)).status, 'idle', 'idle is a no-op');

  const queued = await ctx.service.sendMessage(dock.id, 'never started', MACHINES);
  const stoppedQueued = await ctx.service.stopTurn(dock.id);
  assert.deepStrictEqual([stoppedQueued.status, stoppedQueued.statusDetail], ['idle', 'Stopped before it started']);
  assert.strictEqual(ctx.messages().find((message) => message.id === queued.id).state, 'failed');
  assert.deepStrictEqual((await ctx.service.claim({ wait: 0 }, undefined, 'laptop')).message, null);

  const turn = await takenTurn(ctx);
  const stoppedTaken = await ctx.service.stopTurn(turn.sessionId);
  assert.strictEqual(stoppedTaken.status, 'running', 'the session stays running until the bridge confirms');
  assert.ok(ctx.messages().find((message) => message.id === turn.replyTo).stopRequestedAt);
  assert.deepStrictEqual((await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop')), { stop: true, answers: [], closed: false });
  assert.deepStrictEqual((await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop')), { stop: true, answers: [], closed: false }, 'stop is kept until the turn ends');

  const final = await ctx.service.delta({ ...turn, done: true, stopped: true }, 'laptop');
  assert.strictEqual(final?.status, 'idle');
  assert.strictEqual(ctx.sessions.get(turn.sessionId).statusDetail, 'Stopped');
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'done');
  assert.deepStrictEqual((await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop')), { stop: true, answers: [], closed: true });
});

test('a turn that leaves taken cancels its pending asks, whether it finished, failed, or was given up', async () => {
  const done = setup();
  const doneTurn = await takenTurn(done);
  await done.service.ask(permissionAsk(doneTurn, 'a'), 'laptop');
  await done.service.delta({ ...doneTurn, done: true }, 'laptop');
  assert.deepStrictEqual(done.interactions().map((row) => row.state), ['cancelled']);

  const failed = setup();
  const failedTurn = await takenTurn(failed);
  await failed.service.ask(permissionAsk(failedTurn, 'a'), 'laptop');
  await failed.service.delta({ ...failedTurn, error: 'boom' }, 'laptop');
  assert.deepStrictEqual(failed.interactions().map((row) => row.state), ['cancelled']);

  const stale = setup();
  const staleTurn = await takenTurn(stale);
  await stale.service.ask(permissionAsk(staleTurn, 'a', { ttlSeconds: 1800 }), 'laptop');
  stale.advance(STALE_TAKEN_MS + 1000);
  assert.strictEqual((await stale.service.session(staleTurn.sessionId))?.status, 'error');
  assert.deepStrictEqual(stale.interactions().map((row) => row.state), ['cancelled']);

  const removed = setup();
  const removedTurn = await takenTurn(removed);
  await removed.service.ask(permissionAsk(removedTurn, 'a'), 'laptop');
  assert.strictEqual(await removed.service.deleteSession(removedTurn.sessionId), true);
  assert.deepStrictEqual(removed.interactions(), []);
  assert.deepStrictEqual(removed.calls.filter((call) => call !== 'prune'), ['delete:' + removedTurn.sessionId], 'attachments of the session are removed with it');
});

test('a turn taken 90 minutes ago is failed even while the bridge keeps waiting on the phone', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.ask(permissionAsk(turn, 'a', { ttlSeconds: 1800 }), 'laptop');
  for (let minute = 0; minute < 89; minute += 1) {
    ctx.advance(60_000);
    await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  }
  assert.strictEqual((await ctx.service.session(turn.sessionId))?.status, 'running', 'still inside the cap');
  ctx.advance(TAKEN_HARD_MS - 89 * 60_000 + 1000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  const session = await ctx.service.session(turn.sessionId);
  assert.deepStrictEqual([session?.status, session?.statusDetail], ['error', 'The turn ran too long']);
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'failed');
  assert.strictEqual((await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop'))?.closed, true);

  const legacy = setup();
  const dock = await legacy.service.createSession({ title: 'Old row' });
  await legacy.storage.createChatMessage({ sessionId: dock.id, role: 'user', text: 'x', state: 'taken', at: legacy.now() });
  await legacy.storage.updateChatSession(dock.id, { status: 'running', lastDeltaAt: legacy.now() });
  legacy.advance(TAKEN_HARD_MS + 60_000);
  await legacy.storage.updateChatSession(dock.id, { lastDeltaAt: legacy.now() });
  assert.strictEqual((await legacy.service.session(dock.id))?.status, 'running', 'a row with no takenAt is skipped by the hard cap');
});

test('a taken turn whose bridge goes silent ends as an error in two minutes, unless it waits on the phone', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  ctx.advance(SILENT_TAKEN_MS - 1000);
  assert.strictEqual((await ctx.service.session(turn.sessionId))?.status, 'running');
  ctx.advance(2000);
  const session = await ctx.service.session(turn.sessionId);
  assert.deepStrictEqual([session?.status, session?.statusDetail], ['error', SILENT_TEXT]);
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'failed');
  const late = await ctx.service.delta({ ...turn, items: [{ role: 'assistant', text: 'late', at: ctx.now().toISOString() }], done: true }, 'laptop');
  assert.strictEqual(late?.status, 'error', 'a late delta does not revive the turn');
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'failed');
  await ctx.service.sendMessage(turn.sessionId, 'again', MACHINES);
  assert.strictEqual((await ctx.service.session(turn.sessionId))?.status, 'queued');

  const asking = setup();
  const askTurn = await takenTurn(asking);
  await asking.service.ask(permissionAsk(askTurn, 'a', { ttlSeconds: 1800 }), 'laptop');
  asking.advance(SILENT_TAKEN_MS + 60_000);
  const waiting = await asking.service.session(askTurn.sessionId);
  assert.deepStrictEqual([waiting?.status, waiting?.waiting], ['running', true]);

  const polling = setup();
  const pollTurn = await takenTurn(polling);
  for (let step = 0; step < 10; step += 1) {
    polling.advance(60_000);
    await polling.service.wait({ ...pollTurn, wait: 0 }, undefined, 'laptop');
  }
  assert.strictEqual((await polling.service.session(pollTurn.sessionId))?.status, 'running', 'waits count as talking');

  const legacy = setup();
  const legacyTurn = await takenTurn(legacy, null);
  legacy.advance(SILENT_TAKEN_MS * 3);
  assert.strictEqual((await legacy.service.session(legacyTurn.sessionId))?.status, 'running', 'a bridge without capabilities keeps the old 15 minute rule');
  legacy.advance(STALE_TAKEN_MS);
  assert.strictEqual((await legacy.service.session(legacyTurn.sessionId))?.status, 'error');
});

test('a stop the bridge never acknowledges ends the turn as stopped, even across a restart', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.stopTurn(turn.sessionId);
  ctx.advance(STOP_GRACE_MS - 1000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.strictEqual((await ctx.service.session(turn.sessionId))?.status, 'running');
  ctx.advance(2000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  const restarted = new ChatService(ctx.storage, () => ctx.now(), undefined, attachmentsStub());
  const session = await restarted.session(turn.sessionId);
  assert.deepStrictEqual([session?.status, session?.statusDetail], ['idle', 'Stopped']);
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'done');
  assert.strictEqual((await restarted.wait({ ...turn, wait: 0 }, undefined, 'laptop'))?.closed, true);
  const late = await restarted.delta({ ...turn, items: [], done: true, error: 'late' }, 'laptop');
  assert.strictEqual(late?.status, 'idle', 'a late delta does not revive the turn');
  await restarted.sendMessage(turn.sessionId, 'next', MACHINES);

  const legacy = setup();
  const legacyTurn = await takenTurn(legacy, null);
  await legacy.service.stopTurn(legacyTurn.sessionId);
  legacy.advance(STOP_GRACE_MS * 2);
  assert.strictEqual((await legacy.service.session(legacyTurn.sessionId))?.status, 'running');
});

test('the session lists the recently settled asks of the running turn with the stored outcome', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  assert.deepStrictEqual(await ctx.service.settled(turn.sessionId, 'running', 'laptop'), []);
  for (const id of ['a', 'b', 'c']) await ctx.service.ask(permissionAsk(turn, id), 'laptop');
  const [first, second] = ctx.interactions();
  await ctx.service.answerInteraction(turn.sessionId, first.id, 'allow_session', null, null);
  await ctx.service.answerInteraction(turn.sessionId, second.id, 'deny', null, null);
  ctx.advance(601_000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  const settled = await ctx.service.settled(turn.sessionId, 'running', 'laptop');
  assert.deepStrictEqual(settled.map((item) => [item.state, item.decision]).sort(), [['answered', 'allow_session'], ['answered', 'deny'], ['expired', null]].sort());
  assert.deepStrictEqual(await ctx.service.settled(turn.sessionId, 'idle', 'laptop'), []);
  assert.deepStrictEqual(await ctx.service.settled(turn.sessionId, 'running', 'workspace'), []);
  for (let index = 0; index < 8; index += 1) await ctx.service.ask(permissionAsk(turn, `m${index}`, { ttlSeconds: 30 }), 'laptop').then(() => ctx.advance(31_000));
  assert.ok((await ctx.service.settled(turn.sessionId, 'running', 'laptop')).length <= 5);
  await ctx.service.stopTurn(turn.sessionId);
  const messages = await ctx.service.messages(turn.sessionId);
  assert.strictEqual(messages.find((message) => message.id === turn.replyTo)?.stopped, true);
});

test('the ingest routes for wait, ask and catalog share the token, 404 and 400 conventions', async (t) => {
  const memory = memoryStorage();
  const orchestrator = new OrchestratorService(memory.storage, os.tmpdir());
  const chat = new ChatService(memory.storage, () => new Date(), undefined, attachmentsStub());
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(10, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { token } = await orchestrator.createToken('laptop');
  const post = (route: string, body: unknown, bearer: string | null = token) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/chat/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body),
  });

  for (const route of ['wait', 'ask', 'catalog', 'attachment']) assert.strictEqual((await post(route, {}, null)).status, 401, `${route} needs a token`);

  const dock = await chat.createSession({ title: 'Routes' });
  const sent = await chat.sendMessage(dock.id, 'go', ['laptop']);
  await chat.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const turn = { sessionId: dock.id, replyTo: sent.id };

  const missing = await post('wait', { ...turn, sessionId: 'unknown-session' });
  assert.deepStrictEqual([missing.status, (await missing.json()).error], [404, 'Unknown ticket. Send its status first.']);
  assert.strictEqual((await post('wait', { ...turn, wait: 99 })).status, 400);
  const waited = await post('wait', { ...turn, wait: 0, caps: CAPS });
  assert.deepStrictEqual(await waited.json(), { ok: true, result: { stop: false, answers: [], closed: false } });

  const asked = await post('ask', permissionAsk(turn));
  assert.strictEqual(asked.status, 200);
  const askedBody = await asked.json();
  assert.deepStrictEqual([askedBody.ok, askedBody.result.closed, typeof askedBody.result.id], [true, false, 'number']);
  assert.strictEqual((await post('ask', { ...permissionAsk(turn), kind: 'nope' })).status, 400);

  const catalog = await post('catalog', CATALOG);
  assert.deepStrictEqual(await catalog.json(), { ok: true, result: { hash: 'abc123' } });
  assert.strictEqual((await post('catalog', { ...CATALOG, hash: 'bad hash' })).status, 400);
  assert.strictEqual((await post('attachment', { ...turn, id: 'nope' })).status, 404);
});

test('the thread poll writes nothing in the steady state and expires only an overdue ask', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.ask(permissionAsk(turn), 'laptop');
  ctx.writes.length = 0;
  for (let index = 0; index < 5; index += 1) {
    assert.strictEqual((await ctx.service.pending(turn.sessionId, 'running', 'laptop')).length, 1);
    await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  }
  assert.deepStrictEqual(ctx.writes, [], 'a poll with nothing overdue is a pure read');
  ctx.advance(601_000);
  assert.deepStrictEqual(await ctx.service.pending(turn.sessionId, 'running', 'laptop'), []);
  assert.deepStrictEqual(ctx.writes, ['expire']);
  await ctx.service.pending(turn.sessionId, 'running', 'laptop');
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.deepStrictEqual(ctx.writes, ['expire'], 'one write for the overdue row, none after it');
});

test('a machine without the interactive capability is neither read nor written for asks', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx, null);
  let reads = 0;
  wrap(ctx.storage, 'getPendingChatInteractions', (original, args) => {
    reads += 1;
    return original(...args);
  });
  assert.deepStrictEqual(await ctx.service.pending(turn.sessionId, 'running', 'laptop'), []);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  ctx.advance(601_000);
  await ctx.service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.strictEqual(reads, 0);
  assert.deepStrictEqual(ctx.writes, []);
});

test('a failing read of the pending asks gives an empty list instead of a database error', async (t) => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  t.mock.method(console, 'error', () => undefined);
  wrap(ctx.storage, 'getPendingChatInteractions', () => {
    throw new Error('Invalid `prisma.chatInteraction.findMany()` invocation in E:/data/dock.db');
  });
  assert.deepStrictEqual(await ctx.service.pending(turn.sessionId, 'running', 'laptop'), []);
});

test('a draft left by a failed move is removed with its files released, and a stale draft is swept', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.delta({ ...turn, done: true }, 'laptop');
  const dock = await ctx.service.createSession({ title: 'Draft' });
  const mine = () => ctx.messages().filter((message) => message.sessionId === dock.id);

  wrap(ctx.storage, 'moveChatMessage', (original, args) => {
    if (args[2] === 'draft') throw new Error('database is locked');
    return original(...args);
  });
  await assert.rejects(ctx.service.sendMessage(dock.id, 'see', MACHINES, { attachmentIds: ['a1'] }), /database is locked/);
  assert.strictEqual(mine().length, 0);
  assert.strictEqual(ctx.calls.filter((call) => call.startsWith('release:')).length, 1);

  wrap(ctx.storage, 'moveChatMessage', (original, args) => (args[2] === 'draft' ? false : original(...args)));
  await assert.rejects(ctx.service.sendMessage(dock.id, 'see', MACHINES, { attachmentIds: ['a1'] }), /could not be sent/);
  assert.strictEqual(mine().length, 0);
  assert.strictEqual(ctx.calls.filter((call) => call.startsWith('release:')).length, 2);

  const draft = await ctx.storage.createChatMessage({ sessionId: dock.id, role: 'user', text: 'half', state: 'draft', at: ctx.now() });
  await assert.rejects(ctx.service.sendMessage(dock.id, 'again', MACHINES), /still working/, 'a draft counts as work in progress');
  ctx.advance(DRAFT_MAX_MS - 1000);
  await ctx.service.session(dock.id);
  assert.strictEqual(mine().length, 1, 'a young draft is left alone');
  ctx.advance(2000);
  await ctx.service.session(dock.id);
  assert.strictEqual(mine().length, 0);
  assert.ok(ctx.calls.includes(`release:${draft.id}`));
});

test('the turn is closed when the session update fails after the message left taken, and on a retried delta', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  await ctx.service.ask(permissionAsk(turn, 'a'), 'laptop');
  wrap(ctx.storage, 'updateChatSession', (original, args) => {
    if ((args[1] as { status?: string }).status === 'idle') throw new Error('database is locked');
    return original(...args);
  });
  await assert.rejects(ctx.service.delta({ ...turn, done: true }, 'laptop'), /database is locked/);
  assert.deepStrictEqual(ctx.interactions().map((row) => row.state), ['cancelled']);
  assert.strictEqual(ctx.messages().find((message) => message.id === turn.replyTo).state, 'done');

  const retry = setup();
  const retryTurn = await takenTurn(retry);
  await retry.service.ask(permissionAsk(retryTurn, 'a'), 'laptop');
  await retry.storage.moveChatMessage(retryTurn.replyTo, retryTurn.sessionId, 'taken', 'done');
  assert.deepStrictEqual(retry.interactions().map((row) => row.state), ['pending']);
  await retry.service.delta({ ...retryTurn, done: true }, 'laptop');
  assert.deepStrictEqual(retry.interactions().map((row) => row.state), ['cancelled'], 'a delta of a closed turn still cancels its asks');
});

test('an answer to an ask of a closed turn is refused and the ask is cancelled', async () => {
  const ctx = setup();
  const turn = await takenTurn(ctx);
  const ask = (await ctx.service.ask(permissionAsk(turn, 'a'), 'laptop'))!;
  await ctx.storage.moveChatMessage(turn.replyTo, turn.sessionId, 'taken', 'done');
  await assert.rejects(ctx.service.answerInteraction(turn.sessionId, ask.id, 'allow', undefined, undefined), /no longer pending/);
  assert.deepStrictEqual(ctx.interactions().map((row) => row.state), ['cancelled']);
});

test('a claim without capabilities clears the stored ones and keeps the old response shape', async () => {
  const ctx = setup();
  await ctx.service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  assert.notStrictEqual(ctx.machineInfo.get('laptop').caps, '');
  assert.deepStrictEqual(await ctx.service.claim({ wait: 0 }, undefined, 'laptop'), { message: null });
  assert.strictEqual(ctx.machineInfo.get('laptop').caps, '');
  assert.deepStrictEqual((await ctx.service.machinesWithInfo(['laptop']))[0].capabilities, []);
  const dock = await ctx.service.createSession({ title: 'Old bridge' });
  await assert.rejects(ctx.service.sendMessage(dock.id, 'x', MACHINES, { attachmentIds: ['a1'] }), /cannot receive attachments/);
  await assert.rejects(ctx.service.sendMessage(dock.id, 'x', MACHINES, { options: { permissionMode: 'plan' } }), /permission mode/);
  const writes = ctx.writes.length;
  await ctx.service.claim({ wait: 0 }, undefined, 'laptop');
  assert.strictEqual(ctx.writes.length, writes, 'nothing is written once the caps are gone');

  const cold = new ChatService(ctx.storage, () => ctx.now(), undefined, attachmentsStub());
  assert.deepStrictEqual((await cold.machinesWithInfo(['laptop']))[0].capabilities, [], 'the stored caps are gone as well');
});

test('commands and options refuse a machine without an ingest token before reading anything', async () => {
  const ctx = setup();
  let reads = 0;
  wrap(ctx.storage, 'getChatMachineInfo', (original, args) => {
    reads += 1;
    return original(...args);
  });
  await assert.rejects(ctx.service.commands('ghost', 'x', null, MACHINES), /Unknown machine/);
  await assert.rejects(ctx.service.machineOptions('ghost', MACHINES), /Unknown machine/);
  assert.strictEqual(reads, 0);
});

test('the 90 minute cap applies only to a turn claimed with capabilities', async () => {
  const old = setup();
  const oldDock = await old.service.createSession({ title: 'Old bridge' });
  const oldSent = await old.service.sendMessage(oldDock.id, 'go', MACHINES);
  await old.service.claim({ wait: 0 }, undefined, 'laptop');
  assert.strictEqual(old.messages().find((message) => message.id === oldSent.id).takenAt, null);
  old.advance(TAKEN_HARD_MS + 60_000);
  await old.storage.updateChatSession(oldDock.id, { lastDeltaAt: old.now() });
  assert.strictEqual((await old.service.session(oldDock.id))?.status, 'running');

  const fresh = setup();
  const turn = await takenTurn(fresh);
  assert.ok(fresh.messages().find((message) => message.id === turn.replyTo).takenAt instanceof Date);
});

test('a second wait for the same turn ends the first, and a wait of 0 ends nothing', async () => {
  const memory = memoryStorage();
  const parked = (_ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  const service = new ChatService(memory.storage, () => NOW, parked, attachmentsStub());
  const dock = await service.createSession({ title: 'Waits' });
  const sent = await service.sendMessage(dock.id, 'go', MACHINES);
  await service.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const turn = { sessionId: dock.id, replyTo: sent.id };

  const first = service.wait({ ...turn, wait: 25 }, undefined, 'laptop');
  await tick();
  assert.strictEqual(service.waiters(), 1);
  const hangup = new AbortController();
  const second = service.wait({ ...turn, wait: 25 }, hangup.signal, 'laptop');
  await tick();
  assert.strictEqual(service.waiters(), 1, 'the first wait was released when the second arrived');
  assert.deepStrictEqual(await first, { stop: false, answers: [], closed: false });

  await service.wait({ ...turn, wait: 0 }, undefined, 'laptop');
  assert.strictEqual(service.waiters(), 1, 'a wait of 0 leaves the open wait alone');
  hangup.abort();
  await second;
  assert.strictEqual(service.waiters(), 0);
});

test('two options of one question cannot share a label', () => {
  const turn = { sessionId: 'dock-1', replyTo: 1 };
  const body = (labels: string[]) => ({
    questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: labels.map((label) => ({ label, description: '' })) }],
  });
  assert.throws(() => parseAsk({ ...questionAsk(turn), body: body(['A', 'A']) }, NOW), /different labels/);
  assert.doesNotThrow(() => parseAsk({ ...questionAsk(turn), body: body(['A', 'B']) }, NOW));
});

async function ingestEnv(t: TestContext, chat: ChatService, memory: ReturnType<typeof memoryStorage>) {
  const orchestrator = new OrchestratorService(memory.storage, os.tmpdir());
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(10, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const tokens = { laptop: (await orchestrator.createToken('laptop')).token, workspace: (await orchestrator.createToken('workspace', 'workspace')).token };
  const post = (route: string, body: unknown, machine: keyof typeof tokens = 'laptop') => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/chat/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[machine]}` }, body: JSON.stringify(body),
  });
  const open = (route: string, body: unknown, machine: keyof typeof tokens = 'laptop') => {
    const request = http.request({
      host: '127.0.0.1', port: address.port, method: 'POST', path: `/ingest/orchestrator/chat/${route}`, agent: false,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[machine]}` },
    });
    request.on('error', () => undefined);
    request.end(JSON.stringify(body));
    return request;
  };
  const raw = (route: string, body: Buffer | string, type: string, machine: keyof typeof tokens | null = 'laptop') => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/${route}`, {
    method: 'POST', headers: { 'content-type': type, ...(machine ? { authorization: `Bearer ${tokens[machine]}` } : {}) }, body: typeof body === 'string' ? body : new Uint8Array(body),
  });
  return { post, open, raw };
}

function realAttachments(dir: string, memory: ReturnType<typeof memoryStorage>) {
  const rows = new Map<string, { id: string; sessionId: string; messageId: number | null; name: string; mime: string; size: number; sha256: string; state: string; createdAt: Date; fetchedAt: Date | null }>();
  const store = {
    get: async (id: string) => rows.get(id) ?? null,
    update: async (id: string, data: object) => { Object.assign(rows.get(id) ?? {}, data); },
    forMessages: async () => [],
  } as unknown as ChatAttachmentStore;
  const lookup = {
    session: async (id: string) => memory.sessions.get(id) ?? null,
    message: async (id: number) => memory.messages().find((message) => message.id === id) ?? null,
  };
  return { rows, service: new ChatAttachmentService(store, lookup, { dir: () => dir }) };
}

const NO_ATTACHMENT_CAPS = { ...CAPS, features: CAPS.features.filter((feature) => feature !== 'attachments') };

test('wait, ask and attachment answer a token of another machine like a missing session', async (t) => {
  const memory = memoryStorage();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { rows, service } = realAttachments(dir, memory);
  const chat = new ChatService(memory.storage, undefined, undefined, service);
  const env = await ingestEnv(t, chat, memory);
  const dock = await chat.createSession({ title: 'Owner' });
  const sent = await chat.sendMessage(dock.id, 'go', MACHINES);
  await chat.claim({ wait: 0, caps: NO_ATTACHMENT_CAPS }, undefined, 'laptop');
  const turn = { sessionId: dock.id, replyTo: sent.id };
  const id = '00000000-0000-4000-8000-0000000000d1';
  writeFileSync(path.join(dir, id), 'payload');
  rows.set(id, { id, sessionId: dock.id, messageId: sent.id, name: 'a.txt', mime: 'text/plain', size: 7, sha256: 'f'.repeat(64), state: 'attached', createdAt: NOW, fetchedAt: null });

  const requests: Array<[string, object]> = [
    ['wait', { ...turn, wait: 0 }],
    ['ask', permissionAsk(turn)],
    ['attachment', { ...turn, id }],
  ];
  for (const [route, body] of requests) {
    const own = await env.post(route, body, 'laptop');
    assert.strictEqual(own.status, 200, `${route} works for the owner`);
    await own.arrayBuffer();
    const missing = await env.post(route, { ...body, sessionId: 'unknown-session' }, 'laptop');
    const foreign = await env.post(route, body, 'workspace');
    assert.deepStrictEqual([foreign.status, await foreign.json()], [404, await missing.json()], `${route} gives another machine the missing-session answer`);
  }
});

test('the attachment route streams the file with its headers and releases the stream when the bridge hangs up', async (t) => {
  const memory = memoryStorage();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { rows, service } = realAttachments(dir, memory);
  const chat = new ChatService(memory.storage, undefined, undefined, service);
  const env = await ingestEnv(t, chat, memory);
  const dock = await chat.createSession({ title: 'Stream' });
  const sent = await chat.sendMessage(dock.id, 'go', MACHINES);
  await chat.claim({ wait: 0, caps: NO_ATTACHMENT_CAPS }, undefined, 'laptop');
  const turn = { sessionId: dock.id, replyTo: sent.id };
  const add = (id: string, payload: Buffer) => {
    writeFileSync(path.join(dir, id), payload);
    rows.set(id, { id, sessionId: dock.id, messageId: sent.id, name: 'a.bin', mime: 'text/plain', size: payload.length, sha256: id.slice(-12).repeat(5).slice(0, 64), state: 'attached', createdAt: NOW, fetchedAt: null });
  };

  const small = '00000000-0000-4000-8000-0000000000e1';
  add(small, Buffer.from('hello attachment'));
  const reply = await env.post('attachment', { ...turn, id: small });
  assert.strictEqual(reply.status, 200);
  assert.strictEqual(reply.headers.get('content-type'), 'application/octet-stream');
  assert.strictEqual(reply.headers.get('content-length'), '16');
  assert.strictEqual(reply.headers.get('x-dock-sha256'), rows.get(small)?.sha256);
  assert.strictEqual(reply.headers.get('cache-control'), 'no-store');
  assert.strictEqual(Buffer.from(await reply.arrayBuffer()).toString('utf8'), 'hello attachment');
  assert.strictEqual(rows.get(small)?.state, 'fetched');

  const original = fs.createReadStream;
  const opened: fs.ReadStream[] = [];
  mock.method(fs, 'createReadStream', (...args: Parameters<typeof original>) => {
    const stream = original(...args);
    opened.push(stream);
    return stream;
  });
  t.after(() => mock.restoreAll());
  const big = '00000000-0000-4000-8000-0000000000e2';
  add(big, Buffer.alloc(48 * 1024 * 1024, 1));
  for (let round = 0; round < 3; round += 1) {
    await new Promise<void>((resolve) => {
      const request = env.open('attachment', { ...turn, id: big });
      request.on('response', (response) => {
        response.once('data', () => {
          request.destroy();
          resolve();
        });
      });
    });
  }
  await until(() => opened.every((stream) => stream.destroyed));
  assert.deepStrictEqual(opened.map((stream) => stream.destroyed), [true, true, true]);
});

test('a bridge that hangs up on /chat/wait releases its waiter', async (t) => {
  const memory = memoryStorage();
  const parked = (_ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  const chat = new ChatService(memory.storage, undefined, parked, attachmentsStub());
  const env = await ingestEnv(t, chat, memory);
  const dock = await chat.createSession({ title: 'Hang up' });
  const sent = await chat.sendMessage(dock.id, 'go', MACHINES);
  await chat.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const turn = { sessionId: dock.id, replyTo: sent.id };

  const request = env.open('wait', { ...turn, wait: 25 });
  await until(() => chat.waiters() === 1);
  assert.strictEqual(chat.waiters(), 1);
  request.destroy();
  await until(() => chat.waiters() === 0);
  assert.strictEqual(chat.waiters(), 0);

  const second = env.open('wait', { ...turn, wait: 25 });
  const third = env.open('wait', { ...turn, wait: 25 });
  await until(() => chat.waiters() === 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(chat.waiters(), 1, 'two open waits for one turn end up as one');
  second.destroy();
  third.destroy();
  await until(() => chat.waiters() === 0);
  assert.strictEqual(chat.waiters(), 0);
});

test('the catalogue carries the machine defaults, and a catalogue without them reads as no defaults', async () => {
  const none = { model: null, effort: null, permissionMode: null };
  assert.deepStrictEqual(parseCatalog(CATALOG).defaults, none);
  assert.deepStrictEqual(parseCatalog({ ...CATALOG, defaults: 'x' }).defaults, none);
  assert.deepStrictEqual(
    parseCatalog({ ...CATALOG, defaults: { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto' } }).defaults,
    { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto' },
  );
  assert.deepStrictEqual(
    parseCatalog({ ...CATALOG, defaults: { model: 'opus[1m]', effort: '--bad', permissionMode: 'two words' } }).defaults,
    { model: 'opus[1m]', effort: null, permissionMode: null },
    'only a short safe word is kept',
  );
  assert.deepStrictEqual(parseCatalog({ ...CATALOG, defaults: { model: 5, effort: null } }).defaults, none);

  const ctx = setup();
  assert.strictEqual(await ctx.service.machineOptions('laptop', MACHINES), null);
  await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123' } }, undefined, 'laptop');
  await ctx.service.ingestCatalog({ ...CATALOG, defaults: { model: 'sonnet', effort: 'high', permissionMode: 'default' } }, 'laptop');
  assert.deepStrictEqual((await ctx.service.machineOptions('laptop', MACHINES))?.defaults, { model: 'sonnet', effort: 'high', permissionMode: 'default' });
  await ctx.service.ingestCatalog(CATALOG, 'laptop');
  assert.deepStrictEqual((await ctx.service.machineOptions('laptop', MACHINES))?.defaults, none);
});

test('a session keeps its own options, and a message overlays them field by field', async () => {
  const ctx = setup();
  const caps = { ...CAPS, catalogHash: 'abc123', modes: [...CAPS.modes, 'auto'] };
  await ctx.service.claim({ wait: 0, caps }, undefined, 'laptop');
  await ctx.service.ingestCatalog(CATALOG, 'laptop');
  const dock = await ctx.service.createSession({ title: 'Own options' });
  const stored = (id: number) => JSON.parse(ctx.messages().find((message) => message.id === id).options);
  const finish = async (id: number) => {
    await ctx.service.claim({ wait: 0, caps }, undefined, 'laptop');
    await ctx.service.delta({ sessionId: dock.id, replyTo: id, done: true }, 'laptop');
  };

  const set = await ctx.service.setSessionOptions(dock.id, { model: 'sonnet', effort: 'low', permissionMode: 'plan' });
  assert.deepStrictEqual(set.options, { model: 'sonnet', effort: 'low', permissionMode: 'plan', fast: null });

  const plain = await ctx.service.sendMessage(dock.id, 'one', MACHINES);
  assert.deepStrictEqual(stored(plain.id), { model: 'sonnet', effort: 'low', permissionMode: 'plan', fast: null }, 'the message carries the session options');
  await finish(plain.id);

  const over = await ctx.service.sendMessage(dock.id, 'two', MACHINES, { options: { effort: 'high', permissionMode: 'auto' } });
  assert.deepStrictEqual(stored(over.id), { model: 'sonnet', effort: 'high', permissionMode: 'auto', fast: null }, 'the message wins field by field');
  assert.deepStrictEqual((await ctx.service.session(dock.id))?.options, { model: 'sonnet', effort: 'low', permissionMode: 'plan', fast: null }, 'and leaves the session as it was');
  await finish(over.id);

  await assert.rejects(ctx.service.setSessionOptions(dock.id, { model: 'opus' }), /not offered/);
  await assert.rejects(ctx.service.setSessionOptions(dock.id, { permissionMode: 'bypassPermissions' }), OrchestratorInputError);
  await assert.rejects(ctx.service.setSessionOptions(dock.id, { model: 'sonnet', effort: 'xhigh' }), /effort/);
  await assert.rejects(ctx.service.setSessionOptions('unknown-session', { model: 'sonnet' }), /Unknown chat session/);
  assert.deepStrictEqual((await ctx.service.session(dock.id))?.options, { model: 'sonnet', effort: 'low', permissionMode: 'plan', fast: null });

  assert.strictEqual((await ctx.service.setSessionOptions(dock.id, {})).options, null);
  const bare = await ctx.service.sendMessage(dock.id, 'three', MACHINES);
  assert.strictEqual(ctx.messages().find((message) => message.id === bare.id).options, null, 'no options at all means the machine decides');
});

test('stored session options a machine cannot honour are left out instead of refusing the message', async () => {
  const old = setup();
  const lone = await old.service.createSession({ title: 'Old bridge' });
  assert.strictEqual((await old.service.session(lone.id))?.options?.permissionMode, 'auto');
  const sent = await old.service.sendMessage(lone.id, 'hi', MACHINES);
  assert.strictEqual(old.messages().find((message) => message.id === sent.id).options, null, 'a bridge without capabilities gets nothing');
  const claim = await old.service.claim({ wait: 0 }, undefined, 'laptop');
  assert.deepStrictEqual(claim.message, { id: sent.id, sessionId: lone.id, text: 'hi', claudeSessionId: null, forkFrom: null });

  const ctx = setup();
  await ctx.service.claim({ wait: 0, caps: { ...CAPS, catalogHash: 'abc123' } }, undefined, 'laptop');
  await ctx.service.ingestCatalog(CATALOG, 'laptop');
  const dock = await ctx.service.createSession({ title: 'No auto' });
  await ctx.service.setSessionOptions(dock.id, { model: 'sonnet', permissionMode: 'plan' });
  await ctx.service.ingestCatalog({ ...CATALOG, models: [{ value: 'haiku', label: 'Haiku', efforts: [], fast: false }] }, 'laptop');
  const sent2 = await ctx.service.sendMessage(dock.id, 'hi', MACHINES);
  assert.deepStrictEqual(JSON.parse(ctx.messages().find((message) => message.id === sent2.id).options), { model: null, effort: null, permissionMode: 'plan', fast: null }, 'the model the machine no longer offers is dropped');
});

test('the first message names a session that has no title, and only then', async () => {
  const ctx = setup();
  const blank = await ctx.service.createSession({});
  assert.strictEqual(blank.title, '');
  const text = `  Review <b>this</b>\n\n   PR ${'x'.repeat(100)}`;
  const sent = await ctx.service.sendMessage(blank.id, text, MACHINES);
  const title = (await ctx.service.session(blank.id))?.title ?? '';
  assert.strictEqual(title.length, 80);
  assert.ok(title.startsWith('Review this PR xxxx'));
  await ctx.service.claim({ wait: 0 }, undefined, 'laptop');
  await ctx.service.delta({ sessionId: blank.id, replyTo: sent.id, done: true }, 'laptop');
  await ctx.service.sendMessage(blank.id, 'something else', MACHINES);
  assert.strictEqual((await ctx.service.session(blank.id))?.title, title, 'a later message does not rename it');

  const named = await ctx.service.createSession({ title: 'QRD-1' });
  await ctx.service.sendMessage(named.id, 'hello there', MACHINES);
  assert.strictEqual((await ctx.service.session(named.id))?.title, 'QRD-1');

  const renamed = await ctx.service.createSession({});
  await ctx.service.renameSession(renamed.id, 'Mine');
  await ctx.service.sendMessage(renamed.id, 'hello there', MACHINES);
  assert.strictEqual((await ctx.service.session(renamed.id))?.title, 'Mine');
});

function uploadStore(memory: ReturnType<typeof memoryStorage>) {
  const rows = new Map<string, any>();
  const live = () => [...rows.values()].filter((row) => row.state !== 'deleted');
  const store = {
    create: async (row: any) => { rows.set(row.id, { ...row }); return row; },
    get: async (id: string) => rows.get(id) ?? null,
    getMany: async (ids: string[]) => ids.flatMap((id) => (rows.has(id) ? [rows.get(id)] : [])),
    forMessages: async (ids: number[]) => live().filter((row) => ids.includes(row.messageId)),
    countBySessionState: async (sessionId: string, state: string) => live().filter((row) => row.sessionId === sessionId && row.state === state).length,
    update: async (id: string, data: object) => { Object.assign(rows.get(id) ?? {}, data); },
    claim: async (sessionId: string, ids: string[], messageId: number) => {
      const hit = live().filter((row) => ids.includes(row.id) && row.sessionId === sessionId && row.state === 'uploaded');
      for (const row of hit) Object.assign(row, { messageId, state: 'attached' });
      return hit.length;
    },
    release: async (messageId: number) => { for (const row of live()) if (row.messageId === messageId && row.state === 'attached') Object.assign(row, { messageId: null, state: 'uploaded' }); },
    remove: async (id: string) => { rows.delete(id); },
    removeUploaded: async (id: string) => rows.get(id)?.state === 'uploaded' && rows.delete(id),
    purgeDeleted: async () => undefined,
    forSession: async (sessionId: string) => live().filter((row) => row.sessionId === sessionId),
    live: async () => live(),
    removeSession: async () => undefined,
  } as unknown as ChatAttachmentStore;
  const lookup = {
    session: async (id: string) => memory.sessions.get(id) ?? null,
    message: async (id: number) => memory.messages().find((message) => message.id === id) ?? null,
  };
  return { rows, store, lookup };
}

test('a file from the agent becomes an assistant message of the turn, and every wrong caller is refused', async (t) => {
  const memory = memoryStorage();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-upload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { rows, store, lookup } = uploadStore(memory);
  const chat = new ChatService(memory.storage, undefined, undefined, new ChatAttachmentService(store, lookup, { dir: () => dir }));
  const env = await ingestEnv(t, chat, memory);
  const upload = (query: Record<string, string>, body: Buffer | string, type: string, machine: 'laptop' | 'workspace' = 'laptop') => env.raw(
    `chat/upload?${new URLSearchParams(query)}`, body, type, machine,
  );
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  const dock = await chat.createSession({ title: 'Files' });
  const sent = await chat.sendMessage(dock.id, 'screenshot please', MACHINES);
  await chat.claim({ wait: 0, caps: CAPS }, undefined, 'laptop');
  const query = { sessionId: dock.id, replyTo: String(sent.id), name: 'shot.png' };

  const ok = await upload(query, png, 'image/png');
  const body = await ok.json() as { ok: boolean; result: { messageId: number } };
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(body.ok, true);
  const message = memory.messages().find((item) => item.id === body.result.messageId);
  assert.deepStrictEqual([message.role, message.state, message.text, message.sessionId], ['assistant', 'done', 'Attachment: shot.png', dock.id]);
  const [row] = [...rows.values()];
  assert.deepStrictEqual([row.messageId, row.state, row.mime, row.name], [message.id, 'attached', 'image/png', 'shot.png']);
  assert.strictEqual(memory.sessions.get(dock.id).messageCount, 2);
  const listed = await chat.withAttachments([{ id: message.id, role: 'assistant' }, { id: sent.id, role: 'user' }]);
  assert.deepStrictEqual(listed.map((item) => item.attachments.length), [1, 0], 'an assistant row carries its attachments');

  const refused = async (response: Response, status: number) => {
    assert.strictEqual(response.status, status);
    await response.arrayBuffer();
  };
  await refused(await upload(query, png, 'image/png', 'workspace'), 400);
  await refused(await upload({ ...query, sessionId: 'unknown-session' }, png, 'image/png'), 400);
  await refused(await upload({ ...query, replyTo: '9999' }, png, 'image/png'), 400);
  await refused(await upload({ ...query, replyTo: String(message.id) }, png, 'image/png'), 400);
  await refused(await upload({ ...query, replyTo: 'x' }, png, 'image/png'), 400);
  await refused(await env.raw(`chat/upload?${new URLSearchParams(query)}`, png, 'image/png', null), 401);
  await refused(await upload(query, Buffer.alloc(6 * 1024 * 1024, 1), 'image/png'), 413);
  await refused(await upload(query, Buffer.from('PK'), 'application/zip'), 415);
  await refused(await upload(query, Buffer.from('not an image at all'), 'image/png'), 415);
  await refused(await upload(query, Buffer.alloc(0), 'text/plain'), 400);
  assert.strictEqual(memory.messages().filter((item) => item.role === 'assistant').length, 1, 'a refused file leaves no message');
  assert.strictEqual(rows.size, 1, 'and no stored file');

  await chat.syncSession({ session: { id: 'cli-session', title: 'Terminal', startedAt: '2026-10-12T00:00:00Z', lastMessageAt: '2026-10-12T00:00:00Z' }, messages: [] }, 'laptop');
  await refused(await upload({ ...query, sessionId: 'cli-session' }, png, 'image/png'), 400);
});
