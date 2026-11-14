// The linked worktrees of the Qonflo repos under the kit's ROOT, whether their ticket merged, and their cleanup. A
// worktree is only ever removed through the kit's wt.sh (check, unlink a node_modules junction, check again, then remove):
// `git worktree remove` deletes through a node_modules junction into the main clone, so the junction is taken away with
// wt.sh unlink first, which leaves its target alone, and wt.sh remove still refuses one. DOCK refuses first, and touches nothing, when the
// worktree has local changes, a live session works the ticket, a dev server runs in it, or its ticket is not merged.

import type { MergeRead } from './merge-state';
import { DEFAULT_WORKTREE_MERGED, type WorktreeMerged } from './ops-rules';

export const REFUSALS = {
  dirty: 'ada perubahan lokal',
  session: 'dipakai sesi aktif',
  devServer: 'dev server jalan di sini',
  notMerged: 'belum merged',
  unknown: 'bukan worktree yang DOCK kenal',
} as const;

const HISTORY_KEPT = 50;
const AUTO_HOUR_WIB = 7;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const TICKET = /([A-Z][A-Z0-9]+-\d+)/i;
/** wt.sh check prints "<dir> node_modules: junction|own|none"; a Linux symlink also reads junction. */
const JUNCTION = /node_modules: junction\b/;
const FAILED = /REFUSED|DAMAGE|FAILED/;

export interface KitPaths { root: string; repos: Record<string, string>; kitDir: string }

export interface WorktreeRow {
  repo: string;
  path: string;
  branch: string | null;
  ticketKey: string | null;
  merge: MergeRead['merge'];
  pulls: string[];
  dirty: boolean;
  changes: string[];
  session: boolean;
  devServer: boolean;
  /** When DOCK first saw the ticket merged; auto mode counts its days from here. */
  mergedSince: string | null;
  /** Why a cleanup would be refused now; empty when it may go. */
  refusals: string[];
}

/** unlinked: wt.sh unlink took a node_modules junction away before the remove. */
export interface CleanResult { path: string; ok: boolean; output: string; unlinked?: boolean }
export interface CleanHistoryItem extends CleanResult { at: string; by: 'owner' | 'auto' }
export interface WorktreeList { root: string; mode: WorktreeMerged['mode']; days: number; rows: WorktreeRow[]; history: CleanHistoryItem[]; error: string | null }

export interface WorktreeDeps {
  kitPaths(): Promise<KitPaths>;
  /** git -c safe.directory=* <args> in cwd; rejects on a non-zero exit. */
  git(cwd: string, args: string[]): Promise<string>;
  /** bash <kitDir>/wt.sh <args>; never rejects, the exit code and output come back. */
  wt(kitDir: string, args: string[]): Promise<{ code: number; output: string }>;
  mergeStates(keys: string[]): Promise<Map<string, MergeRead> | null>;
  /** Ticket keys with a chat session that is not idle, and the folders their ledgers name. */
  liveSessions(): Promise<{ keys: Set<string>; dirs: string[] }>;
  /** The working folders of the processes that listen on a port. */
  devServerDirs(): Promise<string[]>;
  rules(): Promise<WorktreeMerged>;
  cacheGet(key: string): Promise<unknown>;
  cacheSet(key: string, value: unknown): Promise<unknown>;
  now?(): Date;
}

const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const inside = (dir: string, base: string) => { const a = norm(dir); const b = norm(base); return a === b || a.startsWith(`${b}/`); };

/** `git worktree list --porcelain`: every worktree after the first one, which is the main clone. */
export function parseWorktreeList(text: string): Array<{ path: string; branch: string | null; head: string | null; bare: boolean }> {
  const blocks = text.replace(/\r/g, '').split('\n\n').map((block) => block.trim()).filter(Boolean);
  return blocks.slice(1).map((block) => {
    const lines = block.split('\n');
    const value = (name: string) => lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1).trim() ?? null;
    const branch = value('branch');
    return { path: value('worktree') ?? '', branch: branch ? branch.replace(/^refs\/heads\//, '') : null, head: value('HEAD'), bare: lines.includes('bare') };
  }).filter((item) => item.path && !item.bare);
}

export const ticketOf = (branch: string | null, folder: string): string | null => (TICKET.exec(branch ?? '')?.[1] ?? TICKET.exec(folder.split('/').pop() ?? '')?.[1] ?? null)?.toUpperCase() ?? null;

export function refusalsOf(row: Pick<WorktreeRow, 'dirty' | 'session' | 'devServer' | 'merge'>): string[] {
  return [
    ...(row.dirty ? [REFUSALS.dirty] : []),
    ...(row.session ? [REFUSALS.session] : []),
    ...(row.devServer ? [REFUSALS.devServer] : []),
    ...(row.merge !== 'merged' ? [REFUSALS.notMerged] : []),
  ];
}

const wibDay = (date: Date) => new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
const wibHour = (date: Date) => new Date(date.getTime() + WIB_OFFSET_MS).getUTCHours();

export class Worktrees {
  private autoRunning: Promise<CleanResult[]> | null = null;

  constructor(private readonly deps: WorktreeDeps) {}

  private now() { return this.deps.now?.() ?? new Date(); }

  private async history(): Promise<CleanHistoryItem[]> {
    const saved = await this.deps.cacheGet('history').catch(() => null);
    return Array.isArray(saved) ? saved as CleanHistoryItem[] : [];
  }

  private async mergedSince(): Promise<Record<string, string>> {
    const saved = await this.deps.cacheGet('mergedSince').catch(() => null);
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, string> : {};
  }

  /** Every linked worktree of each repo, with what a cleanup would check. */
  async list(): Promise<WorktreeList> {
    const rules = await this.deps.rules().catch(() => DEFAULT_WORKTREE_MERGED);
    const history = await this.history();
    let paths: KitPaths;
    try { paths = await this.deps.kitPaths(); } catch (error) {
      return { root: '', mode: rules.mode, days: rules.days, rows: [], history, error: error instanceof Error ? error.message : 'The kit paths could not be read' };
    }
    const found: Array<{ repo: string; path: string; branch: string | null }> = [];
    const errors: string[] = [];
    for (const [repo, dir] of Object.entries(paths.repos)) {
      try {
        for (const item of parseWorktreeList(await this.deps.git(dir, ['worktree', 'list', '--porcelain']))) found.push({ repo, path: item.path, branch: item.branch });
      } catch (error) {
        errors.push(`${repo}: ${error instanceof Error ? error.message : 'git worktree list failed'}`);
      }
    }
    const keys = [...new Set(found.map((item) => ticketOf(item.branch, item.path)).filter((key): key is string => Boolean(key)))];
    const [merges, live, servers] = await Promise.all([
      keys.length ? this.deps.mergeStates(keys).catch(() => null) : Promise.resolve(new Map<string, MergeRead>()),
      this.deps.liveSessions().catch(() => null),
      this.deps.devServerDirs().catch(() => null),
    ]);
    const since = await this.mergedSince();
    const now = this.now().toISOString();
    let sinceChanged = false;
    const rows: WorktreeRow[] = [];
    for (const item of found) {
      const ticketKey = ticketOf(item.branch, item.path);
      const status = await this.deps.git(item.path, ['status', '--porcelain']).catch(() => null);
      const changes = status === null ? ['git status failed'] : status.replace(/\r/g, '').split('\n').filter(Boolean).slice(0, 5);
      const read = ticketKey ? merges?.get(ticketKey) : undefined;
      const merge = read?.merge ?? 'unknown';
      if (merge === 'merged' && !since[item.path]) { since[item.path] = now; sinceChanged = true; }
      if (merge !== 'merged' && since[item.path]) { delete since[item.path]; sinceChanged = true; }
      const row = {
        repo: item.repo,
        path: item.path,
        branch: item.branch,
        ticketKey,
        merge,
        pulls: read?.pulls ?? [],
        dirty: changes.length > 0,
        changes,
        // A read that failed cannot prove the worktree is free, so it counts as in use.
        session: !live || Boolean(ticketKey && live.keys.has(ticketKey)) || live.dirs.some((dir) => inside(dir, item.path)),
        devServer: !servers || servers.some((dir) => inside(dir, item.path)),
        mergedSince: since[item.path] ?? null,
        refusals: [] as string[],
      };
      row.refusals = refusalsOf(row);
      rows.push(row);
    }
    if (sinceChanged) await this.deps.cacheSet('mergedSince', since).catch(() => undefined);
    return { root: paths.root, mode: rules.mode, days: rules.days, rows, history, error: errors.length ? errors.join('; ') : null };
  }

  /**
   * Removes the given worktrees, each checked fresh: a path DOCK did not list, or one with a refusal, is REFUSED and not
   * touched. The rest go through wt.sh check, wt.sh unlink and check again when node_modules is a junction, then wt.sh remove; any non-zero exit or REFUSED from wt.sh stops it.
   */
  async clean(paths: string[], by: CleanHistoryItem['by'] = 'owner'): Promise<CleanResult[]> {
    const list = await this.list();
    const kit = await this.deps.kitPaths();
    const results: CleanResult[] = [];
    for (const wanted of [...new Set(paths)]) {
      const row = list.rows.find((item) => norm(item.path) === norm(wanted));
      if (!row) { results.push({ path: wanted, ok: false, output: `REFUSED: ${REFUSALS.unknown}` }); continue; }
      if (row.refusals.length) { results.push({ path: row.path, ok: false, output: `REFUSED: ${row.refusals.join(', ')}` }); continue; }
      const steps: string[] = [];
      const step = async (args: string[]) => {
        const done = await this.deps.wt(kit.kitDir, args);
        steps.push(done.output.trim() || `wt.sh ${args[0]} exited ${done.code}`);
        return done.code === 0 && !FAILED.test(done.output) ? done.output : null;
      };
      const refuse = (unlinked = false) => results.push({ path: row.path, ok: false, output: steps.join('\n'), ...(unlinked ? { unlinked } : {}) });
      const check = await step(['check', row.path]);
      if (check === null) { refuse(); continue; }
      let unlinked = false;
      if (JUNCTION.test(check)) {
        if ((await step(['unlink', row.path])) === null) { refuse(); continue; }
        unlinked = true;
        const again = await step(['check', row.path]);
        if (again === null || JUNCTION.test(again)) {
          if (again !== null) steps.push(`REFUSED: ${row.path}/node_modules is still a junction after wt.sh unlink`);
          refuse(unlinked);
          continue;
        }
      }
      const ok = (await step(['remove', row.path])) !== null;
      results.push({ path: row.path, ok, output: steps.join('\n'), ...(unlinked ? { unlinked } : {}) });
    }
    if (results.length) {
      const at = this.now().toISOString();
      const history = [...results.map((result) => ({ ...result, at, by })), ...(await this.history())].slice(0, HISTORY_KEPT);
      await this.deps.cacheSet('history', history).catch(() => undefined);
    }
    return results;
  }

  /** Auto mode, once a WIB day from 07:00: the merged worktrees DOCK has seen merged for `days` days or more. */
  autoTick(): Promise<CleanResult[]> {
    if (!this.autoRunning) this.autoRunning = this.auto().finally(() => { this.autoRunning = null; });
    return this.autoRunning;
  }

  private async auto(): Promise<CleanResult[]> {
    const rules = await this.deps.rules();
    const now = this.now();
    if (rules.mode !== 'auto' || wibHour(now) < AUTO_HOUR_WIB) return [];
    const day = wibDay(now);
    if ((await this.deps.cacheGet('autoDay').catch(() => null)) === day) return [];
    await this.deps.cacheSet('autoDay', day);
    const list = await this.list();
    const due = list.rows.filter((row) => row.merge === 'merged' && row.mergedSince && now.getTime() - Date.parse(row.mergedSince) >= rules.days * DAY_MS);
    return due.length ? this.clean(due.map((row) => row.path), 'auto') : [];
  }
}
