import assert from 'node:assert';
import test from 'node:test';
import { ChatService } from '../integrations/chat';
import { removeMachineSessions, type MachineCleanupDeps } from '../integrations/chat-cleanup';
import { OrchestratorInputError } from '../integrations/orchestrator';
import type { StorageService } from '../storage/service';

const COUNTS = { messages: 40, activity: 12, interactions: 3, attachments: 2, attachmentBytes: 2048 };

function fakeDeps(sessions: Array<{ id: string; source: string }>, broken = new Set<string>()) {
  const deleted: string[] = [];
  const forgotten: string[] = [];
  const deps: MachineCleanupDeps = {
    sessions: async () => sessions,
    counts: async () => COUNTS,
    deleteSession: async (id) => {
      if (broken.has(id)) throw new Error('disk full');
      deleted.push(id);
      return true;
    },
    forgetStatus: async (machine) => { forgotten.push(machine); },
  };
  return { deps, deleted, forgotten };
}

const LAPTOP = [{ id: 'cli-1', source: 'cli' }, { id: 'cli-2', source: 'cli' }, { id: 'dock-1', source: 'dock' }];

test('a dry run counts what would go and removes nothing', async () => {
  const { deps, deleted, forgotten } = fakeDeps(LAPTOP);
  const report = await removeMachineSessions(deps, 'laptop', false);
  assert.deepStrictEqual(report, {
    machine: 'laptop', apply: false, sessions: { total: 3, cli: 2, dock: 1 }, ...COUNTS, deleted: 0, failed: [],
  });
  assert.deepStrictEqual(deleted, []);
  assert.deepStrictEqual(forgotten, []);
});

test('apply removes every session of the machine, cli and dock, then forgets its status lines', async () => {
  const { deps, deleted, forgotten } = fakeDeps(LAPTOP, new Set(['cli-2']));
  const report = await removeMachineSessions(deps, ' Laptop ', true);
  assert.deepStrictEqual(deleted, ['cli-1', 'dock-1']);
  assert.deepStrictEqual([report.deleted, report.failed], [2, ['cli-2']], 'one failure does not stop the rest');
  assert.deepStrictEqual(forgotten, ['laptop']);
});

test('the workspace sessions and a bad machine name are refused', async () => {
  const { deps } = fakeDeps(LAPTOP);
  await assert.rejects(removeMachineSessions(deps, 'workspace', true), OrchestratorInputError);
  await assert.rejects(removeMachineSessions(deps, undefined, false), OrchestratorInputError);
});

test('forgetStatus drops one machine from the saved status lines and keeps the others', async () => {
  const cache = new Map<string, unknown>([['chat:sessionStatus', {
    laptop: [{ sessionId: 'old-laptop', receivedAt: '2026-10-08T00:00:00.000Z' }],
    workspace: [{ sessionId: 'kept', receivedAt: '2026-10-08T00:00:00.000Z' }],
  }]]);
  const storage = {
    getSettingValues: async () => [] as Array<{ key: string; value: string }>,
    getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { cache.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
  } as unknown as StorageService;
  const chat = new ChatService(storage, () => new Date('2026-10-08T00:01:00.000Z'));
  await chat.forgetStatus('laptop');
  const saved = cache.get('chat:sessionStatus') as Record<string, Array<{ sessionId: string }>>;
  assert.deepStrictEqual(Object.keys(saved), ['workspace']);
  assert.strictEqual(saved.workspace[0].sessionId, 'kept');
  assert.deepStrictEqual(chat.statusSnapshot('laptop').sessions, []);
});
