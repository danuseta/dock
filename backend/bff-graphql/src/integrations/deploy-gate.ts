// Whether a ticket's merged code is deployed, so it may move to UAT CHECK. On QRD-1292 (4 Nov) the QA bot started at 14:32,
// seven seconds after the BE merge, and the BE deploy finished at 14:55: every new endpoint answered 404 and seven test cases
// failed that passed on the next run. A deploy is cumulative, so a merge counts as deployed once any successful run of the
// repo's deploy workflow, on the branch the pull request merged into, ran on a commit that contains the merge commit.

export type DeployState = 'deployed' | 'deploying' | 'failed' | 'not-merged' | 'unknown';

export interface GatePull { owner: string; repo: string; number: number; status: string }
export interface MergedPull { merged: boolean; mergeSha: string | null; mergedAt: string | null; base: string }
export interface WorkflowRun { headSha: string; status: string; conclusion: string | null; createdAt: string; updatedAt: string; url: string }

export interface RepoDeploy {
  repo: string;
  pull: number;
  state: DeployState;
  mergeSha: string | null;
  runUrl: string | null;
  finishedAt: string | null;
  detail: string;
}

export interface DeployGate { key: string; ready: boolean; repos: RepoDeploy[]; summary: string }

export interface DeployGateDeps {
  pulls(key: string): Promise<GatePull[] | null>;
  pull(owner: string, repo: string, number: number): Promise<MergedPull>;
  /** The deploy workflow file of `owner/repo` (Settings `deployWorkflows`), or null when none is set. */
  workflow(fullName: string): Promise<string | null>;
  runs(owner: string, repo: string, workflow: string, branch: string): Promise<WorkflowRun[]>;
  contains(owner: string, repo: string, base: string, head: string): Promise<boolean>;
  /** The branch the deploy workflows run on; default develop. */
  branch?: string;
}

const RUNNING = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

async function repoDeploy(p: GatePull, deps: DeployGateDeps): Promise<RepoDeploy> {
  const fullName = `${p.owner}/${p.repo}`;
  const base: RepoDeploy = { repo: fullName, pull: p.number, state: 'unknown', mergeSha: null, runUrl: null, finishedAt: null, detail: '' };
  if (p.status === 'closed') return { ...base, state: 'not-merged', detail: 'closed without merge; it does not count' };
  const pull = await deps.pull(p.owner, p.repo, p.number);
  if (!pull.merged || !pull.mergeSha) return { ...base, state: 'not-merged', detail: 'not merged yet' };
  const deployBranch = deps.branch ?? 'develop';
  if (pull.base !== deployBranch) return { ...base, state: 'not-merged', mergeSha: pull.mergeSha, detail: `merged into ${pull.base}; it reaches UAT through that branch's own pull request` };
  const merged = { ...base, mergeSha: pull.mergeSha };
  const workflow = await deps.workflow(fullName);
  if (!workflow) return { ...merged, detail: `no deploy workflow set for ${fullName} (Settings deployWorkflows)` };
  const since = pull.mergedAt ? Date.parse(pull.mergedAt) : 0;
  const runs = (await deps.runs(p.owner, p.repo, workflow, pull.base)).filter((r) => Date.parse(r.createdAt) >= since - 60_000);
  // Newest first. The first successful run that contains the merge decides; otherwise a running one; otherwise a failed one.
  let running: WorkflowRun | null = null;
  let failed: WorkflowRun | null = null;
  for (const run of runs) {
    if (!(await deps.contains(p.owner, p.repo, pull.mergeSha, run.headSha))) continue;
    if (run.status === 'completed' && run.conclusion === 'success') {
      return { ...merged, state: 'deployed', runUrl: run.url, finishedAt: run.updatedAt, detail: `${workflow} succeeded` };
    }
    if (RUNNING.has(run.status)) running ??= run;
    else failed ??= run;
  }
  if (running) return { ...merged, state: 'deploying', runUrl: running.url, detail: `${workflow} is ${running.status}` };
  if (failed) return { ...merged, state: 'failed', runUrl: failed.url, finishedAt: failed.updatedAt, detail: `${workflow} ended ${failed.conclusion ?? failed.status}` };
  return { ...merged, state: 'deploying', detail: `${workflow} has not started for this merge yet` };
}

/** Ready only when the ticket has at least one merged pull request and every one of them is deployed. */
export async function deployGate(key: string, deps: DeployGateDeps): Promise<DeployGate> {
  const pulls = await deps.pulls(key);
  if (!pulls || !pulls.length) return { key, ready: false, repos: [], summary: 'no pull request found for this ticket' };
  const repos = await Promise.all(pulls.map((p) => repoDeploy(p, deps).catch((error) => ({
    repo: `${p.owner}/${p.repo}`, pull: p.number, state: 'unknown' as const, mergeSha: null, runUrl: null, finishedAt: null,
    detail: `GitHub refused: ${error instanceof Error ? error.message : 'unknown error'}`,
  }))));
  const counted = repos.filter((r) => !(r.state === 'not-merged' && (r.detail.startsWith('closed') || r.detail.startsWith('merged into'))));
  const ready = counted.length > 0 && counted.every((r) => r.state === 'deployed');
  const summary = ready
    ? `deployed: ${counted.map((r) => `${r.repo}#${r.pull}`).join(', ')}`
    : counted.filter((r) => r.state !== 'deployed').map((r) => `${r.repo}#${r.pull} ${r.state} (${r.detail})`).join('; ') || 'nothing to deploy';
  return { key, ready, repos, summary };
}

/** `{"owner/repo": "workflow.yml"}` from the setting; an unreadable value is no mapping. */
export function parseDeployWorkflows(raw: string | null | undefined): Record<string, string> {
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[\w.-]+\/[\w.-]+$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  } catch {
    return {};
  }
}
