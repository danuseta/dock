import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { PeerElevenLabsKeys, maskKey, type ElevenLabsKeys, type ElevenLabsStore } from '../integrations/elevenlabs-keys';
import { LedgerPeer } from '../integrations/ledger-peer';
import { OrchestratorInputError, OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';

function memoryKeys(): ElevenLabsKeys & { data: ElevenLabsStore } {
  const data: ElevenLabsStore = { keys: {}, order: [], current: 0, cooldowns: {} };
  return {
    data,
    list: async () => data.order.map((name, index) => ({ name, masked: maskKey(data.keys[name]), parkedUntil: data.cooldowns[name] ? new Date(data.cooldowns[name]).toISOString() : null, current: index === data.current })),
    store: async () => data,
    add: async (name, key) => { if (key.length < 8) throw new OrchestratorInputError('An ElevenLabs key is 8 to 200 characters without spaces'); if (!data.order.includes(name)) data.order.push(name); data.keys[name] = key; },
    remove: async (name) => { const had = name in data.keys; delete data.keys[name]; data.order = data.order.filter((item) => item !== name); return had; },
    park: async (name, until) => { if (until) data.cooldowns[name] = until.getTime(); else delete data.cooldowns[name]; },
    setCurrent: async (name) => { data.current = Math.max(0, data.order.indexOf(name)); },
  };
}

test('the workspace DOCK keeps no ElevenLabs key: every call reaches the laptop DOCK with the workspace token', async (t) => {
  const keys = memoryKeys();
  const service = new OrchestratorService(undefined as never, os.tmpdir());
  t.mock.method(service, 'authenticateMachine', async (token: string) => (token === 'dock_ing_ws' ? 'workspace' : null));
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(5, 60_000), undefined, keys));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${address.port}/ingest/orchestrator`;

  const workspace = new PeerElevenLabsKeys((route, body) => new LedgerPeer(url, 'dock_ing_ws').call(route, body));
  await workspace.add('suryo', 'sk_aaaaaaaaaaaaaaaa1111');
  await workspace.add('sem', 'sk_bbbbbbbbbbbbbbbb2222');
  assert.deepStrictEqual(Object.keys(keys.data.keys), ['suryo', 'sem'], 'a key added on the workspace lands on the laptop DOCK');
  assert.deepStrictEqual((await workspace.list()).map((item) => item.masked), ['sk_aaa...1111', 'sk_bbb...2222'], 'the list is masked');
  await workspace.park('suryo', new Date('2026-10-17T11:00:00.000Z'));
  await workspace.setCurrent('sem');
  const store = await workspace.store();
  assert.deepStrictEqual([store.keys.sem, store.current, store.cooldowns.suryo], ['sk_bbbbbbbbbbbbbbbb2222', 1, new Date('2026-10-17T11:00:00.000Z').getTime()]);
  await assert.rejects(workspace.add('bad', 'short'), /8 to 200/, 'the laptop DOCK message reaches the workspace');
  assert.strictEqual(await workspace.remove('suryo'), true);

  const stranger = await fetch(`${url}/elevenlabs/store`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' });
  assert.strictEqual(stranger.status, 401, 'no token, no key');
});
