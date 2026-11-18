import assert from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEMO_STORAGE_DEFAULTS, mergeDemoStorage, viewOf, type DemoStorage, type DemoStorageConfig } from '../integrations/demo-storage';
import { DemoVideos, type DemoStore } from '../integrations/demo-videos';
import { resolvePlugins, type PluginChoices } from '../integrations/plugins';

const KEYS = { endpoint: 'https://s3.example.com', region: 'r', bucket: 'bucket-1', folder: 'demo', publicBaseUrl: 'https://www.example.com/assets', accessKey: 'AKIAEXAMPLE000001', secretKey: 'secret-example-0001' };

const sources = (saved: Record<string, string>, s3 = false, voice = false) => ({
  setting: async (key: string) => saved[key],
  s3Configured: async () => s3,
  hasVoiceKeys: async () => voice,
});

test('an install that never chose keeps what it runs: S3 when the demo storage is set, ElevenLabs when it has keys, else none', async () => {
  assert.deepStrictEqual(await resolvePlugins(sources({}, true, true)), { storage: 's3', voice: 'elevenlabs', storageLocalDir: '' });
  assert.deepStrictEqual(await resolvePlugins(sources({}, false, false)), { storage: 'none', voice: 'none', storageLocalDir: '' });
});

test('a saved choice wins over the defaults, and an unknown value falls back to them', async () => {
  assert.deepStrictEqual(await resolvePlugins(sources({ storagePlugin: 'none', voicePlugin: 'none' }, true, true)), { storage: 'none', voice: 'none', storageLocalDir: '' });
  assert.deepStrictEqual(await resolvePlugins(sources({ storagePlugin: 'local', storageLocalDir: ' /tmp/demo ', voicePlugin: 'elevenlabs' })), { storage: 'local', voice: 'elevenlabs', storageLocalDir: '/tmp/demo' });
  assert.strictEqual((await resolvePlugins(sources({ storagePlugin: 'ftp', voicePlugin: 'x' }, true, false))).storage, 's3');
  assert.strictEqual((await resolvePlugins(sources({ storagePlugin: 'ftp', voicePlugin: 'x' }, true, false))).voice, 'none');
});

function videos(choice: Pick<PluginChoices, 'storage' | 'storageLocalDir'>) {
  const links = new Map<string, string>();
  const puts: string[] = [];
  const settings: DemoStorage = {
    view: async () => viewOf(DEMO_STORAGE_DEFAULTS), save: async () => viewOf(DEMO_STORAGE_DEFAULTS), clear: async () => true,
    full: async () => mergeDemoStorage(DEMO_STORAGE_DEFAULTS, KEYS) as DemoStorageConfig,
  };
  const store: DemoStore = { list: async () => [], put: async (key) => { puts.push(key); }, remove: async () => undefined };
  const demo = new DemoVideos(settings, { get: async () => null, save: async (key, url) => { links.set(key, url); }, remove: async () => undefined }, () => store, async () => choice);
  return { demo, links, puts };
}

test('storage none refuses an upload with a message and lists as not configured', async () => {
  const { demo, puts } = videos({ storage: 'none', storageLocalDir: '' });
  await assert.rejects(demo.upload('QRD-1', Buffer.from('x'), 'video/mp4', 1), /storage is off/);
  assert.deepStrictEqual(puts, []);
  assert.deepStrictEqual(await demo.list([]), { configured: false, storage: 'none', videos: [] });
});

test('storage local copies the video into the folder and links the file path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'demo-local-'));
  const { demo, links, puts } = videos({ storage: 'local', storageLocalDir: dir });
  const video = await demo.upload('QRD-7', Buffer.from('mp4-bytes'), 'video/mp4', 9);
  const file = path.join(dir, 'QRD-7.mp4');
  assert.strictEqual(video.url, file);
  assert.strictEqual(links.get('QRD-7'), file);
  assert.strictEqual((await readFile(file)).toString(), 'mp4-bytes');
  assert.deepStrictEqual(puts, []);
  assert.strictEqual((await demo.list([])).configured, true);
});

test('storage s3 keeps the bucket upload', async () => {
  const { demo, links, puts } = videos({ storage: 's3', storageLocalDir: '' });
  const video = await demo.upload('QRD-8', Buffer.from('x'), 'video/mp4', 1);
  assert.deepStrictEqual(puts, ['demo/QRD-8.mp4']);
  assert.strictEqual(links.get('QRD-8'), video.url);
});
