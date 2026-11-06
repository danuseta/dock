import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { QaAuto, isRunVideo, isTicketKey, newestRun, parseProgress, parseResults, type QaRun, type QaTrigger } from './qa-local';

const storage = new StorageService();
const CACHE = 'qa-local';
export const QA_SETTING = 'qaAutoRun';

/** `~/qa-local`, where `qonflo-qa-local` keeps its tests and run folders. */
export const qaDir = () => process.env.QA_LOCAL_DIR || path.join(os.homedir(), 'qa-local');
/** QA runs only on a workspace DOCK where the owner installed `qonflo-qa-local`; elsewhere the panel and setting stay hidden. */
export const qaAvailable = () => dockMode() === 'workspace' && fs.existsSync(path.join(qaDir(), 'bin', 'qonflo-qa-local'));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** The newest QA run of a ticket, from its `progress.json`, or its `results.json` for a run made before progress existed. */
export function latestQaRun(key: string): QaRun | null {
  if (!qaAvailable() || !isTicketKey(key)) return null;
  const dir = path.join(qaDir(), 'runs', key);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const runId = newestRun(names);
  if (!runId) return null;
  const progress = read(path.join(dir, runId, 'progress.json'));
  if (progress !== null) return parseProgress(progress, alive);
  const results = read(path.join(dir, runId, 'results.json'));
  return results === null ? null : parseResults(results);
}

/** The absolute path of a run's video, or null when the name is not one the panel links to. */
export function qaVideoPath(key: string, runId: string, file: string): string | null {
  if (!qaAvailable() || !isTicketKey(key) || !/^\d{8}T\d{6}Z$/.test(runId) || !isRunVideo(file)) return null;
  const full = path.join(qaDir(), 'runs', key, runId, file);
  return fs.existsSync(full) ? full : null;
}

export const qaEnabled = async () => (await storage.getSettingValues([QA_SETTING])).some((row) => row.key === QA_SETTING && row.value === 'true');
export const qaTrigger = async (key: string) => (await storage.getCache(CACHE, key)) as QaTrigger | null;

export const qaAuto = new QaAuto({
  available: qaAvailable,
  enabled: qaEnabled,
  machine: async () => (await orchestratorCron.settings()).machine,
  last: qaTrigger,
  save: async (key, trigger) => { await storage.upsertCache(CACHE, key, trigger, 0); },
  open: (key, prompt) => orchestratorCron.openReview(key, prompt, 'QA'),
  now: () => new Date(),
});

const previous = orchestratorService.onLedger;
orchestratorService.onLedger = (run) => {
  previous(run);
  void qaAuto.ledger(run).catch((error) => console.warn('[QaLocal] start failed:', error instanceof Error ? error.message : 'unknown error'));
};
