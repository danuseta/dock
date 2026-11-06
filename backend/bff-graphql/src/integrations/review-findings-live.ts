import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { chatService } from './chat';
import { threadService } from './discord-threads';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { ReviewFindings, findingsEnabled, webhookIdOf } from './review-findings';

const storage = new StorageService();
const jira = new JiraAPI();

const setting = async (key: string) => (await storage.getSettingValues([key]))[0]?.value ?? null;

export const reviewFindings = new ReviewFindings({
  enabled: async () => findingsEnabled(await setting('reviewFindingsToTask')),
  rows: async () => [...(await threadService.stored()).values()],
  webhookId: async () => webhookIdOf(await setting('discordWebhookUrl')),
  ownTickets: async () => new Set((await jira.getTickets()).map((ticket: { key: string }) => ticket.key)),
  latestRounds: (threadIds) => storage.latestRoundsByThread(threadIds),
  create: (data) => storage.createReviewRound(data),
  update: (id, data) => storage.updateReviewRound(id, data),
  roundsToSend: (maxAttempts) => storage.getRoundsToSend(maxAttempts),
  expire: (before, maxAttempts, detail) => storage.expireSentRounds(before, maxAttempts, detail),
  roundById: (id) => storage.getReviewRound(id),
  pendingSessions: () => storage.pendingReviewSessions(),
  newestReply: async (sessionId) => (await storage.getNewestChatMessage(sessionId, 'assistant'))?.text ?? null,
  taskMessage: (key, prompt) => orchestratorCron.taskMessage(key, prompt),
  push: (message) => eventPush.send('needsYou', message),
  now: () => new Date(),
});

chatService.onTurnEnded = (turn) => { void reviewFindings.onTurnEnded(turn).catch((error) => console.warn('[ReviewFindings] result failed:', error instanceof Error ? error.message : 'unknown error')); };
