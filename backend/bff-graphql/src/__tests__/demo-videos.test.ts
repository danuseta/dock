import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import type { Readable } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { DEMO_STORAGE_DEFAULTS, PeerDemoStorage, mergeDemoStorage, viewOf, type DemoStorage, type DemoStorageConfig } from '../integrations/demo-storage';
import { DemoVideos, ingestDemoLink, type DemoStore } from '../integrations/demo-videos';
import { LedgerPeer } from '../integrations/ledger-peer';
import { OrchestratorService } from '../integrations/orchestrator';
import { createDemoVideoRouter } from '../routes/demo-videos';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';

const BASE = 'https://www.danuseta.my.id/assets';
const KEYS = { accessKey: 'AKIAEXAMPLE000001', secretKey: 'secret-example-0001' };

function memorySettings(initial: Partial<DemoStorageConfig> = {}): DemoStorage & { config: DemoStorageConfig } {
  const holder = { config: { ...DEMO_STORAGE_DEFAULTS, ...initial } };
  return {
    get config() { return holder.config; },
    view: async () => viewOf(holder.config),
    save: async (input) => { holder.config = mergeDemoStorage(holder.config, input); return viewOf(holder.config); },
    clear: async () => { holder.config = { ...DEMO_STORAGE_DEFAULTS }; return true; },
    full: async () => (holder.config.accessKey && holder.config.secretKey ? holder.config : null),
  };
}

function fakeBucket() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const made: DemoStorageConfig[] = [];
  const store: DemoStore = {
    list: async (prefix: string) => [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, size: objects.get(key)!.body.length, lastModified: new Date('2026-10-17T10:00:00.000Z') })),
    put: async (key: string, body: Readable | Buffer, contentType: string) => {
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(body)) chunks.push(body); else for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(key, { body: Buffer.concat(chunks), contentType });
    },
    remove: async (key: string) => { objects.delete(key); },
  };
  return { objects, made, makeStore: (config: DemoStorageConfig) => { made.push(config); return store; } };
}

function fakeLinks() {
  const links = new Map<string, string>();
  return { links, save: async (key: string, url: string) => { links.set(key, url); }, remove: async (key: string, url: string) => { if (links.get(key) === url) links.delete(key); } };
}

test('the storage settings keep the keys out of the view, keep a saved key when the form leaves it empty, and check every field', () => {
  const saved = mergeDemoStorage(DEMO_STORAGE_DEFAULTS, KEYS);
  const view = viewOf(saved);
  assert.deepStrictEqual([view.configured, view.accessKeyMasked, view.secretSet, view.folder, view.publicBaseUrl], [true, 'AKIAEX...0001', true, 'demo-qonflo', BASE]);
  assert.ok(!JSON.stringify(view).includes('secret-example'), 'the secret never leaves in a view');
  assert.deepStrictEqual(mergeDemoStorage(saved, { accessKey: '', secretKey: ' ', folder: 'demo-other' }).accessKey, KEYS.accessKey);
  assert.strictEqual(mergeDemoStorage(saved, { folder: '/demo-other/' }).folder, 'demo-other');
  assert.throws(() => mergeDemoStorage(saved, { folder: 'a/b' }), /one name/);
  assert.throws(() => mergeDemoStorage(saved, { endpoint: 'http://plain.example' }), /https/);
  assert.throws(() => mergeDemoStorage(saved, { publicBaseUrl: 'not a url' }), /URL/);
  assert.strictEqual(viewOf(DEMO_STORAGE_DEFAULTS).configured, false);
});

test('one video per ticket in the set folder: the link goes through the public base URL, a removal clears only that link', async () => {
  const settings = memorySettings(KEYS);
  const { objects, made, makeStore } = fakeBucket();
  const links = fakeLinks();
  const videos = new DemoVideos(settings, links, makeStore);

  const video = await videos.upload('qrd-1363', Buffer.from('mp4'), 'video/mp4', 3);
  assert.strictEqual(video.url, `${BASE}/demo-qonflo/QRD-1363.mp4`, 'the link never names the bucket');
  assert.ok(objects.has('demo-qonflo/QRD-1363.mp4'));
  assert.strictEqual(links.links.get('QRD-1363'), video.url);
  await videos.upload('QRD-1363', Buffer.from('mp4 again'), 'video/mp4', 9);
  assert.strictEqual(objects.size, 1, 'a new render replaces the object, so the link stays');
  assert.strictEqual(made.length, 1, 'the bucket client is made once while the settings stay the same');

  objects.set('demo-qonflo/notes.txt', { body: Buffer.from('x'), contentType: 'text/plain' });
  assert.deepStrictEqual((await videos.list()).map((item) => [item.ticketKey, item.size]), [['QRD-1363', 9]]);

  await settings.save({ folder: 'demo-next' });
  await videos.upload('QRD-1255', Buffer.from('mp4'), 'video/mp4', 3);
  assert.ok(objects.has('demo-next/QRD-1255.mp4'), 'a new folder in Settings is used from the next upload');
  assert.strictEqual(made.length, 2);

  await assert.rejects(videos.upload('QRD-1', Buffer.from('x'), 'video/webm', 1), /MP4/);
  await assert.rejects(videos.upload('QRD-1', Buffer.from('x'), 'video/mp4', null), /content length/);
  links.links.set('QRD-1255', 'https://loom.com/share/manual');
  await videos.remove('QRD-1255');
  assert.strictEqual(links.links.get('QRD-1255'), 'https://loom.com/share/manual', 'a link pasted by hand stays when the S3 video goes');

  const unset = new DemoVideos(memorySettings(), links, makeStore);
  assert.strictEqual(await unset.configured(), false);
  await assert.rejects(unset.list(), /Settings/);
});

test('the workspace DOCK keeps no S3 key: the settings live on the laptop DOCK, behind a machine token', async (t) => {
  const settings = memorySettings();
  const service = new OrchestratorService(undefined as never, os.tmpdir());
  t.mock.method(service, 'authenticateMachine', async (token: string) => (token === 'dock_ing_ws' ? 'workspace' : null));
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, settings));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${address.port}/ingest/orchestrator`;
  const workspace = new PeerDemoStorage((route, body) => new LedgerPeer(url, 'dock_ing_ws').call(route, body));

  assert.strictEqual((await workspace.view()).configured, false);
  assert.strictEqual(await workspace.full(), null);
  const view = await workspace.save({ ...KEYS, folder: 'demo-qonflo' });
  assert.deepStrictEqual([view.configured, view.accessKeyMasked], [true, 'AKIAEX...0001']);
  assert.strictEqual(settings.config.secretKey, KEYS.secretKey, 'a key saved on the workspace lands on the laptop DOCK');
  assert.strictEqual((await workspace.full())?.secretKey, KEYS.secretKey, 'the workspace gets the keys only when it uploads');
  await assert.rejects(workspace.save({ folder: 'a/b' }), /one name/, 'the laptop DOCK message reaches the workspace');
  assert.strictEqual(await workspace.clear(), true);
  assert.strictEqual(settings.config.accessKey, '');

  const stranger = await fetch(`${url}/demo-storage/full`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' });
  assert.strictEqual(stranger.status, 401);
});

test('the Demo Video page streams an upload to the bucket behind the PIN and the upload header', async (t) => {
  const { objects, makeStore } = fakeBucket();
  const app = express();
  let unlocked = true;
  app.use('/api/demo-videos', createDemoVideoRouter({ videos: new DemoVideos(memorySettings(KEYS), fakeLinks(), makeStore), authorize: async () => unlocked }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (headers: Record<string, string>, body = 'fake mp4 bytes') => fetch(`http://127.0.0.1:${address.port}/api/demo-videos/QRD-1363`, { method: 'POST', headers: { 'content-type': 'video/mp4', ...headers }, body });

  const ok = await post({ 'x-dock-upload': '1' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(((await ok.json()) as { result: { url: string } }).result.url, `${BASE}/demo-qonflo/QRD-1363.mp4`);
  assert.strictEqual(objects.get('demo-qonflo/QRD-1363.mp4')?.body.toString(), 'fake mp4 bytes');
  assert.strictEqual((await post({})).status, 403);
  assert.strictEqual((await post({ 'x-dock-upload': '1', 'content-type': 'text/plain' })).status, 400);
  unlocked = false;
  assert.strictEqual((await post({ 'x-dock-upload': '1' })).status, 401);
});

test('the laptop DOCK keeps the link the workspace sent, and removes only the one it set', async () => {
  const links = new Map<string, { url: string }>();
  const storage = {
    upsertDemoLink: async (key: string, url: string) => { links.set(key, { url }); },
    getDemoLink: async (key: string) => links.get(key) ?? null,
    deleteDemoLink: async (key: string) => { links.delete(key); },
  } as never;
  const link = `${BASE}/demo-qonflo/QRD-1363.mp4`;
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', url: link }, storage), true);
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', remove: 'https://other' }, storage), false);
  assert.ok(links.has('QRD-1363'));
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', remove: link }, storage), true);
  assert.strictEqual(links.has('QRD-1363'), false);
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1', url: 'javascript:alert(1)' }, storage), false);
});
