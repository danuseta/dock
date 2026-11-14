import { StorageService } from '../storage/service';
import { createJiraHttp, type JiraHttp } from './jira-sprint';
import { QaQueueService } from './qa-queue';

const storage = new StorageService();

async function settings() {
  const rows = await storage.getSettings();
  return (key: string) => rows.find((setting) => setting.key === key)?.value || '';
}

async function jira(): Promise<JiraHttp> {
  const value = await settings();
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) throw new Error('Jira credentials are not configured in Settings');
  return createJiraHttp(credentials);
}

export const qaQueueService = new QaQueueService({
  search: async (jql, fields, maxResults, nextPageToken) => {
    const page = await (await jira()).post('/rest/api/3/search/jql', { jql, fields, expand: 'changelog', maxResults, ...(nextPageToken ? { nextPageToken } : {}) });
    return { issues: page?.issues || [], nextPageToken: page?.nextPageToken ?? null };
  },
  count: async (jql) => Number((await (await jira()).post('/rest/api/3/search/approximate-count', { jql }))?.count ?? 0),
  projectKeys: async () => (await settings())('jiraProjectKeys').split(',').map((key) => key.trim()).filter(Boolean),
  me: async () => {
    const me = await (await jira()).get('/rest/api/3/myself');
    return typeof me?.displayName === 'string' ? me.displayName : null;
  },
});
