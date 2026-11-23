import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { decrypt } from '../storage/crypto';
import { StorageService } from '../storage/service';
import { MESSAGE_KEYS, arenaSetting, messageFormat } from './auto-review';
import { reviewOwner, screenshotsOf } from './auto-review-live';
import { chatService } from './chat';
import { DiscordPoster } from './discord-post';
import { threadService } from './discord-threads';
import { installedSkills } from './installed-skills';
import { LIGHT_KEYS, lightForFindings, lightSettings } from './light-runner';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { ReviewFindings, findingsEnabled, webhookIdOf } from './review-findings';

const storage = new StorageService();
const jira = new JiraAPI();
const github = new GitHubAPI();
const poster = new DiscordPoster();
const PULL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

const setting = async (key: string) => (await storage.getSettingValues([key]))[0]?.value ?? null;

export const REVIEW_FINDINGS_KEYS = ['reviewFindingsAutoReply', 'reviewPostDelayMinutes', 'reviewMaxRounds', ...Object.values(MESSAGE_KEYS.reply), ...LIGHT_KEYS];

export const reviewFindings = new ReviewFindings({
  enabled: async () => findingsEnabled(await setting('reviewFindingsToTask')),
  rows: async () => [...(await threadService.stored()).values()],
  webhookId: async () => webhookIdOf(decrypt(await setting('discordWebhookUrl') ?? '')),
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
  settings: async () => {
    const values = new Map((await storage.getSettingValues(REVIEW_FINDINGS_KEYS)).map((row) => [row.key, row.value]));
    return {
      autoReply: values.get('reviewFindingsAutoReply') !== 'false',
      delayMinutes: arenaSetting('reviewPostDelayMinutes', values.get('reviewPostDelayMinutes')),
      maxRounds: arenaSetting('reviewMaxRounds', values.get('reviewMaxRounds')),
      reply: messageFormat('reply', values),
      light: lightForFindings(lightSettings(values)),
    };
  },
  pull: async (prUrl) => {
    const match = PULL.exec(prUrl);
    return match ? github.pullState(match[1], match[2], Number(match[3])).catch(() => null) : null;
  },
  owner: reviewOwner,
  skills: () => installedSkills(),
  imageRoot: screenshotsOf,
  threadReplies: (threadId) => storage.getThreadReplies(threadId),
  roundNumber: (round) => storage.reviewRoundNumber(round.threadId, round.createdAt),
  dueReplies: (now) => storage.getDueReviewReplies(now),
  updatePendingReply: (id, data) => storage.updatePendingReviewReply(id, data),
  postDiscord: (webhookUrl, content, options) => poster.post(webhookUrl, content, options),
  now: () => new Date(),
});

chatService.onTurnEnded = (turn) => { void reviewFindings.onTurnEnded(turn).catch((error) => console.warn('[ReviewFindings] result failed:', error instanceof Error ? error.message : 'unknown error')); };
