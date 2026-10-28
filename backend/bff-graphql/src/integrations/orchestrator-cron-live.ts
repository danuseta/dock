import { JiraAPI } from '../datasources/JiraAPI';
import { ownerReplySession } from '../datasources/StorageAPI';
import { StorageService } from '../storage/service';
import { STOPPED_QUEUED_TEXT, STOPPED_TEXT, chatService } from './chat';
import { ledgerPeer } from './ledger-peer';
import { DEFAULT_MACHINE, orchestratorService } from './orchestrator';
import { CRON_CACHE, OrchestratorCron } from './orchestrator-cron';
import { isTaskTitle } from './session-titles';
import { eventPush, pushService } from './push';
import { askNotice, runDoneNotice, turnDoneNotice } from './push-notices';

const storage = new StorageService();
const jira = new JiraAPI();
const SESSIONS_LOOKED_AT = 200;
const DEAD_START_LOOKBACK_MS = 2 * 24 * 3600 * 1000;

/** The cron wired to the real storage, Jira, chat and orchestrator services. */
export const orchestratorCron = new OrchestratorCron({
  now: () => new Date(),
  settingValue: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value ?? null,
  saveSetting: (key, value, description) => storage.upsertSetting(key, value, description),
  cacheGet: (key) => storage.getCache(CRON_CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(CRON_CACHE, key, value, 0),
  cacheDelete: (key) => storage.deleteCache(CRON_CACHE, key),
  tickets: () => jira.getTickets(),
  ticket: (key) => jira.getTicket(key),
  moveTicket: (key, statusName) => jira.transitionTicket(key, statusName),
  dependencies: () => storage.getTicketDependencies(),
  dockOrder: () => storage.getTicketOrders(),
  manualKeys: () => storage.getManualTicketKeys(),
  slots: (machine) => storage.countCronSlots(machine),
  machines: () => orchestratorService.machines(),
  online: (machine) => chatService.bridge(machine).online,
  fiveHourUsed: (machine) => chatService.statusSnapshot(machine).limits?.fiveHour ?? null,
  // A ticket the laptop works on lives in the peer DOCK; an unreachable peer leaves only the local runs.
  takenKeys: async () => {
    const [local, peerRuns] = await Promise.all([storage.getOrchestratorRuns(), ledgerPeer ? ledgerPeer.runs() : []]);
    return [...local, ...peerRuns].map((run) => run.key);
  },
  deadStarts: () => storage.getDeadCronStartKeys(new Date(Date.now() - DEAD_START_LOOKBACK_MS)),
  runs: () => orchestratorService.list(),
  saveRun: (ledger, machine) => orchestratorService.ingestLedger(ledger, new Date(), machine),
  park: async (key, waiting) => {
    const row = await storage.getOrchestratorRunWithLedger(key);
    if (!row) return;
    let ledger: Record<string, unknown> = {};
    try { ledger = JSON.parse(row.ledgerRaw || row.payload); } catch { /* an unreadable ledger is parked with the row's own fields */ }
    const now = new Date();
    return orchestratorService.ingestLedger({ ...ledger, key, title: ledger.title ?? row.title, stage: ledger.stage ?? row.stage, waiting, updatedAt: now.toISOString() }, now, row.machine ?? DEFAULT_MACHINE);
  },
  cronSessions: async (keys) => new Map([...(await storage.getCronSessionStates(keys))].map(([key, session]) => [key, {
    id: session.id,
    status: session.status,
    stopped: session.statusDetail === STOPPED_TEXT || session.statusDetail === STOPPED_QUEUED_TEXT,
    otherActive: session.otherActive,
  }])),
  openSession: (input) => chatService.createSession(input),
  machineOptions: (machine, options) => chatService.machineTurnOptions(machine, options),
  deleteSession: (sessionId) => chatService.deleteSession(sessionId),
  ownerSessionBusy: async (key) => (await chatService.sessions('dock', SESSIONS_LOOKED_AT))
    .some((session) => session.ticketKey === key && isTaskTitle(session.title, key) && (session.status === 'queued' || session.status === 'running')),
  send: async (sessionId, text, options, extra = {}) => chatService.sendMessage(sessionId, text, await orchestratorService.machines(), {
    options, ...(extra.cronSlot === false ? { cronSlot: false } : {}), ...(extra.queue ? { mode: 'queue' } : {}),
  }),
  ownerReplySession: async () => ownerReplySession((await storage.getSettings()).find((setting) => setting.key === 'ownerReplySession')?.value),
  lastTaskSession: async (key) => (await storage.getChatSessions('dock', SESSIONS_LOOKED_AT))
    .filter((session) => session.ticketKey === key && isTaskTitle(session.title, key))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null,
  runningSessions: async () => (await chatService.sessions('dock', SESSIONS_LOOKED_AT)).filter((session) => session.status !== 'idle').map((session) => session.id),
  stopTurn: (sessionId) => chatService.stopTurn(sessionId),
  hasPushDevices: async () => (await pushService.subscriptions()).length > 0,
  push: (message) => eventPush.send('needsYou', message),
});

chatService.onAsk = (ask) => { void eventPush.send('needsYou', askNotice(ask)).catch(() => undefined); };
chatService.onTurnDone = (turn) => { void eventPush.send('sessionDone', turnDoneNotice(turn)).catch(() => undefined); };
orchestratorService.onFinished = (run) => { void eventPush.send('sessionDone', runDoneNotice(run)).catch(() => undefined); };
chatService.cronLimit = async () => (await orchestratorCron.settings().catch(() => null))?.parallel ?? null;
chatService.cronTurn = async (ticketKey, stalledDetail, ended) => {
  await orchestratorService.setStalledDetail(ticketKey, stalledDetail);
  if (ended && !stalledDetail) await orchestratorCron.resetResumes(ticketKey);
};
