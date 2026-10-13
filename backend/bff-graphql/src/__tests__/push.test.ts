import assert from 'node:assert';
import test from 'node:test';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { PushService, type PushDeps, type PushSubscription } from '../integrations/push';

const device = (name: string): PushSubscription => ({ endpoint: `https://push.example.com/send/${name}-0123456789`, p256dh: 'BKey_0123456789-abcdefghijklmnopqrstuvwxyz', auth: 'auth_0123456789abcd' });

function world(statusOf: (endpoint: string) => number = () => 201) {
  const state = { settings: new Map<string, string>(), cache: new Map<string, unknown>(), generated: 0, delivered: [] as Array<{ endpoint: string; payload: string; publicKey: string }> };
  const deps: PushDeps = {
    settingValue: async (key) => state.settings.get(key) ?? null,
    saveSetting: async (key, value) => { state.settings.set(key, value); },
    cacheGet: async (key) => state.cache.get(key) ?? null,
    cacheSet: async (key, value) => { state.cache.set(key, JSON.parse(JSON.stringify(value))); },
    generateKeys: () => { state.generated += 1; return { publicKey: `public-${state.generated}`, privateKey: `private-${state.generated}` }; },
    deliver: async (subscription, payload, keys) => {
      state.delivered.push({ endpoint: subscription.endpoint, payload, publicKey: keys.publicKey });
      const status = statusOf(subscription.endpoint);
      if (status === -1) throw new Error('socket hang up');
      return status;
    },
  };
  return { state, push: new PushService(deps) };
}

test('the key pair is made once and then reused', async () => {
  const { state, push } = world();
  assert.strictEqual(await push.publicKey(), 'public-1');
  assert.strictEqual(await push.publicKey(), 'public-1');
  assert.deepStrictEqual([state.generated, state.settings.get('pushVapidPrivateKey')], [1, 'private-1']);
});

test('a device subscribes once, can leave, and a malformed subscription is refused', async () => {
  const { push } = world();
  await push.subscribe(device('phone'));
  await push.subscribe({ ...device('phone'), auth: 'auth_renewed_012345' });
  await push.subscribe(device('tablet'));
  assert.deepStrictEqual((await push.subscriptions()).map((item) => [item.endpoint.includes('phone') ? 'phone' : 'tablet', item.auth]), [['phone', 'auth_renewed_012345'], ['tablet', 'auth_0123456789abcd']]);
  await push.unsubscribe(device('phone').endpoint);
  assert.strictEqual((await push.subscriptions()).length, 1);
  for (const bad of [{ ...device('x'), endpoint: 'http://push.example.com/send/x-0123456789' }, { ...device('x'), p256dh: '' }, { ...device('x'), auth: 'no' }, {}]) {
    await assert.rejects(() => push.subscribe(bad), OrchestratorInputError);
  }
});

test('a message goes to every device; a device the push service no longer knows is forgotten, a failing one is kept', async () => {
  const { state, push } = world((endpoint) => (endpoint.includes('gone') ? 410 : endpoint.includes('down') ? -1 : 201));
  assert.strictEqual(await push.send({ title: 'a', body: 'b', url: '/' }), 0, 'nobody subscribed');
  assert.strictEqual(state.generated, 0, 'no keys are made for nobody');
  for (const name of ['phone', 'gone', 'down']) await push.subscribe(device(name));
  assert.strictEqual(await push.send({ title: 'QRD-1 waits on you', body: 'Which endpoint?', url: '/agents' }), 1);
  assert.deepStrictEqual(state.delivered.map((item) => JSON.parse(item.payload)), Array(3).fill({ title: 'QRD-1 waits on you', body: 'Which endpoint?', url: '/agents' }));
  assert.deepStrictEqual((await push.subscriptions()).map((item) => item.endpoint.split('/').pop()!.split('-')[0]), ['phone', 'down']);
});
