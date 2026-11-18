import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const E2E_IDS = {
  guild: '100000000000000001',
  prForum: '100000000000000010',
  bugForum: '100000000000000011',
  webhookId: '900000000000000001',
  webhookToken: 'e2e-webhook-token',
  ownerDiscordId: '111111111111111111',
  teammateDiscordId: '222222222222222222',
  confluenceParent: '5000',
  splitPage: '5001',
  contractPage: '5002',
  pin: '767676',
} as const;
export const E2E_ENCRYPTION_KEY = 'dock-e2e-encryption-key';

export const e2eDir = (env: NodeJS.ProcessEnv = process.env) => path.resolve(env.E2E_DIR?.trim() || path.join(os.tmpdir(), 'dock-e2e'));
export const e2eDatabaseUrl = (dir: string) => `file:${path.join(dir, 'dock.db').replace(/\\/g, '/')}`;
export const e2eMockUrl = (env: NodeJS.ProcessEnv = process.env) => (env.DOCK_MOCK_URL?.trim() || 'http://localhost:4610').replace(/\/+$/, '');

export function e2eSettings(mockUrl: string, dir: string, fresh: boolean): Record<string, string> {
  return {
    ...(fresh ? {} : {
      jiraUrl: 'qonflo-e2e.atlassian.net',
      jiraEmail: 'danu@e2e.test',
      jiraApiToken: 'e2e-jira-token',
      githubToken: 'e2e-github-token',
    }),
    jiraProjectKeys: 'QRD',
    githubRepos: 'qonflo/dashboard,qonflo/backend',
    discordBotToken: 'e2e-bot-token',
    discordGuildId: E2E_IDS.guild,
    discordUserId: E2E_IDS.ownerDiscordId,
      discordWebhookUrl: `${mockUrl}/discord/api/webhooks/${E2E_IDS.webhookId}/${E2E_IDS.webhookToken}`,
    autoReviewOnIt: 'true',
    autoLgtm: 'true',
    reviewFindingsToTask: 'true',
    autoReviewPostDiscord: 'true',
    reviewFindingsAutoReply: 'true',
    reviewPostDelayMinutes: '0',
    reviewReReviewWaitMinutes: '1',
    lightRunnerOn: 'true',
    storagePlugin: 'local',
    storageLocalDir: path.join(dir, 'videos'),
    voicePlugin: 'none',
    planningConfluenceParent: E2E_IDS.confluenceParent,
  };
}

export const e2eRawSettings = (): Record<string, string> => ({
  planningSplitPage: E2E_IDS.splitPage,
});

export async function seedE2E(dir: string, mockUrl: string, fresh: boolean): Promise<{ token: string }> {
  mkdirSync(dir, { recursive: true });
  for (const name of ['dock.db', 'dock.db-journal', 'dock.db-wal', 'dock.db-shm']) rmSync(path.join(dir, name), { force: true });
  for (const name of ['evidence', 'boards', 'videos', 'claude']) mkdirSync(path.join(dir, name), { recursive: true });
  process.env.DATABASE_URL = e2eDatabaseUrl(dir);
  process.env.DOCK_MOCK_URL = mockUrl;
  process.env.ENCRYPTION_KEY = process.env.E2E_ENCRYPTION_KEY?.trim() || E2E_ENCRYPTION_KEY;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--accept-data-loss', '--schema', path.resolve(__dirname, '../../prisma/schema.prisma')], { env: process.env, stdio: 'pipe' });

  const [{ StorageAPI }, { StorageService }, { prisma }, { orchestratorService }, { prismaChannelStore }] = await Promise.all([
    import('../datasources/StorageAPI'),
    import('../storage/service'),
    import('../storage/client'),
    import('../integrations/orchestrator'),
    import('../integrations/discord-threads'),
  ]);
  try {
    const storage = new StorageService(prisma);
    const api = new StorageAPI(storage);
    if (!(await api.updateSettings(e2eSettings(mockUrl, dir, fresh)))) throw new Error('The e2e settings were refused');
    for (const [key, value] of Object.entries(e2eRawSettings())) await storage.upsertSetting(key, value);
    if (!fresh && !(await api.setMasterPin(E2E_IDS.pin))) throw new Error('The e2e PIN was refused');
    const channels = prismaChannelStore(prisma);
    await channels.save({ id: E2E_IDS.prForum, name: 'pr-review', kind: 'pr', thread: false, enabled: true });
    await channels.save({ id: E2E_IDS.bugForum, name: 'bug-report', kind: 'bug', thread: false, enabled: true });
    const { token } = await orchestratorService.createToken('workspace', 'workspace');
    writeFileSync(path.join(dir, 'token'), `${token}\n`);
    writeFileSync(path.join(dir, 'seed.json'), `${JSON.stringify({ mockUrl, fresh, database: e2eDatabaseUrl(dir), evidence: path.join(dir, 'evidence'), ...E2E_IDS }, null, 2)}\n`);
    return { token };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const dir = e2eDir();
  const fresh = process.argv.includes('--fresh');
  await seedE2E(dir, e2eMockUrl(), fresh);
  process.stdout.write(`Seeded ${path.join(dir, 'dock.db')}${fresh ? ' (fresh: no Jira, GitHub or PIN)' : ''}; token in ${path.join(dir, 'token')}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
