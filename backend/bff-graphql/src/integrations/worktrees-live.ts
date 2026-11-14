import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { chatService } from './chat';
import { devServers } from './dev-servers';
import { statusScript } from './ledger-confirm';
import { readMergeStates } from './merge-state';
import { WORKTREE_MERGED_KEY, readWorktreeMerged } from './ops-rules';
import { Worktrees, type KitPaths } from './worktrees';

const run = promisify(execFile);
const storage = new StorageService();
const github = new GitHubAPI();
const CACHE = 'worktrees';
const SESSIONS_LOOKED_AT = 200;

/** The kit folder next to status.cjs, in the Claude Code config folder the bridge uses. */
const kitDir = () => path.dirname(statusScript());
const fwd = (value: string) => value.replace(/\\/g, '/');

export const worktrees = new Worktrees({
  kitPaths: async (): Promise<KitPaths> => {
    const printed = JSON.parse((await run(process.execPath, [path.join(kitDir(), 'paths.cjs'), '--print'], { timeout: 15_000 })).stdout);
    const repos = printed?.repos && typeof printed.repos === 'object' ? Object.fromEntries(Object.entries(printed.repos).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
    return { root: String(printed?.root ?? ''), repos, kitDir: fwd(String(printed?.kitDir ?? kitDir())) };
  },
  git: async (cwd, args) => (await run('git', ['-c', 'safe.directory=*', ...args], { cwd, timeout: 30_000, maxBuffer: 4 << 20 })).stdout,
  wt: async (dir, args) => {
    try {
      const { stdout, stderr } = await run('bash', [`${fwd(dir)}/wt.sh`, ...args], { timeout: 300_000, maxBuffer: 4 << 20 });
      return { code: 0, output: `${stdout}${stderr}` };
    } catch (error: any) {
      return { code: typeof error?.code === 'number' ? error.code : 1, output: `${error?.stdout ?? ''}${error?.stderr ?? ''}` || String(error?.message ?? 'wt.sh failed') };
    }
  },
  mergeStates: (keys) => readMergeStates(keys, github),
  liveSessions: async () => {
    const sessions = await chatService.sessions('dock', SESSIONS_LOOKED_AT);
    return { keys: new Set(sessions.filter((session) => session.status !== 'idle' && session.ticketKey).map((session) => String(session.ticketKey).toUpperCase())), dirs: [] };
  },
  devServerDirs: () => devServers.listenerDirs(),
  rules: async () => readWorktreeMerged((await storage.getSettingValues([WORKTREE_MERGED_KEY]))[0]?.value),
  cacheGet: (key) => storage.getCache(CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(CACHE, key, value, 0),
});
