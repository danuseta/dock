import assert from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Express } from 'express';
import { createApp } from '../app';

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

test('DOCK monolith shell serves API and SPA from one Express app', async (t) => {
  const frontendDist = await mkdtemp(path.join(os.tmpdir(), 'jidis-spa-'));
  await mkdir(path.join(frontendDist, 'assets'));
  await writeFile(path.join(frontendDist, 'index.html'), '<!doctype html><title>DOCK shell</title>');
  await writeFile(path.join(frontendDist, 'assets', 'app.js'), 'window.DOCK = true;');

  const shell = await createApp({ frontendDistPath: frontendDist });
  const runtime = await listen(shell.app);

  t.after(async () => {
    await runtime.close();
    await shell.apolloServer.stop();
    await rm(frontendDist, { recursive: true, force: true });
  });

  await t.test('keeps the health endpoint as JSON', async () => {
    const response = await fetch(`${runtime.baseUrl}/health`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { status: 'ok', service: 'bff-graphql' });
  });

  await t.test('serves static assets and SPA route fallback', async () => {
    const asset = await fetch(`${runtime.baseUrl}/assets/app.js`);
    assert.strictEqual(asset.status, 200);
    assert.match(await asset.text(), /window\.DOCK/);

    const route = await fetch(`${runtime.baseUrl}/work`);
    assert.strictEqual(route.status, 200);
    assert.match(await route.text(), /DOCK shell/);

    const missingAsset = await fetch(`${runtime.baseUrl}/assets/missing.js`);
    assert.strictEqual(missingAsset.status, 404);
  });

  await t.test('keeps GraphQL active and does not mask unknown API routes', async () => {
    const graphql = await fetch(`${runtime.baseUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    assert.strictEqual(graphql.status, 200);
    assert.deepStrictEqual(await graphql.json(), { data: { __typename: 'Query' } });

    const missingApi = await fetch(`${runtime.baseUrl}/api/missing`);
    assert.strictEqual(missingApi.status, 404);

    const removedInternalStorage = await fetch(`${runtime.baseUrl}/internal/storage/settings`);
    assert.strictEqual(removedInternalStorage.status, 404);
  });

  await t.test('allows the canonical Vite development origin', async () => {
    const preflight = await fetch(`${runtime.baseUrl}/graphql`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.strictEqual(preflight.status, 204);
    assert.strictEqual(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.strictEqual(preflight.headers.get('access-control-allow-credentials'), 'true');
  });

  await t.test('allows the state-protected Google callback without a cross-site session cookie', async () => {
    const callback = await fetch(`${runtime.baseUrl}/auth/google/callback`, { redirect: 'manual' });
    assert.strictEqual(callback.status, 302);
    assert.strictEqual(callback.headers.get('location'), '/settings?google=failed&reason=state-expired');
  });

  await t.test('preserves the provider error when Google denies authorization', async () => {
    const callback = await fetch(`${runtime.baseUrl}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    assert.strictEqual(callback.status, 302);
    assert.strictEqual(callback.headers.get('location'), '/settings?google=failed&reason=access-denied');
  });
});
