import assert from 'node:assert';
import test from 'node:test';
import { generateIngestToken } from '../auth/ingest-token';
import { ensureIngestToken } from '../cli/ensure-ingest-token';
import { OrchestratorService } from '../integrations/orchestrator';
import type { StorageService } from '../storage/service';

function memoryStorage() {
  const tokens: any[] = [];
  const storage = {
    countIngestTokens: async () => tokens.length,
    createIngestToken: async (data: any) => {
      const token = { id: String(tokens.length + 1), ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash) ?? null,
    touchIngestToken: async () => undefined,
  };
  return { service: new OrchestratorService(storage as unknown as StorageService, '', null), tokens };
}

test('ensureIngestToken keeps a valid workspace token and prints nothing', async () => {
  const { service, tokens } = memoryStorage();
  const { token } = await service.createToken('workspace', 'workspace');
  assert.strictEqual(await ensureIngestToken(service, token), null);
  assert.strictEqual(tokens.length, 1);
});

test('ensureIngestToken creates one workspace token when the env token is missing', async () => {
  const { service, tokens } = memoryStorage();
  const created = await ensureIngestToken(service, undefined);
  assert.ok(created);
  assert.strictEqual(tokens.length, 1);
  assert.strictEqual(tokens[0].machine, 'workspace');
  assert.strictEqual(await service.authenticateMachine(created), 'workspace');
});

test('ensureIngestToken creates one token when the env token is unknown', async () => {
  const { service, tokens } = memoryStorage();
  assert.ok(await ensureIngestToken(service, generateIngestToken().token));
  assert.strictEqual(tokens.length, 1);
});

test('ensureIngestToken replaces a token that belongs to another machine', async () => {
  const { service, tokens } = memoryStorage();
  const { token } = await service.createToken('laptop', 'laptop');
  assert.ok(await ensureIngestToken(service, token));
  assert.strictEqual(tokens.length, 2);
});
