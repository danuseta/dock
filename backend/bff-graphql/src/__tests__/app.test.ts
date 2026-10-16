import assert from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Express } from 'express';
import { buildOf, createApp } from '../app';

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
    assert.deepStrictEqual(await response.json(), { status: 'ok', service: 'bff-graphql', build: null }, 'this shell has no hashed entry script');
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

test('each DOCK mode serves only the routes its pages use', async (t) => {
  const before = process.env.DOCK_MODE;
  const appIn = async (mode: string) => {
    process.env.DOCK_MODE = mode;
    return createApp({ frontendDistPath: 'missing-for-mode-test' });
  };
  const laptop = await appIn('laptop');
  const workspace = await appIn('workspace');
  const laptopRuntime = await listen(laptop.app);
  const workspaceRuntime = await listen(workspace.app);
  t.after(async () => {
    if (before === undefined) delete process.env.DOCK_MODE;
    else process.env.DOCK_MODE = before;
    await laptopRuntime.close();
    await workspaceRuntime.close();
    await laptop.apolloServer.stop();
    await workspace.apolloServer.stop();
  });

  const modeOf = async (baseUrl: string) => {
    const response = await fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ dockMode }' }),
    });
    return (await response.json()).data.dockMode;
  };
  assert.strictEqual(await modeOf(workspaceRuntime.baseUrl), 'workspace');
  await assert.rejects(appIn('desktop'), /DOCK_MODE must be one of laptop, workspace/);

  const claim = await fetch(`${laptopRuntime.baseUrl}/ingest/orchestrator/chat/claim`, { method: 'POST' });
  assert.strictEqual(claim.status, 404, 'a laptop DOCK takes no chat from its bridge');
  const history = await fetch(`${laptopRuntime.baseUrl}/ingest/orchestrator/sessions`, { method: 'POST' });
  assert.strictEqual(history.status, 404, 'a laptop DOCK keeps no session history');
  const ledger = await fetch(`${laptopRuntime.baseUrl}/ingest/orchestrator`, { method: 'POST' });
  assert.strictEqual(ledger.status, 401, 'the run ledger still asks for its token');
  const workspaceClaim = await fetch(`${workspaceRuntime.baseUrl}/ingest/orchestrator/chat/claim`, { method: 'POST' });
  assert.strictEqual(workspaceClaim.status, 401, 'a workspace DOCK takes chat once the bridge shows its token');

  const laptopGoogle = await fetch(`${laptopRuntime.baseUrl}/auth/google/callback`, { redirect: 'manual' });
  assert.strictEqual(laptopGoogle.status, 302);
  const workspaceGoogle = await fetch(`${workspaceRuntime.baseUrl}/auth/google/callback`, { redirect: 'manual' });
  assert.strictEqual(workspaceGoogle.status, 404, 'a workspace DOCK has no calendar to connect');
});

test('the build of a page is the hashed name of its entry script', () => {
  assert.strictEqual(buildOf('<script type="module" crossorigin src="/assets/index-Bx9_k2-a.js"></script><link rel="stylesheet" href="/assets/index-DfQ1.css">'), '/assets/index-Bx9_k2-a.js');
  assert.strictEqual(buildOf('<!doctype html><title>DOCK shell</title>'), null);
});
