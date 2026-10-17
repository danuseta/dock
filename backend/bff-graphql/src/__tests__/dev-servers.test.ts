import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DevServers, parseListeners, type DevSystem } from '../integrations/dev-servers';

const PROJECTS = '/home/coder/projects';

// pid -> [parent, command, cwd]
function fakeSystem(processes: Record<number, [number, string, string]>, listeners: Array<{ port: number; pid: number }>) {
  const calls = { started: [] as string[], stopped: [] as string[], killed: [] as number[] };
  const system: DevSystem = {
    listeners: async () => listeners,
    cwd: (pid) => processes[pid]?.[2] ?? null,
    parent: (pid) => processes[pid]?.[0] ?? 0,
    command: (pid) => processes[pid]?.[1] ?? '',
    children: (pid) => Object.entries(processes).filter(([, [parent]]) => parent === pid).map(([child]) => Number(child)),
    kill: (pids) => { calls.killed.push(...pids); },
    start: (app, logFile) => { calls.started.push(app); fs.writeFileSync(logFile, `[${app}] ready\n`); },
    stop: async (app) => { calls.stopped.push(app); return app === 'landing' ? { ok: false, output: 'landing: did not stop' } : { ok: true, output: `${app}: stopped` }; },
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
  const servers = new DevServers(system, PROJECTS, logDir, () => new Date('2026-10-17T10:00:00.000Z'));

  const listed = await servers.list();
  assert.deepStrictEqual(listed.main.map((app) => [app.name, app.running]), [['backend', false], ['frontend', true], ['widget', false], ['landing', false], ['wastaging', false]]);
  assert.deepStrictEqual(listed.secondary.map((item) => [item.folder, item.port, item.ticketKey]), [['wt-1345-fe', 5183, null], ['wt-qrd-1363', 3263, 'QRD-1363']], 'a process outside the projects folder is not listed');

  await assert.rejects(servers.start('frontend'), /already running on port 5173/);
  await assert.rejects(servers.start('rm -rf'), /Unknown app/);
  assert.strictEqual(await servers.start('backend'), true);
  assert.deepStrictEqual(calls.started, ['backend']);
  assert.match(servers.log('backend'), /\[backend\] ready/);
  assert.strictEqual(servers.log('widget'), '', 'an app DOCK never started has no log');

  await assert.rejects(servers.stop('landing'), /did not stop/);
  assert.strictEqual(await servers.restart('backend'), true);
  assert.deepStrictEqual(calls.stopped, ['landing', 'backend']);

  assert.strictEqual(await servers.stopWorktree(3263), true);
  assert.deepStrictEqual(calls.killed.sort(), [12, 13, 14], 'npm and everything under it; the shell and the agent stay');
  await assert.rejects(servers.stopWorktree(5173), /No worktree server/, 'a main app is stopped with qonflo-dev, not by port');
  await assert.rejects(servers.stopWorktree(9999), /No worktree server/);

  assert.deepStrictEqual((await servers.list()).actions.map((item) => [item.target, item.action, item.ok]), [
    ['wt-qrd-1363:3263', 'stop', true], ['backend', 'start', true], ['backend', 'stop', true], ['landing', 'stop', false], ['backend', 'start', true],
  ]);
});
