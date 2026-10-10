import axios from 'axios';
import type { JiraCredentials } from './jira';
import type { SprintEvent, SprintIssue } from './sprint-metrics';

export interface JiraHttp {
  get(url: string, params?: Record<string, unknown>): Promise<any>;
  post(url: string, body: unknown): Promise<any>;
}

export interface BoardSprint {
  id: number;
  name: string;
  state: 'active' | 'closed';
  startDate: string;
  endDate: string;
  completeDate: string | null;
}

const TRACKED_FIELDS = new Set(['status', 'labels', 'Sprint', 'Story point estimate', 'assignee']);
const ISSUE_FIELDS = [
  'summary', 'issuetype', 'status', 'assignee', 'labels', 'created',
  'story_points', 'customfield_10016', 'customfield_10028', 'customfield_10034',
];
const PAGE_SIZE = 100;
const CHANGELOG_CONCURRENCY = 3;
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
}

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
    baseURL: `https://${cleanDomain(credentials.domain)}`,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return {
    get: (url, params) => retryOn429(() => client.get(url, { params }), sleep),
    post: (url, body) => retryOn429(() => client.post(url, body), sleep),
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

export function compactIssue(issue: any, histories: any[]): SprintIssue {
  const fields = issue.fields || {};
  const spValue = [fields.story_points, fields.customfield_10016, fields.customfield_10028, fields.customfield_10034]
    .find((value) => typeof value === 'number' && !Number.isNaN(value));
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
    const raw: any[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await this.http.post('/rest/api/3/search/jql', {
        jql: `sprint = ${Number(sprintId)} ORDER BY created ASC`,
        fields: ISSUE_FIELDS,
        expand: 'changelog',
        maxResults: PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      raw.push(...(page.issues || []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);

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
