import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { orchestratorService } from './orchestrator';
import { liveApprovalDeps } from './review-approval';

export interface ReviewedPull { title: string; url: string; owner: string; repo: string; number: number }

export interface PassLabelSyncDeps {
  passLabel(): Promise<string>;
  /** Pull requests of others the owner reviewed, updated on or after the day given as YYYY-MM-DD. */
  reviewed(since: string): Promise<ReviewedPull[]>;
  vote(pull: ReviewedPull): Promise<'APPROVED' | 'CHANGES_REQUESTED' | null>;
  labels(key: string): Promise<string[] | null>;
  addLabel(key: string, label: string): Promise<void>;
  event(key: string, kind: string, detail: string | null): Promise<unknown>;
  /** A pull request already settled for this label, so it costs no GitHub call. */
  settled(url: string, label: string): Promise<boolean>;
  settle(url: string, label: string, ttlSeconds: number): Promise<void>;
  now(): Date;
}

/** How far back an approval still gets its label; the first run after a deploy fills in the ones missed. */
export const PASS_LABEL_LOOKBACK_DAYS = 14;
/** A pull request without an approval is asked again after this long. */
const UNAPPROVED_RECHECK_SECONDS = 30 * 60;

const ticketOf = (title: string) => /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(title.toUpperCase())?.[1] ?? null;

/**
 * The owner approved a teammate's pull request, from DOCK or straight on GitHub: the ticket gets the owner's Pass label.
 * A label that cannot be added stays unsettled and is tried again on the next run. Returns how many labels were added.
 */
export async function syncPassLabels(deps: PassLabelSyncDeps): Promise<number> {
  const label = await deps.passLabel();
  const since = new Date(deps.now().getTime() - PASS_LABEL_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  let added = 0;
  const labelled = new Set<string>();
  for (const pull of await deps.reviewed(since)) {
    const key = ticketOf(pull.title);
    if (!key || labelled.has(key) || await deps.settled(pull.url, label)) continue;
    const labels = await deps.labels(key).catch(() => null);
    if (!labels) continue;
    if (labels.includes(label)) {
      labelled.add(key);
      await deps.settle(pull.url, label, 0);
      continue;
    }
    const vote = await deps.vote(pull).catch(() => undefined);
    if (vote === undefined) continue;
    if (vote !== 'APPROVED') {
      await deps.settle(pull.url, label, UNAPPROVED_RECHECK_SECONDS);
      continue;
    }
    try {
      await deps.addLabel(key, label);
    } catch (error) {
      await deps.event(key, 'APPROVE_FAILED', `Jira label ${label}: ${error instanceof Error ? error.message : 'unknown error'}`).catch(() => undefined);
      continue;
    }
    labelled.add(key);
    added += 1;
    await deps.settle(pull.url, label, 0);
    await deps.event(key, 'APPROVED', `Jira label ${label}: approved on GitHub ${pull.url}`).catch(() => undefined);
  }
  return added;
}

const NAMESPACE = 'pass-label';
const storage = new StorageService();
const github = new GitHubAPI();
const jira = new JiraAPI();

export const livePassLabelSyncDeps: PassLabelSyncDeps = {
  passLabel: () => liveApprovalDeps.passLabel(),
  reviewed: (since) => github.reviewedByMe(since),
  vote: (pull) => github.myVote(pull.owner, pull.repo, pull.number),
  labels: async (key) => (await jira.getTicket(key))?.labels ?? null,
  addLabel: (key, label) => jira.addLabel(key, label),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
  settled: async (url, label) => Boolean(await storage.getCache(NAMESPACE, `${label} ${url}`).catch(() => null)),
  settle: async (url, label, ttlSeconds) => { await storage.upsertCache(NAMESPACE, `${label} ${url}`, true, ttlSeconds); },
  now: () => new Date(),
};
