import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { dockMode } from '../mode';
import { lessonsFileFor } from './lessons-hook';
import { StorageService } from '../storage/service';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { chatService } from './chat';
import { QA_FIX, QaAuto, RUN_ID, isRunVideo, isTicketKey, newestRun, parseProgress, parseResults, qaLocalRows, readTrigger, runPullRequests, type QaLocalRow, type QaRun } from './qa-local';

const storage = new StorageService();
const github = new GitHubAPI();
const jira = new JiraAPI();
const CACHE = 'qa-local';
const PULL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
export const QA_SETTING = 'qaAutoRun';

/** `~/qa-local`, where `qonflo-qa-local` keeps its tests and run folders. */
export const qaDir = () => process.env.QA_LOCAL_DIR || path.join(os.homedir(), 'qa-local');
/** Where the command may be: the kit's copy first, then the older one inside the data folder. */
export const qaBinPaths = () => [path.join(os.homedir(), '.claude', 'kit', 'qa-local', 'bin', 'qonflo-qa-local'), path.join(qaDir(), 'bin', 'qonflo-qa-local')];
/** QA runs only on a workspace DOCK where the owner installed `qonflo-qa-local`; elsewhere the panel and setting stay hidden. */
export const qaAvailable = () => dockMode() === 'workspace' && qaBinPaths().some((file) => fs.existsSync(file));

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

/**
 * Every ticket's newest local QA run for the QA queue page, plus QA sessions still preparing their first run; RFP and Done
 * tickets left out. Status and title from the cached Jira ticket, the title else from the ledger.
 */
export async function qaLocalRuns(): Promise<{ rows: QaLocalRow[]; hidden: number }> {
  if (!qaAvailable()) return { rows: [], hidden: 0 };
  let runKeys: string[] = [];
  try {
    runKeys = fs.readdirSync(path.join(qaDir(), 'runs'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && isTicketKey(entry.name)).map((entry) => entry.name);
  } catch { /* no runs folder yet: only preparing sessions can show */ }
  const triggers = new Map((await storage.listCache(CACHE).catch(() => [])).filter((entry) => isTicketKey(entry.key)).map((entry) => [entry.key, readTrigger(entry.value)]));
  const keys = [...new Set([...runKeys, ...triggers.keys()])];
  const ledgers = new Map((await orchestratorService.list().catch(() => [])).map((run) => [run.key, run]));
  const sources = await Promise.all(keys.map(async (key) => {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(qaDir(), 'runs', key)); } catch { /* an unreadable folder counts no runs */ }
    const trigger = triggers.get(key) ?? null;
    const session = trigger?.sessionId ? await storage.getChatSession(trigger.sessionId).catch(() => null) : null;
    const ticket = await jira.getTicket(key).catch(() => null);
    return {
      key, run: latestQaRun(key), runs: names.filter((name) => RUN_ID.test(name)).length, trigger,
      sessionRunning: session?.status === 'running' || session?.status === 'queued',
      title: ticket?.title ?? ledgers.get(key)?.title ?? null,
      jiraStatus: ticket?.status ?? null,
    };
  }));
  return qaLocalRows(sources);
}

export const qaEnabled = async () => (await storage.getSettingValues([QA_SETTING])).some((row) => row.key === QA_SETTING && row.value === 'true');
export const qaTrigger = async (key: string) => readTrigger(await storage.getCache(CACHE, key));

export const qaAuto = new QaAuto({
  available: qaAvailable,
  enabled: qaEnabled,
  machine: async () => (await orchestratorCron.settings()).machine,
  last: qaTrigger,
  save: async (key, trigger) => { await storage.upsertCache(CACHE, key, trigger, 0); },
  open: (key, prompt) => orchestratorCron.openReview(key, prompt, 'QA'),
  now: () => new Date(),
  latest: latestQaRun,
  runDir: (key, runId) => path.join(qaDir(), 'runs', key, runId).replace(/\\/g, '/'),
  head: async (prUrl) => {
    const match = PULL.exec(prUrl);
    const client = match ? await github.client() : null;
    return match && client ? ((await client.getPRStatus(match[1], match[2], Number(match[3])))?.head?.sha ?? null) : null;
  },
  message: (key, prompt) => orchestratorCron.taskMessage(key, prompt),
  tickets: async () => (await orchestratorService.list()).filter((run) => run.kind === 'build' && runPullRequests(run).length > 0).map((run) => run.key),
  lessonsFile: (key) => lessonsFileFor(key),
});

const previous = orchestratorService.onLedger;
orchestratorService.onLedger = (run) => {
  previous(run);
  void qaAuto.ledger(run).catch((error) => console.warn('[QaLocal] start failed:', error instanceof Error ? error.message : 'unknown error'));
};

// A Task session ends a QA fix with a QA-FIX line; its result per TC is kept for the QA queue row.
const turnEndedBefore = chatService.onTurnEnded;
chatService.onTurnEnded = (turn) => {
  turnEndedBefore(turn);
  if (!turn.ticketKey || turn.failed || !qaAvailable()) return;
  void storage.getNewestChatMessage(turn.sessionId, 'assistant', `${QA_FIX} `)
    .then((message) => qaAuto.fixReported(turn.ticketKey!, message?.text ?? null))
    .catch((error) => console.warn('[QaLocal] fix result failed:', error instanceof Error ? error.message : 'unknown error'));
};
