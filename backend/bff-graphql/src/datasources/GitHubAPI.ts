import { StorageAPI } from './StorageAPI';
import { GitHubClient, GitHubService, SearchPRsOptions } from '../integrations/github';
import type { PullRequestProblem } from '../integrations/attention';

const PROBLEM_LABEL: Record<PullRequestProblem, string> = { CONFLICT: 'Merge conflict', PR_CHANGES_REQUESTED: 'Changes requested', PR_CHECKS_FAILING: 'Checks failing' };

export class GitHubAPI {
  private storageAPI: StorageAPI;
  private githubService: GitHubService;
  private authInFlight: Promise<{
    headers: { Authorization: string };
    repos: string;
    hasToken: boolean;
  }> | null = null;

  constructor() {
    this.storageAPI = new StorageAPI();
    this.githubService = new GitHubService();
  }

  private getAuth() {
    if (this.authInFlight) return this.authInFlight;

    const pending = this.storageAPI.getSettings().then((settings) => ({
      headers: {
        Authorization: `Bearer ${settings.githubToken || ''}`,
      },
      repos: settings.githubRepos || '',
      hasToken: !!settings.githubToken,
    })).finally(() => {
      if (this.authInFlight === pending) this.authInFlight = null;
    });

    this.authInFlight = pending;
    return pending;
  }

  async getPullRequestsForTicket(ticketKey: string, options: SearchPRsOptions = {}) {
    try {
      const auth = await this.getAuth();
      if (!auth.hasToken || !auth.repos) return [];
      const items = await this.githubService.searchPRs(
        auth.headers.Authorization.replace('Bearer ', ''),
        auth.repos.split(',').map((repo: string) => repo.trim()).filter(Boolean),
        ticketKey,
        options,
      );
      if (!Array.isArray(items)) return [];
      return items.map((pr: any) => ({
        id: pr.id ? String(pr.id) : `${pr.owner}/${pr.repo}/${pr.number || pr.pullNumber}`,
        title: pr.title || 'Untitled PR',
        url: pr.url || pr.html_url || `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number || pr.pullNumber || 0}`,
        html_url: pr.html_url || pr.url,
        status: pr.status || (pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state || 'open'),
        state: pr.state || pr.status || 'open',
        repo: pr.repo || 'unknown',
        type: pr.type || (pr.mergeable === false ? 'CONFLICT' : 'PR'),
        owner: pr.owner || 'unknown',
        pullNumber: pr.pullNumber || pr.number || 0,
        headSha: pr.headSha || '',
        number: pr.number || pr.pullNumber || 0,
        baseBranch: pr.baseBranch || 'main',
        headBranch: pr.headBranch || '',
        commitsCount: pr.commitsCount || (Array.isArray(pr.commits) ? pr.commits.length : 0),
        commits: Array.isArray(pr.commits) ? pr.commits : [],
        changedFilesCount: pr.changedFilesCount || (Array.isArray(pr.files) ? pr.files.length : 0),
        files: Array.isArray(pr.files) ? pr.files : []
      }));
    } catch (error: any) {
      console.error('[BFF GitHubAPI] Error fetching PRs:', error.response?.status, error.response?.data || error.message);
      return []; // Graceful degradation
    }
  }

  /** Cache read only: the first call for a ticket starts a background refresh and returns nothing. */
  async getPullRequestSignals(ticketKey: string, pullRequests: Array<{ url: string; status: string; owner: string; repo: string; number: number; headSha?: string }>) {
    try {
      const auth = await this.getAuth();
      if (!auth.hasToken) return {};
      return await this.githubService.getPRSignals(auth.headers.Authorization.replace('Bearer ', ''), ticketKey, pullRequests);
    } catch {
      return {};
    }
  }

  async checkConflicts(owner: string, repo: string, pullNumber: number) {
    try {
      const auth = await this.getAuth();
      const token = auth.headers.Authorization.replace('Bearer ', '');
      if (!token) return { hasConflict: false, message: 'GitHub token is not configured.' };
      const resData = await this.githubService.checkConflicts(token, owner, repo, pullNumber);
      const hasConflict = resData.hasConflicts;
      
      let message: string | undefined;
      if (hasConflict) {
        if (Array.isArray(resData.conflictingFiles) && resData.conflictingFiles.length > 0) {
          message = `🚨 Conflicting files detected (${resData.conflictingFiles.length} file${resData.conflictingFiles.length > 1 ? 's' : ''}):\n\n` + resData.conflictingFiles.map((f: string) => `• ${f}`).join('\n');
        } else {
          const changedFiles = typeof resData.changedFiles === 'number' ? ` GitHub reports ${resData.changedFiles} changed file${resData.changedFiles === 1 ? '' : 's'}, but does not identify the exact conflicting file(s).` : '';
          message = `🚨 Git merge conflict detected against target branch.${changedFiles} Please update the branch locally to inspect and resolve it.`;
        }
      } else if (!message) {
        message = `✅ No merge conflicts! The branch is clean and ready to merge.`;
      }

      return { hasConflict, message };
    } catch (error: any) {
      console.error('[BFF GitHubAPI] Error checking conflicts:', error.response?.status, error.response?.data || error.message);
      return { hasConflict: false, message: `Could not inspect conflict: ${error.response?.data?.error || error.message}` };
    }
  }

  /** Submits an APPROVE review; throws when there is no token or GitHub refuses. */
  async approvePullRequest(owner: string, repo: string, pullNumber: number) {
    const auth = await this.getAuth();
    if (!auth.hasToken) throw new Error('GitHub token is not configured in Settings');
    await new GitHubClient(auth.headers.Authorization.replace('Bearer ', '')).approvePullRequest(owner, repo, pullNumber);
  }

  async getNeedsAttention() {
    try {
      const auth = await this.getAuth();
      if (!auth.hasToken || !auth.repos) return [];
      const items = await this.githubService.getNeedsAttention(
        auth.headers.Authorization.replace('Bearer ', ''),
        auth.repos.split(',').map((repo: string) => repo.trim()).filter(Boolean),
      );
      if (!Array.isArray(items)) return [];

      return items.flatMap((item: any) => (item.problems as PullRequestProblem[]).map((type) => ({
        id: `${item.id}-${type}`,
        type,
        message: `${PROBLEM_LABEL[type]} on PR #${item.number}: ${item.title}`,
        ticketKey: item.ticketKey || null,
        prUrl: item.url || '',
        owner: item.owner || null,
        repo: item.repo || null,
        pullNumber: item.number || null,
      })));
    } catch (error: any) {
      console.error('[BFF GitHubAPI] Error getting needs attention:', error.response?.status, error.response?.data || error.message);
      return [];
    }
  }

  async validateGitHub(token?: string) {
    try {
      const stored = await this.getAuth();
      const candidate = token || stored.headers.Authorization.replace('Bearer ', '');
      if (!candidate) throw new Error('GitHub token is required');
      await this.githubService.validateCredentials(candidate);
      return { success: true, message: 'GitHub token valid & connected!' };
    } catch (error: any) {
      const errDetail = error.response?.data?.error || error.message || 'GitHub token invalid';
      console.error(`[BFF] GitHub validation error (${error.response?.status}):`, errDetail);
      return { success: false, message: `GitHub failed: ${errDetail}` };
    }
  }

  async listRepositories(overrideToken?: string) {
    try {
      let token = overrideToken;
      if (!token) {
        const auth = await this.getAuth();
        token = auth.headers.Authorization?.replace('Bearer ', '');
      }
      if (!token) return [];
      return await this.githubService.listRepositories(token);
    } catch (error: any) {
      console.error('[BFF] Error listing repos:', error.response?.status, error.response?.data || error.message);
      return [];
    }
  }
}
