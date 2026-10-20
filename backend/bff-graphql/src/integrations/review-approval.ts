import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { orchestratorService } from './orchestrator';

export const PASS_LABEL = 'pass';

export interface ApprovalStep { name: string; ok: boolean; detail: string }

export interface ApprovalDeps {
  addLabel(key: string, label: string): Promise<void>;
  pullRequests(key: string): Promise<Array<{ owner: string; repo: string; number: number; status: string; url: string }>>;
  approve(owner: string, repo: string, pullNumber: number): Promise<void>;
  event(key: string, kind: string, detail: string | null): Promise<unknown>;
}

const reason = (error: unknown) => {
  const response = (error as { response?: { status?: number; data?: { message?: unknown; errorMessages?: unknown } } })?.response;
  const message = response?.data?.message ?? (Array.isArray(response?.data?.errorMessages) ? response.data.errorMessages.join(' ') : null);
  if (response?.status) return `${response.status}${message ? ` ${String(message)}` : ''}`;
  return error instanceof Error ? error.message : 'unknown error';
};

/**
 * The owner approves a review run: the reviewed Jira ticket gets the `pass` label and each of its open pull requests an
 * APPROVE review on GitHub. Every step reports its own result and lands in the ticket's event list; nothing is retried.
 */
export async function approveReview(key: string, deps: ApprovalDeps, prUrls: string[] = []): Promise<ApprovalStep[]> {
  const steps: ApprovalStep[] = [];
  try {
    await deps.addLabel(key, PASS_LABEL);
    steps.push({ name: `Jira label ${PASS_LABEL}`, ok: true, detail: `added to ${key}` });
  } catch (error) {
    steps.push({ name: `Jira label ${PASS_LABEL}`, ok: false, detail: reason(error) });
  }

  let open: Awaited<ReturnType<ApprovalDeps['pullRequests']>> = [];
  try {
    // The verdict names the pull requests it reviewed; without them the ticket's open ones are looked up.
    const named = prUrls.map((url) => /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url)).filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({ owner: match[1], repo: match[2], number: Number(match[3]), status: 'open', url: match[0] }));
    open = named.length > 0 ? named : (await deps.pullRequests(key)).filter((pr) => pr.status === 'open' || pr.status === 'draft');
    if (open.length === 0) steps.push({ name: 'GitHub approve', ok: false, detail: `no open pull request found for ${key}` });
  } catch (error) {
    steps.push({ name: 'GitHub approve', ok: false, detail: reason(error) });
  }
  for (const pr of open) {
    const name = `GitHub approve ${pr.owner}/${pr.repo}#${pr.number}`;
    try {
      await deps.approve(pr.owner, pr.repo, pr.number);
      steps.push({ name, ok: true, detail: pr.url });
    } catch (error) {
      steps.push({ name, ok: false, detail: reason(error) });
    }
  }

  for (const step of steps) {
    if (!step.ok) console.error(`[Approve] ${key} ${step.name} failed:`, step.detail);
    await deps.event(key, step.ok ? 'APPROVED' : 'APPROVE_FAILED', `${step.name}: ${step.detail}`).catch(() => undefined);
  }
  return steps;
}

const APPROVAL_CACHE = 'review-approval';

/** The outcome of the last approval of each review run, kept so a reload still shows it done. */
export class ApprovalRecords {
  constructor(private readonly storage: {
    getCache(namespace: string, key: string): Promise<unknown>;
    upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): PromiseLike<unknown>;
  } = new StorageService()) {}

  async save(key: string, steps: ApprovalStep[], at = new Date()) {
    await this.storage.upsertCache(APPROVAL_CACHE, key, { at: at.toISOString(), ok: steps.length > 0 && steps.every((step) => step.ok) }, 0);
  }

  /** True when every step of the last approval succeeded. */
  async approved(key: string): Promise<boolean> {
    const saved = await this.storage.getCache(APPROVAL_CACHE, key);
    return typeof saved === 'object' && saved !== null && (saved as { ok?: unknown }).ok === true;
  }
}

export const approvalRecords = new ApprovalRecords();

const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();

export const liveApprovalDeps: ApprovalDeps = {
  addLabel: (key, label) => jiraAPI.addLabel(key, label),
  pullRequests: (key) => githubAPI.getPullRequestsForTicket(key),
  approve: (owner, repo, pullNumber) => githubAPI.approvePullRequest(owner, repo, pullNumber),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
};
