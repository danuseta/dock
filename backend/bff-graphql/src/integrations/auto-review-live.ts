import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { AutoReview } from './auto-review';
import { threadService } from './discord-threads';
import { orchestratorService } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { lgtmReview } from './review-approval';

const storage = new StorageService();
const github = new GitHubAPI();

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
