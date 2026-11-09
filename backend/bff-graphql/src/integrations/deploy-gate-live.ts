import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { deployGate as computeGate, parseDeployWorkflows, type DeployGate, type GatePull, type WorkflowRun } from './deploy-gate';

const storage = new StorageService();
const github = new GitHubAPI();
export const DEPLOY_WORKFLOWS_SETTING = 'deployWorkflows';
/** The Qonflo repos' UAT deploy workflows, used until Settings deployWorkflows names others. */
export const DEFAULT_DEPLOY_WORKFLOWS: Record<string, string> = {
  'qonekid/ms-admin-worker-backend': 'deploy.uat.yml',
  'qonekid/ms-client-dashboard-frontend': 'deploy-dev.yml',
};

async function client() {
  const c = await github.client();
  if (!c) throw new Error('GitHub token is not configured in Settings');
  return c;
}

async function pulls(key: string): Promise<GatePull[] | null> {
  const cached = await github.cachedPullRequestsForTicket(key);
  const list = cached && cached.length ? cached : (await github.freshPullRequestsForTicket(key)).prs;
  return (list || []).map((p: any) => ({ owner: p.owner, repo: p.repo, number: Number(p.number || p.pullNumber), status: String(p.status || 'open') }));
}

export async function deployGateFor(key: string): Promise<DeployGate> {
  const rows = await storage.getSettingValues([DEPLOY_WORKFLOWS_SETTING]);
  const map = { ...DEFAULT_DEPLOY_WORKFLOWS, ...parseDeployWorkflows(rows.find((row) => row.key === DEPLOY_WORKFLOWS_SETTING)?.value) };
  const gh = await client();
  return computeGate(key, {
    pulls,
    pull: async (owner, repo, number) => {
      const p = await gh.getPRStatus(owner, repo, number);
      return { merged: Boolean(p?.merged_at), mergeSha: p?.merge_commit_sha ?? null, mergedAt: p?.merged_at ?? null, base: String(p?.base?.ref ?? 'develop') };
    },
    workflow: async (fullName) => map[fullName.toLowerCase()] ?? null,
    runs: async (owner, repo, workflow, branch): Promise<WorkflowRun[]> => (await gh.getWorkflowRuns(owner, repo, workflow, branch)).map((r: any) => ({
      headSha: String(r.head_sha), status: String(r.status), conclusion: r.conclusion ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at), url: String(r.html_url),
    })),
    contains: (owner, repo, base, head) => gh.commitContains(owner, repo, base, head),
  });
}
