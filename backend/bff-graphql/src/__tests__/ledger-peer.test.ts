import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { LedgerPeer, ledgerPeerFromEnv, withPeerRuns, type PeerRun } from '../integrations/ledger-peer';

const run = (key: string, machine: string) => ({ key, machine } as PeerRun);

test('the peer is on only with both its URL and its token', () => {
  assert.strictEqual(ledgerPeerFromEnv({}), null);
  assert.strictEqual(ledgerPeerFromEnv({ DOCK_LEDGER_PEER_URL: 'https://dock.example/ingest/orchestrator' }), null);
  assert.ok(ledgerPeerFromEnv({ DOCK_LEDGER_PEER_URL: 'https://dock.example/ingest/orchestrator', DOCK_LEDGER_PEER_TOKEN: 'dock_x' }) instanceof LedgerPeer);
});

test('peer runs add the other machines, never this machine, and replace a run kept here for a ticket the peer gives away', () => {
  const merged = withPeerRuns([run('ZED-1', 'workspace'), run('ZED-4', 'workspace')], [run('ZED-1', 'laptop'), run('ZED-2', 'laptop'), run('ZED-3', 'workspace')], 'workspace');
  assert.deepStrictEqual(merged.map((item) => [item.key, item.machine, 'peer' in item]), [['ZED-4', 'workspace', false], ['ZED-1', 'laptop', true], ['ZED-2', 'laptop', true]]);
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
  assert.strictEqual(await peer.get('ZED-5'), null);
  assert.strictEqual(seen.at(-1)?.body, '{"key":"ZED-5"}');
  assert.deepStrictEqual(await new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator`, 'dock_token', 300, undefined, 300).runs(), [], 'with nothing read yet a failed read is empty');

  answer = () => undefined;
  const started = Date.now();
  assert.deepStrictEqual(await new LedgerPeer(`http://127.0.0.1:${address.port}/ingest/orchestrator`, 'dock_token', 300, undefined, 300).runs(), [], 'a hanging peer times out');
  assert.ok(Date.now() - started < 2000);
});

test('recent runs ask the peer at most once per window', async () => {
  let asked = 0;
  let clock = 0;
  const peer = new LedgerPeer('http://peer.invalid', 'dock_token');
  peer.runs = async () => { asked += 1; return [run('ZED-6', 'laptop')]; };
  await Promise.all([peer.recentRuns(5000, () => clock), peer.recentRuns(5000, () => clock)]);
  clock = 4000;
  await peer.recentRuns(5000, () => clock);
  assert.strictEqual(asked, 1);
  clock = 6000;
  assert.deepStrictEqual(await peer.recentRuns(5000, () => clock), [run('ZED-6', 'laptop')]);
  assert.strictEqual(asked, 2);
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
