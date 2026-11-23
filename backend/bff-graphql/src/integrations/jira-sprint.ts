import axios from 'axios';
import { atlassianBaseUrl, blockLinks, type JiraCredentials, type TicketLink } from './jira';
import type { SprintEvent, SprintIssue } from './sprint-metrics';

export interface JiraHttp {
  get(url: string, params?: Record<string, unknown>): Promise<any>;
  post(url: string, body: unknown): Promise<any>;
  put?(url: string, body: unknown): Promise<any>;
}

export interface BoardSprint {
  id: number;
  name: string;
  state: 'active' | 'closed';
  startDate: string;
  endDate: string;
  completeDate: string | null;
}

/** A sprint Planning can load: one not started yet, or the active one. A future sprint often has no dates. */
export interface PlanningSprint {
  id: number;
  name: string;
  state: 'active' | 'future';
  startDate: string | null;
  endDate: string | null;
}

/** A ticket as Planning needs it; acRaw is the AC field exactly as Jira returned it (ADF or text). */
export interface PlanningIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  assignee: string | null;
  sp: number | null;
  acRaw: unknown;
  links: TicketLink[];
  /** The parent epic's key. */
  epic?: string | null;
  /** The description as Jira returned it (ADF or text). */
  descriptionRaw?: unknown;
  labels: string[];
  /** The Reference field as Jira returned it (ADF or text). */
  referenceRaw?: unknown;
}

/** The fields a revision reads and writes, as Jira returned them, with the ticket's updated timestamp. */
export interface RevisionIssue {
  key: string;
  summary: string;
  type: string;
  updated: string;
  fields: Record<string, unknown>;
}

export const AC_FIELD = 'customfield_10332';
export const REFERENCE_FIELD = 'customfield_10333';
export const USER_STORY_FIELD = 'customfield_10341';
/** The User Story field older tickets still hold their story in. */
export const OLD_USER_STORY_FIELD = 'customfield_10330';
export const PROBLEM_FIELD = 'customfield_10331';
export const OPEN_TO_CONFIRM_FIELD = 'customfield_10337';
const REVISION_FIELDS = ['summary', 'issuetype', 'updated', USER_STORY_FIELD, OLD_USER_STORY_FIELD, PROBLEM_FIELD, AC_FIELD, REFERENCE_FIELD, OPEN_TO_CONFIRM_FIELD];
const SP_FIELDS = ['story_points', 'customfield_10016', 'customfield_10028', 'customfield_10034'];
const PLANNING_FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'issuelinks', 'parent', 'description', 'labels', AC_FIELD, REFERENCE_FIELD, ...SP_FIELDS];

const TRACKED_FIELDS = new Set(['status', 'labels', 'Sprint', 'Story point estimate', 'assignee']);
const ISSUE_FIELDS = [
  'summary', 'issuetype', 'status', 'assignee', 'labels', 'created',
  'story_points', 'customfield_10016', 'customfield_10028', 'customfield_10034',
];
const PAGE_SIZE = 100;
const MAX_LABEL_PAGES = 10;
const CHANGELOG_CONCURRENCY = 3;
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryOn429(send: () => Promise<any>, sleep: (ms: number) => Promise<void> = sleepMs): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await send()).data;
    } catch (error: any) {
      if (error?.response?.status !== 429 || attempt >= MAX_RETRIES) throw error;
      const retryAfter = Number(error.response.headers?.['retry-after']);
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS) * 1000);
    }
  }
}

export function createJiraHttp(credentials: JiraCredentials, sleep: (ms: number) => Promise<void> = sleepMs): JiraHttp {
  const auth = Buffer.from(`${credentials.email.trim()}:${credentials.apiToken.trim()}`).toString('base64');
  const client = axios.create({
    baseURL: atlassianBaseUrl(credentials.domain),
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return {
    get: (url, params) => retryOn429(() => client.get(url, { params }), sleep),
    post: (url, body) => retryOn429(() => client.post(url, body), sleep),
    put: (url, body) => retryOn429(() => client.put(url, body), sleep),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function historiesToEvents(histories: any[]): SprintEvent[] {
  const events: SprintEvent[] = [];
  for (const history of histories) {
    for (const item of history.items || []) {
      if (!TRACKED_FIELDS.has(item.field)) continue;
      events.push({
        at: history.created,
        by: history.author?.displayName ?? null,
        field: item.field,
        from: item.fromString ?? null,
        to: item.toString ?? null,
      });
    }
  }
  return events;
}

function storyPoints(fields: any): number | null {
  const value = SP_FIELDS.map((field) => fields[field]).find((item) => typeof item === 'number' && !Number.isNaN(item));
  return typeof value === 'number' ? value : null;
}

export function planningIssue(issue: any): PlanningIssue {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    summary: fields.summary || issue.key,
    type: fields.issuetype?.name || '',
    status: fields.status?.name || '',
    assignee: fields.assignee?.displayName ?? null,
    sp: storyPoints(fields),
    acRaw: fields[AC_FIELD] ?? null,
    links: blockLinks(fields.issuelinks),
    epic: typeof fields.parent?.key === 'string' ? fields.parent.key : null,
    descriptionRaw: fields.description ?? null,
    labels: Array.isArray(fields.labels) ? fields.labels.filter((label: unknown): label is string => typeof label === 'string') : [],
    referenceRaw: fields[REFERENCE_FIELD] ?? null,
  };
}

export function compactIssue(issue: any, histories: any[]): SprintIssue {
  const fields = issue.fields || {};
  const spValue = storyPoints(fields);
  return {
    key: issue.key,
    summary: fields.summary || issue.key,
    created: fields.created,
    type: fields.issuetype?.name || '',
    status: fields.status?.name || '',
    assignee: fields.assignee?.displayName ?? null,
    sp: typeof spValue === 'number' ? spValue : null,
    labels: Array.isArray(fields.labels) ? fields.labels.filter((label: unknown): label is string => typeof label === 'string') : [],
    events: historiesToEvents(histories),
  };
}

export class JiraSprintClient {
  constructor(private readonly http: JiraHttp) {}

  async listSprints(boardId: string): Promise<BoardSprint[]> {
    const sprints: BoardSprint[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.http.get(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`, {
        state: 'active,closed', startAt, maxResults: 50,
      });
      for (const sprint of page.values || []) {
        if (!sprint.startDate || !sprint.endDate) continue;
        sprints.push({
          id: sprint.id, name: sprint.name, state: sprint.state === 'active' ? 'active' : 'closed',
          startDate: sprint.startDate, endDate: sprint.endDate, completeDate: sprint.completeDate ?? null,
        });
      }
      if (page.isLast !== false || !(page.values || []).length) return sprints;
      startAt += (page.values || []).length;
    }
  }

  async findBoardId(projectKeys: string[]): Promise<string | null> {
    const boards: Array<{ id: number }> = [];
    for (const key of projectKeys.length ? projectKeys : [undefined]) {
      const page = await this.http.get('/rest/agile/1.0/board', { type: 'scrum', maxResults: 50, ...(key ? { projectKeyOrId: key } : {}) });
      boards.push(...(page.values || []));
    }
    for (const board of boards) {
      const active = await this.http.get(`/rest/agile/1.0/board/${board.id}/sprint`, { state: 'active', maxResults: 1 });
      if ((active.values || []).length) return String(board.id);
    }
    return boards.length ? String(boards[0].id) : null;
  }

  async listPlanningSprints(boardId: string): Promise<PlanningSprint[]> {
    const sprints: PlanningSprint[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.http.get(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`, { state: 'active,future', startAt, maxResults: 50 });
      for (const sprint of page.values || []) {
        sprints.push({
          id: sprint.id, name: sprint.name, state: sprint.state === 'active' ? 'active' : 'future',
          startDate: sprint.startDate ?? null, endDate: sprint.endDate ?? null,
        });
      }
      if (page.isLast !== false || !(page.values || []).length) return sprints;
      startAt += (page.values || []).length;
    }
  }

  /** The sprint's tickets with AC and block links; Epics and sub-tasks are left out. */
  async fetchPlanningIssues(sprintId: number): Promise<PlanningIssue[]> {
    return (await this.searchPlanning(`sprint = ${Number(sprintId)} ORDER BY rank ASC`))
      .filter((issue) => !/^(epic|sub-?task)$/i.test(issue.type));
  }

  /** The keys of the sprint's tickets that are also in a closed sprint: Jira carried them over when that sprint closed. */
  async fetchCarriedKeys(sprintId: number): Promise<string[]> {
    return (await this.searchPlanning(`sprint = ${Number(sprintId)} AND sprint in closedSprints()`)).map((issue) => issue.key);
  }

  /** Status by key, for tickets outside the sprint that an AC line or a link names. */
  async statusesOf(keys: string[]): Promise<Map<string, string>> {
    const safe = keys.filter((key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key));
    const statuses = new Map<string, string>();
    for (let index = 0; index < safe.length; index += PAGE_SIZE) {
      for (const issue of await this.searchPlanning(`key in (${safe.slice(index, index + PAGE_SIZE).join(', ')})`)) statuses.set(issue.key, issue.status);
    }
    return statuses;
  }

  /** The ticket as Jira holds it now; null when it is gone. */
  async planningIssueNow(key: string): Promise<PlanningIssue | null> {
    try {
      return planningIssue(await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: PLANNING_FIELDS.join(',') }));
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  /** The fields a revision may change and the updated timestamp, as Jira holds them now; null when the ticket is not in Jira. */
  async revisionIssueNow(key: string): Promise<RevisionIssue | null> {
    try {
      const issue = await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: REVISION_FIELDS.join(',') });
      const fields = issue?.fields || {};
      return { key: issue.key, summary: fields.summary || '', type: fields.issuetype?.name || '', updated: String(fields.updated ?? ''), fields };
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  /** Writes the given fields of the issue in one edit. */
  async editIssue(key: string, fields: Record<string, unknown>): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }

  /** The account ids of users assignable to the ticket whose display name is exactly `name`. */
  async assignableAccounts(key: string, name: string): Promise<string[]> {
    const users = await this.http.get('/rest/api/3/user/assignable/search', { issueKey: key, query: name, maxResults: 50 });
    const wanted = name.trim().toLowerCase();
    return (Array.isArray(users) ? users : [])
      .filter((user: any) => String(user?.displayName ?? '').trim().toLowerCase() === wanted && typeof user?.accountId === 'string')
      .map((user: any) => user.accountId as string);
  }

  /** The account ids of users assignable in the project whose display name is exactly `name`. */
  async projectAssignableAccounts(project: string, name: string): Promise<string[]> {
    const users = await this.http.get('/rest/api/3/user/assignable/search', { project, query: name, maxResults: 50 });
    const wanted = name.trim().toLowerCase();
    return (Array.isArray(users) ? users : [])
      .filter((user: any) => String(user?.displayName ?? '').trim().toLowerCase() === wanted && typeof user?.accountId === 'string')
      .map((user: any) => user.accountId as string);
  }

  /** Creates an issue from its fields and returns the new key. */
  async createIssue(fields: Record<string, unknown>): Promise<string> {
    const created = await this.http.post('/rest/api/3/issue', { fields });
    if (typeof created?.key !== 'string') throw new Error('Jira created the issue without returning its key');
    return created.key;
  }

  async setAcField(key: string, value: unknown): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: { [AC_FIELD]: value } });
  }

  async setReferenceField(key: string, value: unknown): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: { [REFERENCE_FIELD]: value } });
  }

  /** A Blocks link: `key` is blocked by `blocker`. On create Jira reads inwardIssue as the issue that blocks. */
  async addBlockedBy(key: string, blocker: string): Promise<void> {
    await this.http.post('/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key } });
  }

  /** The account id and display name of the Jira user DOCK's token belongs to. */
  async me(): Promise<{ accountId: string | null; displayName: string | null }> {
    const me = await this.http.get('/rest/api/3/myself');
    return { accountId: typeof me?.accountId === 'string' ? me.accountId : null, displayName: typeof me?.displayName === 'string' ? me.displayName : null };
  }

  /** The issue's whole changelog, oldest first. */
  changelog(key: string): Promise<any[]> {
    return this.fullChangelog(key);
  }

  /** The display name of the Jira user DOCK's token belongs to. */
  async myself(): Promise<string | null> {
    const me = await this.http.get('/rest/api/3/myself');
    return typeof me?.displayName === 'string' ? me.displayName : null;
  }

  /** A comment of plain paragraphs, one per line. */
  async addComment(key: string, lines: string[]): Promise<void> {
    await this.http.post(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      body: { type: 'doc', version: 1, content: lines.filter(Boolean).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) },
    });
  }

  /** A comment another tool reads back: the marker line, then the JSON in a code block (QONFLO-TC, QONFLO-AC-MOVE). */
  async addMarkedComment(key: string, marker: string, json: string): Promise<void> {
    await this.http.post(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }, { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: json }] }] },
    });
  }

  /** The QA bot's test case comment. */
  addTcComment(key: string, marker: string, json: string): Promise<void> {
    return this.addMarkedComment(key, marker, json);
  }

  /** The ticket's comments, oldest first, as Jira returned their bodies. */
  async comments(key: string): Promise<Array<{ created: string; body: unknown }>> {
    const comments: Array<{ created: string; body: unknown }> = [];
    for (let startAt = 0; startAt < 1000; ) {
      const page = await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { startAt, maxResults: PAGE_SIZE, orderBy: 'created' });
      const values = page?.comments || [];
      comments.push(...values.map((comment: any) => ({ created: String(comment.created ?? ''), body: comment.body ?? null })));
      if (!values.length || startAt + values.length >= (page.total ?? 0)) return comments;
      startAt += values.length;
    }
    return comments;
  }

  async removeLabel(key: string, label: string): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { update: { labels: [{ remove: label }] } });
  }

  /** The keys of the token user's tickets that carry `label`. */
  async myLabelledKeys(label: string): Promise<string[]> {
    return (await this.searchPlanning(`labels = "${label.replace(/["\\]/g, '')}" AND assignee = currentUser()`)).map((issue) => issue.key);
  }

  async addLabel(key: string, label: string): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}`, { update: { labels: [{ add: label }] } });
  }

  async setAssignee(key: string, accountId: string): Promise<void> {
    if (!this.http.put) throw new Error('This Jira connection cannot write');
    await this.http.put(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { accountId });
  }

  private async searchPlanning(jql: string): Promise<PlanningIssue[]> {
    const issues: PlanningIssue[] = [];
    let nextPageToken: string | undefined;
    for (let pages = 0; pages === 0 || (nextPageToken && pages < MAX_LABEL_PAGES); pages++) {
      const page = await this.http.post('/rest/api/3/search/jql', { jql, fields: PLANNING_FIELDS, maxResults: PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) });
      issues.push(...(page.issues || []).map(planningIssue));
      nextPageToken = page.nextPageToken;
    }
    return issues;
  }

  private async fullChangelog(key: string): Promise<any[]> {
    const histories: any[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog`, { startAt, maxResults: PAGE_SIZE });
      histories.push(...(page.values || []));
      if (page.isLast || !(page.values || []).length) return histories;
      startAt += page.values.length;
    }
  }

  async fetchSprintIssues(sprintId: number): Promise<SprintIssue[]> {
    return this.fetchIssues(`sprint = ${Number(sprintId)} ORDER BY created ASC`);
  }

  async fetchLabelIssues(label: string, projectKeys: string[] = []): Promise<SprintIssue[]> {
    const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`;
    const scope = projectKeys.length ? ` AND project in (${projectKeys.map(quote).join(', ')})` : '';
    return this.fetchIssues(`labels = ${quote(label)}${scope} ORDER BY created ASC`, MAX_LABEL_PAGES);
  }

  private async fetchIssues(jql: string, maxPages = Infinity): Promise<SprintIssue[]> {
    const raw: any[] = [];
    let nextPageToken: string | undefined;
    for (let pages = 0; pages === 0 || (nextPageToken && pages < maxPages); pages++) {
      const page = await this.http.post('/rest/api/3/search/jql', {
        jql,
        fields: ISSUE_FIELDS,
        expand: 'changelog',
        maxResults: PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      raw.push(...(page.issues || []));
      nextPageToken = page.nextPageToken;
    }
    if (nextPageToken) throw new Error(`Search stopped after ${maxPages} pages with more results left: ${jql}`);

    return mapLimit(raw, CHANGELOG_CONCURRENCY, async (issue) => {
      const changelog = issue.changelog || {};
      const returned: any[] = changelog.histories || [];
      const histories = (changelog.total ?? returned.length) > returned.length
        ? await this.fullChangelog(issue.key)
        : returned;
      return compactIssue(issue, histories);
    });
  }
}
