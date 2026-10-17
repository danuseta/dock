import assert from 'node:assert';
import http from 'node:http';
import type { Readable } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { DemoVideos, ingestDemoLink, s3Store, type DemoConfig, type DemoStore } from '../integrations/demo-videos';
import { createDemoVideoRouter } from '../routes/demo-videos';

const BASE = 'https://kencana.basic.box.cloudeka.id/porto-rzwbgw';

function fakeBucket() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const store: DemoStore & DemoConfig = {
    publicBaseUrl: BASE,
    prefix: 'demo-qonflo/',
    list: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, size: objects.get(key)!.body.length, lastModified: new Date('2026-10-17T10:00:00.000Z') })),
    put: async (key, body, contentType) => {
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(body)) chunks.push(body); else for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk));
      objects.set(key, { body: Buffer.concat(chunks), contentType });
    },
    remove: async (key) => { objects.delete(key); },
  };
  return { store, objects };
}

function fakeLinks() {
  const links = new Map<string, string>();
  return { links, save: async (key: string, url: string) => { links.set(key, url); }, remove: async (key: string, url: string) => { if (links.get(key) === url) links.delete(key); } };
}

test('demo storage is off until both S3 keys are set, and uses the bucket folder demo-qonflo', () => {
  assert.strictEqual(s3Store({}), null);
  assert.strictEqual(s3Store({ DEMO_S3_ACCESS_KEY: 'a' }), null);
  const store = s3Store({ DEMO_S3_ACCESS_KEY: 'a', DEMO_S3_SECRET_KEY: 'b' });
  assert.deepStrictEqual([store?.publicBaseUrl, store?.prefix], [BASE, 'demo-qonflo/']);
  assert.throws(() => new DemoVideos(null, fakeLinks()).urlOf('QRD-1'), /not configured/);
});

test('one video per ticket: upload sets the link, a list reads the folder, removal clears only that link', async () => {
  const { store, objects } = fakeBucket();
  const links = fakeLinks();
  const videos = new DemoVideos(store, links);

  const video = await videos.upload('qrd-1363', Buffer.from('mp4'), 'video/mp4', 3);
  assert.strictEqual(video.url, `${BASE}/demo-qonflo/QRD-1363.mp4`);
  assert.ok(objects.has('demo-qonflo/QRD-1363.mp4'));
  assert.strictEqual(links.links.get('QRD-1363'), video.url, 'the ticket pages get the link without an upload of their own');
  await videos.upload('QRD-1363', Buffer.from('mp4 again'), 'video/mp4', 9);
  assert.strictEqual(objects.size, 1, 'a new render replaces the object, so the link stays');

  objects.set('demo-qonflo/notes.txt', { body: Buffer.from('x'), contentType: 'text/plain' });
  assert.deepStrictEqual((await videos.list()).map((item) => [item.ticketKey, item.size]), [['QRD-1363', 9]]);

  await assert.rejects(videos.upload('QRD-1', Buffer.from('x'), 'video/webm', 1), /MP4/);
  await assert.rejects(videos.upload('QRD-1', Buffer.from('x'), 'video/mp4', null), /content length/);
  await assert.rejects(videos.upload('not a key', Buffer.from('x'), 'video/mp4', 1), /ticket key/);

  links.links.set('QRD-1255', 'https://loom.com/share/manual');
  await videos.upload('QRD-1255', Buffer.from('mp4'), 'video/mp4', 3);
  links.links.set('QRD-1255', 'https://loom.com/share/manual');
  await videos.remove('QRD-1255');
  assert.strictEqual(links.links.get('QRD-1255'), 'https://loom.com/share/manual', 'a link pasted by hand stays when the S3 video goes');
  await videos.remove('QRD-1363');
  assert.strictEqual(links.links.has('QRD-1363'), false);
});

test('the Demo Video page streams an upload to the bucket behind the PIN and the upload header', async (t) => {
  const { store, objects } = fakeBucket();
  const app = express();
  let unlocked = true;
  app.use('/api/demo-videos', createDemoVideoRouter({ videos: new DemoVideos(store, fakeLinks()), authorize: async () => unlocked }));
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
  assert.strictEqual((await post({})).status, 403, 'a form on another site cannot post without the header');
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
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', url: `${BASE}/demo-qonflo/QRD-1363.mp4` }, storage), true);
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', remove: 'https://other' }, storage), false);
  assert.ok(links.has('QRD-1363'));
  assert.strictEqual(await ingestDemoLink({ key: 'QRD-1363', remove: `${BASE}/demo-qonflo/QRD-1363.mp4` }, storage), true);
  assert.strictEqual(links.has('QRD-1363'), false);
  await assert.rejects(ingestDemoLink({ key: 'QRD-1', url: 'javascript:alert(1)' }, storage).then((done) => { if (!done) throw new Error('ignored'); }), /ignored/);
});
