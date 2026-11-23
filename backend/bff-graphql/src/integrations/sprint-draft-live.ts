import { StorageService } from '../storage/service';
import { JiraSprintClient, createJiraHttp } from './jira-sprint';
import { SprintInputError, sprintDashboardService } from './sprint-dashboard';
import { SprintDraftService, TC_MARKER, type ContractTarget, type DraftJira, type SplitSource } from './sprint-draft';
import { AcDriftService, type DriftJira } from './ac-drift';
import { AcInService, MOVE_PENDING_LABEL, type AcMoveJira } from './ac-move';
import { confluenceFrom, type ConfluenceClient } from './confluence';
import { StoryboardReader } from './storyboard';
import { PlanningVisualService } from './planning-visual';
import { defaultBlackboardRoot } from './blackboard';
import { CONTRACT_PARENT_KEY } from './sprint-contract';
import { SPLIT_PAGE_KEY, readSplitPage, splitTestLine } from './split-page';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { readMergeStates } from './merge-state';
import { PlanSignalService } from './plan-signal';
import { parseCronSettings } from './orchestrator-cron';
import { TicketSummaryService, acChangedFrom } from './ticket-summary';

const storage = new StorageService();
const github = new GitHubAPI();
const PLAN_SIGNAL_CACHE = 'plan-signal';
const CRON_CONFIG_KEY = 'orchestratorCronConfig';
const SPLIT_CACHE = 'split-page';

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
    carriedKeys: (sprintId) => client.fetchCarriedKeys(sprintId),
    statusesOf: (keys) => client.statusesOf(keys),
    issueNow: (key) => client.planningIssueNow(key),
    assignableAccounts: (key, name) => client.assignableAccounts(key, name),
    setAc: (key, value) => client.setAcField(key, value),
    setAssignee: (key, accountId) => client.setAssignee(key, accountId),
    postTcs: (key, body) => client.addTcComment(key, TC_MARKER, JSON.stringify(body, null, 2)),
    setReference: (key, value) => client.setReferenceField(key, value),
    addBlockedBy: (key, blocker) => client.addBlockedBy(key, blocker),
    testLinkType: () => client.testLinkType(),
    addTestLink: (tester, tested, typeName) => client.addTestLink(tester, tested, typeName),
    addLabel: (key, label) => client.addLabel(key, label),
    removeLabel: (key, label) => client.removeLabel(key, label),
    comment: (key, lines) => client.addComment(key, lines),
    createIssue: (fields) => client.createIssue(fields),
    projectAccounts: (project, name) => client.projectAssignableAccounts(project, name),
    revisionIssue: (key) => client.revisionIssueNow(key),
    editIssue: (key, fields) => client.editIssue(key, fields),
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

/** The publish signal read back from Jira: every DOCK, the planner's or a developer's, sees the plan through it. */
export const planSignalService = new PlanSignalService({
  sprints: async () => (await planningJira()).listSprints(),
  sprintIssues: async (sprintId) => (await planningJira()).sprintIssues(sprintId),
  changelog: async (key) => (await jiraClient()).client.changelog(key),
  myself: async () => (await jiraClient()).client.me(),
  setting: async (key) => (await storage.getSettings()).find((setting) => setting.key === key)?.value ?? null,
  cacheGet: (key) => storage.getCache(PLAN_SIGNAL_CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(PLAN_SIGNAL_CACHE, key, value, 0),
  dockOrder: () => storage.getTicketOrders(),
  cronSettings: async () => parseCronSettings((await storage.getSettings()).find((setting) => setting.key === CRON_CONFIG_KEY)?.value),
  draftStatus: async (sprint) => {
    const row = await storage.getSprintDraft(sprint);
    return row ? { status: row.status, loadedAt: row.loadedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null } : null;
  },
});

/** The split page of Settings, read at Load from Jira and kept per sprint; no page set or no credentials leaves Planning as it was. */
const splitSource: SplitSource = {
  read: async () => {
    const { client, value } = await confluence();
    const page = value(SPLIT_PAGE_KEY);
    return page && client ? readSplitPage(client, page, value(CONTRACT_PARENT_KEY) || null) : null;
  },
  get: (sprint) => storage.getCache(SPLIT_CACHE, sprint),
  save: (sprint, state) => (state ? storage.upsertCache(SPLIT_CACHE, sprint, state, 0) : storage.deleteCache(SPLIT_CACHE, sprint)),
};

/** The Test button of Settings: reads the page as typed, saved or not. */
export async function testSplitPage(page: string): Promise<{ success: boolean; message: string }> {
  const { client, value } = await confluence();
  if (!client) return { success: false, message: 'Jira credentials are not configured in Settings' };
  const state = await readSplitPage(client, page, value(CONTRACT_PARENT_KEY) || null);
  return { success: !state.error, message: splitTestLine(state) };
}

/** The HTML visuals the planning agent made, kept next to the storyboards under the blackboard root. */
export const planningVisuals = new PlanningVisualService(storage, defaultBlackboardRoot);

export const sprintDraftService = new SprintDraftService(storage, planningJira, undefined, undefined, planningContract, (epic) => storyboardReader.sync(epic), (keys) => readMergeStates(keys, github), () => planSignalService.editRefusal(), splitSource, (sprint) => planningVisuals.dropUnsaved(sprint));

/** The owner's side of a published plan, on the same Jira credentials. */
async function driftJira(): Promise<DriftJira> {
  const { client } = await jiraClient();
  return {
    statusesOf: (keys) => client.statusesOf(keys),
    issueNow: (key) => client.planningIssueNow(key),
    setAc: (key, value) => client.setAcField(key, value),
    setReference: (key, value) => client.setReferenceField(key, value),
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

/** The planning agent's ticket summaries and the facts the ticket readiness reads, on the same storage and Jira. */
export const ticketSummaryService = new TicketSummaryService({
  store: storage,
  view: (sprint) => sprintDraftService.view(sprint),
  draftsWith: (keys) => storage.sprintDraftsWithKeys(keys),
  statusesOf: async (keys) => (await jiraClient()).client.statusesOf(keys),
  acChangedAt: async (key) => acChangedFrom(await (await jiraClient()).client.changelog(key)),
});
