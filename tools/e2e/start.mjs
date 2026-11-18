#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const backend = path.join(root, 'backend', 'bff-graphql');
const frontend = path.join(root, 'frontend');
const E2E_ENCRYPTION_KEY = 'dock-e2e-encryption-key';

export function e2eConfig(env = process.env) {
  const dir = path.resolve(env.E2E_DIR?.trim() || path.join(os.tmpdir(), 'dock-e2e'));
  const ports = { mock: Number(env.E2E_MOCK_PORT || 4610), backend: Number(env.E2E_BE_PORT || 4710), frontend: Number(env.E2E_FE_PORT || 3710) };
  const mockUrl = `http://localhost:${ports.mock}`;
  return {
    dir,
    ports,
    urls: { mock: mockUrl, backend: `http://localhost:${ports.backend}`, graphql: `http://localhost:${ports.backend}/graphql`, frontend: `http://localhost:${ports.frontend}` },
    database: `file:${path.join(dir, 'dock.db').replace(/\\/g, '/')}`,
    evidence: path.join(dir, 'evidence'),
    ccusage: path.join(here, 'fake-ccusage.mjs'),
    encryptionKey: env.E2E_ENCRYPTION_KEY?.trim() || E2E_ENCRYPTION_KEY,
  };
}

export function backendEnv(config, token, env = process.env) {
  return {
    ...env,
    NODE_ENV: 'development',
    PORT: String(config.ports.backend),
    DATABASE_URL: config.database,
    JIDIS_DATA_DIR: config.dir,
    ENCRYPTION_KEY: config.encryptionKey,
    DOCK_MODE: 'workspace',
    DOCK_MOCK_URL: config.urls.mock,
    DOCK_ATLASSIAN_BASE_URL: `${config.urls.mock}/jira`,
    CCUSAGE_BIN: config.ccusage,
    CLAUDE_CONFIG_DIR: path.join(config.dir, 'claude'),
    DOCK_BLACKBOARD_DIR: config.evidence,
    DOCK_SPRINT_BOARDS_DIR: path.join(config.dir, 'boards'),
    DOCK_INGEST_TOKEN: token,
    CORS_ORIGIN: config.urls.frontend,
    SESSION_COOKIE_SECURE: 'false',
    E2E_DIR: config.dir,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(name, check, timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`${name} did not come up within ${timeoutMs / 1000}s`);
    await wait(500);
  }
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

export async function startStack({ withBridge = false, fresh = false, seed = true, log = (line) => process.stdout.write(`${line}\n`), env = process.env } = {}) {
  const config = e2eConfig(env);
  mkdirSync(config.dir, { recursive: true });
  const children = [];
  const output = (name) => openSync(path.join(config.dir, `${name}.log`), 'w');
  const run = (name, args, options) => {
    const out = output(name);
    const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', out, out], windowsHide: true });
    children.push(child);
    return child;
  };
  const stop = async () => {
    for (const child of children.reverse()) stopChild(child);
    await wait(300);
  };
  try {
    run('mock', [path.join(here, 'mock-server.mjs'), '--port', String(config.ports.mock)], { cwd: root, env: { ...env, MOCK_VERBOSE: '1' } });
    await until('mock server', async () => (await fetch(`${config.urls.mock}/health`)).ok);

    if (seed) {
      const seeded = spawnSync(process.execPath, ['--import', 'tsx', path.join(backend, 'src', 'cli', 'seed-e2e.ts'), ...(fresh ? ['--fresh'] : [])], {
        cwd: backend, env: { ...env, E2E_DIR: config.dir, DOCK_MOCK_URL: config.urls.mock, E2E_ENCRYPTION_KEY: config.encryptionKey }, encoding: 'utf8', windowsHide: true,
      });
      if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr || seeded.stdout}`);
      log(seeded.stdout.trim());
    }
    const token = readFileSync(path.join(config.dir, 'token'), 'utf8').trim();

    run('backend', ['--import', 'tsx', path.join(backend, 'src', 'index.ts')], { cwd: backend, env: backendEnv(config, token, env) });
    await until('DOCK backend', async () => (await fetch(`${config.urls.backend}/health`)).ok);

    const vite = path.join(path.dirname(createRequire(path.join(frontend, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
    run('frontend', [vite, '--port', String(config.ports.frontend), '--strictPort'], { cwd: frontend, env: { ...env, VITE_GRAPHQL_URL: config.urls.graphql } });
    await until('DOCK frontend', async () => (await fetch(config.urls.frontend)).ok);

    const bridge = path.join(here, 'fake-bridge.mjs');
    if (withBridge && existsSync(bridge)) {
      run('bridge', [bridge], { cwd: root, env: { ...env, E2E_DIR: config.dir, DOCK_URL: config.urls.backend, DOCK_INGEST_URL: `${config.urls.backend}/ingest/orchestrator`, DOCK_INGEST_TOKEN: token, DOCK_MOCK_URL: config.urls.mock } });
      log(`fake bridge started (${path.join(config.dir, 'bridge.log')})`);
    } else if (withBridge) {
      log('fake bridge not built yet; skipped');
    }
  } catch (error) {
    await stop();
    throw error;
  }
  log(`mock      ${config.urls.mock}  (GET /__state, POST /__script)`);
  log(`backend   ${config.urls.graphql}`);
  log(`frontend  ${config.urls.frontend}  (PIN 767676${fresh ? ', not set: --fresh' : ''})`);
  log(`E2E_DIR   ${config.dir}  (logs: mock.log, backend.log, frontend.log)`);
  return { config, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    const { stop } = await startStack({ withBridge: args.includes('--with-bridge'), fresh: args.includes('--fresh'), seed: !args.includes('--no-seed') });
    const shutdown = () => stop().then(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    setInterval(() => undefined, 1 << 30);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
