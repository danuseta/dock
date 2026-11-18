import { StorageAPI } from '../datasources/StorageAPI';
import { StorageService } from '../storage/service';
import { chatService } from './chat';
import { claudeUsage } from './claude-usage';
import { gmCronView, gmSettingsView, gmUsageRow, withGmCron } from './guild-master';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { resetOwnerPassLabel } from './review-approval';

const storageAPI = new StorageAPI();
const storage = new StorageService();
const USAGE_TICKETS = 8;
const USAGE_CACHE_MS = 5 * 60 * 1000;

/** The settings a Guild Master turn reads and writes, through the same updateSettings path as the Settings page. */
export const gmSettings = {
  view: async () => gmSettingsView(await storageAPI.getPublicSettings()),
  async put(values: Record<string, string>) {
    const ok = await storageAPI.updateSettings(values);
    resetOwnerPassLabel();
    return { ok, ...(ok ? {} : { error: 'DOCK refused one of the values' }), ...gmSettingsView(await storageAPI.getPublicSettings()) };
  },
};

/** The cron fields a Guild Master turn reads and writes, through the same updateSettings path as the Cron dialog. */
export const gmCron = {
  view: async () => gmCronView(await orchestratorCron.settings()),
  async put(values: Record<string, string>) {
    await orchestratorCron.updateSettings(JSON.stringify(withGmCron(await orchestratorCron.settings(), values)));
    return { ok: true, ...gmCronView(await orchestratorCron.settings()) };
  },
};

let usageCache: { at: number; rows: unknown[] } | null = null;

/** The newest ticket runs with their Claude usage and failed gates; ccusage is slow, so the rows are kept for a few minutes. */
async function gmUsage() {
  if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_MS) return usageCache.rows;
  const runs = (await orchestratorService.list()).filter((run) => run.kind === 'build').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, USAGE_TICKETS);
  const rows: unknown[] = [];
  for (const run of runs) rows.push(gmUsageRow(run, await claudeUsage.ticket(await storage.getTicketClaudeSessionIds(run.key))));
  usageCache = { at: Date.now(), rows };
  return rows;
}

chatService.gmSettings = gmSettings.view;
chatService.gmData = async () => ({ cron: await gmCron.view().catch(() => ({ values: {} })), usage: await gmUsage().catch(() => []) });
