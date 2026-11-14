import assert from 'node:assert/strict';
import test from 'node:test';
import { atlassianBaseUrl } from '../integrations/jira';
import { createJiraHttp, type PlanningIssue, type PlanningSprint } from '../integrations/jira-sprint';
import { DEFAULT_CRON_SETTINGS, OrchestratorCron, candidates, publishWaits, type CronDeps, type CronSettings, type CronTicket } from '../integrations/orchestrator-cron';
import { cronDryRun, inPublishedPlan, isPlanner, labelRevision, planChanges, planLabel, publishWait, revisionOf, sprintRevision, sprintStage, stalePlanLabels } from '../integrations/plan-publish';
import { PlanSignalService, type PlanSignalDeps } from '../integrations/plan-signal';
import { planTriggers, type PlanTicket } from '../integrations/sprint-plan';
import { SprintDraftService, type DraftJira, type DraftStore } from '../integrations/sprint-draft';
import type { SprintDraftInput, SprintDraftTicketInput } from '../storage/service';

const AC = 'Acceptance criteria\n\nThe page shows the plan status.';
const cronTicket = (key: string, labels: string[] = [], over: Partial<CronTicket> = {}): CronTicket => ({ key, title: key, description: AC, status: 'To Do', sprintState: 'ACTIVE', sprintName: 'QRD Sprint 27', labels, ...over });
// The gate ships off (DEFAULT_CRON_SETTINGS); these tests switch it on.
const settings = (over: Partial<CronSettings> = {}): CronSettings => ({ ...DEFAULT_CRON_SETTINGS, waitForPublish: true, planAfterPublish: true, ...over });
const keys = (list: Array<{ key: string }>) => list.map((item) => item.key);

test('plan labels: the revision is the highest plan-published-rN, other labels are ignored', () => {
  assert.equal(planLabel(3), 'plan-published-r3');
  assert.deepEqual([labelRevision('plan-published-r12'), labelRevision('plan-published-r'), labelRevision('#2'), labelRevision('plan-published-rx')], [12, null, null, null]);
  assert.equal(revisionOf(['#1', 'plan-published-r1', 'plan-published-r2']), 2);
  assert.equal(revisionOf(['QRD27']), null);
  assert.equal(inPublishedPlan(['plan-published-r1']), true);
  assert.equal(inPublishedPlan(undefined), false);
  assert.equal(sprintRevision([{ labels: [] }, { labels: ['plan-published-r2'] }, { labels: ['plan-published-r1'] }]), 2);
  assert.equal(sprintRevision([{ labels: ['dock'] }]), null);
  assert.deepEqual(stalePlanLabels(['plan-published-r1', 'dock', 'plan-published-r2'], 2), ['plan-published-r1']);
});

test('the planner: set by display name or account id, case aside; nobody set lets every DOCK plan', () => {
  const alvin = { accountId: 'acc-alvin', displayName: 'Alvin Theofilus Sutikno' };
  assert.equal(isPlanner('', alvin), true);
  assert.equal(isPlanner(null, null), true);
  assert.equal(isPlanner('alvin theofilus sutikno', alvin), true);
  assert.equal(isPlanner('acc-alvin', alvin), true);
  assert.equal(isPlanner('Alvin Theofilus Sutikno', { accountId: 'acc-danu', displayName: 'M Danu Seta W' }), false);
  assert.equal(isPlanner('Alvin', null), false);
});

test('sprint stage: Draft before the first publish, Dipublish after, Jalan once the sprint is active too', () => {
  assert.equal(sprintStage(null, 'active'), 'draft');
  assert.equal(sprintStage(1, 'future'), 'published');
  assert.equal(sprintStage(2, 'active'), 'running');
});

test('republish: a ticket without the label joined after publish; an AC unlike the baseline changed', () => {
  const tickets = [
    { key: 'QRD-1', labels: ['plan-published-r1'], ac: ['A', 'B'] },
    { key: 'QRD-2', labels: ['plan-published-r1'], ac: ['C', 'D'] },
    { key: 'QRD-9001', labels: [], ac: ['E'] },
  ];
  assert.deepEqual(planChanges(tickets, 1, { 'QRD-1': ['A', 'B'], 'QRD-2': ['C'] }), { joined: ['QRD-9001'], acChanged: ['QRD-2'] });
  assert.deepEqual(planChanges(tickets, null, null), { joined: [], acChanged: [] }, 'nothing to republish before the first publish');
  assert.deepEqual(planChanges(tickets, 1, null), { joined: ['QRD-9001'], acChanged: [] });
});

test('cron gate: without a published plan no To Do ticket is a candidate, and each waits with a reason', () => {
  const tickets = [cronTicket('QRD-1'), cronTicket('QRD-2')];
  assert.deepEqual(keys(candidates(tickets, new Set(), new Set(), settings())), []);
  assert.deepEqual(publishWaits(tickets, new Set(), settings()), [
    { key: 'QRD-1', reason: 'waiting for the plan of QRD Sprint 27 to be published' },
    { key: 'QRD-2', reason: 'waiting for the plan of QRD Sprint 27 to be published' },
  ]);
  assert.deepEqual(keys(candidates(tickets, new Set(), new Set(), settings({ waitForPublish: false }))), ['QRD-1', 'QRD-2'], 'the gate switched off works as before');
  assert.deepEqual(publishWaits(tickets, new Set(), settings({ waitForPublish: false })), []);
});

test('cron gate: after publish the plan tickets are candidates; a ticket that joined later is skipped until a republish', () => {
  const tickets = [cronTicket('QRD-1', ['plan-published-r1']), cronTicket('QRD-2', ['plan-published-r1', '#1']), cronTicket('QRD-9001')];
  assert.deepEqual(keys(candidates(tickets, new Set(), new Set(), settings())), ['QRD-2', 'QRD-1']);
  assert.deepEqual(publishWaits(tickets, new Set(), settings()), [{ key: 'QRD-9001', reason: 'outside the published plan r1: joined after publish, waits for a republish' }]);
  assert.equal(publishWait({ labels: ['plan-published-r2'] }, 2), null);
});

test('plan triggers: with requirePublish the Plan session waits for the published plan and maps only its tickets', () => {
  const now = new Date('2026-11-13T03:00:00Z');
  const ticket = (key: string, labels: string[] = []): PlanTicket => ({ key, status: 'To Do', sprintName: 'QRD Sprint 27', sprintState: 'ACTIVE', issueType: 'Task', labels });
  const before = [ticket('QRD-1'), ticket('QRD-2')];
  assert.equal(planTriggers(before, null, now, ['To Do'], true), null, 'nothing starts before publish');
  assert.deepEqual(planTriggers(before, null, now, ['To Do'], false), { kind: 'full', sprint: 'QRD Sprint 27', keys: ['QRD-1', 'QRD-2'] }, 'the old behaviour without the setting');
  const after = [ticket('QRD-1', ['plan-published-r1']), ticket('QRD-2', ['plan-published-r1']), ticket('QRD-9001')];
  assert.deepEqual(planTriggers(after, null, now, ['To Do'], true), { kind: 'full', sprint: 'QRD Sprint 27', keys: ['QRD-1', 'QRD-2'] });
  const mapped = { status: 'idle', mappingKeys: '[]', mappedKeys: '["QRD-1","QRD-2"]', startedAt: null };
  assert.equal(planTriggers(after, mapped, now, ['To Do'], true), null, 'the joined ticket waits for a republish');
  const republished = [...after.slice(0, 2), ticket('QRD-9001', ['plan-published-r2'])];
  assert.deepEqual(planTriggers(republished, mapped, now, ['To Do'], true), { kind: 'ticket', sprint: 'QRD Sprint 27', keys: ['QRD-9001'] });
});

test('base URL: DOCK_ATLASSIAN_BASE_URL replaces https://<domain> when set, nothing changes when it is not', async () => {
  assert.equal(atlassianBaseUrl('mysales.atlassian.net', {}), 'https://mysales.atlassian.net');
  assert.equal(atlassianBaseUrl('https://mysales.atlassian.net/', { DOCK_ATLASSIAN_BASE_URL: '' }), 'https://mysales.atlassian.net');
  assert.equal(atlassianBaseUrl('mysales.atlassian.net', { DOCK_ATLASSIAN_BASE_URL: 'http://localhost:4520/' }), 'http://localhost:4520');
  const saved = process.env.DOCK_ATLASSIAN_BASE_URL;
  const http = await import('node:http');
  const seen: string[] = [];
  const server = http.createServer((request, response) => { seen.push(String(request.url)); response.setHeader('Content-Type', 'application/json'); response.end('{"displayName":"Fake"}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.DOCK_ATLASSIAN_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const client = createJiraHttp({ domain: 'mysales.atlassian.net', email: 'a@b.c', apiToken: 't' });
    assert.deepEqual(await client.get('/rest/api/3/myself'), { displayName: 'Fake' });
    assert.deepEqual(seen, ['/rest/api/3/myself']);
  } finally {
    if (saved === undefined) delete process.env.DOCK_ATLASSIAN_BASE_URL; else process.env.DOCK_ATLASSIAN_BASE_URL = saved;
    server.close();
  }
});

test('dry run is on only for an explicit DOCK_CRON_DRY_RUN', () => {
  assert.equal(cronDryRun({}), false);
  assert.equal(cronDryRun({ DOCK_CRON_DRY_RUN: '1' }), true);
  assert.equal(cronDryRun({ DOCK_CRON_DRY_RUN: 'true' }), true);
  assert.equal(cronDryRun({ DOCK_CRON_DRY_RUN: '0' }), false);
});

function cron(tickets: CronTicket[], dryRun: boolean) {
  const opened: string[] = [];
  const saved: string[] = [];
  const moved: string[] = [];
  const cache = new Map<string, unknown>();
  const config = JSON.stringify({ ...DEFAULT_CRON_SETTINGS, waitForPublish: true, planAfterPublish: true, enabled: true, workDays: [1, 2, 3, 4, 5, 6, 7], workStart: 0, workEnd: 24 });
  const deps: CronDeps = {
    now: () => new Date('2026-11-13T03:00:00Z'),
    settingValue: async () => config,
    saveSetting: async () => undefined,
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    cacheDelete: async (key) => { cache.delete(key); },
    tickets: async () => tickets,
    ticket: async (key) => tickets.find((item) => item.key === key) ?? null,
    moveTicket: async (key) => { moved.push(key); return true; },
    dependencies: async () => [],
    heldKeys: async () => new Set(),
    planWatch: async () => null,
    recordWait: async () => undefined,
    dockOrder: async () => new Map(),
    manualKeys: async () => new Set(),
    slots: async () => ({ busy: 0, waiting: 0 }),
    machines: async () => [],
    online: () => false,
    limitsUsed: () => ({ fiveHour: null, sevenDay: null }),
    takenKeys: async () => [],
    deadStarts: async () => [],
    runs: async () => [],
    saveRun: async (ledger) => { saved.push(String(ledger.key)); },
    park: async () => undefined,
    cronSessions: async () => new Map(),
    openSession: async (input) => { opened.push(input.ticketKey); return { id: `s-${opened.length}` }; },
    machineOptions: async (_machine, options) => options,
    deleteSession: async () => undefined,
    ownerSessionBusy: async () => false,
    send: async () => undefined,
    ownerReplySession: async () => 'new',
    lastTaskSession: async () => null,
    runningSessions: async () => [],
    stopTurn: async () => undefined,
    hasPushDevices: async () => false,
    push: async () => undefined,
    dryRun,
  };
  return { cron: new OrchestratorCron(deps), opened, saved, moved };
}

test('dry run: the fill logs the published tickets it would start and opens, saves and moves nothing', async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const before = cron([cronTicket('QRD-1'), cronTicket('QRD-2')], true);
    const waiting = await before.cron.runFill(true);
    assert.equal(waiting.dryRun, true);
    assert.equal(waiting.skipped, null, 'an offline machine does not stop a dry run');
    assert.deepEqual(waiting.started, []);
    assert.deepEqual(keys(waiting.deferred), ['QRD-1', 'QRD-2']);

    const after = cron([cronTicket('QRD-1', ['plan-published-r1']), cronTicket('QRD-2', ['plan-published-r1']), cronTicket('QRD-9001')], true);
    const log = await after.cron.runFill(true);
    assert.deepEqual(log.started, ['QRD-1', 'QRD-2']);
    assert.deepEqual(log.deferred, [{ key: 'QRD-9001', reason: 'outside the published plan r1: joined after publish, waits for a republish' }]);
    assert.deepEqual([after.opened, after.saved, after.moved], [[], [], []]);
  } finally {
    console.warn = warn;
  }
  const real = cron([cronTicket('QRD-1', ['plan-published-r1'])], false);
  assert.match(String((await real.cron.runFill(true)).skipped), /has no ingest token/, 'a real fill still needs the machine');
});

// ---- Publish and the planner's draft -------------------------------------------------------------------------------

const SPRINT: PlanningSprint = { id: 699, name: 'QRD Sprint 27', state: 'future', startDate: null, endDate: null };
const planning = (key: string, labels: string[] = [], assignee = 'Danu'): PlanningIssue => ({ key, summary: key, type: 'Task', status: 'To Do', assignee, sp: 2, acRaw: '- The line one\n- The line two', links: [], labels });

class Store implements DraftStore {
  draft: any = null;
  settings: Array<{ key: string; value: string }> = [];
  async getSettings() { return this.settings; }
  async getSprintDraft(sprint: string) { return this.draft?.sprint === sprint ? { ...this.draft, tickets: this.draft.tickets.map((ticket: any) => ({ ...ticket })) } : null; }
  async replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]) {
    this.draft = {
      ...draft, status: 'draft', decisions: '{}', qaReason: null, loadedAt: new Date('2026-11-12T00:00:00Z'), publishedAt: null, questions: '[]',
      tickets: tickets.map((ticket, position) => ({ ...ticket, ac: JSON.stringify(ticket.ac), jiraAc: JSON.stringify(ticket.jiraAc), dependsOn: JSON.stringify(ticket.dependsOn), frames: JSON.stringify(ticket.frames ?? []), prediction: null, position })),
    };
  }
  async updateSprintDraftTicket(_sprint: string, key: string, data: any) {
    const ticket = this.draft.tickets.find((item: any) => item.key === key);
    for (const [field, value] of Object.entries(data)) ticket[field] = field === 'ac' || field === 'jiraAc' ? JSON.stringify(value) : value;
  }
  async updateSprintDraft(_sprint: string, data: any) { Object.assign(this.draft, data); }
  async sprintDraftsWithEpic() { return []; }
  async saveSprintDraftPredictions() { return undefined; }
}

class Jira implements DraftJira {
  writes: string[] = [];
  constructor(public issues: PlanningIssue[]) {}
  async listSprints() { return [SPRINT]; }
  async sprintIssues() { return this.issues; }
  async statusesOf() { return new Map<string, string>(); }
  async issueNow(key: string) { return this.issues.find((issue) => issue.key === key) ?? null; }
  async assignableAccounts() { return ['acc']; }
  async setAc(key: string) { this.writes.push(`ac ${key}`); }
  async setAssignee(key: string) { this.writes.push(`assignee ${key}`); }
  async postTcs(key: string) { this.writes.push(`tc ${key}`); }
  async addLabel(key: string, label: string) { this.writes.push(`+${label} ${key}`); }
  async removeLabel(key: string, label: string) { this.writes.push(`-${label} ${key}`); }
  async comment(key: string, lines: string[]) { this.writes.push(`comment ${key}: ${lines.join(' / ')}`); }
}

function draftService(issues: PlanningIssue[], refusal: string | null = null) {
  const store = new Store();
  const jira = new Jira(issues);
  const service = new SprintDraftService(store, async () => jira, async () => ({ predictions: new Map(), reason: null }), () => new Date('2026-11-12T10:00:00Z'), undefined, null, null, async () => refusal);
  return { store, jira, service };
}

test('publish labels every open ticket with the next revision and drops the older label', async () => {
  const { jira, service, store } = draftService([planning('QRD-1'), planning('QRD-2')]);
  await service.load(699, 'Alvin');
  const first = await service.publish('QRD Sprint 27', 'Alvin');
  assert.deepEqual(first.find((result) => result.kind === 'label'), { key: 'Jira labels', kind: 'label', status: 'updated', detail: 'plan-published-r1 on 2 tickets' });
  assert.deepEqual(jira.writes.sort(), ['+plan-published-r1 QRD-1', '+plan-published-r1 QRD-2']);
  assert.equal(store.draft.status, 'published');

  jira.issues = [planning('QRD-1', ['plan-published-r1']), planning('QRD-2', ['plan-published-r1']), planning('QRD-9001')];
  jira.writes = [];
  await service.load(699, 'Alvin');
  await service.publish('QRD Sprint 27', 'Alvin');
  assert.deepEqual(jira.writes.sort(), ['+plan-published-r2 QRD-1', '+plan-published-r2 QRD-2', '+plan-published-r2 QRD-9001', '-plan-published-r1 QRD-1', '-plan-published-r1 QRD-2']);
});

test('a DOCK that is not the planner cannot change, answer or publish the draft', async () => {
  const { service, jira } = draftService([planning('QRD-1')], 'Read-only: only Alvin (the planner) can change or publish the draft');
  await service.load(699, 'Danu');
  await assert.rejects(() => service.publish('QRD Sprint 27', 'Danu'), /only Alvin \(the planner\)/);
  await assert.rejects(() => service.updateTicket('QRD Sprint 27', 'QRD-1', { sp: 3 }), /Read-only/);
  await assert.rejects(() => service.moveCards('QRD Sprint 27', ['QRD-1'], 'Aken'), /Read-only/);
  assert.deepEqual(jira.writes, []);
});

test('an answer from the planning chat is kept on the question, as a draft decision and as a comment on the ticket', async () => {
  const { service, jira, store } = draftService([planning('QRD-1')]);
  await service.load(699, 'Alvin');
  const asked = await service.ask('QRD Sprint 27', 'Keep QRD-1 on Danu?', 'QRD-1', ['Keep it', 'Move it', 'Keep it']);
  const question = asked.questions[0];
  assert.deepEqual(question.options, ['Keep it', 'Move it']);
  const view = await service.answer('QRD Sprint 27', question.id, true, 'Alvin', 'Keep it');
  assert.equal(view.questions[0].answer, 'Keep it');
  assert.equal(JSON.parse(store.draft.decisions)[`q|${question.id}`].note, 'Keep it');
  assert.deepEqual(jira.writes, ['comment QRD-1: Planning QRD Sprint 27: Keep QRD-1 on Danu? / Keputusan: Keep it / Dijawab oleh Alvin di DOCK Planning.']);
  const reopened = await service.answer('QRD Sprint 27', question.id, false, 'Alvin');
  assert.equal(reopened.questions[0].answer, null);
  assert.equal(JSON.parse(store.draft.decisions)[`q|${question.id}`], undefined);
});

test('the plan signal: revision, who published and when, joined and changed tickets, and my work order', async () => {
  const cache = new Map<string, unknown>();
  let issues = [planning('QRD-1', ['plan-published-r1', '#2']), planning('QRD-2', ['plan-published-r1', '#1']), planning('QRD-3', ['plan-published-r1'], 'Aken')];
  const deps: PlanSignalDeps = {
    sprints: async () => [{ ...SPRINT, state: 'active', startDate: '2026-11-13T02:00:00Z' }],
    sprintIssues: async () => issues,
    changelog: async () => [{ created: '2026-11-13T03:00:00Z', author: { displayName: 'Alvin' }, items: [{ field: 'labels', fromString: '#2', toString: '#2 plan-published-r1' }] }],
    myself: async () => ({ accountId: 'acc-danu', displayName: 'Danu' }),
    setting: async () => 'Alvin',
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    dockOrder: async () => new Map(),
    cronSettings: async () => ({ waitForPublish: true, planAfterPublish: true }),
    draftStatus: async () => null,
  };
  const signal = new PlanSignalService(deps);
  const first = (await signal.view('QRD Sprint 27'))!;
  assert.deepEqual([first.stage, first.revision, first.publishedBy, first.publishedAt, first.isPlanner, first.planner], ['running', 1, 'Alvin', '2026-11-13T03:00:00Z', false, 'Alvin']);
  assert.deepEqual(keys(first.myOrder), ['QRD-2', 'QRD-1']);
  assert.deepEqual([first.joined, first.acChanged], [[], []]);
  assert.equal(await signal.editRefusal(), 'Read-only: only Alvin (the planner) can change or publish the draft');

  issues = [{ ...issues[0], acRaw: '- The line one\n- The line two\n- A new line' }, issues[1], issues[2], planning('QRD-9001')];
  const later = (await signal.view('QRD Sprint 27'))!;
  assert.deepEqual([later.joined, later.acChanged, later.myOutside], [['QRD-9001'], ['QRD-1'], ['QRD-9001']]);
});
