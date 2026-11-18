import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { E2E_ENCRYPTION_KEY, E2E_IDS, e2eDatabaseUrl, e2eSettings } from '../cli/seed-e2e';

const SEED = path.resolve(__dirname, '../cli/seed-e2e.ts');
const MOCK = 'http://localhost:4610';

function seed(dir: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_DIR: dir, DOCK_MOCK_URL: MOCK, E2E_ENCRYPTION_KEY: '' };
  delete env.DATABASE_URL;
  execFileSync(process.execPath, ['--import', 'tsx', SEED, ...args], { env, stdio: 'pipe', cwd: path.resolve(__dirname, '../..') });
}

async function readBack(dir: string) {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = E2E_ENCRYPTION_KEY;
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl(dir) } } });
  try {
    const { StorageService } = await import('../storage/service');
    const storage = new StorageService(db);
    const settings = Object.fromEntries((await storage.getSettings()).map((row) => [row.key, row.value]));
    return { settings, hasPin: await storage.hasMasterPin(), pinOk: await storage.verifyMasterPin(E2E_IDS.pin).catch(() => false), channels: await db.discordChannel.findMany(), tokens: await db.ingestToken.count() };
  } finally {
    await db.$disconnect();
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  }
}

test('seed:e2e writes a sqlite DB pointing every integration at the mock, with the PIN, an ingest token and the evidence folder', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-seed-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  seed(dir);
  const read = await readBack(dir);
  for (const [key, value] of Object.entries(e2eSettings(MOCK, dir, false))) assert.strictEqual(read.settings[key], value, key);
  assert.strictEqual(read.settings.discordWebhookUrl, `${MOCK}/discord/api/webhooks/${E2E_IDS.webhookId}/${E2E_IDS.webhookToken}`);
  assert.strictEqual(read.settings.discordUserId, E2E_IDS.ownerDiscordId);
  assert.strictEqual(read.settings.planningSplitPage, E2E_IDS.splitPage);
  assert.strictEqual(read.settings.planningConfluenceParent, E2E_IDS.confluenceParent);
  assert.strictEqual(read.hasPin, true);
  assert.strictEqual(read.pinOk, true);
  assert.deepStrictEqual(read.channels.map((row) => [row.id, row.kind, row.enabled]).sort(), [[E2E_IDS.prForum, 'pr', true], [E2E_IDS.bugForum, 'bug', true]].sort());
  assert.strictEqual(read.tokens, 1);
  assert.match(readFileSync(path.join(dir, 'token'), 'utf8').trim(), /\S{20,}/);
  assert.ok(existsSync(path.join(dir, 'evidence')));
  assert.ok(existsSync(path.join(dir, 'videos')));
});

test('seed:e2e --fresh overwrites the DB and leaves Jira, GitHub and the PIN unset', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dock-seed-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  seed(dir);
  seed(dir, '--fresh');
  const read = await readBack(dir);
  assert.strictEqual(read.settings.jiraUrl, undefined);
  assert.strictEqual(read.settings.jiraApiToken, undefined);
  assert.strictEqual(read.settings.githubToken, undefined);
  assert.strictEqual(read.hasPin, false);
  assert.strictEqual(read.settings.discordGuildId, E2E_IDS.guild);
  assert.strictEqual(read.tokens, 1);
});
