import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ResourcesInputError, SAMPLES_KEPT, WorkspaceResources, cpuLimit, keyValues, loadOne, memoryMax, nodeFiles, parseStat, processKind, vmRss, worktreeOf,
  type ResourcesDeps,
} from '../integrations/workspace-resources';

const GB = 1024 ** 3;
const SELF = 900;

interface FixtureProc { pid: number; ppid: number; comm: string; cmd: string[]; cwd: string; rssKb: number }

/** A cgroup and proc tree on disk; a cwd is a plain file holding the path, as nodeFiles reads it. */
function fixture(build: (projects: string) => FixtureProc[] = () => [], events = 'low 0\nhigh 0\nmax 12\noom 9\noom_kill 9\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-resources-'));
  const cgroup = path.join(root, 'cgroup');
  const proc = path.join(root, 'proc');
  const home = path.join(root, 'home');
  const projects = `${home.replace(/\\/g, '/')}/projects`;
  for (const dir of [cgroup, proc, projects, `${projects}/wt-1641-agent-node`, `${projects}/wt-1596-panel`, `${projects}/ms-admin-worker-backend`]) fs.mkdirSync(dir, { recursive: true });
  const write = (file: string, text: string) => fs.writeFileSync(file, text);
  write(path.join(cgroup, 'memory.current'), String(Math.round(10.3 * GB)));
  write(path.join(cgroup, 'memory.max'), String(12 * GB));
  write(path.join(cgroup, 'memory.stat'), `anon ${8 * GB}\nfile ${2 * GB}\n`);
  write(path.join(cgroup, 'memory.events'), events);
  write(path.join(cgroup, 'cpu.max'), '600000 100000\n');
  write(path.join(cgroup, 'cpu.stat'), 'usage_usec 1000000\nuser_usec 800000\n');
  write(path.join(proc, 'loadavg'), '6.30 5.10 4.00 3/900 12345\n');
  for (const item of build(projects)) {
    const dir = path.join(proc, String(item.pid));
    fs.mkdirSync(dir);
    write(path.join(dir, 'stat'), `${item.pid} (${item.comm}) S ${item.ppid} ${item.pid} ${item.pid} 0 -1 4194560`);
    write(path.join(dir, 'status'), `Name:\t${item.comm}\nVmRSS:\t   ${item.rssKb} kB\n`);
    write(path.join(dir, 'cmdline'), `${item.cmd.join('\0')}\0`);
    write(path.join(dir, 'cwd'), item.cwd);
  }
  return { root, cgroup, proc, home, projects };
}

function tree(projects: string): FixtureProc[] {
  const kb = (gb: number) => Math.round(gb * 1024 * 1024);
  return [
    { pid: 1, ppid: 0, comm: 'init', cmd: ['/sbin/init'], cwd: '/', rssKb: 0 },
    { pid: SELF, ppid: 1, comm: 'node', cmd: ['node', 'dist/index.js'], cwd: '/opt/dock', rssKb: kb(0.6) },
    { pid: 901, ppid: 1, comm: 'node', cmd: ['/usr/lib/code-server/lib/node', '/usr/lib/code-server/out/node/entry'], cwd: '/home/coder', rssKb: kb(0.4) },
    { pid: 910, ppid: 1, comm: 'node', cmd: ['node', 'node_modules/.bin/tsx', 'watch', 'src/main.ts'], cwd: `${projects}/ms-admin-worker-backend`, rssKb: kb(0.5) },
    { pid: 100, ppid: 1, comm: 'claude', cmd: ['claude', '--output-format', 'stream-json'], cwd: projects, rssKb: kb(0.4) },
    { pid: 101, ppid: 100, comm: 'node', cmd: ['node', '/home/coder/.npm/_npx/x/atlassian-mcp/dist/index.js'], cwd: projects, rssKb: kb(0.3) },
    { pid: 102, ppid: 100, comm: 'npx', cmd: ['npx', '-y', '@playwright/mcp'], cwd: projects, rssKb: kb(0.3) },
    { pid: 103, ppid: 100, comm: 'bash', cmd: ['bash', '-c', 'npm run dev'], cwd: `${projects}/wt-1641-agent-node`, rssKb: kb(0.01) },
    { pid: 104, ppid: 103, comm: 'node', cmd: ['node', 'node_modules/.bin/vite', '--port', '5641'], cwd: `${projects}/wt-1641-agent-node/frontend`, rssKb: kb(0.5) },
    { pid: 105, ppid: 100, comm: 'node', cmd: ['node', 'node_modules/.bin/vitest', 'run'], cwd: `${projects}/wt-1641-agent-node`, rssKb: kb(0.3) },
    { pid: 200, ppid: 1, comm: 'node', cmd: ['node', 'node_modules/.bin/vite', '--port', '5396'], cwd: `${projects}/wt-1596-panel`, rssKb: kb(0.5) },
    { pid: 201, ppid: 1, comm: 'node', cmd: ['node', 'node_modules/.bin/tsx', 'watch', 'src/main.ts'], cwd: `${projects}/wt-1596-panel/backend`, rssKb: kb(0.4) },
    { pid: 300, ppid: 1, comm: 'ffmpeg', cmd: ['ffmpeg', '-i', 'demo.webm'], cwd: `${projects}/wt-1641-agent-node`, rssKb: kb(1.2) },
  ];
}

function reader(dirs: ReturnType<typeof fixture>, over: Partial<ResourcesDeps> = {}) {
  let now = new Date('2026-11-23T11:00:00Z');
  const cache = new Map<string, unknown>();
  const killed: number[] = [];
  const told: number[] = [];
  const resources = new WorkspaceResources({
    files: nodeFiles,
    cgroupRoot: dirs.cgroup,
    procRoot: dirs.proc,
    home: dirs.home,
    projectsDir: dirs.projects,
    selfPid: SELF,
    now: () => now,
    statuses: async () => new Map([['QRD-1641', 'In Progress'], ['QRD-1596', 'To Do']]),
    inProgressStatus: async () => 'In Progress',
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    onOom: async (today) => { told.push(today); },
    kill: (pid) => { killed.push(pid); },
    ...over,
  });
  return { resources, killed, told, cache, tick: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

test('parsers: key values, cpu.max, memory.max, loadavg, stat with spaces in the command, VmRSS', () => {
  assert.equal(keyValues('oom 2\noom_kill 3\n').get('oom_kill'), 3);
  assert.equal(cpuLimit('600000 100000'), 6);
  assert.equal(cpuLimit('max 100000'), null);
  assert.equal(memoryMax('max\n'), null);
  assert.equal(memoryMax('12884901888\n'), 12884901888);
  assert.equal(loadOne('6.30 5.10 4.00 3/900 1'), 6.3);
  assert.deepEqual(parseStat('42 (tmux: server) S 7 42 42'), { comm: 'tmux: server', ppid: 7 });
  assert.equal(vmRss('VmRSS:\t  2048 kB\n'), 2 * 1024 * 1024);
  assert.equal(vmRss('Name: kthreadd\n'), 0);
  assert.equal(worktreeOf('/home/coder/projects/wt-12-x/frontend', '/home/coder/projects'), 'wt-12-x');
  assert.equal(worktreeOf('/home/coder/projects/ms-admin-worker-backend', '/home/coder/projects'), null);
  assert.equal(worktreeOf('/tmp/wt-12-x', '/home/coder/projects'), null);
  const proc = { pid: 5, ppid: 4, comm: 'node', cmd: 'node server.js', cwd: null, rss: 1 };
  assert.equal(processKind(proc, { pid: 4, ppid: 1, comm: 'claude', cmd: 'claude', cwd: null, rss: 1 }, 1), 'mcp');
  assert.equal(processKind({ ...proc, comm: 'bash', cmd: 'bash -c ls' }, { pid: 4, ppid: 1, comm: 'claude', cmd: 'claude', cwd: null, rss: 1 }, 1), 'other');
});

test('a fixture tree: memory vs limit, CPU limit and load, OOM total, worktrees, disk', async () => {
  const dirs = fixture();
  const { resources } = reader(dirs);
  const view = await resources.sample();
  assert.equal(view.memory.current, Math.round(10.3 * GB));
  assert.equal(view.memory.max, 12 * GB);
  assert.equal(view.memory.anon, 8 * GB);
  assert.deepEqual(view.cpu, { percent: null, limit: 6, load1: 6.3 });
  assert.deepEqual(view.oom, { total: 9, today: 0 });
  assert.equal(view.worktrees, 2);
  assert.ok(view.disk && view.disk.total > 0);
  assert.equal(view.memory.samples.length, 1);
});

test('CPU percent is the usage delta between two reads against the CPU limit', async () => {
  const dirs = fixture();
  const { resources, tick } = reader(dirs);
  await resources.sample();
  tick(5000);
  fs.writeFileSync(path.join(dirs.cgroup, 'cpu.stat'), `usage_usec ${1000000 + 15_000_000}\n`);
  assert.equal((await resources.sample()).cpu.percent, 50);
});

test('the ring buffer keeps the last 180 memory samples', async () => {
  const { resources, tick } = reader(fixture());
  for (let i = 0; i < SAMPLES_KEPT + 5; i += 1) { tick(5000); await resources.sample(); }
  const view = await resources.sample();
  assert.equal(view.memory.samples.length, SAMPLES_KEPT);
});

test('grouping: worktree processes, the Claude session and its MCP servers per ticket; main servers, DOCK and code-server in Base', async () => {
  const { resources } = reader(fixture(tree));
  const view = await resources.sample();
  const byKey = new Map(view.tickets.map((group) => [group.key, group]));
  assert.deepEqual([...byKey.keys()].sort(), ['QRD-1596', 'QRD-1641']);
  const t1641 = byKey.get('QRD-1641')!;
  assert.deepEqual(Object.fromEntries(t1641.kinds.map((kind) => [kind.kind, kind.count])), { ffmpeg: 1, dev: 1, claude: 1, mcp: 2, tests: 1, other: 1 });
  assert.deepEqual(t1641.worktrees, ['wt-1641-agent-node']);
  assert.deepEqual(Object.fromEntries(view.base.kinds.map((kind) => [kind.kind, kind.count])), { dock: 1, dev: 1, codeServer: 1 });
  assert.equal(view.base.key, null);
});

test('leftovers: dev servers of a ticket that is not In Progress; the In Progress ticket has none', async () => {
  const { resources } = reader(fixture(tree));
  const view = await resources.sample();
  assert.deepEqual(view.leftovers.map((item) => [item.ticketKey, item.status, item.count, item.worktrees, item.pids.sort()]), [['QRD-1596', 'To Do', 2, ['wt-1596-panel'], [200, 201]]]);
});

test('stop: SIGTERM only to the leftover dev servers of that ticket; refused while In Progress', async () => {
  const { resources, killed } = reader(fixture(tree));
  await assert.rejects(resources.stopWorktreeServers('QRD-1641'), ResourcesInputError);
  await assert.rejects(resources.stopWorktreeServers('nope'), /ticket key/);
  assert.equal(await resources.stopWorktreeServers('qrd-1596'), 2);
  assert.deepEqual(killed.sort(), [200, 201]);
  assert.equal(await resources.stopWorktreeServers('QRD-7'), 0);
});

test('OOM kills today: counted from the first read of the WIB day, told once per increase', async () => {
  const dirs = fixture();
  const { resources, told, tick } = reader(dirs);
  assert.deepEqual((await resources.sample()).oom, { total: 9, today: 0 });
  fs.writeFileSync(path.join(dirs.cgroup, 'memory.events'), 'oom_kill 11\n');
  assert.deepEqual((await resources.sample()).oom, { total: 11, today: 2 });
  assert.deepEqual((await resources.sample()).oom, { total: 11, today: 2 });
  assert.deepEqual(told, [2]);
  tick(24 * 3600 * 1000);
  assert.deepEqual((await resources.sample()).oom, { total: 11, today: 0 });
  assert.deepEqual(told, [2]);
});

test('view keeps one shared sampler running while asked, and stop ends it', async () => {
  const { resources } = reader(fixture());
  const [a, b] = await Promise.all([resources.view(), resources.view()]);
  assert.equal(a, b);
  assert.equal(resources.running, true);
  resources.stop();
  assert.equal(resources.running, false);
});
