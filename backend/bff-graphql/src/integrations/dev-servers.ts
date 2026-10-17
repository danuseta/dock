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
const ACTIONS_KEPT = 50;
// A shell, an agent or qonflo-dev that started a server is never stopped with it.
const STARTERS = new Set(['bash', 'zsh', 'fish', 'sh', 'claude', 'qonflo-dev']);

export class DevServerError extends Error {}

export interface Listener { port: number; pid: number }
export interface DevServer { name: string; folder: string; port: number; running: boolean; pid: number | null; ticketKey: string | null; hasLog: boolean }
export interface DevServerAction { at: string; target: string; action: string; ok: boolean; output: string }

/** What the service needs from the machine. The real one reads ss and /proc; a test passes its own. */
export interface DevSystem {
  listeners(): Promise<Listener[]>;
  cwd(pid: number): string | null;
  parent(pid: number): number;
  command(pid: number): string;
  children(pid: number): number[];
  kill(pids: number[]): void;
  /** Starts `qonflo-dev <app>` on its own, its output into the log file. */
  start(app: string, logFile: string): void;
  /** Runs `qonflo-dev stop <app>` and returns its output. */
  stop(app: string): Promise<{ ok: boolean; output: string }>;
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
    start: (app, logFile) => {
      const out = fs.openSync(logFile, 'w');
      spawn(qonfloDev, [app], { detached: true, stdio: ['ignore', out, out] }).unref();
      fs.closeSync(out);
    },
    stop: async (app) => {
      try {
        const { stdout, stderr } = await run(qonfloDev, ['stop', app], { timeout: 30_000 });
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

  constructor(
    private readonly system: DevSystem,
    private readonly projectsDir: string,
    private readonly logDir: string,
    private readonly clock: () => Date = () => new Date(),
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

  async list() {
    const listeners = await this.system.listeners();
    const byPort = new Map(listeners.map((item) => [item.port, item.pid]));
    const main: DevServer[] = MAIN_APPS.map((app) => ({
      name: app.name, folder: app.folder, port: app.port, running: byPort.has(app.port), pid: byPort.get(app.port) ?? null, ticketKey: null, hasLog: fs.existsSync(this.logFile(app.name)),
    }));
    const mainFolders = new Set<string>(MAIN_APPS.map((app) => app.folder));
    const ledgers = this.system.ledgers();
    const secondary: DevServer[] = listeners
      .map((item) => ({ ...item, folder: this.folderOf(item.pid) }))
      .filter((item): item is Listener & { folder: string } => Boolean(item.folder) && !mainFolders.has(item.folder!))
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.port - b.port)
      .map((item) => {
        const dir = path.posix.join(this.projectsDir, item.folder);
        const ticketKey = ledgers.find((ledger) => ledger.dirs.some((owned) => owned === dir || owned.startsWith(`${dir}/`)))?.key ?? null;
        return { name: item.folder, folder: item.folder, port: item.port, running: true, pid: item.pid, ticketKey, hasLog: false };
      });
    return { main, secondary, actions: [...this.actions] };
  }

  async start(name: string) {
    const app = this.mainApp(name);
    if ((await this.system.listeners()).some((item) => item.port === app.port)) throw new DevServerError(`${name} is already running on port ${app.port}`);
    fs.mkdirSync(this.logDir, { recursive: true });
    this.system.start(name, this.logFile(name));
    this.record(name, 'start', true, `qonflo-dev ${name}`);
    return true;
  }

  async stop(name: string) {
    this.mainApp(name);
    const result = await this.system.stop(name);
    this.record(name, 'stop', result.ok, result.output);
    if (!result.ok) throw new DevServerError(result.output || `qonflo-dev stop ${name} failed`);
    return true;
  }

  async restart(name: string) {
    await this.stop(name);
    return this.start(name);
  }

  /** Stops a secondary server: the command that started it in its worktree and everything under it, never the shell or agent above. */
  async stopWorktree(port: number) {
    const listener = (await this.system.listeners()).find((item) => item.port === port);
    const folder = listener ? this.folderOf(listener.pid) : null;
    if (!listener || !folder || MAIN_APPS.some((app) => app.folder === folder)) throw new DevServerError(`No worktree server listens on port ${port}`);
    let root = listener.pid;
    for (let parent = this.system.parent(root); parent > 1 && !STARTERS.has(this.system.command(parent)) && this.folderOf(parent) === folder; parent = this.system.parent(parent)) root = parent;
    const tree = (pid: number): number[] => [pid, ...this.system.children(pid).flatMap(tree)];
    this.system.kill(tree(root));
    this.record(`${folder}:${port}`, 'stop', true, `stopped ${tree(root).length} process(es)`);
    return true;
  }

  log(name: string, bytes = LOG_BYTES) {
    this.mainApp(name);
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
