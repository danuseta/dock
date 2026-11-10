import { StorageService } from '../storage/service';
import { JiraSprintClient, createJiraHttp } from './jira-sprint';
import { SprintInputError, sprintDashboardService } from './sprint-dashboard';
import { SprintDraftService, TC_MARKER, type ContractTarget, type DraftJira } from './sprint-draft';
import { AcDriftService, type DriftJira } from './ac-drift';
import { AcInService, MOVE_PENDING_LABEL, type AcMoveJira } from './ac-move';
import { confluenceFrom, type ConfluenceClient } from './confluence';
import { StoryboardReader } from './storyboard';
import { defaultBlackboardRoot } from './blackboard';
import { CONTRACT_PARENT_KEY } from './sprint-contract';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { readMergeStates } from './merge-state';

const storage = new StorageService();
const github = new GitHubAPI();

async function jiraClient(): Promise<{ client: JiraSprintClient; value: (key: string) => string }> {
  const settings = await storage.getSettings();
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  if (!credentials.domain || !credentials.email || !credentials.apiToken) throw new SprintInputError('Jira credentials are not configured in Settings');
  return { client: new JiraSprintClient(createJiraHttp(credentials)), value };
}

/** Jira for Planning: the credentials in Settings and the board the sprint dashboard uses. */
async function planningJira(): Promise<DraftJira> {
  const { client, value } = await jiraClient();
  const projects = value('jiraProjectKeys').split(',').map((key) => key.trim()).filter(Boolean);
  let boardId = await sprintDashboardService.boardId();
  if (!boardId) boardId = (await client.findBoardId(projects)) || '';
  if (!boardId) throw new SprintInputError('No Scrum board found in Jira for the configured projects');
  return {
    listSprints: () => client.listPlanningSprints(boardId),
    previousSprintEnd: async (sprint) => {
      if (!sprint.startDate) return null;
      const closed = (await client.listSprints(boardId)).filter((item) => item.state === 'closed' && item.startDate < sprint.startDate!);
      return closed.sort((a, b) => b.startDate.localeCompare(a.startDate))[0]?.endDate ?? null;
    },
    sprintIssues: (sprintId) => client.fetchPlanningIssues(sprintId),
    statusesOf: (keys) => client.statusesOf(keys),
    issueNow: (key) => client.planningIssueNow(key),
    assignableAccounts: (key, name) => client.assignableAccounts(key, name),
    setAc: (key, value) => client.setAcField(key, value),
    setAssignee: (key, accountId) => client.setAssignee(key, accountId),
    postTcs: (key, body) => client.addTcComment(key, TC_MARKER, JSON.stringify(body, null, 2)),
  };
}

/** Confluence on the Jira site; no credentials leave it null. */
async function confluence(): Promise<{ client: ConfluenceClient | null; value: (key: string) => string }> {
  const settings = await storage.getSettings();
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value?.trim() || '';
  const credentials = { domain: value('jiraUrl'), email: value('jiraEmail'), apiToken: value('jiraApiToken') };
  const ready = credentials.domain && credentials.email && credentials.apiToken;
  return { client: ready ? confluenceFrom(credentials) : null, value };
}

/** The page the sprint contract goes under. */
async function planningContract(): Promise<ContractTarget> {
  const { client, value } = await confluence();
  return { client, parentId: value(CONTRACT_PARENT_KEY) || null };
}

/** The storyboards, read from Confluence on the Jira site and saved under the blackboard sous reads. */
export const storyboardReader = new StoryboardReader(async () => {
  const { client } = await confluence();
  if (!client) throw new SprintInputError('Jira credentials are not configured in Settings');
  return client;
}, defaultBlackboardRoot);

export const sprintDraftService = new SprintDraftService(storage, planningJira, undefined, undefined, planningContract, (epic) => storyboardReader.sync(epic), (keys) => readMergeStates(keys, github));

/** The owner's side of a published plan, on the same Jira credentials. */
async function driftJira(): Promise<DriftJira> {
  const { client } = await jiraClient();
  return {
    statusesOf: (keys) => client.statusesOf(keys),
    issueNow: (key) => client.planningIssueNow(key),
    setAc: (key, value) => client.setAcField(key, value),
    myself: () => client.myself(),
    comment: (key, lines) => client.addComment(key, lines),
    addLabel: (key, label) => client.addLabel(key, label),
    comments: (key) => client.comments(key),
    markedComment: (key, marker, json) => client.addMarkedComment(key, marker, json),
  };
}

/** The receiving side of an AC move, on the same Jira credentials. */
async function moveJira(): Promise<AcMoveJira> {
  const { client } = await jiraClient();
  return {
    myself: () => client.myself(),
    issueNow: (key) => client.planningIssueNow(key),
    setAc: (key, value) => client.setAcField(key, value),
    pendingMoveKeys: () => client.myLabelledKeys(MOVE_PENDING_LABEL),
    comments: (key) => client.comments(key),
    markedComment: (key, marker, json) => client.addMarkedComment(key, marker, json),
    removeLabel: (key, label) => client.removeLabel(key, label),
  };
}

export const acInService = new AcInService(moveJira);

export const acDriftService = new AcDriftService(storage, (sprint) => sprintDraftService.view(sprint), driftJira);
