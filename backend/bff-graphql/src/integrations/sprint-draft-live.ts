import { StorageService } from '../storage/service';
import { JiraSprintClient, createJiraHttp } from './jira-sprint';
import { SprintInputError, sprintDashboardService } from './sprint-dashboard';
import { SprintDraftService, type DraftJira } from './sprint-draft';

const storage = new StorageService();

/** Jira for Planning: the credentials in Settings and the board the sprint dashboard uses. */
async function planningJira(): Promise<DraftJira> {
  const settings = await storage.getSettings();
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) throw new SprintInputError('Jira credentials are not configured in Settings');
  const client = new JiraSprintClient(createJiraHttp(credentials));
  const projects = value('jiraProjectKeys').split(',').map((key) => key.trim()).filter(Boolean);
  let boardId = await sprintDashboardService.boardId();
  if (!boardId) boardId = (await client.findBoardId(projects)) || '';
  if (!boardId) throw new SprintInputError('No Scrum board found in Jira for the configured projects');
  return {
    listSprints: () => client.listPlanningSprints(boardId),
    sprintIssues: (sprintId) => client.fetchPlanningIssues(sprintId),
    statusesOf: (keys) => client.statusesOf(keys),
    issueNow: (key) => client.planningIssueNow(key),
    assignableAccounts: (key, name) => client.assignableAccounts(key, name),
    setAc: (key, value) => client.setAcField(key, value),
    setAssignee: (key, accountId) => client.setAssignee(key, accountId),
  };
}

export const sprintDraftService = new SprintDraftService(storage, planningJira);
