import { GitHubAPI } from '../datasources/GitHubAPI';
import { decrypt } from '../storage/crypto';
import { StorageService } from '../storage/service';
import { AutoReview, MESSAGE_KEYS, WAITING_SKILL, arenaSetting, currentReviews, messageFormat, type AutoReviewOwner, type PullState } from './auto-review';
import { defaultBlackboardRoot, ticketScreenshots } from './blackboard';
import { DISCORD_OPEN, DiscordPoster } from './discord-post';
import { installedSkills } from './installed-skills';
import { threadService } from './discord-threads';
import { reporterName } from './dock-issues';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { lessonsFileFor } from './lessons-hook';
import { lgtmReview } from './review-approval';

const storage = new StorageService();
const github = new GitHubAPI();
const poster = new DiscordPoster();

/** How long the Agents list trusts a pull request's state: the page polls, GitHub should not be asked on every poll. */
const LISTED_PULL_MS = 60_000;
const listedPulls = new Map<string, { at: number; state: Promise<PullState> }>();
/** A commit's date never changes, so a head commit the arena waits on is asked about once. */
const commitDates = new Map<string, Date>();
const COMMIT_DATES = 500;

function listedPull(owner: string, repo: string, number: number): Promise<PullState> {
  const key = `${owner}/${repo}#${number}`;
  const hit = listedPulls.get(key);
  if (hit && Date.now() - hit.at < LISTED_PULL_MS) return hit.state;
  const state = github.pullState(owner, repo, number);
  listedPulls.set(key, { at: Date.now(), state });
  state.catch(() => listedPulls.delete(key));
  return state;
}

/** The auto reviews the Agents page lists: the stored ones that still say something about the pull request as it is now. */
export const listedAutoReviews = async <T extends { prUrl: string; headSha: string; status: string }>(rows: T[]) => currentReviews(rows, listedPull);

export const AUTO_REVIEW_KEYS = ['autoReviewOnIt', 'autoLgtm', 'autoReviewPostDiscord', 'reviewPostDelayMinutes', 'reviewReReviewWaitMinutes', 'reviewReReviewOnCommit', 'reviewMaxRounds', ...Object.values(MESSAGE_KEYS.post)] as const;

/** Who posts to a thread: the owner's Discord user id, webhook and name. */
export const reviewOwner = async (): Promise<AutoReviewOwner> => {
  const values = new Map((await storage.getSettingValues(['discordUserId', 'discordWebhookUrl'])).map((row) => [row.key, row.value]));
  return { discordUserId: values.get('discordUserId')?.trim() || null, webhookUrl: decrypt(values.get('discordWebhookUrl') ?? '').trim() || null, name: reporterName() };
};

/** Where a ticket's screenshots are: the review runner and browser-verifier save them on the ticket's blackboard. */
export const screenshotsOf = (key: string) => ticketScreenshots(defaultBlackboardRoot(), key);

export const autoReview = new AutoReview({
  settings: async () => {
    const values = new Map((await storage.getSettingValues([...AUTO_REVIEW_KEYS])).map((row) => [row.key, row.value]));
    return {
      enabled: values.get('autoReviewOnIt') === 'true',
      autoLgtm: values.get('autoLgtm') === 'true',
      post: values.get('autoReviewPostDiscord') !== 'false',
      postDelayMinutes: arenaSetting('reviewPostDelayMinutes', values.get('reviewPostDelayMinutes')),
      reReviewOnCommit: values.get('reviewReReviewOnCommit') === 'true',
      reReviewWaitMinutes: arenaSetting('reviewReReviewWaitMinutes', values.get('reviewReReviewWaitMinutes')),
      maxRounds: arenaSetting('reviewMaxRounds', values.get('reviewMaxRounds')),
      message: messageFormat('post', values),
    };
  },
  rows: async () => [...(await threadService.stored()).values()],
  pull: listedPull,
  commitAt: async (owner, repo, sha) => {
    const key = `${owner}/${repo}@${sha}`;
    const known = commitDates.get(key);
    if (known) {
      commitDates.delete(key);
      commitDates.set(key, known);
      return known;
    }
    const date = await github.commitAt(owner, repo, sha);
    if (date) commitDates.set(key, date);
    if (commitDates.size > COMMIT_DATES) commitDates.delete(commitDates.keys().next().value as string);
    return date;
  },
  latest: (prUrl) => storage.getLatestAutoReview(prUrl),
  running: (ticketKey) => storage.getRunningAutoReview(ticketKey),
  staleRunning: (before) => storage.getRunningAutoReviewsBefore(before),
  sessionIdle: async (sessionId) => (await storage.countChatMessagesInState(sessionId, ['taken', 'queued'])) === 0,
  get: (id) => storage.getAutoReview(id),
  duePosts: (now) => storage.getDueAutoReviewPosts(now),
  create: (data) => storage.createAutoReview(data),
  update: (id, data) => storage.updateAutoReview(id, data),
  updatePending: (id, data) => storage.updatePendingAutoReview(id, data),
  updateWaitingSkill: (id, data) => storage.updatePendingAutoReview(id, data, WAITING_SKILL),
  openReview: (key, prompt) => orchestratorCron.openReview(key, prompt),
  lessonsFile: (key) => lessonsFileFor(key),
  approve: async (key) => {
    const steps = await lgtmReview(key);
    return steps.length > 0 && steps.every((step) => step.ok);
  },
  push: (message) => eventPush.send('needsYou', message),
  owner: reviewOwner,
  postDiscord: (webhookUrl, content, options) => poster.post(webhookUrl, content, options),
  newestReply: async (sessionId) => (await storage.getNewestChatMessage(sessionId, 'assistant', DISCORD_OPEN))?.text ?? null,
  skills: () => installedSkills(),
  imageRoot: screenshotsOf,
  now: () => new Date(),
});

const previousLedger = orchestratorService.onLedger;
orchestratorService.onLedger = (run) => {
  previousLedger(run);
  void autoReview.ledger(run).catch((error) => console.warn('[AutoReview] verdict failed:', error instanceof Error ? error.message : 'unknown error'));
};
