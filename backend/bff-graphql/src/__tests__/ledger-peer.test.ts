import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { LedgerPeer, ledgerPeerFromEnv, type PeerRun } from '../integrations/ledger-peer';
import { ownRuns } from '../mode';

const run = (key: string, machine: string) => ({ key, machine } as PeerRun);

test('the peer is on only with both its URL and its token', () => {
  assert.strictEqual(ledgerPeerFromEnv({}), null);
  assert.strictEqual(ledgerPeerFromEnv({ DOCK_LEDGER_PEER_URL: 'https://dock.example/ingest/orchestrator' }), null);
  assert.ok(ledgerPeerFromEnv({ DOCK_LEDGER_PEER_URL: 'https://dock.example/ingest/orchestrator', DOCK_LEDGER_PEER_TOKEN: 'dock_x' }) instanceof LedgerPeer);
});

test('each DOCK shows only the runs of its own machine', (t) => {
  const before = process.env.DOCK_MODE;
  t.after(() => { if (before === undefined) delete process.env.DOCK_MODE; else process.env.DOCK_MODE = before; });
  const runs = [run('ZED-1', 'workspace'), run('ZED-2', 'laptop'), run('ZED-3', 'workspace')];
  process.env.DOCK_MODE = 'workspace';
  assert.deepStrictEqual(ownRuns(runs).map((item) => item.key), ['ZED-1', 'ZED-3']);
  process.env.DOCK_MODE = 'laptop';
  assert.deepStrictEqual(ownRuns(runs).map((item) => item.key), ['ZED-2']);
});

test('the peer reads with the bearer token, keeps its last runs through a failed read, and a hanging peer times out', async (t) => {
  const seen: Array<{ url?: string; authorization?: string; body: string }> = [];
  let answer = (response: http.ServerResponse) => { response.end(JSON.stringify({ ok: true, result: [run('ZED-5', 'laptop')] })); };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      seen.push({ url: request.url, authorization: request.headers.authorization, body });
      answer(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const peer = new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator`, 'dock_token', 300, undefined, 300);

  assert.deepStrictEqual(await peer.runs(), [run('ZED-5', 'laptop')]);
  assert.deepStrictEqual(seen[0], { url: '/ingest/orchestrator/runs', authorization: 'Bearer dock_token', body: '{}' });

  answer = (response) => { response.statusCode = 500; response.end('{}'); };
  assert.deepStrictEqual(await peer.runs(), [run('ZED-5', 'laptop')], 'a failed read answers the last runs it read');
  assert.deepStrictEqual(await new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator`, 'dock_token', 300, undefined, 300).runs(), [], 'with nothing read yet a failed read is empty');

  answer = () => undefined;
  const started = Date.now();
  assert.deepStrictEqual(await new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator`, 'dock_token', 300, undefined, 300).runs(), [], 'a hanging peer times out');
  assert.ok(Date.now() - started < 2000);
});

test('the peer goes through its own proxy', async (t) => {
  const target = http.createServer((_request, response) => { response.end(JSON.stringify({ ok: true, result: [] })); });
  const tunnels: string[] = [];
  const proxy = http.createServer((_request, response) => { response.statusCode = 502; response.end(); });
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(request.url ?? '');
    const [host, port] = (request.url ?? '').split(':');
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  for (const server of [target, proxy]) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => Promise.all([target, proxy].map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))));
  const port = (server: http.Server) => (server.address() as { port: number }).port;

  const peer = ledgerPeerFromEnv({
    DOCK_LEDGER_PEER_URL: `http://127.0.0.1:${port(target)}/ingest/orchestrator`,
    DOCK_LEDGER_PEER_TOKEN: 'dock_token',
    DOCK_LEDGER_PEER_PROXY: `http://127.0.0.1:${port(proxy)}`,
  });
  assert.deepStrictEqual(await peer?.runs(), []);
  assert.deepStrictEqual(tunnels, [`127.0.0.1:${port(target)}`]);
});
