import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { createApp } from '../app';
import { OrchestratorService } from '../integrations/orchestrator';
import { createBrainProxyRouter } from '../routes/brain';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import type { StorageService } from '../storage/service';

const SECRET = 'a'.repeat(32) + 'internal-secret-canary';
const CANARY = 'canary-upstream-body-7f3a';
const OPS = ['retrieve', 'search', 'read', 'save', 'ingest', 'status'];

function tokenStorage() {
  const tokens: any[] = [];
  let sequence = 0;
  const storage = {
    getIngestTokens: async () => tokens.filter((token) => !token.revokedAt),
    countIngestTokens: async () => tokens.filter((token) => !token.revokedAt).length,
    createIngestToken: async (data: any) => {
      const token = { id: String((sequence += 1)), machine: 'laptop', ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
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
  return storage as unknown as StorageService;
}

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type UpstreamHandler = (request: http.IncomingMessage, response: http.ServerResponse, seen: Seen) => void;

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function startUpstream(handler: UpstreamHandler = (_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, result: { fake: true } }));
}) {
  const calls: Seen[] = [];
  const sockets = new Set<net.Socket>();
  const state = { handler };
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const seen = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
      calls.push(seen);
      state.handler(request, response, seen);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    calls,
    state,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

async function closedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startDock(router: express.Router, mount = '/ingest/brain') {
  const app = express();
  app.use(mount, router);
  const server = http.createServer(app);
  const port = await listen(server);
  return { port, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

const transcript: string[] = [];

function raw(port: number, path: string, options: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: options.method ?? 'POST', agent: false,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    }, (reply) => {
      const chunks: Buffer[] = [];
      reply.on('data', (chunk: Buffer) => chunks.push(chunk));
      reply.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        transcript.push(text, JSON.stringify(reply.headers));
        resolve({ status: reply.statusCode ?? 0, headers: reply.headers, text });
      });
    });
    request.on('error', reject);
    request.end(options.method === 'GET' ? undefined : options.body ?? '{}');
  });
}

async function withLogs<T>(work: () => Promise<T>) {
  const lines: string[] = [];
  const { warn, error, log } = console;
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.warn = capture;
  console.error = capture;
  console.log = capture;
  try {
    const result = await work();
    return { result, lines };
  } finally {
    console.warn = warn;
    console.error = error;
    console.log = log;
  }
}

async function setup(t: test.TestContext, options: { handler?: UpstreamHandler; limits?: Parameters<typeof createBrainProxyRouter>[4]; limiter?: PinRateLimiter; upstream?: string | null; secret?: string } = {}) {
  const service = new OrchestratorService(tokenStorage(), os.tmpdir());
  const laptop = (await service.createToken('laptop')).token;
  const workspace = (await service.createToken('workspace', 'workspace')).token;
  const upstream = await startUpstream(options.handler);
  const router = createBrainProxyRouter(
    service,
    options.limiter ?? new PinRateLimiter(1000, 60_000),
    options.upstream === undefined ? upstream.url : options.upstream ?? '',
    options.secret ?? SECRET,
    options.limits,
  );
  const dock = await startDock(router);
  t.after(async () => {
    await dock.close();
    await upstream.close();
  });
  const call = (op: string, token: string | null, body: unknown = {}, extra: Record<string, string> = {}) => raw(dock.port, `/ingest/brain/${op}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { service, laptop, workspace, upstream, dock, call };
}

test('forwards each allowlisted op with the machine from the token and the internal secret', async (t) => {
  const { upstream, laptop, workspace, call } = await setup(t);

  for (const op of OPS) {
    const answer = await call(op, laptop, { query: 'deploy', machine: 'workspace' });
    assert.strictEqual(answer.status, 200, op);
    assert.deepStrictEqual(JSON.parse(answer.text), { ok: true, result: { fake: true } });
    const seen = upstream.calls.at(-1)!;
    assert.strictEqual(seen.method, 'POST');
    assert.strictEqual(seen.url, `/v1/${op}`);
    assert.strictEqual(seen.headers['x-brain-machine'], 'laptop');
    assert.strictEqual(seen.headers['x-brain-secret'], SECRET);
    assert.strictEqual(seen.headers['content-type'], 'application/json');
    assert.deepStrictEqual(Object.keys(seen.headers).sort(), ['connection', 'content-length', 'content-type', 'host', 'x-brain-machine', 'x-brain-secret']);
    assert.deepStrictEqual(JSON.parse(seen.body), { query: 'deploy' }, 'a body machine field is never forwarded');
  }

  const own = await call('retrieve', workspace, { machine: 'laptop', query: 'x' });
  assert.strictEqual(own.status, 200);
  assert.strictEqual(upstream.calls.at(-1)!.headers['x-brain-machine'], 'workspace');
});

test('caller headers never reach the Brain service', async (t) => {
  const { upstream, workspace, dock } = await setup(t);
  const answer = await raw(dock.port, '/ingest/brain/status', {
    headers: {
      authorization: `Bearer ${workspace}`,
      'x-brain-machine': 'laptop',
      'x-brain-secret': 'guess',
      'x-brain-admin': '1',
      'x-forwarded-for': '10.0.0.9',
      'x-forwarded-host': 'evil.example',
      forwarded: 'for=10.0.0.9',
      cookie: 'dock_session=abc',
      host: 'evil.example',
    },
  });
  assert.strictEqual(answer.status, 200);
  const seen = upstream.calls.at(-1)!;
  assert.strictEqual(seen.headers['x-brain-machine'], 'workspace');
  assert.strictEqual(seen.headers['x-brain-secret'], SECRET);
  for (const name of ['authorization', 'x-brain-admin', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cookie']) {
    assert.strictEqual(seen.headers[name], undefined, name);
  }
  assert.strictEqual(seen.headers.host, `127.0.0.1:${upstream.port}`);
});

test('an unknown op never reaches the Brain service', async (t) => {
  const { upstream, laptop, dock } = await setup(t);
  const paths = [
    '/ingest/brain/delete',
    '/ingest/brain/..',
    '/ingest/brain/%2e%2e',
    '/ingest/brain/status%2Fx',
    '/ingest/brain/..%2Fhealthz',
    '/ingest/brain/status/extra',
    '/ingest/brain/status/',
    '/ingest/brain/',
    '/ingest/brain',
    '/ingest/brain/Status',
    '/ingest/brain/status%00',
    '/ingest/brain/delete?op=status',
    '/ingest/brain//status',
  ];
  for (const path of paths) {
    const answer = await raw(dock.port, path, { headers: { authorization: `Bearer ${laptop}` } });
    const expected = path === '/ingest/brain/status/' || path === '/ingest/brain//status' ? 200 : 404;
    assert.strictEqual(answer.status, expected, path);
    if (expected === 404) assert.deepStrictEqual(JSON.parse(answer.text), { error: 'Unknown Brain operation' }, path);
  }
  const get = await raw(dock.port, '/ingest/brain/status', { method: 'GET', headers: { authorization: `Bearer ${laptop}` } });
  assert.strictEqual(get.status, 404);
  assert.deepStrictEqual(upstream.calls.map((call) => call.url), ['/v1/status', '/v1/status'], 'only slash variants of a real op got through, on the fixed path');
});

test('the query string never reaches the Brain service', async (t) => {
  const { upstream, laptop, dock } = await setup(t);
  const answer = await raw(dock.port, '/ingest/brain/read?path=../../etc/passwd&host=evil', { headers: { authorization: `Bearer ${laptop}` } });
  assert.strictEqual(answer.status, 200);
  assert.strictEqual(upstream.calls.at(-1)!.url, '/v1/read');
});

test('missing, wrong and revoked tokens are refused exactly like the orchestrator routes', async (t) => {
  const service = new OrchestratorService(tokenStorage(), os.tmpdir());
  const live = await service.createToken('laptop');
  const revoked = await service.createToken('laptop');
  await service.revokeToken(revoked.record.id);
  const upstream = await startUpstream();
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(1000, 60_000)));
  app.use('/ingest/brain', createBrainProxyRouter(service, new PinRateLimiter(1000, 60_000), upstream.url, SECRET));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await upstream.close();
  });

  for (const bearer of [null, 'dock_ing_wrong', revoked.token, 'not-a-dock-token']) {
    const headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
    const reference = await raw(port, '/ingest/orchestrator/ledger/list', { headers });
    for (const op of ['status', 'delete']) {
      const answer = await raw(port, `/ingest/brain/${op}`, { headers });
      assert.strictEqual(answer.status, 401, `${bearer} ${op}`);
      assert.strictEqual(answer.text, reference.text);
      assert.strictEqual(reference.status, 401);
    }
  }
  assert.strictEqual((await raw(port, '/ingest/brain/status', { headers: { authorization: `Bearer ${live.token}` } })).status, 200);
  assert.deepStrictEqual(upstream.calls.length, 1);
});

test('failed attempts are throttled and valid tokens are not locked out', async (t) => {
  const { laptop, call, upstream } = await setup(t, { limiter: new PinRateLimiter(2, 60_000) });
  assert.strictEqual((await call('status', null)).status, 401);
  assert.strictEqual((await call('status', 'dock_ing_wrong')).status, 401);
  const throttled = await call('status', 'dock_ing_wrong');
  assert.strictEqual(throttled.status, 429);
  assert.ok(Number(throttled.headers['retry-after']) > 0);
  assert.deepStrictEqual(JSON.parse(throttled.text), { error: 'Too many failed attempts' });
  assert.strictEqual((await call('status', laptop)).status, 200);
  assert.strictEqual(upstream.calls.length, 1);
});

test('a body over the limit is refused before the Brain service is called', async (t) => {
  const { laptop, call, upstream } = await setup(t);
  const big = await call('save', laptop, JSON.stringify({ context: 'x'.repeat(65 * 1024) }));
  assert.strictEqual(big.status, 413);
  assert.deepStrictEqual(JSON.parse(big.text), { error: 'Payload too large' });
  const fits = await call('save', laptop, JSON.stringify({ context: 'x'.repeat(60 * 1024) }));
  assert.strictEqual(fits.status, 200);
  const broken = await call('save', laptop, '{not json');
  assert.strictEqual(broken.status, 400);
  assert.strictEqual(upstream.calls.length, 1);
});

test('an upstream that is slow, down or answers badly becomes a clean JSON error', async (t) => {
  const { laptop, call, upstream } = await setup(t, { limits: { timeoutMs: 150, maxResponseBytes: 1000 } });

  upstream.state.handler = () => undefined;
  const { result: slow, lines: slowLogs } = await withLogs(() => call('retrieve', laptop));
  assert.strictEqual(slow.status, 504);
  assert.deepStrictEqual(JSON.parse(slow.text), { error: 'Brain timed out' });
  assert.deepStrictEqual(slowLogs, ['[Brain] upstream timeout (op=retrieve)']);

  upstream.state.handler = (_request, response) => { response.setHeader('content-type', 'text/html'); response.end(`<html>${CANARY}</html>`); };
  const { result: html, lines: htmlLogs } = await withLogs(() => call('search', laptop));
  assert.strictEqual(html.status, 502);
  assert.deepStrictEqual(JSON.parse(html.text), { error: 'Brain returned an invalid response' });
  assert.ok(!html.text.includes(CANARY));
  assert.ok(!htmlLogs.join('\n').includes(CANARY));

  upstream.state.handler = (_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, result: { blob: 'y'.repeat(5000) } })); };
  const { result: huge, lines: hugeLogs } = await withLogs(() => call('read', laptop));
  assert.strictEqual(huge.status, 502);
  assert.ok(!huge.text.includes('yyyy'));
  assert.deepStrictEqual(hugeLogs, ['[Brain] upstream invalid (op=read)']);

  upstream.state.handler = (_request, response) => {
    response.write(JSON.stringify({ ok: true, result: { blob: 'z'.repeat(600) } }).slice(0, 600));
    setTimeout(() => response.end('w'.repeat(900)), 10);
  };
  const chunked = await call('read', laptop);
  assert.strictEqual(chunked.status, 502, 'a response without content-length is cut off at the limit too');
  assert.ok(!chunked.text.includes('zzzz'));

  upstream.state.handler = (_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, result: { echoed: SECRET } })); };
  const echoed = await call('status', laptop);
  assert.strictEqual(echoed.status, 502, 'an answer that carries the internal secret is not relayed');
  assert.ok(!echoed.text.includes(SECRET));

  upstream.state.handler = (_request, response) => { response.destroy(); };
  const dropped = await call('status', laptop);
  assert.strictEqual(dropped.status, 503);
  assert.deepStrictEqual(JSON.parse(dropped.text), { error: 'Brain is unavailable' });
});

test('an unreachable upstream answers 503 and logs no address', async (t) => {
  const port = await closedPort();
  const { laptop, call } = await setup(t, { upstream: `http://127.0.0.1:${port}` });
  const { result, lines } = await withLogs(() => call('status', laptop));
  assert.strictEqual(result.status, 503);
  assert.deepStrictEqual(JSON.parse(result.text), { error: 'Brain is unavailable' });
  assert.deepStrictEqual(lines, ['[Brain] upstream unreachable (op=status)']);
  assert.ok(!result.text.includes(String(port)) && !lines.join('').includes(String(port)));
});

test('upstream error bodies are never relayed', async (t) => {
  const { laptop, call, upstream } = await setup(t);
  const cases: Array<[number, number, string | undefined]> = [
    [400, 400, undefined],
    [403, 403, undefined],
    [404, 404, undefined],
    [413, 413, undefined],
    [429, 429, '30'],
    [507, 507, undefined],
    [401, 502, undefined],
    [500, 502, undefined],
    [503, 502, undefined],
    [302, 502, undefined],
    [201, 502, undefined],
  ];
  const { lines } = await withLogs(async () => {
    for (const [from, to, retryAfter] of cases) {
      upstream.state.handler = (_request, response) => {
        response.statusCode = from;
        response.setHeader('content-type', 'application/json');
        response.setHeader('x-leak', CANARY);
        response.setHeader('set-cookie', `leak=${CANARY}`);
        if (from === 429) response.setHeader('retry-after', '30');
        response.end(JSON.stringify({ error: `${CANARY} at http://${upstream.url} with ${SECRET}`, stack: CANARY }));
      };
      const answer = await call('retrieve', laptop);
      assert.strictEqual(answer.status, to, String(from));
      assert.ok(!answer.text.includes(CANARY) && !JSON.stringify(answer.headers).includes(CANARY), String(from));
      assert.strictEqual(answer.headers['retry-after'], retryAfter);
      assert.strictEqual(answer.headers['set-cookie'], undefined);
      assert.strictEqual(typeof JSON.parse(answer.text).error, 'string');
    }
  });
  assert.ok(!lines.join('\n').includes(CANARY));
  assert.ok(!lines.join('\n').includes(SECRET));

  upstream.state.handler = (_request, response) => { response.statusCode = 429; response.setHeader('retry-after', `${CANARY}`); response.end('{}'); };
  const odd = await call('retrieve', laptop);
  assert.strictEqual(odd.status, 429);
  assert.strictEqual(odd.headers['retry-after'], undefined, 'only a plain number of seconds is passed on');
});

test('the status of a successful answer and its JSON are relayed, headers are not', async (t) => {
  const { laptop, call, upstream } = await setup(t);
  upstream.state.handler = (_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('set-cookie', 'a=b');
    response.setHeader('x-powered-by', 'brain');
    response.end(JSON.stringify({ ok: true, result: { hits: [{ path: 'wiki/sources/x.md' }] } }));
  };
  const answer = await call('retrieve', laptop);
  assert.strictEqual(answer.status, 200);
  assert.deepStrictEqual(JSON.parse(answer.text), { ok: true, result: { hits: [{ path: 'wiki/sources/x.md' }] } });
  assert.strictEqual(answer.headers['set-cookie'], undefined);
  assert.notStrictEqual(answer.headers['x-powered-by'], 'brain');
});

test('at most four requests per machine run at once', async (t) => {
  const { laptop, workspace, call, upstream } = await setup(t);
  const held: http.ServerResponse[] = [];
  upstream.state.handler = (_request, response) => { held.push(response); };
  const waitFor = async (count: number) => {
    for (let attempt = 0; attempt < 100 && held.length < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(held.length, count);
  };
  const release = () => {
    for (const response of held.splice(0)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, result: {} }));
    }
  };

  const running = [1, 2, 3, 4].map(() => call('retrieve', laptop));
  await waitFor(4);
  const fifth = await call('retrieve', laptop);
  assert.strictEqual(fifth.status, 429);
  assert.deepStrictEqual(JSON.parse(fifth.text), { error: 'Too many concurrent Brain requests' });
  assert.strictEqual(held.length, 4, 'the fifth call never reached the Brain service');

  const other = call('retrieve', workspace);
  await waitFor(5);
  release();
  assert.deepStrictEqual((await Promise.all([...running, other])).map((answer) => answer.status), [200, 200, 200, 200, 200]);

  upstream.state.handler = (_request, response) => { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); };
  assert.strictEqual((await call('retrieve', laptop)).status, 200, 'the slots are released');
});

test('a slow upstream frees its slot when it times out', async (t) => {
  const { laptop, call, upstream } = await setup(t, { limits: { timeoutMs: 100 } });
  upstream.state.handler = () => undefined;
  const answers = await Promise.all([1, 2, 3, 4].map(() => call('retrieve', laptop)));
  assert.deepStrictEqual(answers.map((answer) => answer.status), [504, 504, 504, 504]);
  const { result } = await withLogs(() => call('retrieve', laptop));
  assert.strictEqual(result.status, 504, 'a fifth call is admitted once the first four are done');
});

test('without configuration the route answers 503 and calls nothing', async (t) => {
  const service = new OrchestratorService(tokenStorage(), os.tmpdir());
  const { token } = await service.createToken('laptop');
  const upstream = await startUpstream();
  t.after(() => upstream.close());
  const saved = { url: process.env.BRAIN_SERVICE_URL, secret: process.env.BRAIN_INTERNAL_SECRET };
  t.after(() => {
    if (saved.url === undefined) delete process.env.BRAIN_SERVICE_URL; else process.env.BRAIN_SERVICE_URL = saved.url;
    if (saved.secret === undefined) delete process.env.BRAIN_INTERNAL_SECRET; else process.env.BRAIN_INTERNAL_SECRET = saved.secret;
  });

  const variants: Array<[string, express.Router]> = [];
  delete process.env.BRAIN_SERVICE_URL;
  delete process.env.BRAIN_INTERNAL_SECRET;
  variants.push(['environment unset', createBrainProxyRouter(service)]);
  variants.push(['empty strings', createBrainProxyRouter(service, undefined, '', '')]);
  variants.push(['no secret', createBrainProxyRouter(service, undefined, upstream.url, '')]);
  variants.push(['no url', createBrainProxyRouter(service, undefined, '', SECRET)]);
  variants.push(['not a url', createBrainProxyRouter(service, undefined, 'brain:8787', SECRET)]);
  variants.push(['not http', createBrainProxyRouter(service, undefined, 'ftp://127.0.0.1', SECRET)]);

  for (const [name, router] of variants) {
    const dock = await startDock(router);
    try {
      const answer = await raw(dock.port, '/ingest/brain/status', { headers: { authorization: `Bearer ${token}` } });
      assert.strictEqual(answer.status, 503, name);
      assert.deepStrictEqual(JSON.parse(answer.text), { error: 'Brain is not configured' }, name);
      assert.strictEqual((await raw(dock.port, '/ingest/brain/status')).status, 401, `${name}: still needs a token`);
      assert.strictEqual((await raw(dock.port, '/ingest/brain/delete', { headers: { authorization: `Bearer ${token}` } })).status, 404, name);
    } finally {
      await dock.close();
    }
  }
  assert.strictEqual(upstream.calls.length, 0);
});

test('the route needs no PIN session and does not unlock anything else', async (t) => {
  const saved = { url: process.env.BRAIN_SERVICE_URL, secret: process.env.BRAIN_INTERNAL_SECRET };
  delete process.env.BRAIN_SERVICE_URL;
  delete process.env.BRAIN_INTERNAL_SECRET;
  const shell = await createApp({ frontendDistPath: os.tmpdir() });
  const server = http.createServer(shell.app);
  const port = await listen(server);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shell.apolloServer.stop();
    if (saved.url !== undefined) process.env.BRAIN_SERVICE_URL = saved.url;
    if (saved.secret !== undefined) process.env.BRAIN_INTERNAL_SECRET = saved.secret;
  });

  const refused = await raw(port, '/ingest/brain/status');
  assert.strictEqual(refused.status, 401);
  assert.deepStrictEqual(JSON.parse(refused.text), { error: 'A valid ingest token is required' }, 'the token is what is asked for, not a PIN');
  const unknown = await raw(port, '/ingest/brain/status/extra');
  assert.strictEqual(unknown.status, 401);
  const graphql = await raw(port, '/graphql', {
    headers: { 'x-apollo-operation-name': 'probe' },
    body: JSON.stringify({ query: 'mutation { createIngestToken(name: "x", machine: "laptop") { token } }' }),
  });
  assert.ok(!graphql.text.includes('dock_ing_'), 'GraphQL stays locked');
});

test('the internal secret never appears in any response', () => {
  assert.ok(transcript.length > 20);
  for (const text of transcript) assert.ok(!text.includes(SECRET) && !text.includes('internal-secret-canary'));
});
