import test from 'node:test';
import assert from 'node:assert';
import { resolvers } from '../resolvers';
import { StorageService } from '../storage/service';

const unlocked = { authenticated: true, request: { headers: {}, ip: '127.0.0.1', socket: {} } };
const opsRules = () => (resolvers.Query.opsRules as (parent: unknown, args: unknown, context: unknown) => Promise<{ statusAfterMerge: string; worktreeMerged: string }>)(undefined, {}, unlocked);

test('opsRules reads each rule by its key when only the worktree rule is stored', async (t) => {
  t.mock.method(StorageService.prototype, 'hasMasterPin', async () => false);
  t.mock.method(StorageService.prototype, 'getSettingValues', async () => [{ key: 'worktreeMerged', value: '{"mode":"auto","days":5}' }]);
  const rules = await opsRules();
  assert.deepStrictEqual(JSON.parse(rules.worktreeMerged), { mode: 'auto', days: 5 });
  assert.strictEqual(JSON.parse(rules.statusAfterMerge).next, 'UAT MERGED');
});

test('opsRules does not depend on the order the rows come back in', async (t) => {
  t.mock.method(StorageService.prototype, 'hasMasterPin', async () => false);
  t.mock.method(StorageService.prototype, 'getSettingValues', async () => [
    { key: 'worktreeMerged', value: '{"mode":"off","days":7}' },
    { key: 'statusAfterMerge', value: '{"enabled":false,"next":"UAT CHECK","ignoreDocsSync":false,"laptop":true}' },
  ]);
  const rules = await opsRules();
  assert.deepStrictEqual(JSON.parse(rules.worktreeMerged), { mode: 'off', days: 7 });
  assert.deepStrictEqual(JSON.parse(rules.statusAfterMerge), { enabled: false, next: 'UAT CHECK', ignoreDocsSync: false, laptop: true });
});

test('updateSettings refuses a bad value with its reason as BAD_USER_INPUT', async (t) => {
  t.mock.method(StorageService.prototype, 'hasMasterPin', async () => false);
  const upsert = t.mock.method(StorageService.prototype, 'upsertSetting', async () => undefined);
  const update = resolvers.Mutation.updateSettings as (parent: unknown, args: unknown, context: unknown) => Promise<boolean>;
  await assert.rejects(update(undefined, { input: { lightMaxLines: 999999 } }, unlocked), (error: { message: string; extensions?: { code?: string } }) => {
    assert.match(error.message, /lightMaxLines/);
    assert.strictEqual(error.extensions?.code, 'BAD_USER_INPUT');
    return true;
  });
  assert.strictEqual(upsert.mock.callCount(), 0);
});
