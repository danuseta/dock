import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/** The five apps `qonflo-dev` runs from the main clones, as the Coder template defines them. */
export const MAIN_APPS = [
  { name: 'backend', folder: 'ms-admin-worker-backend', port: 3000 },
  { name: 'frontend', folder: 'ms-client-dashboard-frontend', port: 5173 },
  { name: 'widget', folder: 'qonflo-chat-widget', port: 5174 },
  { name: 'landing', folder: 'ms-landing-page', port: 5000 },
  { name: 'wastaging', folder: 'wastaging', port: 3100 },
] as const;

const LOG_BYTES = 64 * 1024;
// The log of a secondary server, written by the kit's dev-server.cjs: <worktree folder>-<port>.
const SECONDARY_LOG = /^[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,5}$/;
const ACTIONS_KEPT = 50;
const STARTING_MS = 120_000;
const STOP_WAIT_MS = 5000;
const ERROR_TAIL_BYTES = 2048;
// A shell, an agent or qonflo-dev that started a server is never stopped with it.
const STARTERS = new Set(['bash', 'zsh', 'fish', 'sh', 'claude', 'qonflo-dev']);

export class DevServerError extends Error {}

export interface Listener { port: number; pid: number }
export interface DevServer { name: string; folder: string; port: number; running: boolean; pid: number | null; state: 'running' | 'starting' | 'stopped' | 'failed'; error: string | null; ticketKey: string | null; hasLog: boolean }
export interface DevServerAction { at: string; target: string; action: string; ok: boolean; output: string }

/** What the service needs from the machine. The real one reads ss and /proc; a test passes its own. */
export interface DevSystem {
  listeners(): Promise<Listener[]>;
  cwd(pid: number): string | null;
  parent(pid: number): number;
  command(pid: number): string;
  children(pid: number): number[];
  kill(pids: number[]): void;
  /** Ends the process group a start made, when pid is a real group leader. */
  killGroup(pid: number): void;
  /** Starts `qonflo-dev <app>` on its own, its output into the log file. Resolves with its pid once it spawned, rejects when it cannot; `onFail` hears of a later error or a failed exit. */
  start(app: string, logFile: string, onFail: (message: string) => void): Promise<number | null>;
  /** Runs `qonflo-dev stop <app>`, or `qonflo-dev stop` for all, and returns its output. */
  stop(app?: string): Promise<{ ok: boolean; output: string }>;
  ledgers(): Array<{ key: string; dirs: string[] }>;
}

const run = promisify(execFile);

/** `ss -ltnpH` lines: the port of the local address and the first pid of its users. */
export function parseListeners(text: string): Listener[] {
  const seen = new Map<number, number>();
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const local = fields[3];
    const pid = /pid=(\d+)/.exec(line)?.[1];
    const port = local ? Number(local.slice(local.lastIndexOf(':') + 1)) : NaN;
    if (pid && Number.isInteger(port) && !seen.has(port)) seen.set(port, Number(pid));
  }
  return [...seen].map(([port, pid]) => ({ port, pid }));
}

export function linuxSystem(projectsDir: string, qonfloDev: string): DevSystem {
  const proc = (pid: number, file: string) => { try { return fs.readFileSync(`/proc/${pid}/${file}`, 'utf8'); } catch { return ''; } };
  return {
    listeners: async () => parseListeners((await run('ss', ['-ltnpH'])).stdout),
    cwd: (pid) => { try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } },
    // The fourth field of /proc/<pid>/stat, after the command in parentheses.
    parent: (pid) => Number(proc(pid, 'stat').slice(proc(pid, 'stat').lastIndexOf(')') + 2).split(' ')[1]) || 0,
    command: (pid) => proc(pid, 'comm').trim(),
    children: (pid) => proc(pid, `task/${pid}/children`).trim().split(/\s+/).filter(Boolean).map(Number),
    kill: (pids) => { for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } } },
    killGroup: (pid) => { if (pid > 1) { try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ } } },
    start: (app, logFile, onFail) => new Promise((resolve, reject) => {
      const out = fs.openSync(logFile, 'w');
      let child: ReturnType<typeof spawn>;
      try { child = spawn(qonfloDev, [app], { detached: true, stdio: ['ignore', out, out] }); } finally { fs.closeSync(out); }
      let spawned = false;
      child.on('error', (error) => { if (spawned) onFail(error.message); else reject(error); });
      child.on('spawn', () => { spawned = true; resolve(child.pid ?? null); });
      child.on('exit', (code, signal) => { if (code !== 0) onFail(`qonflo-dev exited with ${code ?? signal}`); });
      child.unref();
    }),
    stop: async (app) => {
      try {
        const { stdout, stderr } = await run(qonfloDev, app ? ['stop', app] : ['stop'], { timeout: 30_000 });
        return { ok: true, output: `${stdout}${stderr}`.trim() };
      } catch (error: any) {
        return { ok: false, output: `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim() || String(error?.message ?? 'stop failed') };
      }
    },
    ledgers: () => {
      const evidence = path.join(projectsDir, '.evidence');
      let keys: string[] = [];
      try { keys = fs.readdirSync(evidence); } catch { return []; }
      return keys.flatMap((key) => {
        try {
          const ledger = JSON.parse(fs.readFileSync(path.join(evidence, key, 'status.json'), 'utf8'));
          return [{ key: String(ledger.key ?? key), dirs: Object.values(ledger.dirs ?? {}).filter((dir): dir is string => typeof dir === 'string' && dir.startsWith('/')) }];
        } catch { return []; }
      });
    },
  };
}

/**
 * The dev servers of the workspace: the five main apps run by qonflo-dev, and the secondary ones an agent
 * started in a ticket worktree. DOCK starts and stops the main apps with qonflo-dev, keeps their output as a
 * log, and stops a secondary server only when it runs from a worktree folder.
 */
export class DevServers {
  private readonly actions: DevServerAction[] = [];
  private readonly started = new Map<string, { pid: number | null; at: number; error: string | null }>();

  constructor(
    private readonly system: DevSystem,
    private readonly projectsDir: string,
    private readonly logDir: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly stopWaitMs = STOP_WAIT_MS,
  ) {}

  private logFile(app: string) { return path.join(this.logDir, `${app}.log`); }

  private record(target: string, action: string, ok: boolean, output: string) {
    this.actions.unshift({ at: this.clock().toISOString(), target, action, ok, output: output.slice(0, 2000) });
    this.actions.length = Math.min(this.actions.length, ACTIONS_KEPT);
  }

  private mainApp(name: string) {
    const app = MAIN_APPS.find((item) => item.name === name);
    if (!app) throw new DevServerError(`Unknown app ${name}. Use ${MAIN_APPS.map((item) => item.name).join(', ')}.`);
    return app;
  }

  // The top folder under the projects folder a process runs in, or null outside it.
  private folderOf(pid: number) {
    const cwd = this.system.cwd(pid);
    const relative = cwd ? path.posix.relative(this.projectsDir, cwd) : '..';
    return relative && !relative.startsWith('..') && !relative.startsWith('.') ? relative.split('/')[0] : null;
  }

  // A start DOCK made that has not bound its port yet and has not failed or timed out.
  private starting(name: string) {
    const entry = this.started.get(name);
    return entry && !entry.error && this.clock().getTime() - entry.at < STARTING_MS ? entry : null;
  }

  private mainState(name: string, port: number, running: boolean) {
    const entry = this.started.get(name);
    if (running) this.started.delete(name);
    if (running || !entry) return { state: running ? 'running' as const : 'stopped' as const, error: null, pid: null };
    if (this.starting(name)) return { state: 'starting' as const, error: null, pid: entry.pid };
    const reason = entry.error ?? `Nothing listens on port ${port} after ${STARTING_MS / 1000}s.`;
    return { state: 'failed' as const, error: [reason, this.log(name, ERROR_TAIL_BYTES).trim()].filter(Boolean).join('\n'), pid: null };
  }

  async list() {
    const listeners = await this.system.listeners();
    const byPort = new Map(listeners.map((item) => [item.port, item.pid]));
    const main: DevServer[] = MAIN_APPS.map((app) => {
      const { state, error, pid } = this.mainState(app.name, app.port, byPort.has(app.port));
      return { name: app.name, folder: app.folder, port: app.port, running: state === 'running', pid: byPort.get(app.port) ?? pid, state, error, ticketKey: null, hasLog: fs.existsSync(this.logFile(app.name)) };
    });
    const mainFolders = new Set<string>(MAIN_APPS.map((app) => app.folder));
    const ledgers = this.system.ledgers();
    const secondary: DevServer[] = listeners
      .map((item) => ({ ...item, folder: this.folderOf(item.pid) }))
      .filter((item): item is Listener & { folder: string } => Boolean(item.folder) && !mainFolders.has(item.folder!))
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.port - b.port)
      .map((item) => {
        const dir = path.posix.join(this.projectsDir, item.folder);
        const ticketKey = ledgers.find((ledger) => ledger.dirs.some((owned) => owned === dir || owned.startsWith(`${dir}/`)))?.key ?? null;
        const name = `${item.folder}-${item.port}`;
        return { name, folder: item.folder, port: item.port, running: true, pid: item.pid, state: 'running', error: null, ticketKey, hasLog: fs.existsSync(this.logFile(name)) };
      });
    return { main, secondary, actions: [...this.actions] };
  }

  async start(name: string) {
    const app = this.mainApp(name);
    if ((await this.system.listeners()).some((item) => item.port === app.port)) throw new DevServerError(`${name} is already running on port ${app.port}`);
    if (this.starting(name)) throw new DevServerError(`${name} is already starting`);
    this.release(name);
    fs.mkdirSync(this.logDir, { recursive: true });
    const entry = { pid: null as number | null, at: this.clock().getTime(), error: null as string | null };
    this.started.set(name, entry);
    try {
      entry.pid = await this.system.start(name, this.logFile(name), (message) => {
        if (this.started.get(name) !== entry) return;
        entry.error = message;
        this.record(name, 'start', false, message);
      });
    } catch (error: any) {
      entry.error = String(error?.message ?? 'start failed');
      this.record(name, 'start', false, entry.error);
      throw new DevServerError(`qonflo-dev ${name} did not start: ${entry.error}`);
    }
    this.record(name, 'start', true, `qonflo-dev ${name}`);
    return true;
  }

  async startAll() {
    const listeners = await this.system.listeners();
    const errors: string[] = [];
    for (const app of MAIN_APPS) {
      if (listeners.some((item) => item.port === app.port) || this.starting(app.name)) continue;
      try { await this.start(app.name); } catch (error) {
        if (!(error instanceof DevServerError)) throw error;
        errors.push(error.message);
      }
    }
    if (errors.length) throw new DevServerError(errors.join('\n'));
    return true;
  }

  private async snapshot(ports: number[], waitMs: number) {
    const read = async () => new Map((await this.system.listeners()).map((item) => [item.port, item.pid]));
    let bound = await read();
    for (const end = Date.now() + waitMs; ports.some((port) => bound.has(port)) && Date.now() < end;) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      bound = await read();
    }
    return bound;
  }

  // Forgets what DOCK started, and ends the process group of a start that is still running.
  private release(name: string) {
    const entry = this.started.get(name);
    this.started.delete(name);
    if (entry && !entry.error && entry.pid) this.system.killGroup(entry.pid);
  }

  // Waits for stopped apps to release their ports, kills the process tree that owns a port still bound when it runs from the app's folder, and reports what is left.
  private async freePorts(apps: ReadonlyArray<(typeof MAIN_APPS)[number]>, stopped: boolean) {
    let bound = await this.snapshot(apps.map((app) => app.port), stopped ? this.stopWaitMs : 0);
    const killed = new Map<string, number>();
    const foreign = new Map<string, string>();
    for (const app of apps) {
      const pid = bound.get(app.port);
      if (pid === undefined) continue;
      if (this.folderOf(pid) !== app.folder) foreign.set(app.name, `port ${app.port} held by pid ${pid} outside ${app.folder}`);
      else killed.set(app.name, this.killTree(pid, app.folder));
    }
    if (killed.size) bound = await this.snapshot(apps.filter((app) => killed.has(app.name)).map((app) => app.port), this.stopWaitMs);
    return apps.map((app) => ({
      app,
      killed: killed.get(app.name) ?? 0,
      stuck: foreign.get(app.name) ?? (killed.has(app.name) && bound.has(app.port) ? `still listens on port ${app.port}` : null),
    }));
  }

  async stop(name: string) {
    const app = this.mainApp(name);
    this.release(name);
    const result = await this.system.stop(name);
    const [freed] = await this.freePorts([app], result.ok);
    const output = [result.output, freed.killed ? `killed ${freed.killed} process(es) on port ${app.port}` : '', freed.stuck ?? ''].filter(Boolean).join('\n');
    this.record(name, 'stop', !freed.stuck, output);
    if (freed.stuck) throw new DevServerError(output);
    return true;
  }

  async stopAll() {
    for (const app of MAIN_APPS) this.release(app.name);
    const result = await this.system.stop();
    const freed = await this.freePorts(MAIN_APPS, result.ok);
    const stuck = freed.filter((item) => item.stuck);
    const killed = freed.reduce((sum, item) => sum + item.killed, 0);
    const output = [result.output, killed ? `killed ${killed} process(es)` : '', ...stuck.map((item) => `${item.app.name}: ${item.stuck}`)].filter(Boolean).join('\n');
    this.record('all', 'stop', stuck.length === 0, output);
    if (stuck.length) throw new DevServerError(output);
    return true;
  }

  async restart(name: string) {
    await this.stop(name);
    return this.start(name);
  }

  // The command that owns a server in its folder and everything under it, never the shell or agent above, nor init or DOCK itself.
  private killTree(pid: number, folder: string) {
    const spared = new Set([0, 1, process.pid, process.ppid]);
    if (spared.has(pid)) return 0;
    let root = pid;
    for (let parent = this.system.parent(root); parent > 1 && !STARTERS.has(this.system.command(parent)) && this.folderOf(parent) === folder; parent = this.system.parent(parent)) root = parent;
    const tree = (current: number): number[] => [current, ...this.system.children(current).flatMap(tree)];
    const pids = tree(root).filter((current) => !spared.has(current));
    this.system.kill(pids);
    return pids.length;
  }

  /** Stops a secondary server: the command that started it in its worktree and everything under it, never the shell or agent above. */
  async stopWorktree(port: number) {
    const listener = (await this.system.listeners()).find((item) => item.port === port);
    const folder = listener ? this.folderOf(listener.pid) : null;
    if (!listener || !folder || MAIN_APPS.some((app) => app.folder === folder)) throw new DevServerError(`No worktree server listens on port ${port}`);
    const killed = this.killTree(listener.pid, folder);
    this.record(`${folder}:${port}`, 'stop', true, `stopped ${killed} process(es)`);
    return true;
  }

  /** The end of a log: a main app's, or a secondary server's that dev-server.cjs started. */
  log(name: string, bytes = LOG_BYTES) {
    if (!MAIN_APPS.some((app) => app.name === name) && !SECONDARY_LOG.test(name)) throw new DevServerError(`No log named ${name}`);
    const file = this.logFile(name);
    if (!fs.existsSync(file)) return '';
    const size = fs.statSync(file).size;
    const length = Math.min(size, Math.max(1024, Math.min(bytes, LOG_BYTES * 4)));
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
    return buffer.toString('utf8');
  }
}

const projectsDir = process.env.QONFLO_PROJECTS_DIR || path.join(os.homedir(), 'projects');
export const devServers = new DevServers(
  linuxSystem(projectsDir, process.env.QONFLO_DEV_BIN || path.join(os.homedir(), '.config/qonflo/bin/qonflo-dev')),
  projectsDir,
  path.join(os.homedir(), '.local/state/dock/dev-logs'),
);
