import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import type { Express } from 'express';

async function listen(app: Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function graphql(baseUrl: string, query: string, cookie?: string) {
  return fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ query }),
  });
}

test('SQLite storage preserves settings, PIN, demo-link, and cache behavior', {
  skip: process.env.JIDIS_SQLITE_INTEGRATION !== '1',
}, async (t) => {
  const [{ StorageService }, { prisma }, { createApp }] = await Promise.all([
    import('../storage/service'),
    import('../storage/client'),
    import('../app'),
  ]);
  const storage = new StorageService(prisma);
  t.after(() => prisma.$disconnect());

  await storage.upsertSetting('jiraApiToken', 'encrypted-secret');
  await storage.upsertSetting('googleClientSecret', 'google-secret');
  const settings = await storage.getSettings();
  assert.strictEqual(settings.find((item) => item.key === 'jiraApiToken')?.value, 'encrypted-secret');
  assert.strictEqual(settings.find((item) => item.key === 'googleClientSecret')?.value, 'google-secret');

  await storage.createQuickLink({ title: 'GitHub', url: 'https://github.com', color: '#60a5fa' });
  assert.strictEqual((await storage.getQuickLinks())[0]?.title, 'GitHub');

  const monitor = await storage.createMonitorTarget({ name: 'Portfolio', url: 'https://example.com/health', expectedStatus: 200, timeoutMs: 5000 });
  await storage.updateMonitorResult(monitor.id, { lastStatus: 'UP', lastStatusCode: 200, lastLatencyMs: 42, lastCheckedAt: new Date(), lastError: null });
  assert.deepStrictEqual((await storage.getMonitorTargets()).map((item) => [item.name, item.lastStatus, item.lastLatencyMs]), [['Portfolio', 'UP', 42]]);

  await storage.setMasterPin('123456');
  assert.strictEqual(await storage.verifyMasterPin('123456'), true);
  assert.strictEqual(await storage.verifyMasterPin('654321'), false);

  await storage.upsertDemoLink('JID-1', 'https://example.test/demo');
  assert.strictEqual((await storage.getDemoLink('JID-1'))?.url, 'https://example.test/demo');

  await storage.upsertCache('jira', 'assigned', [{ key: 'JID-1' }], 60);
  assert.deepStrictEqual(await storage.getCache('jira', 'assigned'), [{ key: 'JID-1' }]);

  const shell = await createApp({ frontendDistPath: 'missing-for-integration-test' });
  const runtime = await listen(shell.app);
  t.after(async () => {
    await runtime.close();
    await shell.apolloServer.stop();
  });

  const locked = await graphql(runtime.baseUrl, '{ dashboard { status } }');
  const lockedBody: any = await locked.json();
  assert.strictEqual(lockedBody.errors?.[0]?.extensions?.code, 'UNAUTHENTICATED');

  const unlock = await graphql(
    runtime.baseUrl,
    'mutation { verifyMasterPin(pin: "123456") }',
  );
  const unlockBody: any = await unlock.json();
  assert.strictEqual(unlockBody.data?.verifyMasterPin, true);
  const cookie = unlock.headers.get('set-cookie')?.split(';', 1)[0];
  assert.match(cookie || '', /^jidis_session=/);

  const status = await graphql(runtime.baseUrl, '{ authStatus { authenticated hasMasterPin } }', cookie);
  assert.deepStrictEqual(await status.json(), {
    data: { authStatus: { authenticated: true, hasMasterPin: true } },
  });
});
