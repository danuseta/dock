import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { chatService } from './chat';
import { orchestratorService } from './orchestrator';
import { CRON_CACHE, OrchestratorCron, postWebhook } from './orchestrator-cron';
import { pushService } from './push';

const storage = new StorageService();
const jira = new JiraAPI();
const SESSIONS_LOOKED_AT = 200;

/** The cron wired to the real storage, Jira, chat and orchestrator services. */
export const orchestratorCron = new OrchestratorCron({
  now: () => new Date(),
  settingValue: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value ?? null,
  saveSetting: (key, value, description) => storage.upsertSetting(key, value, description),
  cacheGet: (key) => storage.getCache(CRON_CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(CRON_CACHE, key, value, 0),
  tickets: () => jira.getTickets(),
  ticket: (key) => jira.getTicket(key),
  moveTicket: (key, statusName) => jira.transitionTicket(key, statusName),
  dependencies: () => storage.getTicketDependencies(),
  dockOrder: () => storage.getTicketOrders(),
  slots: (machine) => storage.countCronSlots(machine),
  machines: () => orchestratorService.machines(),
  online: (machine) => chatService.bridge(machine).online,
  fiveHourUsed: (machine) => chatService.statusSnapshot(machine).limits?.fiveHour ?? null,
  takenKeys: async () => (await storage.getOrchestratorRuns()).map((run) => run.key),
  runs: () => orchestratorService.list(),
  saveRun: (ledger, machine) => orchestratorService.ingestLedger(ledger, new Date(), machine),
  openSession: (input) => chatService.createSession(input),
  send: async (sessionId, text, options) => chatService.sendMessage(sessionId, text, await orchestratorService.machines(), { options }),
  runningSessions: async () => (await chatService.sessions('dock', SESSIONS_LOOKED_AT)).filter((session) => session.status !== 'idle').map((session) => session.id),
  stopTurn: (sessionId) => chatService.stopTurn(sessionId),
  post: postWebhook,
  hasPushDevices: async () => (await pushService.subscriptions()).length > 0,
  push: (message) => pushService.send(message),
});

chatService.cronLimit = async () => (await orchestratorCron.settings().catch(() => null))?.parallel ?? null;
