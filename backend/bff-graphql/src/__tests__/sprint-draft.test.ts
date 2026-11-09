import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraSprintClient, type PlanningIssue, type PlanningSprint } from '../integrations/jira-sprint';
import type { QaInputTicket, QaRun } from '../integrations/qa-predict';
import { SprintDraftService, acValueLines, diffLines, finalAc, rewriteAcValue, type DraftJira, type DraftStore } from '../integrations/sprint-draft';
import type { SprintDraftInput, SprintDraftTicketInput } from '../storage/service';

const adf = (...blocks: any[]) => ({ type: 'doc', version: 1, content: blocks });
const para = (...content: any[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const bullets = (...items: string[]) => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [para(text(item))] })) });

class MemoryStore implements DraftStore {
  draft: any = null;
  settings: Array<{ key: string; value: string }> = [];
  async getSettings() { return this.settings; }
  async getSprintDraft(sprint: string) { return this.draft?.sprint === sprint ? { ...this.draft, tickets: this.draft.tickets.map((ticket: any) => ({ ...ticket })) } : null; }
  async replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]) {
    this.draft = {
      ...draft, status: 'draft', decisions: this.draft?.decisions ?? '{}', qaReason: null, loadedAt: new Date('2026-11-09T00:00:00Z'), publishedAt: null,
      tickets: tickets.map((ticket, position) => ({ ...ticket, ac: JSON.stringify(ticket.ac), jiraAc: JSON.stringify(ticket.jiraAc), dependsOn: JSON.stringify(ticket.dependsOn), prediction: null, position })),
    };
  }
  async updateSprintDraftTicket(_sprint: string, key: string, data: any) {
    const ticket = this.draft.tickets.find((item: any) => item.key === key);
    for (const [field, value] of Object.entries(data)) ticket[field] = field === 'ac' || field === 'jiraAc' ? JSON.stringify(value) : value;
  }
  async updateSprintDraft(_sprint: string, data: any) { Object.assign(this.draft, data); }
  async saveSprintDraftPredictions(_sprint: string, predictions: Map<string, string> | null, qaReason: string | null) {
    this.draft.qaReason = qaReason;
    for (const ticket of this.draft.tickets) ticket.prediction = predictions?.get(ticket.key) ?? null;
  }
}

const SPRINT: PlanningSprint = { id: 26, name: 'QRD Sprint 26', state: 'future', startDate: '2026-10-27T01:00:00.000Z', endDate: '2026-11-09T10:00:00.000Z' };

function issue(key: string, over: Partial<PlanningIssue> = {}): PlanningIssue {
  return { key, summary: `Ticket ${key}`, type: 'Story', status: 'To Do', assignee: 'Danu', sp: 2, acRaw: null, links: [], ...over };
}

class FakeJira implements DraftJira {
  writes: Array<[string, string, unknown]> = [];
  issues: PlanningIssue[];
  now = new Map<string, PlanningIssue>();
  users: Record<string, string[]> = { Aken: ['acc-aken'], Danu: ['acc-danu'] };
  constructor(issues: PlanningIssue[]) { this.issues = issues; }
  async listSprints() { return [SPRINT]; }
  async sprintIssues() { return this.issues; }
  async statusesOf(keys: string[]) { return new Map(keys.filter((key) => key === 'QRD-1363').map((key) => [key, 'Ready for Production'])); }
  async issueNow(key: string) { return this.now.get(key) ?? this.issues.find((item) => item.key === key) ?? null; }
  async assignableAccounts(_key: string, name: string) { return this.users[name] ?? []; }
  async setAc(key: string, value: unknown) { this.writes.push(['ac', key, value]); }
  async setAssignee(key: string, accountId: string) { this.writes.push(['assignee', key, accountId]); }
}

const predictions = (verdicts: Record<string, string>) => async (tickets: QaInputTicket[]): Promise<QaRun> => ({
  predictions: new Map(tickets.filter((ticket) => verdicts[ticket.key]).map((ticket) => [ticket.key, { prediction: verdicts[ticket.key] as any, reasons: ['needs a later ticket'], fix: null }])),
  reason: null,
});

function setup(verdicts: Record<string, string> = {}) {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-1489', { assignee: 'Aken', sp: 5, acRaw: adf(bullets('The client edits the skill', 'Changes wait for Publish')) }),
    issue('QRD-1511', { sp: 3, acRaw: adf(para(text('Cursor shows', [{ type: 'strong' }])), bullets('An Edit client sees the cursor (QRD-1490)', 'Works after QRD-1363')) }),
    issue('QRD-1490', { assignee: 'Aken', sp: 8, acRaw: '- Edits wait for the owner\n- Owner publishes', links: [{ key: 'QRD-1489', relation: 'blockedBy' }] }),
  ]);
  let seen: QaInputTicket[] = [];
  const predict = async (tickets: QaInputTicket[]) => { seen = tickets; return predictions(verdicts)(tickets); };
  const service = new SprintDraftService(store, async () => jira, predict, () => new Date('2026-11-09T10:00:00Z'));
  return { store, jira, service, seen: () => seen };
}

test('the Jira client lists open sprints, leaves Epics out and resolves an assignee by exact name', async () => {
  const calls: Array<[string, string, unknown]> = [];
  const http = {
    get: async (url: string, params?: Record<string, unknown>) => {
      calls.push(['get', url, params]);
      if (url.endsWith('/sprint')) return { isLast: true, values: [{ id: 27, name: 'Sprint 27', state: 'future' }, { id: 26, name: 'Sprint 26', state: 'active', startDate: 'a', endDate: 'b' }] };
      return [{ displayName: 'Danu', accountId: 'acc-1' }, { displayName: 'Danu Seta', accountId: 'acc-2' }];
    },
    post: async (url: string, body: unknown) => {
      calls.push(['post', url, body]);
      return { issues: [
        { key: 'QRD-1', fields: { summary: 'One', issuetype: { name: 'Story' }, status: { name: 'To Do' }, customfield_10332: 'x', customfield_10016: 3, issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'QRD-2' } }] } },
        { key: 'QRD-9', fields: { summary: 'Epic', issuetype: { name: 'Epic' }, status: { name: 'To Do' } } },
      ] };
    },
    put: async (url: string, body: unknown) => { calls.push(['put', url, body]); },
  };
  const client = new JiraSprintClient(http);
  assert.deepEqual(await client.listPlanningSprints('7'), [
    { id: 27, name: 'Sprint 27', state: 'future', startDate: null, endDate: null },
    { id: 26, name: 'Sprint 26', state: 'active', startDate: 'a', endDate: 'b' },
  ]);
  assert.deepEqual(calls[0][2], { state: 'active,future', startAt: 0, maxResults: 50 });
  assert.deepEqual(await client.fetchPlanningIssues(26), [
    { key: 'QRD-1', summary: 'One', type: 'Story', status: 'To Do', assignee: null, sp: 3, acRaw: 'x', links: [{ key: 'QRD-2', relation: 'blockedBy' }] },
  ]);
  assert.deepEqual(await client.assignableAccounts('QRD-1', 'danu'), ['acc-1']);
  await client.setAcField('QRD-1', 'y');
  await client.setAssignee('QRD-1', 'acc-1');
  assert.deepEqual(calls.slice(-2), [['put', '/rest/api/3/issue/QRD-1', { fields: { customfield_10332: 'y' } }], ['put', '/rest/api/3/issue/QRD-1/assignee', { accountId: 'acc-1' }]]);
});

test('the AC field reads into lines from ADF and from text', () => {
  assert.deepEqual(acValueLines(adf(para(text('One'), { type: 'hardBreak' }, text('Two')), bullets('- Three'), { type: 'codeBlock', content: [text('a\nb')] })), ['One', 'Two', 'Three', 'a', 'b']);
  assert.deepEqual(acValueLines('1. One\n\n- Two'), ['One', 'Two']);
  assert.deepEqual(acValueLines(null), []);
  assert.deepEqual(diffLines(['a', 'b', 'b'], ['b', 'c']), { removed: ['a', 'b'], added: ['c'] });
});

test('a rewrite keeps Jira format: ADF keeps other nodes and marks, text keeps its bullets', () => {
  const doc = adf(para(text('Cursor shows', [{ type: 'strong' }]), { type: 'hardBreak' }, text('Gone line')), bullets('Keep', 'Remove me'));
  const out: any = rewriteAcValue(doc, ['Gone line', 'Remove me'], ['Moved in']);
  assert.deepEqual(out.content[0], para(text('Cursor shows', [{ type: 'strong' }])));
  assert.deepEqual(out.content[1], bullets('Keep', 'Moved in'));
  assert.deepEqual(acValueLines(rewriteAcValue(adf(para(text('Only'))), ['Only'], [])), []);
  assert.equal(rewriteAcValue('- one\n- two', ['two'], ['three']), '- one\n- three');
  assert.equal(rewriteAcValue('one', [], ['two']), 'one\ntwo');
  assert.deepEqual(rewriteAcValue(null, [], ['New']), adf(bullets('New')));
  assert.throws(() => rewriteAcValue('- one', ['missing'], []), /AC line not found in Jira: missing/);
});

test('decisions move a line to the ticket it needs or drop it', () => {
  const lines = finalAc([{ key: 'A', ac: ['x needs B', 'y needs B', 'z'] }, { key: 'B', ac: ['b1'] }], {
    'ac|A|B|x needs B': { action: 'move', note: null, by: null, at: '' },
    'ac|A|B|y needs B': { action: 'drop', note: null, by: null, at: '' },
    'ac|A|C|z': { action: 'wait', note: null, by: null, at: '' },
  });
  assert.deepEqual(Object.fromEntries(lines), { A: ['z'], B: ['b1', 'x needs B'] });
});

test('a load schedules the sprint, finds the after-it line and gives the QA bot the plan', async () => {
  const { service, seen } = setup({ 'QRD-1511': 'ESCALATED' });
  const view = await service.load(26, 'Alvin');
  assert.deepEqual([view.sprint, view.sprintDays, view.createdBy, view.status], ['QRD Sprint 26', 10, 'Alvin', 'draft']);
  const byKey = Object.fromEntries(view.tickets.map((ticket) => [ticket.key, ticket]));
  assert.deepEqual([byKey['QRD-1489'].start, byKey['QRD-1489'].end, byKey['QRD-1489'].split], [0, 2.5, [3, 2]]);
  assert.deepEqual([byKey['QRD-1490'].start, byKey['QRD-1490'].end, byKey['QRD-1490'].wave, byKey['QRD-1490'].inSprint], [2.5, 6.5, 2, true]);
  assert.deepEqual(view.findings.map((finding) => [finding.key, finding.line, finding.refKey, finding.kind]), [
    ['QRD-1511', 2, 'QRD-1490', 'after-it'],
    ['QRD-1511', 3, 'QRD-1363', 'lands-first'],
  ]);
  assert.equal(byKey['QRD-1511'].prediction?.prediction, 'ESCALATED');
  assert.deepEqual(view.blockers, ['ac|QRD-1511|QRD-1490|An Edit client sees the cursor (QRD-1490)', 'qa|QRD-1511']);
  assert.equal(view.canPublish, false);
  assert.deepEqual(seen().find((ticket) => ticket.key === 'QRD-1511')!.waitsOn, [{ key: 'QRD-1490', endDay: 6.5 }, { key: 'QRD-1363', endDay: null }]);
});

test('publish is held until every blocker has a decision, and a decision is checked', async () => {
  const { service } = setup({ 'QRD-1511': 'ESCALATED' });
  const view = await service.load(26, 'Alvin');
  await assert.rejects(service.publish('QRD Sprint 26'), /2 AC line or QA prediction still needs a decision/);
  await assert.rejects(service.decide('QRD Sprint 26', view.blockers[0], 'ship', null, 'Alvin'), /moved, kept to wait, or dropped/);
  await assert.rejects(service.decide('QRD Sprint 26', 'qa|QRD-1511', 'fix', ' ', 'Alvin'), /Say what was fixed/);
  await service.decide('QRD Sprint 26', view.blockers[0], 'move', null, 'Alvin');
  const decided = await service.decide('QRD Sprint 26', 'qa|QRD-1511', 'accept', null, 'Alvin');
  assert.equal(decided.canPublish, true);
  assert.equal(decided.findings[0].decision?.action, 'move');
  assert.equal((await service.decide('QRD Sprint 26', 'qa|QRD-1511', 'clear', null, 'Alvin')).canPublish, false);
});

test('preview lists only what differs from Jira, and publish writes it in Jira format', async () => {
  const { service, jira, store } = setup();
  const view = await service.load(26, 'Alvin');
  await service.decide('QRD Sprint 26', view.findings[0].id, 'move', null, 'Alvin');
  await service.updateTicket('QRD Sprint 26', 'QRD-1489', { dev: 'Danu' });
  await service.updateTicket('QRD Sprint 26', 'QRD-1511', { wave: 3, sp: 2 });
  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual(preview, [
    { key: 'QRD-1489', assigneeFrom: 'Aken', assigneeTo: 'Danu', acRemoved: [], acAdded: [], refused: null },
    { key: 'QRD-1511', assigneeFrom: null, assigneeTo: null, acRemoved: ['An Edit client sees the cursor (QRD-1490)'], acAdded: [], refused: null },
    { key: 'QRD-1490', assigneeFrom: null, assigneeTo: null, acRemoved: [], acAdded: ['An Edit client sees the cursor (QRD-1490)'], refused: null },
  ]);
  assert.deepEqual(jira.writes, [], 'preview writes nothing');

  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(results.map((result) => [result.key, result.status]), [['QRD-1489', 'updated'], ['QRD-1511', 'updated'], ['QRD-1490', 'updated'], ['Confluence', 'skipped']]);
  assert.deepEqual(jira.writes[0], ['assignee', 'QRD-1489', 'acc-danu']);
  assert.deepEqual(jira.writes[1], ['ac', 'QRD-1511', adf(para(text('Cursor shows', [{ type: 'strong' }])), bullets('Works after QRD-1363'))]);
  assert.deepEqual(jira.writes[2], ['ac', 'QRD-1490', '- Edits wait for the owner\n- Owner publishes\n- An Edit client sees the cursor (QRD-1490)']);
  assert.equal(store.draft.status, 'published');
  assert.deepEqual(JSON.parse(store.draft.tickets.find((ticket: any) => ticket.key === 'QRD-1490').jiraAc), ['Edits wait for the owner', 'Owner publishes', 'An Edit client sees the cursor (QRD-1490)']);
});

test('publish refuses a ticket whose AC changed in Jira since load and names an assignee it cannot resolve', async () => {
  const { service, jira, store } = setup();
  const view = await service.load(26, 'Alvin');
  await service.decide('QRD Sprint 26', view.findings[0].id, 'drop', null, 'Alvin');
  await service.updateTicket('QRD Sprint 26', 'QRD-1490', { dev: 'Nobody' });
  jira.now.set('QRD-1511', issue('QRD-1511', { acRaw: '- Someone else edited this' }));
  const preview = await service.preview('QRD Sprint 26');
  assert.equal(preview.find((change) => change.key === 'QRD-1511')!.refused, 'The AC changed in Jira after it was loaded; load the sprint again');
  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(results, [
    { key: 'QRD-1511', kind: 'ticket', status: 'refused', detail: 'The AC changed in Jira after it was loaded; load the sprint again' },
    { key: 'QRD-1490', kind: 'ticket', status: 'failed', detail: 'No assignable Jira user is named Nobody' },
    { key: 'Confluence', kind: 'contract', status: 'skipped', detail: 'No Confluence parent page is set (Settings planningConfluenceParent); the contract page was not written' },
  ]);
  assert.deepEqual(jira.writes, []);
  assert.equal(store.draft.status, 'draft');
});

test('ticket changes are checked and the SP per day setting changes the schedule', async () => {
  const { service, store } = setup();
  await service.load(26, 'Alvin');
  await assert.rejects(service.updateTicket('QRD Sprint 26', 'QRD-9', { dev: 'Ana' }), /QRD-9 is not in the QRD Sprint 26 draft/);
  await assert.rejects(service.updateTicket('QRD Sprint 26', 'QRD-1511', { wave: 1.5 }), /Wave must be a whole number/);
  const edited = await service.updateTicket('QRD Sprint 26', 'QRD-1511', { ac: ['- First', '  ', 'Second (QRD-1489)'] });
  assert.deepEqual(edited.tickets.find((ticket) => ticket.key === 'QRD-1511')!.ac, ['First', 'Second (QRD-1489)']);
  store.settings = [{ key: 'planningSpPerDay', value: '4' }];
  assert.equal((await service.view('QRD Sprint 26'))!.tickets.find((ticket) => ticket.key === 'QRD-1490')!.dur, 2);
  assert.equal(await service.view('QRD Sprint 99'), null);
});

test('tickets already past merge stay out of the schedule and the AC check, and a line naming one lands first', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-1', { status: 'Done / MERGED', sp: 8 }),
    issue('QRD-2', { status: 'ReadyForProduction', sp: 8 }),
    issue('QRD-3', { acRaw: '- Opens the page built in QRD-1\n- Works with QRD-2' }),
  ]);
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-11-09T10:00:00Z'));
  const view = await service.load(26, 'Danu');
  assert.deepEqual(view.tickets.map((ticket) => ticket.key), ['QRD-3']);
  assert.equal(view.landed, 2);
  assert.equal(view.tickets[0].start, 0);
  assert.deepEqual(view.findings.map((finding) => [finding.refKey, finding.kind]), [['QRD-1', 'lands-first'], ['QRD-2', 'lands-first']]);
  assert.equal(view.canPublish, true);
});
