import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { DevServers, appEnv, linuxSystem, parseListeners, type DevSystem } from '../integrations/dev-servers';

const PROJECTS = '/home/coder/projects';

// pid -> [parent, command, cwd]
function fakeSystem(processes: Record<number, [number, string, string]>, listeners: Array<{ port: number; pid: number }>, options: { startError?: string; failExit?: string; stubborn?: boolean } = {}) {
  const calls = { started: [] as string[], stopped: [] as string[], killed: [] as number[], groups: [] as number[], fail: {} as Record<string, (message: string) => void> };
  const system: DevSystem = {
    listeners: async () => listeners,
    cwd: (pid) => processes[pid]?.[2] ?? null,
    parent: (pid) => processes[pid]?.[0] ?? 0,
    command: (pid) => processes[pid]?.[1] ?? '',
    children: (pid) => Object.entries(processes).filter(([, [parent]]) => parent === pid).map(([child]) => Number(child)),
    kill: (pids) => {
      calls.killed.push(...pids);
      if (!options.stubborn) for (const pid of pids) { const index = listeners.findIndex((item) => item.pid === pid); if (index >= 0) listeners.splice(index, 1); }
    },
    killGroup: (pid) => { calls.groups.push(pid); },
    start: async (app, logFile, onFail) => {
      if (options.startError) throw new Error(options.startError);
      calls.fail[app] = onFail;
      calls.started.push(app);
      fs.writeFileSync(logFile, `[${app}] ready\n`);
      if (options.failExit) onFail(options.failExit);
      return 4242;
    },
    stop: async (app) => { calls.stopped.push(app ?? 'all'); return app === 'landing' ? { ok: false, output: 'landing: did not stop' } : { ok: true, output: `${app ?? 'all'}: stopped` }; },
    ledgers: () => [{ key: 'QRD-1363', dirs: [`${PROJECTS}/wt-qrd-1363`] }],
  };
  return { system, calls };
}

test('ss lines give each listening port once, with its first pid', () => {
  const text = [
    'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=101,fd=22))',
    'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=101,fd=23))',
    'LISTEN 0 511 *:5173 *:* users:(("node",pid=202,fd=20),("node",pid=203,fd=20))',
    'LISTEN 0 4096 127.0.0.1:27017 0.0.0.0:*',
  ].join('\n');
  assert.deepStrictEqual(parseListeners(text), [{ port: 3000, pid: 101 }, { port: 5173, pid: 202 }]);
});

test('main apps by port, secondary servers by worktree with their ticket, and a stop that spares the agent', async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-logs-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const { system, calls } = fakeSystem({
    10: [1, 'claude', `${PROJECTS}/wt-qrd-1363`],
    11: [10, 'bash', `${PROJECTS}/wt-qrd-1363`],
    12: [11, 'npm', `${PROJECTS}/wt-qrd-1363`],
    13: [12, 'node', `${PROJECTS}/wt-qrd-1363`],
    14: [13, 'node', `${PROJECTS}/wt-qrd-1363/dist`],
    20: [1, 'node', `${PROJECTS}/ms-client-dashboard-frontend`],
    30: [1, 'node', `${PROJECTS}/wt-1345-fe`],
    40: [1, 'node', '/home/coder/elsewhere'],
  }, [{ port: 3263, pid: 13 }, { port: 5173, pid: 20 }, { port: 5183, pid: 30 }, { port: 9999, pid: 40 }]);
  fs.writeFileSync(path.join(logDir, 'wt-qrd-1363-3263.log'), 'listening on 3263\n');
  const servers = new DevServers(system, PROJECTS, logDir, () => new Date('2026-10-17T10:00:00.000Z'), 0);

  const listed = await servers.list();
  assert.deepStrictEqual(listed.main.map((app) => [app.name, app.running]), [['backend', false], ['frontend', true], ['widget', false], ['landing', false], ['wastaging', false]]);
  assert.deepStrictEqual(listed.secondary.map((item) => [item.folder, item.port, item.ticketKey, item.hasLog]), [['wt-1345-fe', 5183, null, false], ['wt-qrd-1363', 3263, 'QRD-1363', true]], 'a process outside the projects folder is not listed');

  await assert.rejects(servers.start('frontend'), /already running on port 5173/);
  await assert.rejects(servers.start('rm -rf'), /Unknown app/);
  assert.strictEqual(await servers.start('backend'), true);
  assert.deepStrictEqual(calls.started, ['backend']);
  assert.match(servers.log('backend'), /\[backend\] ready/);
  assert.strictEqual(servers.log('widget'), '', 'an app DOCK never started has no log');
  assert.match(servers.log('wt-qrd-1363-3263'), /listening on 3263/, 'a secondary server started with dev-server.cjs has its log');
  assert.throws(() => servers.log('../secret'), /No log named/);

  assert.strictEqual(await servers.stop('landing'), true, 'qonflo-dev failed but nothing listens on the port');
  assert.strictEqual(await servers.restart('backend'), true);
  assert.deepStrictEqual(calls.stopped, ['landing', 'backend']);

  assert.strictEqual(await servers.stopWorktree(3263), true);
  assert.deepStrictEqual(calls.killed.sort(), [12, 13, 14], 'npm and everything under it; the shell and the agent stay');
  await assert.rejects(servers.stopWorktree(5173), /No worktree server/, 'a main app is stopped with qonflo-dev, not by port');
  await assert.rejects(servers.stopWorktree(9999), /No worktree server/);

  assert.deepStrictEqual((await servers.list()).actions.map((item) => [item.target, item.action, item.ok]), [
    ['wt-qrd-1363:3263', 'stop', true], ['backend', 'start', true], ['backend', 'stop', true], ['landing', 'stop', true], ['backend', 'start', true],
  ]);
});

function mainSetup(t: TestContext, listeners: Array<{ port: number; pid: number }>, options: Parameters<typeof fakeSystem>[2] = {}) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-logs-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const fake = fakeSystem({
    50: [1, 'node', `${PROJECTS}/ms-landing-page`],
    51: [50, 'node', `${PROJECTS}/ms-landing-page`],
    60: [1, 'node', `${PROJECTS}/wastaging`],
  }, listeners, options);
  let now = Date.parse('2026-10-17T10:00:00.000Z');
  const servers = new DevServers(fake.system, PROJECTS, logDir, () => new Date(now), 0);
  return { ...fake, servers, logDir, advance: (ms: number) => { now += ms; } };
}

const states = async (servers: DevServers) => Object.fromEntries((await servers.list()).main.map((app) => [app.name, app.state]));

test('an app DOCK started is starting until its port binds, then failed with the log tail after the timeout', async (t) => {
  const listeners: Array<{ port: number; pid: number }> = [];
  const { servers, advance } = mainSetup(t, listeners);
  await servers.start('backend');
  let listed = (await servers.list()).main.find((app) => app.name === 'backend')!;
  assert.deepStrictEqual([listed.state, listed.running, listed.pid, listed.error], ['starting', false, 4242, null]);
  await assert.rejects(servers.start('backend'), /already starting/);

  advance(121_000);
  listed = (await servers.list()).main.find((app) => app.name === 'backend')!;
  assert.strictEqual(listed.state, 'failed');
  assert.match(listed.error!, /Nothing listens on port 3000 after 120s\.\n\[backend\] ready/);

  await servers.start('backend');
  listeners.push({ port: 3000, pid: 70 });
  listed = (await servers.list()).main.find((app) => app.name === 'backend')!;
  assert.deepStrictEqual([listed.state, listed.running, listed.pid], ['running', true, 70]);
});

test('a spawn error or an early failed exit shows instead of ok', async (t) => {
  const broken = mainSetup(t, [], { startError: 'spawn qonflo-dev ENOENT' });
  await assert.rejects(broken.servers.start('backend'), /did not start: spawn qonflo-dev ENOENT/);
  assert.strictEqual((await states(broken.servers)).backend, 'failed');
  assert.deepStrictEqual((await broken.servers.list()).actions.map((item) => [item.action, item.ok]), [['start', false]]);

  const exited = mainSetup(t, [], { failExit: 'qonflo-dev exited with 1' });
  await exited.servers.start('widget');
  const widget = (await exited.servers.list()).main.find((app) => app.name === 'widget')!;
  assert.strictEqual(widget.state, 'failed');
  assert.match(widget.error!, /qonflo-dev exited with 1/);
});

test('start all starts the apps that are neither running nor starting', async (t) => {
  const { servers, calls } = mainSetup(t, [{ port: 5173, pid: 80 }]);
  await servers.start('widget');
  assert.strictEqual(await servers.startAll(), true);
  assert.deepStrictEqual(calls.started, ['widget', 'backend', 'landing', 'wastaging']);
  assert.deepStrictEqual(await states(servers), { backend: 'starting', frontend: 'running', widget: 'starting', landing: 'starting', wastaging: 'starting' });
});

test('start all reports the apps that did not start and still starts the rest', async (t) => {
  const { servers } = mainSetup(t, [], { startError: 'spawn qonflo-dev ENOENT' });
  await assert.rejects(servers.startAll(), /backend did not start[^]*wastaging did not start/);
});

test('stop falls back to killing the process tree on the port, and restart still starts', async (t) => {
  const { servers, calls } = mainSetup(t, [{ port: 5000, pid: 51 }]);
  assert.strictEqual(await servers.stop('landing'), true);
  assert.deepStrictEqual(calls.killed.sort(), [50, 51]);
  assert.match((await servers.list()).actions[0].output, /did not stop\nkilled 2 process\(es\) on port 5000/);

  const again = mainSetup(t, [{ port: 3100, pid: 60 }]);
  assert.strictEqual(await again.servers.restart('wastaging'), true);
  assert.deepStrictEqual(again.calls.killed, [60], 'qonflo-dev stop worked but the port stayed bound');
  assert.deepStrictEqual(again.calls.started, ['wastaging']);
});

test('stop fails when the port stays bound after the kill', async (t) => {
  const { servers } = mainSetup(t, [{ port: 3100, pid: 60 }], { stubborn: true });
  await assert.rejects(servers.stop('wastaging'), /still listens on port 3100/);
  assert.strictEqual((await servers.list()).actions[0].ok, false);
});

test('stop all runs qonflo-dev stop and clears what stays bound', async (t) => {
  const { servers, calls } = mainSetup(t, [{ port: 5000, pid: 51 }, { port: 3100, pid: 60 }]);
  await servers.start('backend');
  assert.strictEqual(await servers.stopAll(), true);
  assert.deepStrictEqual(calls.stopped, ['all']);
  assert.deepStrictEqual(calls.killed.sort(), [50, 51, 60]);
  assert.deepStrictEqual(await states(servers), { backend: 'stopped', frontend: 'stopped', widget: 'stopped', landing: 'stopped', wastaging: 'stopped' });
});

test('stop ends the process group of an app still starting and ignores its later exit', async (t) => {
  const { servers, calls } = mainSetup(t, []);
  await servers.start('backend');
  await servers.stop('backend');
  assert.deepStrictEqual(calls.groups, [4242]);
  calls.fail.backend('qonflo-dev exited with 143');
  assert.deepStrictEqual((await servers.list()).actions.map((item) => [item.action, item.ok]), [['stop', true], ['start', true]]);
  assert.strictEqual((await states(servers)).backend, 'stopped');
});

test('a start that timed out has its process group ended before the next start', async (t) => {
  const { servers, calls, advance } = mainSetup(t, []);
  await servers.start('backend');
  advance(121_000);
  await servers.start('backend');
  assert.deepStrictEqual(calls.groups, [4242]);
});

test('a listener from another folder is not killed, nor is init or DOCK itself', async (t) => {
  const foreign = mainSetup(t, [{ port: 5173, pid: 80 }]);
  await assert.rejects(foreign.servers.stop('frontend'), /port 5173 held by pid 80 outside ms-client-dashboard-frontend/);
  assert.deepStrictEqual(foreign.calls.killed, []);

  for (const pid of [1, process.pid]) {
    const setup = mainSetup(t, [{ port: 3100, pid }]);
    const processes = { [pid]: [0, 'node', `${PROJECTS}/wastaging`] } as Record<number, [number, string, string]>;
    const { system, calls } = fakeSystem(processes, [{ port: 3100, pid }]);
    const servers = new DevServers(system, PROJECTS, setup.logDir, () => new Date(), 0);
    await assert.rejects(servers.stop('wastaging'), /still listens on port 3100/);
    assert.deepStrictEqual(calls.killed, []);
  }
});

test('stop all reads the listeners once per poll for every app', async (t) => {
  const { servers, system } = mainSetup(t, []);
  let reads = 0;
  const read = system.listeners;
  system.listeners = async () => { reads += 1; return read(); };
  await servers.stopAll();
  assert.strictEqual(reads, 1);
});

test('the real start rejects when the command does not exist', { skip: process.platform === 'win32' }, async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-logs-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const messages: string[] = [];
  await assert.rejects(linuxSystem(PROJECTS, '/nonexistent/qonflo-dev').start('backend', path.join(logDir, 'backend.log'), (message) => messages.push(message)), /ENOENT/);
  assert.deepStrictEqual(messages, []);
});

/** The started child is unref'd, so nothing else keeps the event loop alive until its exit arrives. */
const keepAlive = <T>(promise: Promise<T>) => {
  const timer = setInterval(() => undefined, 50);
  return promise.finally(() => clearInterval(timer));
};

test('the real start reports a failed exit', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'qonflo-dev');
  fs.writeFileSync(script, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  const failure = new Promise<string>((resolve) => { void linuxSystem(PROJECTS, script).start('backend', path.join(dir, 'backend.log'), resolve); });
  assert.match(await keepAlive(failure), /exited with 3/);
});

test('apps do not get the variables meant for DOCK', () => {
  const env = appEnv({ PATH: '/usr/bin', HOME: '/home/coder', PORT: '4100', NODE_ENV: 'production', DATABASE_URL: 'file:x', ENCRYPTION_KEY: 'k', TRUST_PROXY: 'true', FRONTEND_DIST_PATH: '/d', DOCK_MODE: 'workspace', DOCK_LEDGER_PEER_TOKEN: 't', JIDIS_DATA_DIR: '/s' });
  assert.deepStrictEqual(env, { PATH: '/usr/bin', HOME: '/home/coder' });
});

test('the real start runs qonflo-dev without DOCK port or secrets', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'qonflo-dev');
  const seen = path.join(dir, 'seen');
  fs.writeFileSync(script, `#!/bin/sh\necho "port=\${PORT:-none} key=\${ENCRYPTION_KEY:-none} path=\${PATH:+set}" > ${seen}\nexit 3\n`, { mode: 0o755 });
  const saved = { PORT: process.env.PORT, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  process.env.PORT = '4100';
  process.env.ENCRYPTION_KEY = 'secret';
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
  await keepAlive(new Promise<string>((resolve) => { void linuxSystem(PROJECTS, script).start('backend', path.join(dir, 'backend.log'), resolve); }));
  assert.strictEqual(fs.readFileSync(seen, 'utf8').trim(), 'port=none key=none path=set');
});
