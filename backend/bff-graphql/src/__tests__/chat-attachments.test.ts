import assert from 'node:assert';
import fs, { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';
import express from 'express';
import { ATTACHMENT_LIMITS, ChatAttachmentService } from '../integrations/chat-attachments';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { createChatAttachmentRouter } from '../routes/chat-attachments';
import type { AttachmentRow, ChatAttachmentStore, ChatSessionLookup } from '../storage/chat-attachments';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.4\n');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function memoryStore(): ChatAttachmentStore {
  const rows = new Map<string, AttachmentRow>();
  const sorted = () => [...rows.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    create: async (row) => { rows.set(row.id, { ...row }); return row; },
    get: async (id) => rows.get(id) ?? null,
    getMany: async (ids) => ids.flatMap((id) => (rows.has(id) ? [rows.get(id) as AttachmentRow] : [])),
    forMessages: async (ids) => sorted().filter((row) => row.messageId !== null && ids.includes(row.messageId)),
    countBySessionState: async (sessionId, state) => sorted().filter((row) => row.sessionId === sessionId && row.state === state).length,
    update: async (id, data) => { const row = rows.get(id); if (row) rows.set(id, { ...row, ...data }); },
    claim: async (sessionId, ids, messageId) => {
      let claimed = 0;
      for (const id of ids) {
        const row = rows.get(id);
        if (row && row.sessionId === sessionId && row.state === 'uploaded') {
          rows.set(id, { ...row, messageId, state: 'attached' });
          claimed += 1;
        }
      }
      return claimed;
    },
    release: async (messageId) => {
      for (const row of sorted()) if (row.messageId === messageId && row.state === 'attached') rows.set(row.id, { ...row, messageId: null, state: 'uploaded' });
    },
    remove: async (id) => { rows.delete(id); },
    removeUploaded: async (id) => {
      if (rows.get(id)?.state !== 'uploaded') return false;
      rows.delete(id);
      return true;
    },
    purgeDeleted: async (before) => {
      for (const row of sorted()) if (row.state === 'deleted' && row.createdAt < before) rows.delete(row.id);
    },
    forSession: async (sessionId) => sorted().filter((row) => row.sessionId === sessionId),
    live: async () => sorted().filter((row) => row.state !== 'deleted'),
    removeSession: async (sessionId) => { for (const row of sorted()) if (row.sessionId === sessionId) rows.delete(row.id); },
  };
}

function lookup() {
  const sessions = new Map<string, { id: string; source: string; machine: string }>();
  const messages = new Map<number, { id: number; sessionId: string; state: string }>();
  const value: ChatSessionLookup = {
    session: async (id) => sessions.get(id) ?? null,
    message: async (id) => messages.get(id) ?? null,
  };
  return { value, sessions, messages };
}

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: Buffer; json: any }

function request(port: number, method: string, url: string, headers: Record<string, string>, chunks: Buffer[] = []): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(parts);
        let json: any = null;
        try { json = JSON.parse(body.toString('utf8')); } catch { json = null; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function setup(options: { authorized?: boolean; clock?: { now: Date } } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-att-'));
  const store = memoryStore();
  const sessionLookup = lookup();
  const clock = options.clock ?? { now: new Date('2026-10-12T10:00:00Z') };
  const service = new ChatAttachmentService(store, sessionLookup.value, { dir: () => dir, now: () => clock.now });
  sessionLookup.sessions.set('s1', { id: 's1', source: 'dock', machine: 'laptop' });
  sessionLookup.sessions.set('s2', { id: 's2', source: 'claude', machine: 'laptop' });
  const state = { authorized: options.authorized ?? true };
  const app = express();
  app.use('/api/chat/attachments', createChatAttachmentRouter({ service, authorize: async () => state.authorized }));
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as AddressInfo).port;
  const upload = (query: string, headers: Record<string, string>, chunks: Buffer[]) => request(
    port,
    'POST',
    `/api/chat/attachments?${query}`,
    { 'x-dock-upload': '1', ...headers },
    chunks,
  );
  const close = async () => {
    await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, store, service, sessionLookup, clock, state, port, upload, close };
}

const files = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

test('upload streams to disk, stores under a uuid and returns the view', async () => {
  const env = await setup();
  try {
    const body = Buffer.concat([PNG, Buffer.alloc(100, 1)]);
    const reply = await env.upload('sessionId=s1&name=shot.png', { 'content-type': 'image/png', 'content-length': String(body.length) }, [body]);
    assert.equal(reply.status, 200);
    assert.equal(reply.json.name, 'shot.png');
    assert.equal(reply.json.mime, 'image/png');
    assert.equal(reply.json.size, body.length);
    const stored = files(env.dir);
    assert.deepEqual(stored, [reply.json.id]);
    assert.ok(readFileSync(path.join(env.dir, reply.json.id)).equals(body));
    const row = await env.store.get(reply.json.id);
    assert.equal(row?.state, 'uploaded');
    assert.equal(row?.sha256.length, 64);
  } finally {
    await env.close();
  }
});

test('a client supplied name never becomes a path', async () => {
  const env = await setup();
  try {
    const body = Buffer.from('hello');
    const reply = await env.upload(`sessionId=s1&name=${encodeURIComponent('..\\..\\evil/../etc/pass:wd.txt')}`, { 'content-type': 'text/plain' }, [body]);
    assert.equal(reply.status, 200);
    assert.ok(!/[\\/:]/.test(reply.json.name));
    assert.equal(reply.json.name, 'pass_wd.txt');
    assert.deepEqual(files(env.dir), [reply.json.id]);
    const noName = await env.upload('sessionId=s1', { 'content-type': 'text/plain' }, [body]);
    assert.equal(noName.json.name, 'file');
  } finally {
    await env.close();
  }
});

test('a body one byte over the image limit is refused and leaves no file', async () => {
  const env = await setup();
  try {
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const parts = [Buffer.concat([PNG, chunk.subarray(PNG.length)])];
    for (let i = 1; i < 5; i += 1) parts.push(chunk);
    parts.push(Buffer.alloc(1, 7));
    assert.equal(parts.reduce((sum, part) => sum + part.length, 0), ATTACHMENT_LIMITS.imageBytes + 1);
    const reply = await env.upload('sessionId=s1&name=big.png', { 'content-type': 'image/png' }, parts);
    assert.equal(reply.status, 413);
    assert.deepEqual(files(env.dir), []);
    assert.equal((await env.store.live()).length, 0);
  } finally {
    await env.close();
  }
});

test('exactly the image limit is accepted, and a declared content-length over the limit is refused up front', async () => {
  const env = await setup();
  try {
    const exact = Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_LIMITS.imageBytes - PNG.length, 3)]);
    const ok = await env.upload('sessionId=s1&name=a.png', { 'content-type': 'image/png' }, [exact]);
    assert.equal(ok.status, 200);
    const refused = await env.upload('sessionId=s1&name=b.png', { 'content-type': 'image/png', 'content-length': String(ATTACHMENT_LIMITS.imageBytes + 1) }, []);
    assert.equal(refused.status, 413);
  } finally {
    await env.close();
  }
});

test('a file one byte over the file limit is refused', async () => {
  const env = await setup();
  try {
    const chunk = Buffer.alloc(1024 * 1024, 65);
    const parts: Buffer[] = [];
    for (let i = 0; i < 8; i += 1) parts.push(chunk);
    parts.push(Buffer.alloc(1, 65));
    const reply = await env.upload('sessionId=s1&name=big.txt', { 'content-type': 'text/plain' }, parts);
    assert.equal(reply.status, 413);
    assert.deepEqual(files(env.dir), []);
  } finally {
    await env.close();
  }
});

test('type rules: svg, zip, unknown octet-stream and fake images are refused', async () => {
  const env = await setup();
  try {
    const text = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal((await env.upload('sessionId=s1&name=a.svg', { 'content-type': 'image/svg+xml' }, [text])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.zip', { 'content-type': 'application/zip' }, [PNG])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.exe', { 'content-type': 'application/octet-stream' }, [text])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.png', { 'content-type': 'image/png' }, [text])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.pdf', { 'content-type': 'application/pdf' }, [text])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/plain' }, [Buffer.from([65, 0, 66])])).status, 415);
    assert.equal((await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/plain' }, [])).status, 400);
    assert.deepEqual(files(env.dir), []);
  } finally {
    await env.close();
  }
});

test('type rules: octet-stream passes only for listed extensions, pdf and json pass, image mime follows the bytes', async () => {
  const env = await setup();
  try {
    const md = await env.upload('sessionId=s1&name=notes.md', { 'content-type': 'application/octet-stream' }, [Buffer.from('# hi')]);
    assert.equal(md.status, 200);
    assert.equal(md.json.mime, 'application/octet-stream');
    assert.equal((await env.upload('sessionId=s1&name=a.pdf', { 'content-type': 'application/pdf' }, [PDF])).status, 200);
    assert.equal((await env.upload('sessionId=s1&name=a.json', { 'content-type': 'application/json' }, [Buffer.from('{}')])).status, 200);
    const sniffed = await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/plain' }, [PNG]);
    assert.equal(sniffed.status, 200);
    assert.equal(sniffed.json.mime, 'image/png');
    const jpeg = await env.upload('sessionId=s1&name=a.jpg', { 'content-type': 'image/png' }, [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])]);
    assert.equal(jpeg.json.mime, 'image/jpeg');
    const gif = await env.upload('sessionId=s1&name=a.gif', { 'content-type': 'image/gif' }, [Buffer.from('GIF89a......')]);
    assert.equal(gif.json.mime, 'image/gif');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    assert.equal((await env.upload('sessionId=s1&name=a.webp', { 'content-type': 'image/webp' }, [webp])).json.mime, 'image/webp');
    const parameterised = await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/plain; charset=utf-8' }, [Buffer.from('x')]);
    assert.equal(parameterised.json.mime, 'text/plain');
  } finally {
    await env.close();
  }
});

test('refusals: missing header, no auth, unknown or non-dock session, ninth unsent upload', async () => {
  const env = await setup();
  try {
    const plain = (query: string, headers: Record<string, string>) => request(env.port, 'POST', `/api/chat/attachments?${query}`, { 'content-type': 'text/plain', ...headers }, [Buffer.from('x')]);
    assert.equal((await plain('sessionId=s1&name=a.txt', {})).status, 403);
    env.state.authorized = false;
    assert.equal((await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')])).status, 401);
    env.state.authorized = true;
    assert.equal((await env.upload('sessionId=nope&name=a.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')])).status, 404);
    assert.equal((await env.upload('sessionId=s2&name=a.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')])).status, 404);
    assert.equal((await env.upload('name=a.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')])).status, 400);
    for (let i = 0; i < ATTACHMENT_LIMITS.unsentPerSession; i += 1) {
      assert.equal((await env.upload(`sessionId=s1&name=${i}.txt`, { 'content-type': 'text/plain' }, [Buffer.from('x')])).status, 200);
    }
    const ninth = await env.upload('sessionId=s1&name=9.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')]);
    assert.equal(ninth.status, 409);
    assert.equal(files(env.dir).length, ATTACHMENT_LIMITS.unsentPerSession);
  } finally {
    await env.close();
  }
});

test('a third concurrent upload gets 429', async () => {
  const env = await setup();
  try {
    const open = () => new Promise<http.ClientRequest>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: env.port, method: 'POST', path: '/api/chat/attachments?sessionId=s1&name=a.txt', headers: { 'x-dock-upload': '1', 'content-type': 'text/plain' } });
      req.on('error', () => undefined);
      req.write('partial', () => resolve(req));
    });
    const first = await open();
    const second = await open();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const third = await env.upload('sessionId=s1&name=c.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')]);
    assert.equal(third.status, 429);
    first.destroy();
    second.destroy();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await env.upload('sessionId=s1&name=d.txt', { 'content-type': 'text/plain' }, [Buffer.from('x')]);
    assert.equal(after.status, 200);
    assert.equal(files(env.dir).length, 1);
  } finally {
    await env.close();
  }
});

test('GET serves with nosniff, inline images and attachment for the rest; DELETE only while uploaded', async () => {
  const env = await setup();
  try {
    const image = await env.upload('sessionId=s1&name=a.png', { 'content-type': 'image/png' }, [PNG]);
    const pdf = await env.upload('sessionId=s1&name=a.pdf', { 'content-type': 'application/pdf' }, [PDF]);
    const asImage = await request(env.port, 'GET', `/api/chat/attachments/${image.json.id}`, {});
    assert.equal(asImage.status, 200);
    assert.equal(asImage.headers['x-content-type-options'], 'nosniff');
    assert.equal(asImage.headers['cache-control'], 'private, max-age=3600');
    assert.equal(asImage.headers['content-type'], 'image/png');
    assert.ok(!asImage.headers['content-disposition']?.startsWith('attachment'));
    assert.ok(asImage.body.equals(PNG));
    const asPdf = await request(env.port, 'GET', `/api/chat/attachments/${pdf.json.id}`, {});
    assert.ok(asPdf.headers['content-disposition']?.startsWith('attachment'));
    assert.equal((await request(env.port, 'GET', '/api/chat/attachments/not-an-id', {})).status, 404);
    assert.equal((await request(env.port, 'GET', `/api/chat/attachments/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, {})).status, 404);
    env.state.authorized = false;
    assert.equal((await request(env.port, 'GET', `/api/chat/attachments/${image.json.id}`, {})).status, 401);
    env.state.authorized = true;

    assert.equal((await request(env.port, 'DELETE', `/api/chat/attachments/${image.json.id}`, {})).status, 403);
    assert.equal((await request(env.port, 'DELETE', `/api/chat/attachments/${image.json.id}`, { 'x-dock-upload': '1' })).status, 200);
    assert.equal(existsSync(path.join(env.dir, image.json.id)), false);
    assert.equal(await env.store.get(image.json.id), null);
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'queued' });
    await env.service.attach('s1', 1, [pdf.json.id]);
    assert.equal((await request(env.port, 'DELETE', `/api/chat/attachments/${pdf.json.id}`, { 'x-dock-upload': '1' })).status, 409);
    assert.equal(existsSync(path.join(env.dir, pdf.json.id)), true);
  } finally {
    await env.close();
  }
});

async function seed(env: Awaited<ReturnType<typeof setup>>, name = 'a.txt', content = 'abc') {
  const reply = await env.upload('sessionId=s1&name=' + name, { 'content-type': 'text/plain' }, [Buffer.from(content)]);
  assert.equal(reply.status, 200);
  return reply.json.id as string;
}

test('attach validates ids, session, state and count', async () => {
  const env = await setup();
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'queued' });
    const a = await seed(env, 'a.txt');
    const b = await seed(env, 'b.txt');
    await assert.rejects(env.service.attach('s1', 1, ['nope']), OrchestratorInputError);
    await assert.rejects(env.service.attach('s1', 1, [a, a]), OrchestratorInputError);
    await assert.rejects(env.service.attach('s2', 1, [a]), OrchestratorInputError);
    const views = await env.service.attach('s1', 1, [a, b]);
    assert.deepEqual(views.map((view) => [view.name, view.state]), [['a.txt', 'attached'], ['b.txt', 'attached']]);
    await assert.rejects(env.service.attach('s1', 2, [a]), OrchestratorInputError);
    const many: string[] = [];
    for (let i = 0; i < 5; i += 1) many.push(await seed(env, `m${i}.txt`));
    await assert.rejects(env.service.attach('s1', 3, many), OrchestratorInputError);
    assert.equal((await env.store.get(many[0]))?.state, 'uploaded');
    assert.deepEqual(await env.service.attach('s1', 4, []), []);
  } finally {
    await env.close();
  }
});

test('forMessages groups by message, forClaim lists sendable files with their hash', async () => {
  const env = await setup();
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'queued' });
    env.sessionLookup.messages.set(2, { id: 2, sessionId: 's1', state: 'queued' });
    const a = await seed(env, 'a.txt', 'one');
    const b = await seed(env, 'b.txt', 'two');
    await env.service.attach('s1', 1, [a]);
    await env.service.attach('s1', 2, [b]);
    const grouped = await env.service.forMessages([1, 2, 3]);
    assert.deepEqual([...grouped.keys()].sort(), [1, 2]);
    assert.equal(grouped.get(1)?.[0].name, 'a.txt');
    assert.deepEqual(Object.keys(grouped.get(1)?.[0] ?? {}).sort(), ['id', 'mime', 'name', 'size', 'state']);
    assert.deepEqual((await env.service.forMessages([])).size, 0);
    const claim = await env.service.forClaim(1);
    assert.equal(claim.length, 1);
    assert.deepEqual(Object.keys(claim[0]).sort(), ['id', 'mime', 'name', 'sha256', 'size']);
    assert.equal(claim[0].size, 3);
  } finally {
    await env.close();
  }
});

test('openForBridge answers only for the owning machine, a taken message and its own attachment', async () => {
  const env = await setup();
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'taken' });
    env.sessionLookup.messages.set(2, { id: 2, sessionId: 's1', state: 'taken' });
    const id = await seed(env, 'a.txt', 'abc');
    await env.service.attach('s1', 1, [id]);
    const input = { sessionId: 's1', replyTo: 1, id };
    const opened = await env.service.openForBridge(input, 'laptop');
    assert.ok(opened);
    assert.equal(opened?.size, 3);
    assert.equal(readFileSync(opened?.path ?? '', 'utf8'), 'abc');
    assert.equal(opened?.sha256, (await env.store.get(id))?.sha256);
    assert.equal((await env.store.get(id))?.state, 'fetched');
    assert.ok(await env.service.openForBridge(input, 'laptop'));

    assert.equal(await env.service.openForBridge(input, 'workspace'), null);
    assert.equal(await env.service.openForBridge({ ...input, replyTo: 2 }, 'laptop'), null);
    assert.equal(await env.service.openForBridge({ ...input, sessionId: 's2' }, 'laptop'), null);
    assert.equal(await env.service.openForBridge({ ...input, id: '00000000-0000-4000-8000-000000000000' }, 'laptop'), null);
    for (const bad of [null, 'x', {}, { ...input, replyTo: 'one' }, { ...input, replyTo: 0 }, { ...input, id: '../x' }, { ...input, sessionId: '../s1' }]) {
      assert.equal(await env.service.openForBridge(bad, 'laptop'), null);
    }
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'done' });
    assert.equal(await env.service.openForBridge(input, 'laptop'), null);
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'taken' });
    rmSync(path.join(env.dir, id));
    assert.equal(await env.service.openForBridge(input, 'laptop'), null);
  } finally {
    await env.close();
  }
});

test('openForBridge refuses an unsent upload', async () => {
  const env = await setup();
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'taken' });
    const id = await seed(env);
    assert.equal(await env.service.openForBridge({ sessionId: 's1', replyTo: 1, id }, 'laptop'), null);
  } finally {
    await env.close();
  }
});

test('retention: unsent after 1 hour, sent after 7 days keeping the row, throttled to once an hour', async () => {
  const env = await setup();
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'queued' });
    const sent = await seed(env, 'sent.txt');
    const unsent = await seed(env, 'unsent.txt');
    await env.service.attach('s1', 1, [sent]);
    const start = env.clock.now;

    await env.service.prune(new Date(start.getTime() + 30 * 60 * 1000));
    assert.equal(files(env.dir).length, 2);

    await env.service.prune(new Date(start.getTime() + 91 * 60 * 1000));
    assert.equal(existsSync(path.join(env.dir, unsent)), false);
    assert.equal(await env.store.get(unsent), null);
    assert.equal(existsSync(path.join(env.dir, sent)), true);

    await env.service.prune(new Date(start.getTime() + 7 * DAY + 2 * HOUR));
    assert.equal(existsSync(path.join(env.dir, sent)), false);
    const row = await env.store.get(sent);
    assert.equal(row?.state, 'deleted');
    assert.equal(row?.name, 'sent.txt');
    const grouped = await env.service.forMessages([1]);
    assert.equal(grouped.get(1)?.[0].state, 'deleted');
    assert.deepEqual(await env.service.forClaim(1), []);
  } finally {
    await env.close();
  }
});

test('retention: prune does not run twice within an hour', async () => {
  const env = await setup();
  try {
    const id = await seed(env);
    const start = env.clock.now;
    await env.service.prune(start);
    await env.service.prune(new Date(start.getTime() + 2 * HOUR - 1));
    assert.equal(await env.store.get(id), null);
    const again = await seed(env, 'again.txt');
    await env.service.prune(new Date(start.getTime() + 2 * HOUR));
    assert.ok(await env.store.get(again));
    await env.service.prune(new Date(start.getTime() + 3 * HOUR + 1));
    assert.equal(await env.store.get(again), null);
  } finally {
    await env.close();
  }
});

test('retention: over the total cap the oldest files go first', async () => {
  const clock = { now: new Date('2026-10-12T10:00:00Z') };
  const env = await setup({ clock });
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'queued' });
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'done' });
    const make = async (index: number, size: number, messageId = 1) => {
      const id = `00000000-0000-4000-8000-00000000000${index}`;
      writeFileSync(path.join(env.dir, id), Buffer.alloc(size, 1));
      await env.store.create({
        id, sessionId: 's1', messageId, name: `f${index}.txt`, mime: 'text/plain', size, sha256: 'x'.repeat(64),
        state: 'attached', createdAt: new Date(clock.now.getTime() + index * 1000), fetchedAt: null,
      });
      return id;
    };
    const chunk = 100 * 1024 * 1024;
    const ids = [await make(1, chunk), await make(2, chunk), await make(3, chunk), await make(4, chunk)];
    await env.service.prune(new Date(clock.now.getTime() + 10 * 1000));
    assert.equal(existsSync(path.join(env.dir, ids[0])), false);
    assert.equal((await env.store.get(ids[0]))?.state, 'deleted');
    for (const id of ids.slice(1)) assert.equal(existsSync(path.join(env.dir, id)), true);
  } finally {
    await env.close();
  }
});

test('deleteForSession removes files and rows of that session only', async () => {
  const env = await setup();
  try {
    env.sessionLookup.sessions.set('s3', { id: 's3', source: 'dock', machine: 'laptop' });
    const mine = await seed(env);
    const other = (await env.upload('sessionId=s3&name=o.txt', { 'content-type': 'text/plain' }, [Buffer.from('o')])).json.id as string;
    await env.service.deleteForSession('s1');
    assert.equal(existsSync(path.join(env.dir, mine)), false);
    assert.equal(await env.store.get(mine), null);
    assert.equal(existsSync(path.join(env.dir, other)), true);
    assert.ok(await env.store.get(other));
  } finally {
    await env.close();
  }
});

test('attach is all or nothing when a file is taken between the check and the update', async () => {
  const env = await setup();
  try {
    const first = await seed(env, 'a.txt');
    const second = await seed(env, 'b.txt');
    const getMany = env.store.getMany;
    env.store.getMany = async (ids) => {
      const found = await getMany(ids);
      await env.store.update(second, { messageId: 99, state: 'attached' });
      return found;
    };
    await assert.rejects(env.service.attach('s1', 1, [first, second]), OrchestratorInputError);
    assert.deepEqual([(await env.store.get(first))?.state, (await env.store.get(first))?.messageId], ['uploaded', null]);
    assert.deepEqual([(await env.store.get(second))?.state, (await env.store.get(second))?.messageId], ['attached', 99]);
  } finally {
    await env.close();
  }
});

test('release hands the files of a message back as unsent uploads', async () => {
  const env = await setup();
  try {
    const id = await seed(env);
    await env.service.attach('s1', 7, [id]);
    await env.service.release(7);
    assert.deepEqual([(await env.store.get(id))?.state, (await env.store.get(id))?.messageId], ['uploaded', null]);
  } finally {
    await env.close();
  }
});

test('discard deletes only a file that is still unsent at the moment of the delete', async () => {
  const env = await setup();
  try {
    const id = await seed(env);
    const get = env.store.get;
    env.store.get = async (target) => {
      const row = await get(target);
      await env.store.update(id, { messageId: 1, state: 'attached' });
      return row;
    };
    assert.equal(await env.service.discard(id), 'sent');
    assert.equal(existsSync(path.join(env.dir, id)), true);
    assert.equal((await get(id))?.state, 'attached');
  } finally {
    await env.close();
  }
});

test('retention: a file with no row goes after the safe margin, a row of a deleted file after 30 days', async () => {
  const env = await setup();
  try {
    const now = new Date(env.clock.now.getTime() + 2 * HOUR);
    const place = (name: string, ageMs: number) => {
      const file = path.join(env.dir, name);
      writeFileSync(file, 'x');
      const at = new Date(now.getTime() - ageMs);
      utimesSync(file, at, at);
    };
    const kept = await seed(env);
    await env.service.attach('s1', 1, [kept]);
    place(kept, 5 * HOUR);
    place('00000000-0000-4000-8000-0000000000a1', 2 * HOUR);
    place('00000000-0000-4000-8000-0000000000a2', 60 * 1000);
    place('notes.txt', 2 * HOUR);
    const deleted = (id: string, ageMs: number) => ({
      id, sessionId: 's1', messageId: 1, name: 'gone.txt', mime: 'text/plain', size: 1, sha256: 'x'.repeat(64),
      state: 'deleted', createdAt: new Date(now.getTime() - ageMs), fetchedAt: null,
    });
    await env.store.create(deleted('00000000-0000-4000-8000-0000000000b1', 31 * DAY));
    await env.store.create(deleted('00000000-0000-4000-8000-0000000000b2', 10 * DAY));
    await env.service.prune(now);
    assert.deepEqual(files(env.dir).sort(), [kept, '00000000-0000-4000-8000-0000000000a2', 'notes.txt'].sort());
    assert.equal(await env.store.get('00000000-0000-4000-8000-0000000000b1'), null);
    assert.ok(await env.store.get('00000000-0000-4000-8000-0000000000b2'));
  } finally {
    await env.close();
  }
});

test('retention: files of a draft, queued or taken message are never evicted', async () => {
  const clock = { now: new Date('2026-10-12T10:00:00Z') };
  const env = await setup({ clock });
  try {
    env.sessionLookup.messages.set(1, { id: 1, sessionId: 's1', state: 'taken' });
    env.sessionLookup.messages.set(2, { id: 2, sessionId: 's1', state: 'done' });
    const chunk = 100 * 1024 * 1024;
    const make = async (index: number, messageId: number) => {
      const id = `00000000-0000-4000-8000-00000000000${index}`;
      writeFileSync(path.join(env.dir, id), Buffer.alloc(chunk, 1));
      await env.store.create({
        id, sessionId: 's1', messageId, name: `f${index}.txt`, mime: 'text/plain', size: chunk, sha256: 'x'.repeat(64),
        state: 'attached', createdAt: new Date(clock.now.getTime() + index * 1000), fetchedAt: null,
      });
      return id;
    };
    const ids = [await make(1, 1), await make(2, 2), await make(3, 2), await make(4, 2)];
    await env.service.prune(new Date(clock.now.getTime() + 10 * 1000));
    assert.equal(existsSync(path.join(env.dir, ids[0])), true);
    assert.equal((await env.store.get(ids[0]))?.state, 'attached');
    assert.equal(existsSync(path.join(env.dir, ids[1])), false);
    assert.equal((await env.store.get(ids[1]))?.state, 'deleted');
    for (const id of ids.slice(2)) assert.equal(existsSync(path.join(env.dir, id)), true);
  } finally {
    await env.close();
  }
});

test('the stored mime comes from a fixed list, whatever the request header says', async () => {
  const env = await setup();
  try {
    const odd = await env.upload('sessionId=s1&name=a.txt', { 'content-type': 'text/x-weird; charset=utf-8' }, [Buffer.from('a')]);
    assert.equal(odd.json.mime, 'text/plain');
    const long = await env.upload('sessionId=s1&name=b.txt', { 'content-type': `text/${'a'.repeat(300)}` }, [Buffer.from('b')]);
    assert.equal(long.json.mime, 'text/plain');
    const markdown = await env.upload('sessionId=s1&name=c.md', { 'content-type': 'text/markdown' }, [Buffer.from('c')]);
    assert.equal(markdown.json.mime, 'text/markdown');
    const octet = await env.upload('sessionId=s1&name=d.md', { 'content-type': 'application/octet-stream' }, [Buffer.from('d')]);
    assert.equal(octet.json.mime, 'application/octet-stream');
    assert.equal((await env.store.get(long.json.id))?.mime, 'text/plain');
  } finally {
    await env.close();
  }
});

test('a client that aborts a download releases the file stream', async () => {
  const env = await setup();
  const original = fs.createReadStream;
  const opened: fs.ReadStream[] = [];
  mock.method(fs, 'createReadStream', (...args: Parameters<typeof original>) => {
    const stream = original(...args);
    opened.push(stream);
    return stream;
  });
  try {
    const size = 48 * 1024 * 1024;
    const id = '00000000-0000-4000-8000-0000000000c1';
    writeFileSync(path.join(env.dir, id), Buffer.alloc(size, 1));
    await env.store.create({
      id, sessionId: 's1', messageId: null, name: 'big.pdf', mime: 'application/pdf', size,
      sha256: 'x'.repeat(64), state: 'uploaded', createdAt: env.clock.now, fetchedAt: null,
    });
    for (let round = 0; round < 3; round += 1) {
      await new Promise<void>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: env.port, path: `/api/chat/attachments/${id}`, agent: false }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => undefined);
        req.end();
      });
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && opened.some((stream) => !stream.destroyed)) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(opened.length, 3);
    assert.deepEqual(opened.map((stream) => stream.destroyed), [true, true, true]);
  } finally {
    mock.restoreAll();
    await env.close();
  }
});
