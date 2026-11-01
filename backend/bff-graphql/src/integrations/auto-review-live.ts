import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { AutoReview, currentReviews, type PullState } from './auto-review';
import { threadService } from './discord-threads';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { lgtmReview } from './review-approval';

const storage = new StorageService();
const github = new GitHubAPI();

/** How long the Agents list trusts a pull request's state: the page polls, GitHub should not be asked on every poll. */
const LISTED_PULL_MS = 60_000;
const listedPulls = new Map<string, { at: number; state: Promise<PullState> }>();

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

export const AUTO_REVIEW_KEYS = ['autoReviewOnIt', 'autoLgtm'] as const;

export const autoReview = new AutoReview({
  settings: async () => {
    const values = new Map((await storage.getSettingValues([...AUTO_REVIEW_KEYS])).map((row) => [row.key, row.value]));
    return { enabled: values.get('autoReviewOnIt') === 'true', autoLgtm: values.get('autoLgtm') === 'true' };
  },
  rows: async () => [...(await threadService.stored()).values()],
  pull: (owner, repo, number) => github.pullState(owner, repo, number),
  latest: (prUrl) => storage.getLatestAutoReview(prUrl),
  running: (ticketKey) => storage.getRunningAutoReview(ticketKey),
  create: (data) => storage.createAutoReview(data),
  update: (id, data) => storage.updateAutoReview(id, data),
  openReview: (key, prompt) => orchestratorCron.openReview(key, prompt),
  approve: async (key) => {
    const steps = await lgtmReview(key);
    return steps.length > 0 && steps.every((step) => step.ok);
  },
  push: (message) => eventPush.send('needsYou', message),
  now: () => new Date(),
});

orchestratorService.onLedger = (run) => { void autoReview.ledger(run).catch((error) => console.warn('[AutoReview] verdict failed:', error instanceof Error ? error.message : 'unknown error')); };
