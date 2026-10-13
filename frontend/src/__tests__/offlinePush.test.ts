import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { restoreCache, saveCache } from '../lib/offline';
import { keyBytes, pushSupport } from '../lib/push';

function memoryStore(limit = Infinity) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { if (value.length > limit) throw new Error('QuotaExceededError'); items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

test('the cache is written to the device and read back; a copy that cannot be read or no longer fits is dropped', () => {
  const store = memoryStore();
  const data = { ROOT_QUERY: { authStatus: { authenticated: true } } };
  saveCache({ extract: () => data }, store);
  let restored: unknown = null;
  restoreCache({ restore: (value) => { restored = value; return undefined as never; } }, store);
  assert.deepStrictEqual(restored, data);

  store.items.set('dock-apollo-cache-v1', '{not json');
  restoreCache({ restore: () => { throw new Error('must not be called'); } }, store);
  assert.strictEqual(store.items.size, 0, 'the unreadable copy is gone');

  const small = memoryStore(10);
  small.items.set('dock-apollo-cache-v1', '{}');
  saveCache({ extract: () => data }, small);
  assert.strictEqual(small.items.size, 0, 'over quota: no stale copy stays behind');
});

test('the server key becomes the bytes a browser subscription wants', () => {
  assert.deepStrictEqual([...keyBytes('AQID-_8')], [1, 2, 3, 251, 255]);
});

test('push is offered where the browser has it; an iPhone in Safari is told to install first', () => {
  const all = { serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: false };
  assert.strictEqual(pushSupport(all), 'ready');
  assert.strictEqual(pushSupport({ ...all, ios: true, standalone: true }), 'ready');
  assert.strictEqual(pushSupport({ ...all, pushManager: false, notification: false, ios: true }), 'install-first');
  assert.strictEqual(pushSupport({ ...all, pushManager: false, ios: true, standalone: true }), 'unsupported', 'an installed app on an iOS too old for push');
  assert.strictEqual(pushSupport({ ...all, pushManager: false }), 'unsupported');
});

// Runs public/sw.js in a bare scope with stand-ins for the worker globals.
function worker(network: (url: string) => Response | null) {
  const handlers = new Map<string, (event: any) => void>();
  const saved = new Map<string, Response>();
  const shown: Array<{ title: string; options: any }> = [];
  const opened: string[] = [];
  const keyOf = (key: string | Request) => (typeof key === 'string' ? new URL(key, 'https://dock.test').href : key.url);
  const cache = { add: async (path: string) => { saved.set(keyOf(path), new Response('saved page')); }, put: async (key: string | Request, response: Response) => { saved.set(keyOf(key), response); } };
  const scope = {
    URL, Promise,
    self: {
      location: { origin: 'https://dock.test' },
      addEventListener: (name: string, handler: (event: any) => void) => { handlers.set(name, handler); },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
      registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }); } },
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async (key: string | Request) => saved.get(keyOf(key))?.clone() },
    fetch: async (request: Request) => { const response = network(request.url); if (!response) throw new TypeError('Failed to fetch'); return response; },
  };
  vm.runInNewContext(fs.readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8'), scope);
  const run = async (name: string, event: Record<string, unknown>) => {
    let answer: Promise<Response | undefined> | null = null;
    const waits: Promise<unknown>[] = [];
    handlers.get(name)!({ ...event, respondWith: (value: Promise<Response>) => { answer = value; }, waitUntil: (value: Promise<unknown>) => { waits.push(value); } });
    await Promise.all(waits);
    return answer === null ? null : (await answer as Response | undefined) ?? undefined;
  };
  const get = (path: string, mode = 'no-cors') => run('fetch', { request: { url: `https://dock.test${path}`, method: 'GET', mode } });
  return { run, get, saved, shown, opened };
}

test('the worker serves the saved page and saved files when the server cannot be reached, and leaves the API alone', async () => {
  let online = true;
  const sw = worker((url) => (online ? new Response(url.endsWith('/agents') ? 'fresh page' : 'file') : null));
  await sw.run('install', {});

  assert.strictEqual(await (await sw.get('/agents', 'navigate'))!.text(), 'fresh page');
  assert.strictEqual(await (await sw.get('/assets/index-abc123.js'))!.text(), 'file');
  for (const path of ['/graphql', '/api/chat/attachments/1', '/ingest/orchestrator', '/sw.js']) assert.strictEqual(await sw.get(path), null, `${path} is not the worker's business`);
  assert.strictEqual(await sw.run('fetch', { request: { url: 'https://dock.test/graphql', method: 'POST', mode: 'cors' } }), null);
  assert.strictEqual(await sw.run('fetch', { request: { url: 'https://fonts.example.com/a.woff2', method: 'GET', mode: 'cors' } }), null);

  online = false;
  assert.strictEqual(await (await sw.get('/sprint', 'navigate'))!.text(), 'fresh page', 'any route gets the last page that loaded');
  assert.strictEqual(await (await sw.get('/assets/index-abc123.js'))!.text(), 'file');
  await assert.rejects(() => sw.get('/assets/never-loaded.js') as Promise<unknown>, /Failed to fetch/);
});

test('a push becomes a notification, and tapping it opens the page it names', async () => {
  const sw = worker(() => null);
  await sw.run('push', { data: { json: () => ({ title: 'QRD-7 waits on you', body: 'Which endpoint?', url: '/agents' }) } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sw.shown)), [{ title: 'QRD-7 waits on you', options: { body: 'Which endpoint?', icon: '/icon-192.png', data: { url: '/agents' } } }]);
  await sw.run('notificationclick', { notification: { close: () => undefined, data: { url: '/agents' } } });
  assert.deepStrictEqual(sw.opened, ['/agents']);
});
