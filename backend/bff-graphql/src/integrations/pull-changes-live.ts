import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { toOrchestration } from './orchestrator';
import { PullChangesService } from './pull-changes';

const storage = new StorageService();
const githubAPI = new GitHubAPI();
const CACHE = 'pr-changes';

/** The Changes page service wired to GitHub with the Settings token, the run store and the cache table. */
export const pullChangesService = new PullChangesService({
  github: async () => {
    const client = await githubAPI.client();
    return client && {
      pull: (owner, repo, number) => client.getPRStatus(owner, repo, number),
      files: (owner, repo, number, page) => client.getPullFiles(owner, repo, number, page),
      commitDate: (owner, repo, sha) => client.getCommitDate(owner, repo, sha),
      raw: (owner, repo, path, ref) => client.getRawFile(owner, repo, path, ref),
      repo: (owner, repo) => client.getRepo(owner, repo),
    };
  },
  search: async (ticketKey) => (await githubAPI.getPullRequestsForTicket(ticketKey)).map((pull: { url: string }) => pull.url),
  runs: async () => {
    const now = new Date();
    return (await storage.getOrchestratorRuns()).map((row) => toOrchestration(row, now));
  },
  cacheGet: (key) => storage.getCache(CACHE, key),
  cacheSet: (key, value, ttlSeconds) => storage.upsertCache(CACHE, key, value, ttlSeconds),
  now: () => new Date(),
});
