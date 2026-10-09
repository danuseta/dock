import assert from 'node:assert';
import test from 'node:test';
import { JiraSprintClient, retryOn429, type JiraHttp } from '../integrations/jira-sprint';
import {
  SprintBusyError, SprintDashboardService, SprintInputError, parseSprintConfig,
  type SnapshotRow, type SprintStore,
} from '../integrations/sprint-dashboard';
import { nextRunAt } from '../integrations/sprint-scheduler';
import {
  DEFAULT_SPRINT_CONFIG, buildTrend, computeSprintMetrics,
  type SprintConfig, type SprintEvent, type SprintIssue, type SprintResult,
} from '../integrations/sprint-metrics';

const ANN = 'Ann Alpha';
const BOB = 'Bob Beta';
const config: SprintConfig = {
  ...DEFAULT_SPRINT_CONFIG,
  roster: [
    { full: ANN, short: 'Ann', token: 'annPass' },
    { full: BOB, short: 'Bob', token: 'bobPass' },
  ],
};
const window = { id: 5, name: 'QRD Sprint 5', state: 'active' as const, start: '2026-01-05T02:00:00Z', end: '2026-01-19T02:00:00Z' };

const at = (day: number, hour = 10) => `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000+0800`;
const ev = (when: string, by: string, field: string, from: string | null, to: string | null): SprintEvent => ({ at: when, by, field, from, to });
const status = (when: string, by: string, from: string, to: string) => ev(when, by, 'status', from, to);

const issues: SprintIssue[] = [
  {
    key: 'K-1', summary: 'Carried task', created: '2025-12-15T10:00:00.000+0800', type: 'Task', status: 'UAT MERGED', assignee: ANN, sp: 3, labels: [],
    events: [
      ev('2025-12-20T10:00:00.000+0800', ANN, 'Sprint', '', 'QRD Sprint 4'),
      ev('2026-01-03T10:00:00.000+0800', ANN, 'Sprint', 'QRD Sprint 4', 'QRD Sprint 4, QRD Sprint 5'),
      status(at(6), ANN, 'To Do', 'In Progress'),
      status(at(7), ANN, 'In Progress', 'PR Review'),
      status(at(8), BOB, 'PR Review', 'In Progress'),
      status(at(9), ANN, 'In Progress', 'PR Review'),
      status(at(12), BOB, 'PR Review', 'UAT MERGED'),
    ],
  },
  {
    key: 'K-2', summary: 'Mid-sprint bug', created: at(6, 9), type: 'Bug', status: 'UAT BUG / Improvement', assignee: ANN, sp: 2, labels: ['bobPass'],
    events: [
      ev(at(6, 9), ANN, 'Story point estimate', null, '2'),
      status(at(7), ANN, 'To Do', 'In Progress'),
      status(at(8), ANN, 'In Progress', 'UAT CHECK'),
      ev(at(8, 11), BOB, 'labels', '', 'bobPass'),
      status(at(12), BOB, 'UAT CHECK', 'UAT BUG / Improvement'),
    ],
  },
  {
    key: 'K-3', summary: 'Clean task', created: '2026-01-01T10:00:00.000+0800', type: 'Task', status: 'ReadyForProduction', assignee: BOB, sp: 5, labels: ['annPass'],
    events: [
      status(at(6), BOB, 'To Do', 'In Progress'),
      status(at(7), BOB, 'In Progress', 'PR Review'),
      ev(at(8, 9), ANN, 'labels', '', 'annPass'),
      status(at(8, 11), ANN, 'PR Review', 'UAT MERGED'),
      status(at(9), BOB, 'UAT MERGED', 'UAT CHECK'),
      status(at(12), ANN, 'UAT CHECK', 'ReadyForProduction'),
    ],
  },
  { key: 'K-4', summary: 'Someone else', created: at(6), type: 'Task', status: 'To Do', assignee: 'Out Sider', sp: 8, labels: [], events: [] },
  { key: 'K-5', summary: 'Documentation: handbook', created: at(6), type: 'Task', status: 'To Do', assignee: ANN, sp: 1, labels: [], events: [] },
];

test('computeSprintMetrics applies the sprint rules to a small synthetic sprint', () => {
  const result = computeSprintMetrics(window, issues, config);

  assert.deepStrictEqual(
    { total: result.overview.totalSP, alloc: result.overview.allocated, carry: result.overview.carryover, bug: result.overview.bugSP, devs: result.overview.developers },
    { total: 10, alloc: 5, carry: 3, bug: 2, devs: 2 },
  );
  assert.deepStrictEqual(
    result.notes.excluded.map((e) => [e.key, e.reason]),
    [['K-4', 'not-in-roster'], ['K-5', 'documentation']],
  );

  const ann = result.pr.find((r) => r.dev === 'Ann')!;
  const bob = result.pr.find((r) => r.dev === 'Bob')!;
  assert.deepStrictEqual([ann.passed, ann.reworked, ann.rate], [0, 3, 0], 'K-1 was pushed back from PR Review');
  assert.deepStrictEqual([bob.passed, bob.reworked, bob.rate], [5, 0, 1]);

  const annQa = result.qa.find((r) => r.dev === 'Ann')!;
  assert.deepStrictEqual([annQa.reworked, annQa.rate], [2, 0], 'K-2 bounced from UAT CHECK to UAT BUG');
  assert.strictEqual(result.qa.find((r) => r.dev === 'Bob')!.rate, 1);

  const reviewerBob = result.reviewers.find((r) => r.dev === 'Bob')!;
  assert.deepStrictEqual([reviewerBob.sp, reviewerBob.failedSP, reviewerBob.failRate], [2, 2, 1], 'K-2 bounce is charged to the reviewer who passed it');
  assert.strictEqual(result.reviewers.find((r) => r.dev === 'Ann')!.sp, 5);

  assert.ok(result.flags.some((f) => f.sev === 'R' && f.dev === 'Ann' && f.metric === 'pr'));
});

test('computeSprintMetrics counts a pass label added by someone else separately', () => {
  const tampered = issues.map((i) => i.key !== 'K-3' ? i : {
    ...i,
    events: i.events.map((e) => e.field === 'labels' ? { ...e, by: BOB } : e),
  });
  const result = computeSprintMetrics(window, tampered, config);
  assert.deepStrictEqual(result.notes.nonSelfPass, [{ key: 'K-3', token: 'annPass', by: BOB }]);
  assert.strictEqual(result.reviewers.find((r) => r.dev === 'Ann'), undefined);
});

test('computeSprintMetrics puts unknown statuses in the excluded list instead of throwing', () => {
  const odd = issues.map((i) => i.key === 'K-3' ? { ...i, status: 'Mystery', events: [] } : i);
  const result = computeSprintMetrics(window, odd, config);
  assert.ok(result.notes.excluded.some((e) => e.key === 'K-3' && e.reason === 'unknown-status'));
});

test('buildTrend leaves out developers without load in the two most recent sprints', () => {
  const sprint = (label: string, start: string, rows: Array<[string, number, number | null]>) => ({
    sprint: { label, start },
    roster: config.roster,
    end: rows.map(([dev, total, velocity]) => ({ dev, total, velocity })),
  }) as unknown as SprintResult;
  const trend = buildTrend([
    sprint('QRD3', '2026-01-19T00:00:00Z', [['Ann', 10, 0.5], ['Bob', 0, null]]),
    sprint('QRD1', '2025-12-01T00:00:00Z', [['Ann', 10, 0.25], ['Bob', 8, 0.75]]),
    sprint('QRD2', '2026-01-05T00:00:00Z', [['Ann', 10, 0.4], ['Bob', 0, null]]),
  ]);
  assert.deepStrictEqual(trend.labels, ['QRD1', 'QRD2', 'QRD3']);
  assert.deepStrictEqual(trend.series.map((s) => s.dev), ['Ann']);
  assert.deepStrictEqual(trend.series[0].data, [25, 40, 50]);
});

function fakeHttp(script: (method: string, url: string, payload: any) => any): JiraHttp & { calls: Array<[string, string, any]> } {
  const calls: Array<[string, string, any]> = [];
  return {
    calls,
    get: async (url, params) => { calls.push(['GET', url, params]); return script('GET', url, params); },
    post: async (url, body) => { calls.push(['POST', url, body]); return script('POST', url, body); },
  };
}

test('listSprints pages through the board and skips sprints without dates', async () => {
  const http = fakeHttp((_, __, params) => params.startAt === 0
    ? { isLast: false, values: [{ id: 1, name: 'QRD Sprint 1', state: 'closed', startDate: 'a', endDate: 'b', completeDate: 'c' }, { id: 2, name: 'Future', state: 'future' }] }
    : { isLast: true, values: [{ id: 3, name: 'QRD Sprint 3', state: 'active', startDate: 'd', endDate: 'e' }] });
  const sprints = await new JiraSprintClient(http).listSprints('40');
  assert.deepStrictEqual(sprints.map((s) => [s.id, s.state, s.completeDate]), [[1, 'closed', 'c'], [3, 'active', null]]);
  assert.strictEqual(http.calls[0][1], '/rest/agile/1.0/board/40/sprint');
});

test('fetchSprintIssues follows nextPageToken, keeps tracked events, and reloads truncated changelogs', async () => {
  const issue = (key: string, total: number, histories: any[]) => ({
    key, fields: { summary: key, created: 'c', issuetype: { name: 'Task' }, status: { name: 'To Do' }, assignee: { displayName: ANN }, labels: ['x'], customfield_10016: 3 },
    changelog: { total, histories },
  });
  const history = (field: string, to: string) => ({ created: 't', author: { displayName: ANN }, items: [{ field, fromString: null, toString: to }] });
  const http = fakeHttp((method, url, payload) => {
    if (method === 'POST') {
      return payload.nextPageToken
        ? { issues: [issue('K-2', 1, [history('status', 'Done')])] }
        : { issues: [issue('K-1', 150, [history('status', 'In Progress'), history('summary', 'ignored')])], nextPageToken: 'p2' };
    }
    return { isLast: true, values: [history('status', 'In Progress'), history('labels', 'annPass'), history('Sprint', 'S1')] };
  });
  const result = await new JiraSprintClient(http).fetchSprintIssues(5);

  assert.deepStrictEqual(result.map((r) => r.key), ['K-1', 'K-2']);
  assert.deepStrictEqual(result[0].events.map((e) => e.field), ['status', 'labels', 'Sprint']);
  assert.deepStrictEqual(result[1].events.map((e) => e.field), ['status']);
  assert.strictEqual(result[0].sp, 3);
  assert.strictEqual(result[0].assignee, ANN);
  assert.deepStrictEqual(http.calls.filter((c) => c[0] === 'GET').map((c) => c[1]), ['/rest/api/3/issue/K-1/changelog']);
  assert.strictEqual(http.calls[0][2].jql, 'sprint = 5 ORDER BY created ASC');
  assert.strictEqual(http.calls[0][2].expand, 'changelog');
});

test('retryOn429 waits for Retry-After and gives up on other errors', async () => {
  const waits: number[] = [];
  let attempts = 0;
  const data = await retryOn429(async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('slow down'), { response: { status: 429, headers: { 'retry-after': '2' } } });
    return { data: 'ok' };
  }, async (ms) => { waits.push(ms); });
  assert.strictEqual(data, 'ok');
  assert.deepStrictEqual(waits, [2000]);

  await assert.rejects(
    retryOn429(async () => { throw Object.assign(new Error('nope'), { response: { status: 500 } }); }, async () => undefined),
    /nope/,
  );
});

test('nextRunAt picks the next 06:00 WIB', () => {
  assert.strictEqual(nextRunAt(new Date('2026-01-05T20:00:00Z'), 6).toISOString(), '2026-01-05T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T23:30:00Z'), 6).toISOString(), '2026-01-06T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T23:00:00Z'), 6).toISOString(), '2026-01-06T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T16:59:00Z'), 0).toISOString(), '2026-01-05T17:00:00.000Z');
});

class MemoryStore implements SprintStore {
  settings = new Map<string, string>();
  snapshots = new Map<number, SnapshotRow>();
  events = new Map<number, string>();
  async getSettings() { return [...this.settings].map(([key, value]) => ({ key, value })); }
  async upsertSetting(key: string, value: string) { this.settings.set(key, value); }
  async getSprintSnapshots() { return [...this.snapshots.values()].sort((a, b) => b.startDate.getTime() - a.startDate.getTime()); }
  async getSprintSnapshot(id: number) { return this.snapshots.get(id) ?? null; }
  async upsertSprintSnapshot(data: Partial<SnapshotRow> & { sprintId: number }) {
    const old = this.snapshots.get(data.sprintId);
    this.snapshots.set(data.sprintId, { result: null, computedAt: null, lastError: null, ...old, ...data } as SnapshotRow);
  }
  async getSprintIssueEvents(id: number) { return this.events.has(id) ? { issues: this.events.get(id)! } : null; }
  async upsertSprintIssueEvents(id: number, json: string) { this.events.set(id, json); }
}

const boardSprints = [
  { id: 3, name: 'QRD Sprint 3', state: 'closed' as const, startDate: '2025-12-01T02:00:00Z', endDate: '2025-12-15T02:00:00Z', completeDate: '2025-12-15T03:00:00Z' },
  { id: 4, name: 'QRD Sprint 4', state: 'closed' as const, startDate: '2025-12-15T02:00:00Z', endDate: '2026-01-05T02:00:00Z', completeDate: '2026-01-05T03:00:00Z' },
  { id: 5, name: 'QRD Sprint 5', state: 'active' as const, startDate: window.start, endDate: window.end, completeDate: null },
];

function setup(options: { failFor?: number; delayMs?: number } = {}) {
  const store = new MemoryStore();
  store.settings.set('sprintBoardId', '40');
  store.settings.set('sprintDashboardConfig', JSON.stringify(config));
  const fetched: number[] = [];
  const client = {
    listSprints: async () => boardSprints,
    fetchSprintIssues: async (id: number) => {
      fetched.push(id);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (id === options.failFor) throw new Error('Jira exploded');
      return issues;
    },
  } as unknown as JiraSprintClient;
  const service = new SprintDashboardService(store, async () => client, () => new Date('2026-01-12T00:00:00Z'));
  return { store, service, fetched };
}

test('refresh stores a snapshot and the dashboard reads it back', async () => {
  const { service, store } = setup();
  service.startRefresh(5);
  await service.idle();

  assert.strictEqual(service.refreshState().status, 'idle');
  const dashboard = await service.getDashboard(5);
  assert.strictEqual(dashboard.summary?.computedAt, '2026-01-12T00:00:00.000Z');
  assert.strictEqual(JSON.parse(dashboard.result!).overview.totalSP, 10);
  assert.ok(store.events.has(5));
  assert.strictEqual((await service.getDashboard(null)).summary?.id, 5, 'no id picks the active sprint');
});

test('a second refresh while one is running is rejected', async () => {
  const { service } = setup({ delayMs: 20 });
  service.startRefresh(5);
  assert.throws(() => service.startRefresh(4), SprintBusyError);
  await service.idle();
  assert.doesNotThrow(() => service.startRefresh(4));
  await service.idle();
});

test('a failed refresh records lastError and keeps the previous result', async () => {
  const { service, store } = setup({ failFor: 5 });
  await store.upsertSprintSnapshot({
    sprintId: 5, name: 'QRD Sprint 5', state: 'active', startDate: new Date(window.start), endDate: new Date(window.end), result: '{"old":true}',
  });
  service.startRefresh(5);
  await service.idle();

  assert.strictEqual(service.refreshState().status, 'error');
  assert.match(service.refreshState().error!, /Jira exploded/);
  const row = store.snapshots.get(5)!;
  assert.strictEqual(row.result, '{"old":true}');
  assert.match(row.lastError!, /Jira exploded/);
});

test('refresh without a roster or board id reports why', async () => {
  const { service, store } = setup();
  store.settings.set('sprintDashboardConfig', JSON.stringify({ ...config, roster: [] }));
  service.startRefresh(5);
  await service.idle();
  assert.match(service.refreshState().error!, /roster/);

  store.settings.delete('sprintBoardId');
  service.startRefresh(5);
  await service.idle();
  assert.match(service.refreshState().error!, /board id/);
});

test('backfill skips closed sprints that already have a result and keeps going after a failure', async () => {
  const { service, store, fetched } = setup({ failFor: 3 });
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate), result: '{}',
  });
  service.startBackfill(3);
  await service.idle();

  assert.deepStrictEqual(fetched.sort(), [3, 5]);
  assert.strictEqual(service.refreshState().total, 2);
  assert.match(service.refreshState().error!, /1 sprint\(s\) failed/);
  assert.ok(store.snapshots.get(5)!.result);
});

test('the daily run refreshes the active sprint and finalizes sprints that closed since', async () => {
  const { service, store, fetched } = setup();
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'active', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate),
  });
  await service.runDaily();
  assert.deepStrictEqual(fetched.sort(), [4, 5]);
  assert.strictEqual(store.snapshots.get(4)!.state, 'closed');
});

test('saving settings validates input and recomputes stored sprints with the new roster', async () => {
  const { service, store } = setup();
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).overview.developers, 2);

  await assert.rejects(service.updateSettings('abc', JSON.stringify(config)), SprintInputError);
  await assert.rejects(service.updateSettings('40', 'not json'), SprintInputError);
  await assert.rejects(service.updateSettings('40', JSON.stringify({ roster: [{ full: 'x' }] })), SprintInputError);

  await service.updateSettings('41', JSON.stringify({ ...config, roster: [config.roster[0]] }));
  assert.strictEqual(await service.boardId(), '41');
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).overview.developers, 1);
});

test('issueEvents returns the stored changelog of a sprint, or an empty list', async () => {
  const { service, store } = setup();
  assert.strictEqual(await service.issueEvents(5), '[]');
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(JSON.parse(await service.issueEvents(5)).length, issues.length);
  assert.ok(store.events.has(5));
});

test('parseSprintConfig fills defaults and rejects bad numbers', () => {
  assert.strictEqual(parseSprintConfig(null).loadTarget, 16);
  assert.strictEqual(parseSprintConfig('{"slaDays":3}').slaDays, 3);
  assert.throws(() => parseSprintConfig('{"dailyHour":30}'), SprintInputError);
  assert.throws(() => parseSprintConfig('{"loadTarget":"x"}'), SprintInputError);
});
