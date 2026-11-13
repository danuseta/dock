import { StorageService } from '../storage/service';
import { createJiraHttp, type JiraHttp } from './jira-sprint';
import { orchestratorService } from './orchestrator';
import { pullChangesService } from './pull-changes-live';
import { writeQaGuide, type QaGuideDeps } from './qa-guide';
import { sousFlowSettings } from './sous-flow-live';

const storage = new StorageService();
const FRONTEND_REPO = /front|dashboard|widget|(^|-)fe$/i;

async function jira(): Promise<JiraHttp> {
  const settings = await storage.getSettings();
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) throw new Error('Jira credentials are not configured in Settings');
  return createJiraHttp(credentials);
}

/** The files of the ticket's frontend pull requests: the ledger's FE link, or a repository named like a frontend. */
async function frontendFiles(key: string): Promise<string[]> {
  const run = await orchestratorService.get(key);
  const all = await pullChangesService.changes(key);
  const paths: string[] = [];
  for (const pull of all.pulls.filter((item) => item.url === run?.prFe || FRONTEND_REPO.test(item.repo))) {
    const view = (await pullChangesService.changes(key, pull.tab)).pulls.find((item) => item.tab === pull.tab);
    paths.push(...(view?.files ?? []).map((file) => file.path));
  }
  return paths;
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
  frontendFiles,
  menu: async (key) => (await orchestratorService.get(key))?.qaMenu ?? null,
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
};

/** The QA guide wired to Jira with the Settings credentials, the ticket's pull requests and its ledger. */
export const qaGuide = {
  afterUat: (key: string) => writeQaGuide(deps, key),
  write: (key: string) => writeQaGuide(deps, key, true),
};
