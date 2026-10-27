import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { chatService } from './chat';
import { ClaudeAccounts, ROTATION_DEFAULTS, parseCycleList, type AccountUsage, type CycleList, type Rotation, type RotationEntry, type UsageWindow } from './claude-accounts';
import { eventPush } from './push';

const run = promisify(execFile);
const storage = new StorageService();
const CACHE = 'claude-accounts';
const LIST_FRESH_MS = 15_000;
export const ROTATION_KEYS = ['claudeRotate', 'claudeRotateFiveHour', 'claudeRotateSevenDay', 'claudeRotateBackToMain'] as const;

/** `/cycle`'s script on this machine, in the Claude Code config folder the bridge uses. */
export const cycleScript = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'account-cycle', 'cycle.py');
export const cycleAvailable = () => dockMode() === 'workspace' && fs.existsSync(cycleScript());
const python = process.platform === 'win32' ? 'python' : 'python3';

let listed: { at: number; list: CycleList } | null = null;

async function list(): Promise<CycleList> {
  if (listed && Date.now() - listed.at < LIST_FRESH_MS) return listed.list;
  if (!cycleAvailable()) return { accounts: [], active: null };
  const { stdout } = await run(python, [cycleScript(), 'list'], { timeout: 15_000 });
  listed = { at: Date.now(), list: parseCycleList(stdout) };
  return listed.list;
}

const date = (value: unknown) => (typeof value === 'string' ? new Date(value) : null);
const window = (value: unknown): UsageWindow | null => {
  const raw = value as { usedPercentage?: unknown; resetsAt?: unknown } | null;
  return raw && typeof raw.usedPercentage === 'number' ? { usedPercentage: raw.usedPercentage, resetsAt: date(raw.resetsAt) } : null;
};

async function usage(): Promise<Record<string, AccountUsage>> {
  const saved = (await storage.getCache(CACHE, 'usage')) as Record<string, { fiveHour: unknown; sevenDay: unknown; receivedAt: string }> | null;
  return Object.fromEntries(Object.entries(saved ?? {}).map(([name, seen]) => [name, { fiveHour: window(seen.fiveHour), sevenDay: window(seen.sevenDay), receivedAt: new Date(seen.receivedAt) }]));
}

async function log(): Promise<RotationEntry[]> {
  const saved = (await storage.getCache(CACHE, 'log')) as Array<Omit<RotationEntry, 'at'> & { at: string }> | null;
  return (saved ?? []).map((entry) => ({ ...entry, at: new Date(entry.at) }));
}

async function rotation(): Promise<Rotation> {
  const values = new Map((await storage.getSettingValues([...ROTATION_KEYS])).map((row) => [row.key, row.value]));
  const percent = (key: string, fallback: number) => {
    const value = Number(values.get(key));
    return Number.isInteger(value) && value >= 50 && value <= 100 ? value : fallback;
  };
  return {
    enabled: values.get('claudeRotate') === 'true',
    fiveHour: percent('claudeRotateFiveHour', ROTATION_DEFAULTS.fiveHour),
    sevenDay: percent('claudeRotateSevenDay', ROTATION_DEFAULTS.sevenDay),
    backToMain: values.has('claudeRotateBackToMain') ? values.get('claudeRotateBackToMain') === 'true' : ROTATION_DEFAULTS.backToMain,
  };
}

export const claudeAccounts = new ClaudeAccounts({
  list,
  switchTo: async (name) => {
    await run(python, [cycleScript(), name], { timeout: 15_000 });
    listed = null;
  },
  rotation,
  saveRotation: async (rule) => {
    await Promise.all([
      storage.upsertSetting('claudeRotate', String(rule.enabled)),
      storage.upsertSetting('claudeRotateFiveHour', String(rule.fiveHour)),
      storage.upsertSetting('claudeRotateSevenDay', String(rule.sevenDay)),
      storage.upsertSetting('claudeRotateBackToMain', String(rule.backToMain)),
    ]);
  },
  usage,
  saveUsage: async (value) => { await storage.upsertCache(CACHE, 'usage', value, 0); },
  log,
  saveLog: async (value) => { await storage.upsertCache(CACHE, 'log', value, 0); },
  switched: () => { void chatService.forgetLimits(dockMode()); },
  push: (message) => eventPush.send('needsYou', message),
  now: () => new Date(),
});

/** The rotation follows only this machine's own turns, the ones `/cycle` here decides the account of. */
chatService.onLimits = (machine, limits) => {
  if (machine !== dockMode() || !cycleAvailable()) return;
  void claudeAccounts.report(limits).catch((error) => console.warn('[ClaudeAccounts] report failed:', error instanceof Error ? error.message : 'unknown error'));
};

/** What the Settings section reads; a machine without `/cycle` lists no account. */
export const claudeAccountsState = async () => ({ available: cycleAvailable(), ...(await claudeAccounts.state()) });
