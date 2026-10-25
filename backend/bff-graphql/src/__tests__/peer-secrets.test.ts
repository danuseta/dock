import assert from 'node:assert';
import test from 'node:test';
import { DEMO_STORAGE_DEFAULTS, viewOf, type DemoStorage, type DemoStorageConfig } from '../integrations/demo-storage';
import { maskKey, type ElevenLabsKeys, type ElevenLabsStore } from '../integrations/elevenlabs-keys';
import { pullPeerSecrets } from '../integrations/peer-secrets';

function memoryKeys(data: ElevenLabsStore = { keys: {}, order: [], current: 0, cooldowns: {} }): ElevenLabsKeys & { data: ElevenLabsStore } {
  return {
    data,
    list: async () => data.order.map((name, index) => ({ name, masked: maskKey(data.keys[name]), parkedUntil: null, current: index === data.current })),
    store: async () => data,
    add: async (name, key) => { if (!data.order.includes(name)) data.order.push(name); data.keys[name] = key; },
    remove: async () => false,
    park: async (name, until) => { if (until) data.cooldowns[name] = until.getTime(); else delete data.cooldowns[name]; },
    setCurrent: async (name) => { data.current = Math.max(0, data.order.indexOf(name)); },
    quota: async () => [],
  };
}

function memoryStorage(config: DemoStorageConfig | null = null): DemoStorage & { saved: DemoStorageConfig | null } {
  const box = {
    saved: config,
    view: async () => viewOf(box.saved ?? DEMO_STORAGE_DEFAULTS),
    save: async (input: Partial<DemoStorageConfig>) => { box.saved = { ...DEMO_STORAGE_DEFAULTS, ...box.saved, ...input }; return viewOf(box.saved); },
    clear: async () => { box.saved = null; return true; },
    full: async () => box.saved,
  };
  return box;
}

const PEER_STORAGE: DemoStorageConfig = { ...DEMO_STORAGE_DEFAULTS, endpoint: 'https://s3.example.test', region: 'id-1', bucket: 'demo', folder: 'videos', publicBaseUrl: 'https://cdn.example.test', accessKey: 'AKIAEXAMPLE', secretKey: 'secret-example' };

test('pulling copies every key in order, the current key, parks and the demo storage, and reports names only', async () => {
  const until = new Date('2026-10-26T00:00:00.000Z');
  const peerKeys = memoryKeys({ keys: { suryo: 'sk_aaaaaaaaaaaaaaaa1111', sem: 'sk_bbbbbbbbbbbbbbbb2222' }, order: ['suryo', 'sem'], current: 1, cooldowns: { suryo: until.getTime() } });
  const localKeys = memoryKeys();
  const localStorage = memoryStorage();

  const pulled = await pullPeerSecrets({ keys: peerKeys, storage: memoryStorage(PEER_STORAGE) }, { keys: localKeys, storage: localStorage });

  assert.deepStrictEqual(localKeys.data.order, ['suryo', 'sem']);
  assert.deepStrictEqual(localKeys.data.keys, peerKeys.data.keys);
  assert.strictEqual(localKeys.data.current, 1);
  assert.deepStrictEqual(localKeys.data.cooldowns, { suryo: until.getTime() });
  assert.deepStrictEqual(localStorage.saved, PEER_STORAGE);
  assert.deepStrictEqual(pulled, { keys: ['suryo', 'sem'], current: 'sem', parked: ['suryo'], storage: true });
  assert.ok(!JSON.stringify(pulled).includes('sk_'), 'the report carries no key value');
});

test('pulling twice keeps one row per key, and a peer without demo storage leaves the local one alone', async () => {
  const peerKeys = memoryKeys({ keys: { suryo: 'sk_aaaaaaaaaaaaaaaa1111' }, order: ['suryo'], current: 0, cooldowns: {} });
  const localKeys = memoryKeys();
  const localStorage = memoryStorage(PEER_STORAGE);

  await pullPeerSecrets({ keys: peerKeys, storage: memoryStorage() }, { keys: localKeys, storage: localStorage });
  const pulled = await pullPeerSecrets({ keys: peerKeys, storage: memoryStorage() }, { keys: localKeys, storage: localStorage });

  assert.deepStrictEqual(localKeys.data.order, ['suryo']);
  assert.deepStrictEqual(localStorage.saved, PEER_STORAGE);
  assert.strictEqual(pulled.storage, false);
});
