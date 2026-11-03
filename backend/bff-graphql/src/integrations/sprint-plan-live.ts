import { JiraAPI } from '../datasources/JiraAPI';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { CHAT_MACHINE, chatService } from './chat';
import { orchestratorService } from './orchestrator';
import { sprintDashboardService } from './sprint-dashboard';
import { SprintPlanner } from './sprint-plan';

const storage = new StorageService();
const jira = new JiraAPI();

/** The planner wired to the real storage, Jira cache, sprint dashboard and workspace chat. */
export const sprintPlanner = new SprintPlanner({
  now: () => new Date(),
  store: storage,
  tickets: () => jira.getTickets(),
  canStart: () => dockMode() === 'workspace' && chatService.bridge(CHAT_MACHINE).online,
  openSession: async (title) => (await chatService.createSession({ title, machine: CHAT_MACHINE })).id,
  send: async (sessionId, text) => chatService.sendMessage(sessionId, text, await orchestratorService.machines()),
  deleteSession: (sessionId) => chatService.deleteSession(sessionId),
  sprints: () => sprintDashboardService.listSprints(),
  sprintKeys: async (sprintId) => (JSON.parse(await sprintDashboardService.issueEvents(sprintId)) as Array<{ key?: unknown }>).map((issue) => String(issue.key)),
});
