// The workspace DOCK's live resources, read from files only: the cgroup's memory, CPU and OOM kills, the load, the home
// disk, and every process grouped by the ticket it works for. One shared sampler keeps 15 minutes of memory samples and
// runs only while a client asked in the last 15 seconds.
import fs from 'node:fs';
import path from 'node:path';

export type ProcessKind = 'claude' | 'mcp' | 'dev' | 'tests' | 'ffmpeg' | 'dock' | 'codeServer' | 'other';

export interface ProcInfo { pid: number; ppid: number; comm: string; cmd: string; cwd: string | null; rss: number }
export interface KindUse { kind: ProcessKind; bytes: number; count: number }
export interface ResourceGroup { key: string | null; bytes: number; count: number; kinds: KindUse[]; worktrees: string[] }
export interface Leftover { ticketKey: string; status: string | null; bytes: number; count: number; worktrees: string[]; pids: number[] }
export interface MemorySample { at: string; bytes: number }
export interface ResourcesView {
  at: string;
  memory: { current: number; max: number | null; anon: number | null; samples: MemorySample[] };
  cpu: { percent: number | null; limit: number | null; load1: number | null };
  disk: { total: number; used: number } | null;
  oom: { total: number; today: number };
  worktrees: number;
  tickets: ResourceGroup[];
  base: ResourceGroup;
  leftovers: Leftover[];
}

export class ResourcesInputError extends Error {}

/** What the reader needs from the machine; tests pass a fixture tree. A `cwd` that is a plain file holds the path as text. */
export interface ResourceFiles {
  read(file: string): string | null;
  link(file: string): string | null;
  list(dir: string): string[];
  disk(dir: string): { total: number; used: number } | null;
}

export const nodeFiles: ResourceFiles = {
  read: (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } },
  link: (file) => {
    try { return fs.readlinkSync(file); } catch {
      try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
    }
  },
  list: (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  disk: (dir) => {
    try {
      const stat = fs.statfsSync(dir);
      return { total: stat.blocks * stat.bsize, used: (stat.blocks - stat.bfree) * stat.bsize };
    } catch { return null; }
  },
};

export const SAMPLE_MS = 5000;
export const SAMPLES_KEPT = 180;
export const ASKED_MS = 15_000;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const WORKTREE = /^wt-(\d+)-/;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash']);
const MCP_RUNTIMES = /^(node|python\d*(\.\d+)?|uv|uvx|npx|npm|bun|deno|docker)$/;

/** "key value" lines (memory.events, memory.stat, cpu.stat) as numbers. */
export function keyValues(text: string | null): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of (text ?? '').split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key && value !== undefined && /^\d+$/.test(value)) values.set(key, Number(value));
  }
  return values;
}

/** cpu.max "quota period" as a number of CPUs; "max" or an unreadable file is no limit. */
export function cpuLimit(text: string | null): number | null {
  const [quota, period] = (text ?? '').trim().split(/\s+/);
  const q = Number(quota);
  const p = Number(period);
  return quota && quota !== 'max' && q > 0 && p > 0 ? Math.round((q / p) * 100) / 100 : null;
}

/** memory.max in bytes, or null for "max". */
export function memoryMax(text: string | null): number | null {
  const value = (text ?? '').trim();
  return /^\d+$/.test(value) ? Number(value) : null;
}

export function loadOne(text: string | null): number | null {
  const value = Number((text ?? '').trim().split(/\s+/)[0]);
  return (text ?? '').trim() && Number.isFinite(value) ? value : null;
}

/** /proc/<pid>/stat: the command in parentheses (which may hold spaces) and the parent pid after the state. */
export function parseStat(text: string | null): { comm: string; ppid: number } | null {
  if (!text) return null;
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const rest = text.slice(close + 2).split(' ');
  return { comm: text.slice(open + 1, close), ppid: Number(rest[1]) || 0 };
}

/** VmRSS of /proc/<pid>/status in bytes; a kernel thread has none. */
export function vmRss(text: string | null): number {
  const match = /^VmRSS:\s+(\d+)\s*kB/m.exec(text ?? '');
  return match ? Number(match[1]) * 1024 : 0;
}

/** Reads every process of the proc tree. */
export function readProcesses(files: ResourceFiles, procRoot: string): ProcInfo[] {
  return files.list(procRoot).filter((name) => /^\d+$/.test(name)).flatMap((name) => {
    const dir = path.posix.join(procRoot.replace(/\\/g, '/'), name);
    const stat = parseStat(files.read(`${dir}/stat`));
    if (!stat) return [];
    const cmd = (files.read(`${dir}/cmdline`) ?? '').split('\0').filter(Boolean).join(' ');
    return [{ pid: Number(name), ppid: stat.ppid, comm: stat.comm, cmd, cwd: files.link(`${dir}/cwd`), rss: vmRss(files.read(`${dir}/status`)) }];
  });
}

const isClaude = (proc: ProcInfo) => proc.comm === 'claude' || /(^|\/)claude(\s|$)/.test(proc.cmd.split(' ')[0] ?? '') || /@anthropic-ai\/claude-code/.test(proc.cmd);

/** The kind of a process from its command line; `parent` is its parent process, when known. */
export function processKind(proc: ProcInfo, parent: ProcInfo | undefined, selfPid: number): ProcessKind {
  if (proc.pid === selfPid) return 'dock';
  if (proc.comm === 'ffmpeg' || /(^|[\s/])ffmpeg(\s|$)/.test(proc.cmd)) return 'ffmpeg';
  if (isClaude(proc)) return 'claude';
  if (/\bmcp\b|mcp-server|-mcp\b|mcp[-_]/i.test(proc.cmd)) return 'mcp';
  if (/\b(vitest|jest|playwright)\b/.test(proc.cmd)) return 'tests';
  if (/code-server/.test(proc.cmd)) return 'codeServer';
  if (parent && isClaude(parent) && !SHELLS.has(proc.comm) && MCP_RUNTIMES.test(proc.comm) && !/\b(vite|tsx)\b/.test(proc.cmd)) return 'mcp';
  if (/\b(vite|tsx|next dev|nodemon|ts-node-dev|webpack-dev-server)\b/.test(proc.cmd)) return 'dev';
  return 'other';
}

/** The worktree folder (`wt-<n>-…` straight under the projects folder) a cwd lies in, or null. */
export function worktreeOf(cwd: string | null, projectsDir: string): string | null {
  if (!cwd) return null;
  const relative = path.posix.relative(projectsDir.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'));
  if (!relative || relative.startsWith('..')) return null;
  const folder = relative.split('/')[0];
  return WORKTREE.test(folder) ? folder : null;
}

export interface GroupOptions { selfPid: number; projectsDir: string; keyOf: (number: string) => string }
export interface Grouped { tickets: ResourceGroup[]; base: ResourceGroup; kinds: Map<number, ProcessKind>; ticketOf: Map<number, string | null>; worktreeOf: Map<number, string | null> }

const sortKinds = (kinds: Map<ProcessKind, KindUse>) => [...kinds.values()].sort((a, b) => b.bytes - a.bytes);

/**
 * Processes per ticket: a process in a `wt-<n>-*` worktree belongs to that ticket; a Claude process outside one takes the
 * ticket its descendants work in; every other process takes the ticket of its nearest Claude ancestor (its MCP servers,
 * its shells). What is left is Base: the main clones' dev servers, DOCK, code-server.
 */
export function groupProcesses(processes: ProcInfo[], options: GroupOptions): Grouped {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const children = new Map<number, number[]>();
  for (const proc of processes) children.set(proc.ppid, [...(children.get(proc.ppid) ?? []), proc.pid]);
  const kinds = new Map(processes.map((proc) => [proc.pid, processKind(proc, byPid.get(proc.ppid), options.selfPid)]));
  const folders = new Map(processes.map((proc) => [proc.pid, worktreeOf(proc.cwd, options.projectsDir)]));
  const direct = new Map([...folders].map(([pid, folder]) => [pid, folder ? options.keyOf(WORKTREE.exec(folder)![1]) : null]));
  for (const proc of processes) {
    if (kinds.get(proc.pid) !== 'claude' || direct.get(proc.pid)) continue;
    const queue = [...(children.get(proc.pid) ?? [])];
    const seen = new Set<number>();
    while (queue.length) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      const key = direct.get(pid);
      if (key) { direct.set(proc.pid, key); break; }
      queue.push(...(children.get(pid) ?? []));
    }
  }
  const ticketOf = new Map<number, string | null>();
  for (const proc of processes) {
    let key = direct.get(proc.pid) ?? null;
    const seen = new Set<number>([proc.pid]);
    for (let parent = byPid.get(proc.ppid); !key && parent && !seen.has(parent.pid); parent = byPid.get(parent.ppid)) {
      seen.add(parent.pid);
      if (kinds.get(parent.pid) === 'claude') key = direct.get(parent.pid) ?? null;
      if (kinds.get(parent.pid) === 'claude') break;
    }
    ticketOf.set(proc.pid, key);
  }
  const groups = new Map<string | null, { bytes: number; count: number; kinds: Map<ProcessKind, KindUse>; worktrees: Set<string> }>();
  for (const proc of processes) {
    if (proc.rss === 0) continue;
    const key = ticketOf.get(proc.pid) ?? null;
    const group = groups.get(key) ?? { bytes: 0, count: 0, kinds: new Map(), worktrees: new Set() };
    const kind = kinds.get(proc.pid)!;
    const use = group.kinds.get(kind) ?? { kind, bytes: 0, count: 0 };
    use.bytes += proc.rss;
    use.count += 1;
    group.kinds.set(kind, use);
    group.bytes += proc.rss;
    group.count += 1;
    const folder = folders.get(proc.pid);
    if (folder) group.worktrees.add(folder);
    groups.set(key, group);
  }
  const view = (key: string | null): ResourceGroup => {
    const group = groups.get(key);
    return group ? { key, bytes: group.bytes, count: group.count, kinds: sortKinds(group.kinds), worktrees: [...group.worktrees].sort() } : { key, bytes: 0, count: 0, kinds: [], worktrees: [] };
  };
  return {
    tickets: [...groups.keys()].filter((key): key is string => key !== null).map(view).sort((a, b) => b.bytes - a.bytes),
    base: view(null),
    kinds,
    ticketOf,
    worktreeOf: folders,
  };
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Dev servers in a ticket's worktree whose ticket is not In Progress: left running after the work moved on. */
export function leftovers(processes: ProcInfo[], grouped: Grouped, statuses: Map<string, string>, inProgress: string): Leftover[] {
  const found = new Map<string, Leftover>();
  for (const proc of processes) {
    const folder = grouped.worktreeOf.get(proc.pid);
    const key = grouped.ticketOf.get(proc.pid);
    if (grouped.kinds.get(proc.pid) !== 'dev' || !folder || !key) continue;
    const status = statuses.get(key) ?? null;
    if (status && sameText(status, inProgress)) continue;
    const item = found.get(key) ?? { ticketKey: key, status, bytes: 0, count: 0, worktrees: [], pids: [] };
    item.bytes += proc.rss;
    item.count += 1;
    item.pids.push(proc.pid);
    if (!item.worktrees.includes(folder)) item.worktrees.push(folder);
    found.set(key, item);
  }
  return [...found.values()].sort((a, b) => b.bytes - a.bytes);
}

export interface ResourcesDeps {
  files: ResourceFiles;
  cgroupRoot: string;
  procRoot: string;
  home: string;
  projectsDir: string;
  selfPid: number;
  now(): Date;
  /** The Jira status of each ticket DOCK already holds, by key. */
  statuses(): Promise<Map<string, string>>;
  inProgressStatus(): Promise<string>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  /** Told once per new OOM kill of the WIB day, with today's count. */
  onOom(today: number, total: number): Promise<unknown>;
  kill(pid: number): void;
}

const wibDay = (now: Date) => new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

export class WorkspaceResources {
  private samples: MemorySample[] = [];
  private lastCpu: { usage: number; at: number } | null = null;
  private latest: ResourcesView | null = null;
  private askedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private sampling: Promise<ResourcesView> | null = null;
  private notified: { day: string; today: number } | null = null;

  constructor(private readonly deps: ResourcesDeps) {}

  private file(root: string, name: string) { return this.deps.files.read(path.posix.join(root.replace(/\\/g, '/'), name)); }

  /** The newest reading; asking keeps the shared sampler running for another 15 seconds. */
  async view(): Promise<ResourcesView> {
    this.askedAt = this.deps.now().getTime();
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.deps.now().getTime() - this.askedAt > ASKED_MS) { this.stop(); return; }
        void this.sample().catch((error) => console.warn('[Resources] Sample failed:', error instanceof Error ? error.message : 'unknown error'));
      }, SAMPLE_MS);
      this.timer.unref();
    }
    return this.latest && this.deps.now().getTime() - Date.parse(this.latest.at) < SAMPLE_MS ? this.latest : this.sample();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean { return this.timer !== null; }

  /** One reading, shared by every client asking at the same time. */
  sample(): Promise<ResourcesView> {
    if (!this.sampling) this.sampling = this.read().finally(() => { this.sampling = null; });
    return this.sampling;
  }

  private async read(): Promise<ResourcesView> {
    const now = this.deps.now();
    const { cgroupRoot, procRoot } = this.deps;
    const current = Number((this.file(cgroupRoot, 'memory.current') ?? '').trim()) || 0;
    this.samples.push({ at: now.toISOString(), bytes: current });
    if (this.samples.length > SAMPLES_KEPT) this.samples.splice(0, this.samples.length - SAMPLES_KEPT);
    const usage = keyValues(this.file(cgroupRoot, 'cpu.stat')).get('usage_usec');
    const limit = cpuLimit(this.file(cgroupRoot, 'cpu.max'));
    let percent: number | null = null;
    if (usage !== undefined) {
      if (this.lastCpu && now.getTime() > this.lastCpu.at) {
        const used = (usage - this.lastCpu.usage) / ((now.getTime() - this.lastCpu.at) * 1000);
        percent = Math.max(0, Math.round((used / (limit ?? 1)) * 1000) / 10);
      }
      this.lastCpu = { usage, at: now.getTime() };
    }
    const oom = await this.oom(keyValues(this.file(cgroupRoot, 'memory.events')).get('oom_kill') ?? 0, now);
    const processes = readProcesses(this.deps.files, procRoot);
    const [statuses, inProgress] = await Promise.all([this.deps.statuses().catch(() => new Map<string, string>()), this.deps.inProgressStatus().catch(() => 'In Progress')]);
    const prefix = [...statuses.keys()][0]?.split('-')[0] ?? 'QRD';
    const keyOf = (number: string) => [...statuses.keys()].find((key) => key.endsWith(`-${number}`)) ?? `${prefix}-${number}`;
    const grouped = groupProcesses(processes, { selfPid: this.deps.selfPid, projectsDir: this.deps.projectsDir, keyOf });
    this.latest = {
      at: now.toISOString(),
      memory: { current, max: memoryMax(this.file(cgroupRoot, 'memory.max')), anon: keyValues(this.file(cgroupRoot, 'memory.stat')).get('anon') ?? null, samples: [...this.samples] },
      cpu: { percent, limit, load1: loadOne(this.file(procRoot, 'loadavg')) },
      disk: this.deps.files.disk(this.deps.home),
      oom,
      worktrees: this.deps.files.list(this.deps.projectsDir).filter((name) => WORKTREE.test(name)).length,
      tickets: grouped.tickets,
      base: grouped.base,
      leftovers: leftovers(processes, grouped, statuses, inProgress),
    };
    return this.latest;
  }

  /** Today's OOM kills from the count kept at the first read of the WIB day; a new kill is told once. */
  private async oom(total: number, now: Date): Promise<{ total: number; today: number }> {
    const day = wibDay(now);
    const saved = await this.deps.cacheGet('oomBase').catch(() => null) as { day?: string; count?: number } | null;
    let base = saved && saved.day === day && typeof saved.count === 'number' && saved.count <= total ? saved.count : null;
    if (base === null) {
      base = total;
      await this.deps.cacheSet('oomBase', { day, count: total }).catch(() => undefined);
    }
    const today = total - base;
    if (!this.notified || this.notified.day !== day) {
      const kept = await this.deps.cacheGet('oomNotified').catch(() => null) as { day?: string; today?: number } | null;
      this.notified = { day, today: kept?.day === day && typeof kept.today === 'number' ? kept.today : 0 };
    }
    if (today > this.notified.today) {
      this.notified = { day, today };
      await this.deps.cacheSet('oomNotified', this.notified).catch(() => undefined);
      await this.deps.onOom(today, total).catch(() => undefined);
    }
    return { total, today };
  }

  /**
   * SIGTERM to the dev servers left running in the ticket's worktrees, never to Claude, a main clone or DOCK. Refused
   * while the ticket is In Progress. Worktrees and branches stay. Resolves to the number of processes told to stop.
   */
  async stopWorktreeServers(ticketKeyInput: string): Promise<number> {
    const key = String(ticketKeyInput ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new ResourcesInputError('A ticket key is required');
    const [statuses, inProgress] = await Promise.all([this.deps.statuses(), this.deps.inProgressStatus()]);
    const status = statuses.get(key);
    if (status && sameText(status, inProgress)) throw new ResourcesInputError(`${key} is ${status}: its servers keep running`);
    const view = await this.sample();
    const item = view.leftovers.find((leftover) => leftover.ticketKey === key);
    if (!item) return 0;
    for (const pid of item.pids) if (pid > 1 && pid !== this.deps.selfPid) this.deps.kill(pid);
    return item.pids.length;
  }
}
