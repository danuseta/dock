import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentLooks, AvatarRefusal } from '../integrations/agent-looks';
import { AgentBridge, parseAgentInput } from '../integrations/agents';
import { OrchestratorInputError } from '../integrations/orchestrator';

const ONLINE = async () => ({ online: true, capabilities: ['interactive', 'agents'] });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const input = (over: Record<string, unknown> = {}) => ({
  slug: 'qonflo-copy-checker', create: true, description: 'Checks copy.', model: 'haiku', tools: ['Read', 'Bash'], body: 'You check copy.', guardProfile: 'read', dispatchable: true, ...over,
});

function memoryCache() {
  const entries = new Map<string, unknown>();
  return {
    getCache: async (namespace: string, key: string) => entries.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { entries.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
  };
}

test('a job rides on the next claim once and resolves with the bridge answer', async () => {
  const bridge = new AgentBridge(ONLINE);
  const answer = bridge.list('workspace');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(bridge.take('laptop'), []);
  const [job] = bridge.take('workspace');
  assert.strictEqual(job.op, 'list');
  assert.deepStrictEqual(bridge.take('workspace'), [], 'a job is handed out only once');
  assert.deepStrictEqual(bridge.receive({ id: job.id, result: [{ slug: 'x' }] }, 'laptop'), { accepted: false }, 'another machine cannot answer it');
  assert.deepStrictEqual(bridge.receive({
    id: job.id,
    result: [{ slug: 'sous-verifier', source: 'kit', description: 'Runs tests', model: 'sonnet', tools: ['Bash', 'Read'], guardProfile: null, hasHooks: true, dispatchable: true, locked: { slug: true, tools: true, hooks: true } }],
  }, 'workspace'), { accepted: true });
  const [agent] = await answer;
  assert.strictEqual(agent.slug, 'sous-verifier');
  assert.deepStrictEqual(agent.locked, { slug: true, tools: true, hooks: true });
});

test('an offline bridge, an old kit and a silent bridge each give a clear error', async () => {
  await assert.rejects(new AgentBridge(async () => ({ online: false, capabilities: ['agents'] })).list('workspace'), /bridge on workspace is offline/);
  await assert.rejects(new AgentBridge(async () => ({ online: true, capabilities: ['interactive'] })).list('workspace'), /too old to manage agents/);
  await assert.rejects(new AgentBridge(ONLINE, 5).list('workspace'), /did not answer in time/);
});

test('a bridge error becomes an input error for the page', async () => {
  const bridge = new AgentBridge(ONLINE);
  const answer = bridge.get('workspace', 'nobody-here');
  await new Promise((resolve) => setImmediate(resolve));
  const [job] = bridge.take('workspace');
  bridge.receive({ id: job.id, error: 'No agent named nobody-here' }, 'workspace');
  await assert.rejects(answer, (error: unknown) => error instanceof OrchestratorInputError && /No agent named/.test(error.message));
});

test('an agent without a guard profile is sent as a draft runners cannot dispatch', () => {
  assert.strictEqual(parseAgentInput(input({ guardProfile: null, dispatchable: true })).dispatchable, false);
  assert.strictEqual(parseAgentInput(input()).dispatchable, true);
  assert.throws(() => parseAgentInput(input({ slug: 'Bad Slug' })), /slug/);
  assert.throws(() => parseAgentInput(input({ guardProfile: 'root' })), /guardProfile/);
  assert.throws(() => parseAgentInput(input({ model: 'gpt' })), /model/);
  assert.throws(() => parseAgentInput(input({ tools: ['Read; rm -rf'] })), /tools/);
});

test('put sends the parsed input and reads ok or the refusal', async () => {
  const bridge = new AgentBridge(ONLINE);
  const saved = bridge.put('workspace', input({ guardProfile: null }));
  await new Promise((resolve) => setImmediate(resolve));
  const [job] = bridge.take('workspace');
  assert.strictEqual((job.input as { dispatchable: boolean }).dispatchable, false);
  bridge.receive({ id: job.id, result: { ok: false, error: 'An agent named qonflo-copy-checker already exists' } }, 'workspace');
  assert.deepStrictEqual(await saved, { ok: false, diff: '', error: 'An agent named qonflo-copy-checker already exists' });
});

test('looks keep name, initials and colour per slug, and a PNG avatar beside them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-looks-'));
  try {
    const looks = new AgentLooks(memoryCache(), () => dir, () => 1700000000000);
    await looks.save({ slug: 'qonflo-copy-checker', displayName: 'Copy checker', initials: 'Cc', color: '#C39CF2' });
    const withAvatar = await looks.setAvatar('qonflo-copy-checker', 'image/png', PNG);
    assert.deepStrictEqual(withAvatar, {
      slug: 'qonflo-copy-checker', displayName: 'Copy checker', initials: 'Cc', color: '#c39cf2', avatarUrl: '/api/agent-looks/qonflo-copy-checker/avatar?v=1700000000000',
    });
    assert.deepStrictEqual(await looks.avatar('qonflo-copy-checker'), PNG);
    await assert.rejects(looks.setAvatar('qonflo-copy-checker', 'image/svg+xml', Buffer.from('<svg/>')), (error: unknown) => error instanceof AvatarRefusal && error.status === 415);
    await assert.rejects(looks.setAvatar('qonflo-copy-checker', 'image/png', Buffer.from('not a png at all')), (error: unknown) => error instanceof AvatarRefusal && error.status === 415);
    await assert.rejects(looks.setAvatar('qonflo-copy-checker', 'image/png', Buffer.concat([PNG, Buffer.alloc(512 * 1024)])), (error: unknown) => error instanceof AvatarRefusal && error.status === 413);
    await assert.rejects(looks.save({ slug: 'qonflo-copy-checker', color: 'red' }), /colour/);
    assert.strictEqual(await looks.avatar('../etc/passwd'), null);
    const cleared = await looks.save({ slug: 'qonflo-copy-checker', displayName: 'Copy checker', initials: 'Cc', color: '#c39cf2', removeAvatar: true });
    assert.strictEqual(cleared.avatarUrl, null);
    assert.strictEqual(await looks.avatar('qonflo-copy-checker'), null);
    await looks.remove('qonflo-copy-checker');
    assert.deepStrictEqual(await looks.list(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
