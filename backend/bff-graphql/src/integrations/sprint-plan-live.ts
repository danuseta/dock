import { JiraAPI } from '../datasources/JiraAPI';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { CHAT_MACHINE, chatService } from './chat';
import { orchestratorService } from './orchestrator';
import { sprintDashboardService } from './sprint-dashboard';
import { SprintPlanner } from './sprint-plan';
import { parseCronSettings } from './orchestrator-cron';
import { cronDryRun } from './plan-publish';

const storage = new StorageService();
const jira = new JiraAPI();

/** The planner wired to the real storage, Jira cache, sprint dashboard and workspace chat. */
export const sprintPlanner = new SprintPlanner({
  now: () => new Date(),
  store: storage,
  tickets: () => jira.getTickets(),
  canStart: () => dockMode() === 'workspace' && !cronDryRun() && chatService.bridge(CHAT_MACHINE).online,
  openSession: async (title) => (await chatService.createSession({ title, machine: CHAT_MACHINE })).id,
  send: async (sessionId, text) => chatService.sendMessage(sessionId, text, await orchestratorService.machines()),
  deleteSession: (sessionId) => chatService.deleteSession(sessionId),
  sprints: () => sprintDashboardService.listSprints(),
  requirePublish: async () => parseCronSettings((await storage.getSettings()).find((setting) => setting.key === 'orchestratorCronConfig')?.value).planAfterPublish,
  sprintKeys: async (sprintId) => (JSON.parse(await sprintDashboardService.issueEvents(sprintId)) as Array<{ key?: unknown }>).map((issue) => String(issue.key)),
});
