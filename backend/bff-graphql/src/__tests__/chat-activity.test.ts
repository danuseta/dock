import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import express from 'express';

const directory = mkdtempSync(path.join(os.tmpdir(), 'dock-activity-'));
const databaseUrl = `file:${path.join(directory, 'activity.db').replaceAll('\\', '/')}`;
let loading: ReturnType<typeof load> | null = null;

after(async () => {
  if (loading) await (await loading).prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function load() {
  process.env.DATABASE_URL = databaseUrl;
  process.env.ENCRYPTION_KEY ||= 'activity-test-key';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../../prisma/schema.prisma')], { env: process.env, stdio: 'pipe' });
  const [storageModule, clientModule, chatModule, orchestratorModule, routeModule, resolverModule, sourceModule, sessionModule] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/chat'),
    import('../integrations/orchestrator'),
    import('../routes/orchestrator'),
    import('../resolvers'),
    import('../datasources/StorageAPI'),
    import('../auth/session'),
  ]);
  return { ...storageModule, ...chatModule, ...routeModule, ...resolverModule, ...sourceModule, prisma: clientModule.prisma, OrchestratorService: orchestratorModule.OrchestratorService, OrchestratorInputError: orchestratorModule.OrchestratorInputError, PinRateLimiter: sessionModule.PinRateLimiter };
}

type Resolver = (...args: unknown[]) => Promise<unknown>;
const queries = (gql: { Query: unknown }) => gql.Query as Record<string, Resolver>;

const modules = () => (loading ??= load());

const NOW = Date.parse('2026-10-11T03:30:00.000Z');

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  parentId: null,
  kind: 'tool',
  agent: 'main',
  name: 'Bash',
  label: 'Bash: list files',
  summary: 'ls -la',
  detail: null,
  status: 'running',
  startedAt: '2026-10-11T03:00:00.000Z',
  endedAt: null,
  ...extra,
});

const batch = (sessionId: string, replyTo: number, events: unknown[], extra: Record<string, unknown> = {}) => ({ v: 1, sessionId, replyTo, events, ...extra });

async function world(storageOverride?: (mods: Awaited<ReturnType<typeof load>>) => InstanceType<Awaited<ReturnType<typeof load>>['StorageService']>) {
  const mods = await modules();
  const storage = storageOverride ? storageOverride(mods) : new mods.StorageService(mods.prisma);
  const clock = { at: NOW };
  const service = new mods.ChatService(storage, () => new Date(clock.at));
  const session = async (machine = 'laptop', source = 'dock', state = 'taken') => {
    const id = randomUUID();
    const at = new Date(clock.at);
    await storage.createChatSession({ id, source, machine, title: 'ZED-101', ticketKey: 'ZED-101', startedAt: at, lastMessageAt: at });
    const message = await storage.createChatMessage({ sessionId: id, role: 'user', text: 'go', state, at });
    await storage.updateChatSession(id, { status: 'running', lastDeltaAt: at });
    return { id, turn: message.id };
  };
  const rows = (sessionId: string) => mods.prisma.chatActivity.findMany({ where: { sessionId }, orderBy: { seq: 'asc' } });
  return { ...mods, storage, service, clock, session, rows };
}

test('parse accepts the contract shape and refuses anything outside it', async () => {
  const { parseActivity, OrchestratorInputError } = await modules();
  const now = new Date(NOW);
  const id = randomUUID();
  const parsed = parseActivity(batch(id, 12, [event('toolu_01', { endedAt: '2026-10-11T03:00:02.000Z', status: 'ok', detail: 'out' })]), now);
  assert.deepStrictEqual([parsed.sessionId, parsed.replyTo, parsed.events.length], [id, 12, 1]);
  assert.deepStrictEqual(
    [parsed.events[0].eventId, parsed.events[0].parentId, parsed.events[0].kind, parsed.events[0].status, parsed.events[0].endedAt?.toISOString()],
    ['toolu_01', null, 'tool', 'ok', '2026-10-11T03:00:02.000Z'],
  );
  const bad = (events: unknown[], extra: Record<string, unknown> = {}) => () => parseActivity(batch(id, 12, events, extra), now);
  assert.throws(bad([event('a', { kind: 'thought' })]), OrchestratorInputError);
  assert.throws(bad([event('a', { status: 'done' })]), OrchestratorInputError);
  assert.throws(bad([event('has space')]), OrchestratorInputError);
  assert.throws(bad([event('a'.repeat(81))]), OrchestratorInputError);
  assert.throws(bad([event('a', { parentId: 'bad parent' })]), OrchestratorInputError);
  assert.throws(bad([event('dropped-server')]), OrchestratorInputError, 'the id the server keeps for its own dropped row');
  assert.throws(bad([event('dock_ing_AAAAAAAAAAAAAAAAAAAAAAAA')]), OrchestratorInputError, 'an id cannot carry a secret');
  assert.throws(bad([event('a', { name: '' })]), OrchestratorInputError);
  assert.throws(bad([event('a', { startedAt: 'soon' })]), OrchestratorInputError);
  assert.throws(bad([event('a', { endedAt: 5 })]), OrchestratorInputError);
  assert.throws(bad([null]), OrchestratorInputError);
  assert.throws(bad(Array.from({ length: 51 }, (_, index) => event(`e${index}`))), OrchestratorInputError);
  assert.strictEqual(parseActivity(batch(id, 12, Array.from({ length: 50 }, (_, index) => event(`e${index}`))), now).events.length, 50);
  assert.throws(bad([], { v: 2 }), OrchestratorInputError);
  assert.throws(bad([], { v: undefined }), OrchestratorInputError);
  assert.throws(bad([], { replyTo: 0 }), OrchestratorInputError);
  assert.throws(bad([], { sessionId: '../etc' }), OrchestratorInputError);
  assert.throws(bad([], { events: 'none' }), OrchestratorInputError);
  assert.throws(() => parseActivity(null, now), OrchestratorInputError);

  const long = parseActivity(batch(id, 12, [event('a', { agent: 'x'.repeat(90), name: 'n'.repeat(90), label: 'l'.repeat(300), summary: 's'.repeat(500), detail: 'd'.repeat(9000) })]), now).events[0];
  assert.deepStrictEqual([long.agent.length, long.name.length, long.label.length, long.summary.length], [48, 64, 120, 200]);
  assert.ok(Buffer.byteLength(JSON.stringify(long)) <= 4096, 'an event is cut to 4 KB');
  assert.ok((long.detail?.length ?? 0) > 1000, 'the cut takes the detail first');
  const quoted = parseActivity(batch(id, 12, [event('a', { detail: '"'.repeat(2000), label: 'line one\nline two' })]), now).events[0];
  assert.ok(Buffer.byteLength(JSON.stringify(quoted)) <= 4096, 'escaping counts toward the 4 KB');
  assert.strictEqual(quoted.label, 'line one line two');
  assert.strictEqual(parseActivity(batch(id, 12, [event('a', { startedAt: '2999-01-01T00:00:00.000Z' })]), now).events[0].startedAt.toISOString(), now.toISOString(), 'a clock ahead of the server is clamped');
});

test('a retried event is one row, a changed one gets the next seq and a repeat changes nothing', async () => {
  const { service, session, rows } = await world();
  const { id, turn } = await session();

  const first = await service.activity(batch(id, turn, [event('toolu_01')]), 'laptop');
  assert.deepStrictEqual(first, { accepted: 1, seq: 1, dropped: 0, closed: false });
  const second = await service.activity(batch(id, turn, [event('toolu_01', { status: 'ok', endedAt: '2026-10-11T03:00:02.000Z', detail: 'out' }), event('toolu_02')]), 'laptop');
  assert.deepStrictEqual(second, { accepted: 2, seq: 3, dropped: 0, closed: false });
  const stored = await rows(id);
  assert.deepStrictEqual(stored.map((row) => [row.eventId, row.status, row.seq]), [['toolu_02', 'running', 3], ['toolu_01', 'ok', 2]].sort((a, b) => Number(a[2]) - Number(b[2])));
  assert.strictEqual(stored.length, 2, 'two events, two rows');

  const again = await service.activity(batch(id, turn, [event('toolu_01', { status: 'ok', endedAt: '2026-10-11T03:00:02.000Z', detail: 'out' }), event('toolu_02')]), 'laptop');
  assert.deepStrictEqual(again, { accepted: 2, seq: 3, dropped: 0, closed: false }, 'the same batch twice: accepted stays, seq does not move');
  assert.deepStrictEqual((await rows(id)).map((row) => row.seq), [2, 3]);

  const update = await service.activity(batch(id, turn, [event('toolu_01', { kind: 'agent', name: 'Task', agent: 'other', parentId: 'toolu_99', startedAt: '2026-10-11T02:00:00.000Z', label: 'Changed', summary: 'new summary', status: 'error', endedAt: '2026-10-11T03:00:05.000Z' })]), 'laptop');
  assert.strictEqual(update?.seq, 4);
  const changed = (await rows(id)).find((row) => row.eventId === 'toolu_01')!;
  assert.deepStrictEqual(
    [changed.kind, changed.name, changed.agent, changed.parentId, changed.startedAt.toISOString(), changed.label, changed.summary, changed.status, changed.detail],
    ['tool', 'Bash', 'main', null, '2026-10-11T03:00:00.000Z', 'Changed', 'new summary', 'error', 'out'],
    'only status, endedAt, label, summary and detail follow an update',
  );
});

test('rows come back in seq order and a finished row never goes back to running', async () => {
  const { service, session, rows } = await world();
  const { id, turn } = await session();
  await service.activity(batch(id, turn, [event('a'), event('b'), event('c')]), 'laptop');
  await service.activity(batch(id, turn, [event('a', { status: 'ok', endedAt: '2026-10-11T03:00:01.000Z' })]), 'laptop');
  assert.deepStrictEqual((await rows(id)).map((row) => row.eventId), ['b', 'c', 'a'], 'a changed row moves to the end of the seq order');

  const late = await service.activity(batch(id, turn, [event('a', { status: 'running', label: 'Stale' })]), 'laptop');
  assert.strictEqual(late?.seq, 4);
  const a = (await rows(id)).find((row) => row.eventId === 'a')!;
  assert.deepStrictEqual([a.status, a.label, a.seq], ['ok', 'Bash: list files', 4]);
  await service.activity(batch(id, turn, [event('a', { status: 'stopped' })]), 'laptop');
  assert.strictEqual((await rows(id)).find((row) => row.eventId === 'a')!.status, 'stopped', 'finished states can still be corrected');
});

test('nesting is kept by parent id', async () => {
  const { service, session, rows } = await world();
  const { id, turn } = await session();
  await service.activity(batch(id, turn, [
    event('toolu_B', { kind: 'agent', name: 'explore', label: 'Agent explore: count files' }),
    event('toolu_C', { parentId: 'toolu_B', agent: 'explore', name: 'Grep' }),
    event('toolu_D', { parentId: 'toolu_C', agent: 'explore', name: 'Read' }),
  ]), 'laptop');
  assert.deepStrictEqual((await rows(id)).map((row) => [row.eventId, row.parentId, row.agent]), [
    ['toolu_B', null, 'main'], ['toolu_C', 'toolu_B', 'explore'], ['toolu_D', 'toolu_C', 'explore'],
  ]);
});

test('the 401st row of a turn is counted in one dropped row while updates still land', async () => {
  const { service, session, rows, storage } = await world();
  const { id, turn } = await session();
  const events = Array.from({ length: 400 }, (_, index) => event(`e${index}`));
  for (let start = 0; start < 400; start += 50) {
    assert.strictEqual((await service.activity(batch(id, turn, events.slice(start, start + 50)), 'laptop'))?.dropped, 0);
  }
  assert.strictEqual(await storage.countChatActivity(id, turn), 400);

  const over = await service.activity(batch(id, turn, [event('extra-1')]), 'laptop');
  assert.deepStrictEqual([over?.accepted, over?.dropped, over?.closed], [0, 1, false]);
  const dropped = (await rows(id)).find((row) => row.eventId === 'dropped-server')!;
  assert.deepStrictEqual([dropped.kind, dropped.name, dropped.summary, dropped.label, dropped.parentId], ['note', 'dropped', '1', '1 steps not shown', null]);
  assert.strictEqual((await rows(id)).some((row) => row.eventId === 'extra-1'), false);

  const mixed = await service.activity(batch(id, turn, [event('extra-2'), event('e7', { status: 'ok', endedAt: '2026-10-11T03:00:03.000Z' })]), 'laptop');
  assert.deepStrictEqual([mixed?.accepted, mixed?.dropped], [1, 1], 'the update of an old row is accepted, the new row is not');
  assert.strictEqual((await rows(id)).find((row) => row.eventId === 'e7')!.status, 'ok');
  assert.strictEqual((await rows(id)).find((row) => row.eventId === 'dropped-server')!.summary, '2');
  assert.strictEqual(await storage.countChatActivity(id, turn), 401, 'four hundred events and the dropped row');
});

test('a token only writes to its own machine, and a foreign session looks like an unknown one', async () => {
  const { service, session, rows, storage } = await world();
  const laptop = await session('laptop');
  const workspace = await session('workspace');
  const cli = await session('laptop', 'cli', 'done');

  assert.strictEqual(await service.activity(batch(laptop.id, laptop.turn, [event('a')]), 'workspace'), null, 'workspace token on a laptop session');
  assert.strictEqual(await service.activity(batch(randomUUID(), 1, [event('a')]), 'workspace'), null, 'unknown session answers the same');
  assert.strictEqual(await service.activity(batch(cli.id, cli.turn, [event('a')]), 'workspace'), null, 'a cli session of another machine too');
  assert.deepStrictEqual(await rows(laptop.id), []);

  await assert.rejects(service.activity(batch(cli.id, cli.turn, [event('a')]), 'laptop'), /Only a DOCK session/);
  await assert.rejects(service.activity(batch(laptop.id, workspace.turn, [event('a')]), 'laptop'), /replyTo is not a message of this session/);
  await assert.rejects(service.activity(batch(laptop.id, 999999, [event('a')]), 'laptop'), /replyTo is not a message of this session/);
  assert.deepStrictEqual(await rows(laptop.id), []);
  assert.deepStrictEqual(await rows(workspace.id), []);

  await storage.moveChatMessage(laptop.turn, laptop.id, 'taken', 'done');
  const closed = await service.activity(batch(laptop.id, laptop.turn, [event('a')]), 'laptop');
  assert.deepStrictEqual([closed?.accepted, closed?.closed], [0, true]);
  assert.deepStrictEqual(await rows(laptop.id), [], 'a finished turn takes no rows');
  assert.strictEqual(await service.activityDetail(laptop.id, 1), null);
});

test('activity keeps the turn alive and the bridge visible', async () => {
  const { service, session, storage, clock } = await world();
  const { id, turn } = await session();
  clock.at += 10 * 60 * 1000;
  assert.strictEqual(service.bridge('laptop').online, false);
  await service.activity(batch(id, turn, [event('a')]), 'laptop');
  assert.strictEqual(service.bridge('laptop').online, true);
  assert.strictEqual((await storage.getChatSession(id))?.lastDeltaAt?.getTime(), clock.at, 'a long step that only produces activity is not stale');
});

test('canary secrets of every pattern reach neither the database nor the GraphQL answer', async () => {
  const { service, session, prisma, resolvers: gql } = await world();
  const { id, turn } = await session();
  const canaries = [
    'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
    'sk_live_BBBBBBBBBBBBBBBBBBBBBBBB',
    'pk_live_CCCCCCCCCCCCCCCCCCCCCCCC',
    'rk_live_DDDDDDDDDDDDDDDDDDDDDDDD',
    'xi_EEEEEEEEEEEEEEEEEEEEEEEE',
    'ghp_FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
    'github_pat_GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
    'xoxb-1234567890-HHHHHHHHHHHH',
    'apikey_IIIIIIIIIIII',
    'dock_ing_JJJJJJJJJJJJJJJJJJJJJJJJ',
    'AIzaSyKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ6ZWQifQ.c2lnbmF0dXJlMTIz',
    'Bearer LLLLLLLLLLLLLLLLLLLLLLLLLL',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END RSA PRIVATE KEY-----',
    'postgres://zed:MMMMMMMMMMMM@db.example.test:5432/zed',
    'password=NNNNNNNNNNNN',
    'client_secret: "OOOOOOOOOOOO"',
    'api_key = PPPPPPPPPPPP',
  ];
  const needles = ['AAAAAAAAAAAA', 'BBBBBBBBBBBB', 'CCCCCCCCCCCC', 'DDDDDDDDDDDD', 'EEEEEEEEEEEE', 'FFFFFFFFFFFF', 'GGGGGGGGGGGG', 'HHHHHHHHHHHH', 'IIIIIIIIIIII', 'JJJJJJJJJJJJ', 'KKKKKKKKKKKK', 'c2lnbmF0dXJlMTIz', 'LLLLLLLLLLLL', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'MMMMMMMMMMMM', 'NNNNNNNNNNNN', 'OOOOOOOOOOOO', 'PPPPPPPPPPPP'];
  const envBlock = ['ALPHA_ONE=1111', 'BETA_TWO=2222', 'GAMMA_THREE=3333', 'DELTA_FOUR=4444', 'EPSILON_FIVE=5555', 'ZETA_SIX=6666'].join('\n');

  const events = canaries.map((canary, index) => event(`c${index}`, {
    name: index === 0 ? canary : 'Bash',
    label: `label ${canary}`,
    summary: `summary ${canary}`,
    detail: `$ run\nout ${canary}\nend`,
    status: 'ok',
  }));
  events.push(event('env', { label: 'printenv', summary: envBlock, detail: envBlock, status: 'ok' }));
  for (let start = 0; start < events.length; start += 50) {
    await service.activity(batch(id, turn, events.slice(start, start + 50)), 'laptop');
  }

  const stored = JSON.stringify(await prisma.chatActivity.findMany({ where: { sessionId: id } }));
  const listed = await queries(gql).chatActivity({}, { sessionId: id, limit: 500 }, { request: { headers: {}, socket: {} }, authenticated: true } as never) as Array<{ id: number }>;
  const details = await Promise.all(listed.map((row) => queries(gql).chatActivityDetail({}, { sessionId: id, id: row.id }, { request: { headers: {}, socket: {} }, authenticated: true } as never)));
  const answered = JSON.stringify([listed, details]);
  assert.strictEqual(listed.length, canaries.length + 1);
  for (const [name, text] of [['database', stored], ['GraphQL', answered]]) {
    for (const needle of [...needles, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '1111', 'EPSILON_FIVE=5555', 'ZETA_SIX']) {
      assert.strictEqual(text.includes(needle), false, `${name} leaks ${needle}`);
    }
    for (const canary of canaries) assert.strictEqual(text.includes(canary), false, `${name} leaks ${canary.slice(0, 24)}`);
  }
  const rowsByEvent = new Map((await prisma.chatActivity.findMany({ where: { sessionId: id } })).map((row) => [row.eventId, row]));
  assert.deepStrictEqual([rowsByEvent.get('env')!.detail, rowsByEvent.get('env')!.summary, rowsByEvent.get('env')!.label], ['[hidden]', '[hidden]', 'printenv'], 'a dump of NAME=value lines is replaced whole');
  assert.match(rowsByEvent.get('c15')!.detail!, /password=\*\*\*/);
  assert.match(rowsByEvent.get('c8')!.label, /label \*\*\*/);
  assert.strictEqual(rowsByEvent.get('c0')!.name.includes('sk-ant'), false);
});

test('the masking pass leaves ordinary text alone', async () => {
  const { maskActivityText } = await import('../integrations/chat-activity');
  for (const text of ['ls -la src/integrations', 'git commit -m "fix: task-handler risk-score"', 'Read src/auth/login.ts lines 10-40', 'MAX_ROWS=5\nOTHER=1', 'https://example.test/a/b?x=1', 'password prompt shown']) {
    assert.strictEqual(maskActivityText(text), text);
  }
});

test('delta done, delta error and a stale turn close the running rows of that turn as stopped', async () => {
  const { service, session, rows, clock, storage } = await world();
  const finished = await session();
  const failed = await session();
  const stale = await session();
  const other = await session();
  for (const turn of [finished, failed, stale, other]) {
    await service.activity(batch(turn.id, turn.turn, [event('run'), event('done', { status: 'ok', endedAt: '2026-10-11T03:00:01.000Z' })]), 'laptop');
  }
  const states = async (sessionId: string) => (await rows(sessionId)).map((row) => [row.eventId, row.status]);

  await service.delta({ sessionId: finished.id, replyTo: finished.turn, done: true }, 'laptop');
  assert.deepStrictEqual(await states(finished.id), [['run', 'stopped'], ['done', 'ok']].sort(), 'running becomes stopped, finished rows stay');
  const closedRow = (await rows(finished.id)).find((row) => row.eventId === 'run')!;
  assert.strictEqual(closedRow.endedAt?.getTime(), clock.at);
  assert.ok(closedRow.seq > 2, 'the closed row is served again to a reader that already had it');

  await service.delta({ sessionId: failed.id, replyTo: failed.turn, error: 'boom' }, 'laptop');
  assert.strictEqual((await states(failed.id)).find(([eventId]) => eventId === 'run')?.[1], 'stopped');
  assert.strictEqual((await states(other.id)).find(([eventId]) => eventId === 'run')?.[1], 'running', 'another session is untouched');

  clock.at += 16 * 60 * 1000;
  await storage.updateChatSession(other.id, { lastDeltaAt: new Date(clock.at) });
  await service.session(stale.id);
  assert.strictEqual((await states(stale.id)).find(([eventId]) => eventId === 'run')?.[1], 'stopped');
  assert.strictEqual((await storage.getChatSession(stale.id))?.status, 'error');
  assert.strictEqual((await states(other.id)).find(([eventId]) => eventId === 'run')?.[1], 'running');
});

test('a failure in activity never reaches a chat turn', async (t) => {
  const mute = t.mock.method(console, 'error', () => undefined);
  const { service, session, storage } = await world((mods) => {
    class BrokenActivity extends mods.StorageService {
      async closeRunningChatActivity(): Promise<number> { throw new Error('disk full'); }
      async upsertChatActivity(): Promise<never> { throw new Error('disk full'); }
      async pruneChatActivity(): Promise<never> { throw new Error('disk full'); }
    }
    return new BrokenActivity(mods.prisma);
  });
  const { id, turn } = await session();

  await assert.rejects(service.activity(batch(id, turn, [event('a')]), 'laptop'), /disk full/);
  const done = await service.delta({ sessionId: id, replyTo: turn, done: true, items: [{ role: 'assistant', text: 'hi', at: '2026-10-11T03:00:00.000Z' }] }, 'laptop');
  assert.deepStrictEqual([done?.status, done?.messageCount], ['idle', 2]);
  assert.strictEqual((await storage.getChatMessage(turn))?.state, 'done');
  assert.ok(mute.mock.callCount() >= 1, 'the failure is logged');
});

test('chatActivity returns only what is new, without detail, and the detail of a row only to its session', async () => {
  const { service, session, OrchestratorInputError } = await world();
  const { id, turn } = await session();
  const other = await session();
  await service.activity(batch(id, turn, [event('a', { detail: 'secret-free detail' }), event('b'), event('c')]), 'laptop');
  await service.activity(batch(other.id, other.turn, [event('x', { detail: 'other detail' })]), 'laptop');

  const all = await service.activityRows(id, {});
  assert.deepStrictEqual(all.map((row) => [row.eventId, row.hasDetail, row.seq]), [['a', true, 1], ['b', false, 2], ['c', false, 3]]);
  assert.ok(all.every((row) => !('detail' in row)), 'a listing never carries detail');
  assert.deepStrictEqual(Object.keys(all[0]).sort(), ['agent', 'endedAt', 'eventId', 'hasDetail', 'id', 'kind', 'label', 'name', 'parentId', 'seq', 'sessionId', 'startedAt', 'status', 'summary', 'turnId']);
  assert.strictEqual(typeof all[0].startedAt, 'string');
  assert.strictEqual(all[0].endedAt, null);

  assert.deepStrictEqual((await service.activityRows(id, { afterSeq: 1 })).map((row) => row.eventId), ['b', 'c']);
  assert.deepStrictEqual((await service.activityRows(id, { afterSeq: 3 })).map((row) => row.eventId), [], 'nothing new, an empty answer');
  assert.deepStrictEqual((await service.activityRows(id, { afterSeq: 0, limit: 2 })).map((row) => row.eventId), ['a', 'b']);
  await service.activity(batch(id, turn, [event('b', { status: 'ok', endedAt: '2026-10-11T03:00:02.000Z' })]), 'laptop');
  assert.deepStrictEqual((await service.activityRows(id, { afterSeq: 3 })).map((row) => [row.eventId, row.status]), [['b', 'ok']], 'a changed row is served again');
  assert.deepStrictEqual((await service.activityRows(id, { fromTurnId: turn + 1 })).map((row) => row.eventId), []);
  assert.strictEqual((await service.activityRows(id, { fromTurnId: turn, beforeTurnId: turn + 1 })).length, 3);
  assert.strictEqual((await service.activityRows(id, { beforeTurnId: turn })).length, 0);
  assert.strictEqual((await service.activityRows(id, { limit: 9999 })).length, 3);
  await assert.rejects(service.activityRows(id, { afterSeq: -1 }), OrchestratorInputError);
  assert.deepStrictEqual(await service.activityRows('bad id', {}), []);

  assert.strictEqual(await service.activityDetail(id, all[0].id), 'secret-free detail');
  assert.strictEqual(await service.activityDetail(id, all[1].id), null, 'a row without detail');
  assert.strictEqual(await service.activityDetail(other.id, all[0].id), null, 'a row of another session');
  assert.strictEqual(await service.activityDetail(id, 0), null);
  assert.strictEqual(await service.activityDetail('bad id', all[0].id), null);
});

test('the read fields sit behind the PIN', async () => {
  const { resolvers: gql, StorageAPI, protectedQueries } = await world();
  assert.ok(protectedQueries.includes('chatActivity') && protectedQueries.includes('chatActivityDetail'));
  const previousMode = process.env.DOCK_PIN_MODE;
  const originalPin = StorageAPI.prototype.hasMasterPin;
  process.env.DOCK_PIN_MODE = 'always';
  StorageAPI.prototype.hasMasterPin = async () => true;
  try {
    const locked = { request: { headers: {}, socket: {} }, authenticated: false } as never;
    await assert.rejects(queries(gql).chatActivity({}, { sessionId: randomUUID() }, locked), /Unlock DOCK to continue/);
    await assert.rejects(queries(gql).chatActivityDetail({}, { sessionId: randomUUID(), id: 1 }, locked), /Unlock DOCK to continue/);
    await assert.rejects(queries(gql).chatMessages({}, { sessionId: randomUUID() }, locked), /Unlock DOCK to continue/, 'the same guard as chatMessages');
    assert.deepStrictEqual(await queries(gql).chatActivity({}, { sessionId: randomUUID() }, { ...(locked as object), authenticated: true } as never), []);
  } finally {
    StorageAPI.prototype.hasMasterPin = originalPin;
    if (previousMode === undefined) delete process.env.DOCK_PIN_MODE;
    else process.env.DOCK_PIN_MODE = previousMode;
  }
});

test('pruning clears detail after 7 days, deletes rows after 30 and keeps the table under its cap', async () => {
  const { service, session, rows, storage, prisma, clock } = await world();
  await prisma.chatActivity.deleteMany();
  const { id, turn } = await session();
  const day = 24 * 60 * 60 * 1000;
  const aged = (days: number) => new Date(NOW - days * day).toISOString();
  const calls: unknown[] = [];
  const prune = storage.pruneChatActivity.bind(storage);
  storage.pruneChatActivity = async (...args) => { calls.push(args[0]); return prune(...args); };
  await service.activity(batch(id, turn, [
    event('fresh', { detail: 'fresh detail', startedAt: aged(1) }),
    event('week', { detail: 'week detail', startedAt: aged(8) }),
    event('month', { detail: 'month detail', startedAt: aged(31) }),
  ]), 'laptop');
  assert.strictEqual(calls.length, 1, 'the first ingest after a start prunes');
  await service.activity(batch(id, turn, [event('tick-2')]), 'laptop');
  clock.at += 5 * 60 * 60 * 1000;
  await service.activity(batch(id, turn, [event('tick-3')]), 'laptop');
  assert.strictEqual(calls.length, 1, 'and then at most once per 6 hours');
  clock.at += 2 * 60 * 60 * 1000;
  await service.activity(batch(id, turn, [event('tick-4')]), 'laptop');
  assert.strictEqual(calls.length, 2);

  const left = new Map((await rows(id)).map((row) => [row.eventId, row]));
  assert.strictEqual(left.has('month'), false, 'older than 30 days is gone');
  assert.strictEqual(left.get('week')?.detail, null, 'older than 7 days loses its detail');
  assert.strictEqual(left.get('week')?.label, 'Bash: list files', 'but the row stays');
  assert.strictEqual(left.get('fresh')?.detail, 'fresh detail');
  assert.strictEqual((await service.activityRows(id, {})).find((row) => row.eventId === 'week')?.hasDetail, false);

  await prisma.chatActivity.deleteMany();
  const many = Array.from({ length: 30 }, (_, index) => event(`m${index}`));
  await service.activity(batch(id, turn, many), 'laptop');
  const result = await storage.pruneChatActivity({ detailBefore: new Date(0), rowsBefore: new Date(0), maxRows: 12 });
  assert.strictEqual(result.evicted, 18);
  assert.deepStrictEqual((await rows(id)).map((row) => row.eventId), many.slice(18).map((row) => row.id), 'the oldest rows go first');
});

test('a machine that floods can only evict its own history', async () => {
  const { service, session, prisma, storage } = await world();
  await prisma.chatActivity.deleteMany();
  const laptop = await session('laptop');
  const workspace = await session('workspace');
  const send = async (target: { id: string; turn: number }, machine: string, prefix: string, count: number) => {
    const events = Array.from({ length: count }, (_, index) => event(`${prefix}${index}`));
    for (let start = 0; start < count; start += 50) await service.activity(batch(target.id, target.turn, events.slice(start, start + 50)), machine);
  };
  await send(laptop, 'laptop', 'l', 20);
  await send(workspace, 'workspace', 'w', 150);
  await storage.pruneChatActivity({ detailBefore: new Date(0), rowsBefore: new Date(0), maxRows: 100 });
  assert.strictEqual(await prisma.chatActivity.count({ where: { sessionId: laptop.id } }), 20, 'the quiet machine keeps every row although its rows are the oldest');
  assert.strictEqual(await prisma.chatActivity.count({ where: { sessionId: workspace.id } }), 80);

  await send(laptop, 'laptop', 'm', 100);
  await storage.pruneChatActivity({ detailBefore: new Date(0), rowsBefore: new Date(0), maxRows: 100 });
  const counts = [await prisma.chatActivity.count({ where: { sessionId: laptop.id } }), await prisma.chatActivity.count({ where: { sessionId: workspace.id } })];
  assert.strictEqual(counts[0] + counts[1], 100);
  assert.ok(counts[0] >= 40 && counts[1] >= 40, `two heavy machines are trimmed evenly (${counts.join('/')})`);
});

test('deleting a session or trimming its messages takes the activity of those turns with it', async () => {
  const { service, session, rows, storage } = await world();
  const { id, turn } = await session();
  const next = await storage.createChatMessage({ sessionId: id, role: 'user', text: 'again', state: 'taken', at: new Date(NOW) });
  await service.activity(batch(id, turn, [event('old')]), 'laptop');
  await service.activity(batch(id, next.id, [event('new')]), 'laptop');
  await storage.trimChatMessages(id, 1);
  assert.deepStrictEqual((await rows(id)).map((row) => row.eventId), ['new'], 'the turn whose message was trimmed loses its activity');
  assert.strictEqual(await storage.deleteChatSession(id), true);
  assert.deepStrictEqual(await rows(id), []);
});

test('the ingest route shares the token rules, answers 404 and 400 as delta does and refuses a large body', async (t) => {
  const { storage, ChatService, OrchestratorService, PinRateLimiter, createOrchestratorIngestRouter, session, rows } = await world();
  const orchestrator = new OrchestratorService(storage, os.tmpdir());
  const chat = new ChatService(storage);
  const laptopToken = (await orchestrator.createToken('activity-laptop', 'laptop')).token;
  const workspaceToken = (await orchestrator.createToken('activity-workspace', 'workspace')).token;
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(50, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (route: string, body: unknown, bearer: string | null = laptopToken) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const { id, turn } = await session('laptop');
  await storage.updateChatSession(id, { status: 'running' });

  assert.strictEqual((await post('/chat/activity', batch(id, turn, [event('a')]), null)).status, 401);
  assert.strictEqual((await post('/chat/activity', batch(id, turn, [event('a')]), 'dock_ing_wrong')).status, 401);
  assert.strictEqual((await post('/chat/activity', '{not json')).status, 400);
  assert.strictEqual((await post('/chat/activity', batch(id, turn, [event('a')], { v: 2 }))).status, 400);
  assert.strictEqual((await post('/chat/activity', batch(id, turn, [event('a', { kind: 'x' })]))).status, 400);
  assert.strictEqual((await post('/chat/activity', batch(id, turn, Array.from({ length: 51 }, (_, index) => event(`e${index}`))))).status, 400);
  assert.strictEqual((await post('/chat/activity', batch(id, turn, [event('a', { detail: 'x'.repeat(300 * 1024) })]))).status, 413);

  const unknown = await post('/chat/activity', batch(randomUUID(), 1, [event('a')]));
  assert.deepStrictEqual([unknown.status, await unknown.json()], [404, { error: 'Unknown ticket. Send its status first.' }]);
  const foreign = await post('/chat/activity', batch(id, turn, [event('a')]), workspaceToken);
  assert.deepStrictEqual([foreign.status, await foreign.json()], [404, { error: 'Unknown ticket. Send its status first.' }], 'the same answer as an unknown session');
  assert.deepStrictEqual(await rows(id), []);

  const accepted = await post('/chat/activity', batch(id, turn, [event('a'), event('b')]));
  assert.deepStrictEqual([accepted.status, await accepted.json()], [200, { ok: true, result: { accepted: 2, seq: 2, dropped: 0, closed: false } }]);

  const done = await post('/chat/delta', { sessionId: id, replyTo: turn, done: true, items: [{ role: 'assistant', text: 'hi', at: '2026-10-11T03:00:00.000Z' }] });
  assert.deepStrictEqual([done.status, await done.json()], [200, { ok: true, result: { id, status: 'idle', messageCount: 2 } }]);
  assert.deepStrictEqual((await rows(id)).map((row) => row.status), ['stopped', 'stopped']);
  const closed = await post('/chat/activity', batch(id, turn, [event('c')]));
  assert.deepStrictEqual([closed.status, await closed.json()], [200, { ok: true, result: { accepted: 0, seq: 4, dropped: 0, closed: true } }]);
});

test('two requests for one session at once both land', async () => {
  const { service, session, rows } = await world();
  const { id, turn } = await session();
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => service.activity(batch(id, turn, [event(`p${index}`), event(`q${index}`)]), 'laptop')));
  assert.ok(results.every((result) => result?.accepted === 2));
  assert.strictEqual((await rows(id)).length, 12);
  assert.strictEqual(new Set((await rows(id)).map((row) => row.seq)).size, 12, 'each change got its own seq');
});
