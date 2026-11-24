import assert from 'node:assert';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AgentBridge } from '../integrations/agents';
import { agentBridge } from '../integrations/agents-live';
import { chatService } from '../integrations/chat';
import { parseGmProposal } from '../integrations/guild-master';
import { KitMergeReports, kitConflictNotice, kitResolveSha, parseKitMergeReport, skillPath, skillPutSha } from '../integrations/kit-merge';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { resolvers } from '../resolvers';
import { StorageService } from '../storage/service';

const ONLINE = async () => ({ online: true, capabilities: ['interactive', 'agents', 'gm', 'skills', 'kit-merge'] });
const NOW = new Date('2026-11-24T10:00:00.000Z');
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const REPORT = {
  at: '2026-11-24T09:00:00.000Z',
  merged: [{ path: 'skills/demo-video/SKILL.md', at: 'x' }],
  kept: [{ path: 'agents/sous-verifier.md', at: 'x' }],
  conflicts: [{ path: 'skills/review-message/SKILL.md', kitNew: 'skills/review-message/SKILL.md.kit-new', reason: 'both changed the same lines', at: 'x' }],
};

function memoryCache() {
  const entries = new Map<string, unknown>();
  return {
    getCache: async (namespace: string, key: string) => entries.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { entries.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
  };
}

const answerNext = async (bridge: AgentBridge, machine: string, answer: (job: { op: string; input: unknown }) => unknown) => {
  await new Promise((resolve) => setImmediate(resolve));
  const [job] = bridge.take(machine);
  bridge.receive({ id: job.id, result: answer(job) }, machine);
  return job;
};

test('a merge report keeps only skill and agent paths the kit merges', () => {
  const report = parseKitMergeReport({ ...REPORT, conflicts: [...REPORT.conflicts, { path: 'kit/guard.cjs' }, { path: 'skills/../kit/x.md' }, { path: 'agents/a/b.md' }] }, 'workspace', NOW);
  assert.deepStrictEqual(report.conflicts.map((row) => row.path), ['skills/review-message/SKILL.md']);
  assert.strictEqual(report.conflicts[0].kitNew, 'skills/review-message/SKILL.md.kit-new');
  assert.deepStrictEqual(report.merged.map((row) => row.path), ['skills/demo-video/SKILL.md']);
  assert.strictEqual(report.at, '2026-11-24T09:00:00.000Z');
  assert.throws(() => parseKitMergeReport('x', 'workspace', NOW), OrchestratorInputError);
});

test('a new conflict pushes a notice once; the same conflict in the next report does not', async () => {
  const reports = new KitMergeReports(memoryCache());
  const pushed: Array<[string, string[]]> = [];
  reports.onConflicts = (machine, paths) => pushed.push([machine, paths]);
  assert.deepStrictEqual(await reports.ingest(REPORT, 'workspace', NOW), { machine: 'workspace', conflicts: 1, fresh: 1 });
  assert.deepStrictEqual(await reports.ingest(REPORT, 'workspace', NOW), { machine: 'workspace', conflicts: 1, fresh: 0 });
  assert.deepStrictEqual(pushed, [['workspace', ['skills/review-message/SKILL.md']]]);
  assert.strictEqual((await reports.list())[0].conflicts.length, 1);
  const notice = kitConflictNotice('workspace', ['skills/review-message/SKILL.md', 'agents/sous-verifier.md']);
  assert.match(notice.body, /^bentrok di review-message, agent sous-verifier\./);
  assert.strictEqual(notice.url, '/agents?tab=library');
});

test('skill paths: relative to skills, plain segments, text files only', () => {
  assert.strictEqual(skillPath('skills/review-message/SKILL.md'), 'review-message/SKILL.md');
  assert.strictEqual(skillPath('review-message\\lexicon.json'), 'review-message/lexicon.json');
  for (const bad of ['../agents/x.md', 'a/../b.md', '/etc/x.md', 'C:/x/SKILL.md', 'review-message/run.py', 'SKILL.md', 'a/SKILL.md.kit-new', '']) {
    assert.throws(() => skillPath(bad), OrchestratorInputError, bad);
  }
});

test('the skill save and the conflict actions carry a nonce bound to the path and the text, and an old kit is told to update', async () => {
  const bridge = new AgentBridge(ONLINE);
  const grants: string[] = [];
  const grant = async (value: string) => { grants.push(value); return { nonce: 'n-1', key: 'k' }; };
  const saved = bridge.saveSkillFile('workspace', 'skills/review-message/SKILL.md', 'new text', grant, skillPutSha);
  const job = await answerNext(bridge, 'workspace', () => ({ ok: true, diff: '+new text' }));
  assert.strictEqual(job.op, 'gm-skill-put');
  assert.deepStrictEqual(job.input, { path: 'review-message/SKILL.md', text: 'new text', nonce: 'n-1', key: 'k' });
  assert.deepStrictEqual(await saved, { ok: true, diff: '+new text', error: null });
  assert.deepStrictEqual(grants, [`skill:review-message/SKILL.md:${sha('new text')}`]);
  await assert.rejects(bridge.saveSkillFile('workspace', '../kit/guard.cjs', 'x', grant, skillPutSha), /\.\./);
  await assert.rejects(new AgentBridge(async () => ({ online: true, capabilities: ['agents', 'gm'] })).skillFiles('workspace'), /too old to edit skills/);
  await assert.rejects(new AgentBridge(async () => ({ online: true, capabilities: ['agents', 'gm'] })).kitMergeReport('workspace'), /too old for install merges/);

  const actions: Array<[string, string | undefined, string]> = [['local', undefined, kitResolveSha('skills/review-message/SKILL.md', 'local', null)], ['kit', undefined, kitResolveSha('skills/review-message/SKILL.md', 'kit', null)], ['edit', 'merged', `kit-resolve:skills/review-message/SKILL.md:edit:${sha('merged')}`]];
  for (const [action, body, expected] of actions) {
    grants.length = 0;
    const done = bridge.resolveKitConflict('workspace', 'skills/review-message/SKILL.md', action, body ?? null, grant, kitResolveSha, NOW);
    const sent = await answerNext(bridge, 'workspace', () => ({ ok: true, entry: { id: 1 }, report: { ...REPORT, conflicts: [] } }));
    assert.strictEqual(sent.op, 'gm-kit-resolve');
    assert.deepStrictEqual(sent.input, { path: 'skills/review-message/SKILL.md', action, ...(body ? { text: body } : {}), nonce: 'n-1', key: 'k' });
    const result = await done;
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.report?.conflicts, []);
    assert.deepStrictEqual(grants, [expected]);
  }
  await assert.rejects(bridge.resolveKitConflict('workspace', 'skills/review-message/SKILL.md', 'theirs', null, grant, kitResolveSha), /action must be/);
  await assert.rejects(bridge.resolveKitConflict('workspace', 'kit/guard.cjs', 'kit', null, grant, kitResolveSha), /Not a skill or agent file/);
});

test('a Guild Master skill proposal must name a skill text file', () => {
  const pending = (change: Record<string, unknown>) => ({ sessionId: 'gm-1', replyTo: 3, pending: JSON.stringify({ diff: '-a\n+b', summary: 's', ...change }) });
  assert.strictEqual(parseGmProposal(pending({ type: 'skill', path: 'review-message/SKILL.md', target: 'skills/review-message/SKILL.md' })).values, null);
  assert.throws(() => parseGmProposal(pending({ type: 'skill', path: '../kit/guard.cjs', target: 'skills/../kit/guard.cjs' })), OrchestratorInputError);
  assert.throws(() => parseGmProposal(pending({ type: 'skill', path: 'review-message/SKILL.md', target: 'kit/guard.cjs' })), /one skill text file/);
});

const unlocked = { authenticated: true, request: { headers: {}, ip: '127.0.0.1', socket: {} } };
type Resolver = (parent: unknown, args: unknown, context: unknown) => Promise<unknown>;

test('resolvers: the report from DOCK storage, and each conflict action writes only with a nonce DOCK consumes once', async (t) => {
  const before = process.env.DOCK_MODE;
  t.after(() => { if (before === undefined) delete process.env.DOCK_MODE; else process.env.DOCK_MODE = before; });
  process.env.DOCK_MODE = 'workspace';
  const cache = memoryCache();
  t.mock.method(StorageService.prototype, 'hasMasterPin', async () => false);
  t.mock.method(StorageService.prototype, 'getCache', cache.getCache);
  t.mock.method(StorageService.prototype, 'upsertCache', cache.upsertCache);
  t.mock.method(chatService, 'gmKey', async () => 'log-key');
  const sent: Array<{ op: string; input: Record<string, unknown> }> = [];
  t.mock.method(agentBridge, 'request', async (_machine: string, op: string, input: Record<string, unknown>) => {
    sent.push({ op, input });
    if (op === 'kit-merge-file') return { path: input.path, local: 'local', kit: 'kit', base: 'base', merged: '<<<<<<< local', clean: false };
    // The kit's write consumes the nonce through /chat/gm/confirm with the sha256 it computes itself.
    const body = typeof input.text === 'string' ? input.text : null;
    chatService.gmNonces.consume({ sessionId: null, nonce: input.nonce, sha256: kitResolveSha(String(input.path), input.action as 'local' | 'kit' | 'edit', body) });
    return { ok: true, entry: { id: 7 }, report: { ...REPORT, conflicts: [] } };
  });

  const Query = resolvers.Query as unknown as Record<string, Resolver>;
  const Mutation = resolvers.Mutation as unknown as Record<string, Resolver>;
  await new KitMergeReports(cache).ingest(REPORT, 'workspace', NOW);
  const listed = await Query.kitMergeReports(undefined, {}, unlocked) as Array<{ conflicts: Array<{ path: string }> }>;
  assert.deepStrictEqual(listed[0].conflicts.map((row) => row.path), ['skills/review-message/SKILL.md']);
  const file = await Query.kitConflictFile(undefined, { path: 'skills/review-message/SKILL.md' }, unlocked) as { kit: string };
  assert.strictEqual(file.kit, 'kit');

  for (const [action, body] of [['local', null], ['kit', null], ['edit', 'merged by hand']] as const) {
    const result = await Mutation.resolveKitConflict(undefined, { path: 'skills/review-message/SKILL.md', action, text: body }, unlocked) as { ok: boolean };
    assert.strictEqual(result.ok, true, action);
    const job = sent.at(-1)!;
    assert.strictEqual(job.op, 'gm-kit-resolve');
    assert.strictEqual(job.input.key, 'log-key');
    assert.throws(() => chatService.gmNonces.consume({ sessionId: null, nonce: job.input.nonce, sha256: kitResolveSha('skills/review-message/SKILL.md', action, body) }), /unknown, used or expired/, 'a nonce works once');
  }
  const after = await Query.kitMergeReports(undefined, {}, unlocked) as Array<{ conflicts: unknown[] }>;
  assert.deepStrictEqual(after[0].conflicts, [], 'the report the kit sent back replaces the stored one');
});

test('resolvers: a skill save needs DOCK\'s nonce for exactly that text', async (t) => {
  const before = process.env.DOCK_MODE;
  t.after(() => { if (before === undefined) delete process.env.DOCK_MODE; else process.env.DOCK_MODE = before; });
  process.env.DOCK_MODE = 'workspace';
  t.mock.method(StorageService.prototype, 'hasMasterPin', async () => false);
  t.mock.method(chatService, 'gmKey', async () => 'log-key');
  t.mock.method(agentBridge, 'request', async (_machine: string, op: string, input: Record<string, unknown>) => {
    assert.strictEqual(op, 'gm-skill-put');
    assert.throws(() => chatService.gmNonces.consume({ sessionId: null, nonce: input.nonce, sha256: skillPutSha('review-message/SKILL.md', 'other text') }), /unknown, used or expired/);
    return { ok: false, error: 'DOCK did not confirm' };
  });
  const save = (resolvers.Mutation as unknown as Record<string, Resolver>).saveLibrarySkillFile;
  assert.deepStrictEqual(await save(undefined, { path: 'review-message/SKILL.md', text: 'the text' }, unlocked), { ok: false, diff: '', error: 'DOCK did not confirm' });
  assert.throws(() => chatService.gmNonces.consume({ sessionId: null, sha256: skillPutSha('review-message/SKILL.md', 'the text') }), /needs DOCK's confirmation/, 'no nonce, no write');
});
