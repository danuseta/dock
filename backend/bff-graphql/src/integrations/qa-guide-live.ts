import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { createJiraHttp, type JiraHttp } from './jira-sprint';
import { orchestratorService } from './orchestrator';
import { pullChangesService } from './pull-changes-live';
import { writeQaGuide, type FrontendChange, type QaGuideDeps } from './qa-guide';
import { ROUTE_LIST_PATH } from './qa-guide-routes';
import { sousFlowSettings } from './sous-flow-live';

const storage = new StorageService();
const github = new GitHubAPI();
const FILE_CACHE = 'qa-guide-file';
const FILE_CACHE_SECONDS = 7 * 24 * 3600;
const FRONTEND_REPO = /front|dashboard|widget|(^|-)fe$/i;

async function jira(): Promise<JiraHttp> {
  const settings = await storage.getSettings();
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) throw new Error('Jira credentials are not configured in Settings');
  return createJiraHttp(credentials);
}

/** A file at a commit, read once through the GitHub contents API and kept by commit; null when it cannot be read. */
async function fileAt(owner: string, repo: string, path: string, sha: string): Promise<string | null> {
  const cacheKey = `${owner}/${repo}@${sha}:${path}`;
  const cached = await storage.getCache(FILE_CACHE, cacheKey).catch(() => null) as { text?: string } | null;
  if (typeof cached?.text === 'string') return cached.text;
  const client = await github.client();
  if (!client) return null;
  try {
    const text = await client.getRawFile(owner, repo, path, sha);
    await storage.upsertCache(FILE_CACHE, cacheKey, { text }, FILE_CACHE_SECONDS).catch(() => undefined);
    return text;
  } catch {
    return null;
  }
}

/**
 * What the ticket's frontend pull requests change (the ledger's FE link, or a repository named like a frontend), with
 * the app's route list at the head of the first one.
 */
async function frontend(key: string): Promise<FrontendChange> {
  const run = await orchestratorService.get(key);
  const all = await pullChangesService.changes(key);
  const files: string[] = [];
  let head: { owner: string; repo: string; sha: string } | null = null;
  for (const pull of all.pulls.filter((item) => item.url === run?.prFe || FRONTEND_REPO.test(item.repo))) {
    const view = (await pullChangesService.changes(key, pull.tab)).pulls.find((item) => item.tab === pull.tab);
    files.push(...(view?.files ?? []).map((file) => file.path));
    if (!head && view?.headSha) head = { owner: view.owner, repo: view.repo, sha: view.headSha };
  }
  if (!head) return { files, routeList: null };
  const at = head;
  return {
    files,
    routeList: await fileAt(at.owner, at.repo, ROUTE_LIST_PATH, at.sha),
    readFile: (path) => fileAt(at.owner, at.repo, path, at.sha),
  };
}

const deps: QaGuideDeps = {
  settings: async () => {
    const flow = await sousFlowSettings();
    return { enabled: flow.qaGuide, field: flow.qaGuideField };
  },
  read: async (key, field) => {
    const issue = await (await jira()).get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: field });
    return issue?.fields?.[field] ?? null;
  },
  write: async (key, field, value) => {
    const http = await jira();
    if (!http.put) throw new Error('This Jira connection cannot write');
    await http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: { [field]: value } });
  },
  frontend,
  menu: async (key) => (await orchestratorService.get(key))?.qaMenu ?? null,
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
};

/** The QA guide wired to Jira with the Settings credentials, the ticket's pull requests and its ledger. */
export const qaGuide = {
  afterUat: (key: string) => writeQaGuide(deps, key),
  write: (key: string) => writeQaGuide(deps, key, true),
};
