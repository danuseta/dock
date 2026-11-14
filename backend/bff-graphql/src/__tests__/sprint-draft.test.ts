import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraSprintClient, type PlanningIssue, type PlanningSprint } from '../integrations/jira-sprint';
import type { QaInputTicket, QaRun } from '../integrations/qa-predict';
import { SprintDraftService, TC_MARKER, acSideEffects, acValueLines, diffLines, finalAc, rewriteAcValue, type DraftJira, type DraftStore } from '../integrations/sprint-draft';
import type { SprintDraftInput, SprintDraftTicketInput } from '../storage/service';
import { StoryboardMissing } from '../integrations/storyboard';

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
      tickets: tickets.map((ticket, position) => ({ ...ticket, ac: JSON.stringify(ticket.ac), jiraAc: JSON.stringify(ticket.jiraAc), dependsOn: JSON.stringify(ticket.dependsOn), frames: JSON.stringify(ticket.frames ?? []), prediction: null, position })),
    };
  }
  async updateSprintDraftTicket(_sprint: string, key: string, data: any) {
    const ticket = this.draft.tickets.find((item: any) => item.key === key);
    for (const [field, value] of Object.entries(data)) ticket[field] = field === 'ac' || field === 'jiraAc' ? JSON.stringify(value) : value;
  }
  async updateSprintDraft(_sprint: string, data: any) { Object.assign(this.draft, data); }
  async sprintDraftsWithEpic(epic: string) { return this.draft?.tickets.some((ticket: any) => ticket.epic === epic) ? [this.draft.sprint] : []; }
  async saveSprintDraftPredictions(_sprint: string, predictions: Map<string, string> | null, qaReason: string | null) {
    this.draft.qaReason = qaReason;
    for (const ticket of this.draft.tickets) ticket.prediction = predictions?.get(ticket.key) ?? null;
  }
}

const SPRINT: PlanningSprint = { id: 26, name: 'QRD Sprint 26', state: 'future', startDate: '2026-10-27T01:00:00.000Z', endDate: '2026-11-09T10:00:00.000Z' };

function issue(key: string, over: Partial<PlanningIssue> = {}): PlanningIssue {
  return { key, summary: `Ticket ${key}`, type: 'Story', status: 'To Do', assignee: 'Danu', sp: 2, acRaw: null, links: [], labels: [], ...over };
}

class FakeJira implements DraftJira {
  previousSprintEnd?: DraftJira['previousSprintEnd'];
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
  async postTcs(key: string, body: unknown) { this.writes.push(['tc', key, body]); }
  async setReference(key: string, value: unknown) { this.writes.push(['reference', key, value]); }
  async addBlockedBy(key: string, blocker: string) { this.writes.push(['link', key, blocker]); }
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
  const service = new SprintDraftService(store, async () => jira, predict, () => new Date('2026-10-26T10:00:00Z'));
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
    { key: 'QRD-1', summary: 'One', type: 'Story', status: 'To Do', assignee: null, sp: 3, acRaw: 'x', links: [{ key: 'QRD-2', relation: 'blockedBy' }], epic: null, descriptionRaw: null, labels: [], referenceRaw: null },
  ]);
  assert.deepEqual(await client.assignableAccounts('QRD-1', 'danu'), ['acc-1']);
  await client.setAcField('QRD-1', 'y');
  await client.setAssignee('QRD-1', 'acc-1');
  assert.deepEqual(calls.slice(-2), [['put', '/rest/api/3/issue/QRD-1', { fields: { customfield_10332: 'y' } }], ['put', '/rest/api/3/issue/QRD-1/assignee', { accountId: 'acc-1' }]]);
  await client.setReferenceField('QRD-1', 'r');
  await client.addBlockedBy('QRD-1', 'QRD-2');
  assert.deepEqual(calls.slice(-2), [
    ['put', '/rest/api/3/issue/QRD-1', { fields: { customfield_10333: 'r' } }],
    ['post', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: 'QRD-2' }, outwardIssue: { key: 'QRD-1' } }],
  ]);
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

test('decisions move a line to the ticket it needs or send it to Reference; older wait and drop read as dependency and reference', () => {
  const lines = finalAc([{ key: 'A', ac: ['x needs B', 'y needs B', 'z'] }, { key: 'B', ac: ['b1'] }], {
    'ac|A|B|x needs B': { action: 'move', note: null, by: null, at: '' },
    'ac|A|B|y needs B': { action: 'drop', note: null, by: null, at: '' },
    'ac|A|C|z': { action: 'wait', note: null, by: null, at: '' },
  });
  assert.deepEqual(Object.fromEntries(lines), { A: ['z'], B: ['b1', 'x needs B'] });
  const sides = acSideEffects([{ key: 'A', ac: ['x needs B', 'y needs B', 'z needs C'] }], {
    'ac|A|B|y needs B': { action: 'drop', note: null, by: null, at: '' },
    'ac|A|C|z needs C': { action: 'wait', note: null, by: null, at: '' },
    'ac|A|B|gone needs B': { action: 'reference', note: null, by: null, at: '' },
  });
  assert.deepEqual(sides.get('A'), { reference: ['B: y needs B'], blockedBy: ['C'] }, 'a line no longer in AC writes nothing');
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
  assert.equal(view.canPublish, true, 'blockers are shown, they do not hold publish');
  assert.deepEqual(seen().find((ticket) => ticket.key === 'QRD-1511')!.waitsOn, [{ key: 'QRD-1490', endDay: 6.5 }, { key: 'QRD-1363', endDay: null }]);
});

test('a decision is checked and clears its blocker, and publish goes ahead with blockers still open', async () => {
  const { service, store } = setup({ 'QRD-1511': 'ESCALATED' });
  const view = await service.load(26, 'Alvin');
  await assert.rejects(service.decide('QRD Sprint 26', view.blockers[0], 'ship', null, 'Alvin'), /is a dependency, moves to Reference, or moves to the ticket that builds it/);
  await assert.rejects(service.decide('QRD Sprint 26', 'qa|QRD-1511', 'fix', ' ', 'Alvin'), /Say what was fixed/);
  await service.decide('QRD Sprint 26', view.blockers[0], 'move', null, 'Alvin');
  const decided = await service.decide('QRD Sprint 26', 'qa|QRD-1511', 'accept', null, 'Alvin');
  assert.deepEqual(decided.blockers, []);
  assert.equal(decided.findings[0].decision?.action, 'move');
  assert.deepEqual((await service.decide('QRD Sprint 26', 'qa|QRD-1511', 'clear', null, 'Alvin')).blockers, ['qa|QRD-1511']);
  const results = await service.publish('QRD Sprint 26');
  assert.ok(results.some((result) => result.kind === 'ticket' && result.status === 'updated'), 'an open QA blocker does not refuse publish');
  assert.equal(store.draft.status, 'published');
});

test('a scope cut is written as the scope|cut decision and needs its text', async () => {
  const { service } = setup();
  assert.equal((await service.load(26, 'Alvin')).scopeCut, null);
  await assert.rejects(service.decide('QRD Sprint 26', 'scope|cut', 'cut', '  ', 'Alvin'), /Write what leaves the sprint/);
  await assert.rejects(service.decide('QRD Sprint 26', 'scope|cut', 'drop', 'QRD-1490', 'Alvin'), /action cut/);
  const cut = await service.decide('QRD Sprint 26', 'scope|cut', 'cut', 'QRD-1490 moves to Sprint 27', 'Alvin');
  assert.deepEqual([cut.scopeCut?.action, cut.scopeCut?.note, cut.scopeCut?.by], ['cut', 'QRD-1490 moves to Sprint 27', 'Alvin']);
  assert.equal((await service.decide('QRD Sprint 26', 'scope|cut', 'clear', null, 'Alvin')).scopeCut, null);
});

test('preview lists only what differs from Jira, and publish writes it in Jira format', async () => {
  const { service, jira, store } = setup();
  const view = await service.load(26, 'Alvin');
  await service.decide('QRD Sprint 26', view.findings[0].id, 'move', null, 'Alvin');
  await service.updateTicket('QRD Sprint 26', 'QRD-1489', { dev: 'Danu' });
  await service.updateTicket('QRD Sprint 26', 'QRD-1511', { wave: 3, sp: 2 });
  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual(preview, [
    { key: 'QRD-1489', assigneeFrom: 'Aken', assigneeTo: 'Danu', acRemoved: [], acAdded: [], referenceAdded: [], blockedBy: [], refused: null },
    { key: 'QRD-1511', assigneeFrom: null, assigneeTo: null, acRemoved: ['An Edit client sees the cursor (QRD-1490)'], acAdded: [], referenceAdded: [], blockedBy: [], refused: null },
    { key: 'QRD-1490', assigneeFrom: null, assigneeTo: null, acRemoved: [], acAdded: ['An Edit client sees the cursor (QRD-1490)'], referenceAdded: [], blockedBy: [], refused: null },
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
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'));
  const view = await service.load(26, 'Danu');
  assert.deepEqual(view.tickets.filter((ticket) => !ticket.merged).map((ticket) => ticket.key), ['QRD-3']);
  assert.equal(view.landed, 2);
  assert.equal(view.tickets[0].start, 0);
  assert.deepEqual(view.findings.map((finding) => [finding.refKey, finding.kind]), [['QRD-1', 'lands-first'], ['QRD-2', 'lands-first']]);
  assert.equal(view.canPublish, true);
});

test('a frame changed in the newest storyboard flags the tickets naming it, Held until work starts; a missing storyboard says so', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-1312', { epic: 'QRD-1233', acRaw: '- Stop serving dialog (F7.3)' }),
    issue('QRD-1307', { epic: 'QRD-1233', status: 'In Progress', descriptionRaw: adf(para(text('Builds F7.3 and F7.4'))) }),
    issue('QRD-1400', { epic: 'QRD-1233', acRaw: '- Share (F10.1)' }),
    issue('QRD-1500', { epic: 'QRD-1300' }),
  ]);
  const storyboard = async (epic: string) => {
    if (epic === 'QRD-1300') throw new StoryboardMissing('No Confluence page titled "Storyboard" for QRD-1300.');
    return { epic, version: 8, previous: 7, path: '/b/QRD-1233/materials/storyboard/v8.html', page: '11', frames: [{ id: 'F7.3', text: '' }], changed: ['F7.3'] };
  };
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, storyboard);
  const view = await service.load(26, 'Alvin');
  const flag = (key: string) => view.tickets.find((ticket) => ticket.key === key)!.storyboard;
  assert.deepEqual(flag('QRD-1312'), { version: 8, frames: ['F7.3'], held: true, checked: null });
  assert.deepEqual(flag('QRD-1307')?.held, false);
  assert.equal(flag('QRD-1400'), null);
  assert.deepEqual(view.storyboards.map((board) => [board.epic, board.version, board.error]), [['QRD-1233', 8, null], ['QRD-1300', null, 'No Confluence page titled "Storyboard" for QRD-1300.']]);
  const checked = await service.decide('QRD Sprint 26', 'sb|QRD-1312|v8', 'checked', null, 'Alvin');
  assert.equal(checked.tickets.find((ticket) => ticket.key === 'QRD-1312')!.storyboard!.checked!.by, 'Alvin');
  assert.deepEqual(await service.applyStoryboard({ epic: 'QRD-1233', version: 9, previous: 8, path: 'p', page: '11', frames: [], changed: ['F10.1'] }), ['QRD Sprint 26']);
  assert.deepEqual((await service.view('QRD Sprint 26'))!.tickets.filter((ticket) => ticket.storyboard).map((ticket) => ticket.key), ['QRD-1400']);
  const scenarios = [{ n: 1, title: 'Serve outward', groups: [{ title: 'Stop', flows: [{ id: 'F7.3', title: 'Stop serving', tickets: ['QRD-1307'], info: [], frames: [{ index: 0, title: 'Dialog', step: null, changed: true }], changed: true }] }] }];
  await service.applyStoryboard({ epic: 'QRD-1233', version: 10, previous: 9, path: 'p', page: null, frames: [], changed: ['F7.3', 'F10.1'], scenarios, tickets: { 'F7.3': ['QRD-1307'], 'F10.1': [] } });
  const byFlow = (await service.view('QRD Sprint 26'))!;
  assert.deepEqual(byFlow.tickets.filter((ticket) => ticket.storyboard).map((ticket) => [ticket.key, ticket.storyboard!.frames]), [['QRD-1307', ['F7.3']], ['QRD-1400', ['F10.1']]], "a flow's own tickets win over the AC text; a flow without tickets falls back to it");
  assert.deepEqual(byFlow.storyboards.find((board) => board.epic === 'QRD-1233')!.scenarios, scenarios);
});

test('the planning chat asks open questions once each and the planner marks them answered', async () => {
  const { service } = setup();
  await service.load(26, 'Alvin');
  await service.ask('QRD Sprint 26', 'Tooltip names both open versions or the last?', 'qrd-1511');
  const view = await service.ask('QRD Sprint 26', 'Tooltip names both open versions or the last?', 'QRD-1511');
  assert.equal(view.questions.length, 1);
  assert.equal(view.questions[0].key, 'QRD-1511');
  await assert.rejects(service.ask('QRD Sprint 26', '  ', null), /text is required/);
  const answered = await service.answer('QRD Sprint 26', view.questions[0].id, true, 'Alvin');
  assert.deepEqual([answered.questions[0].answered, answered.questions[0].answeredBy], [true, 'Alvin']);
  assert.equal((await service.answer('QRD Sprint 26', view.questions[0].id, false, 'Alvin')).questions[0].answered, false);
});

test('test cases are checked, kept across a load, posted once per new set as QONFLO-TC v1, and go stale after a storyboard change', async () => {
  const { service, jira, store } = setup();
  const view = await service.load(26, 'Alvin');
  await service.decide('QRD Sprint 26', view.findings[0].id, 'wait', null, 'Alvin');
  const tcs = [{ id: 'tc-1', ac: 1, title: 'Edit client sees the cursor', steps: ['Open as owner', 'Open as client'], expected: 'Both cursors show' }];
  await assert.rejects(service.setTcs('QRD Sprint 26', 'QRD-1489', [{ ...tcs[0], ac: 9 }]), /ac must be the number of one of the 2 AC lines/);
  await assert.rejects(service.setTcs('QRD Sprint 26', 'QRD-1489', [{ ...tcs[0], id: 'one' }]), /id must look like TC-1/);
  let next = await service.setTcs('QRD Sprint 26', 'QRD-1489', tcs);
  const ticket = () => next.tickets.find((item) => item.key === 'QRD-1489')!;
  assert.deepEqual(ticket().tcs, [{ ...tcs[0], id: 'TC-1' }]);
  assert.equal(ticket().tcPending, true);
  next = await service.load(26, 'Alvin');
  assert.equal(ticket().tcs.length, 1, 'a load from Jira keeps the test cases');

  const first = await service.publish('QRD Sprint 26');
  assert.deepEqual(first.filter((result) => result.kind === 'tc').map((result) => [result.key, result.status]), [['QRD-1489', 'updated']]);
  assert.deepEqual(jira.writes.filter(([kind]) => kind === 'tc'), [['tc', 'QRD-1489', { version: 1, tcs: [{ ...tcs[0], id: 'TC-1' }] }]]);
  const again = await service.publish('QRD Sprint 26');
  assert.equal(again.filter((result) => result.kind === 'tc').length, 0, 'an unchanged set is not posted again');

  store.draft.tickets.find((item: any) => item.key === 'QRD-1489').tcAt = new Date('2026-10-20T00:00:00Z');
  store.draft.tickets.find((item: any) => item.key === 'QRD-1489').epic = 'QRD-1233';
  store.draft.tickets.find((item: any) => item.key === 'QRD-1489').frames = JSON.stringify(['F7.3']);
  await service.applyStoryboard({ epic: 'QRD-1233', version: 2, previous: 1, path: 'p', page: '1', frames: [], changed: ['F7.3'] });
  next = (await service.view('QRD Sprint 26'))!;
  assert.equal(ticket().tcStale, true);
});

test('the test case comment starts with the QONFLO-TC v1 line and holds the JSON in a code block', async () => {
  const posts: Array<[string, any]> = [];
  const client = new JiraSprintClient({ get: async () => ({}), post: async (url: string, body: unknown) => { posts.push([url, body]); return {}; } });
  const json = JSON.stringify({ version: 1, tcs: [{ id: 'TC-1', ac: 1, title: 't', steps: ['s'], expected: 'e' }] }, null, 2);
  await client.addTcComment('QRD-1489', TC_MARKER, json);
  assert.equal(posts[0][0], '/rest/api/3/issue/QRD-1489/comment');
  const [marker, code] = posts[0][1].body.content;
  assert.deepEqual(marker, { type: 'paragraph', content: [{ type: 'text', text: 'QONFLO-TC v1' }] });
  assert.equal(code.type, 'codeBlock');
  assert.deepEqual(JSON.parse(code.content[0].text), { version: 1, tcs: [{ id: 'TC-1', ac: 1, title: 't', steps: ['s'], expected: 'e' }] });
});

test('an active sprint loaded after its start lays open tickets from today, with day 1 still the sprint start', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([issue('QRD-1', { sp: 2 }), issue('QRD-2', { sp: 2, links: [{ key: 'QRD-1', relation: 'blockedBy' }] })]);
  jira.previousSprintEnd = async () => '2026-10-26T12:06:00.000Z';
  jira.listSprints = async () => [{ ...SPRINT, state: 'active', startDate: '2026-10-28T02:06:29.812Z', endDate: '2026-11-11T14:00:00.000Z' }];
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-11-04T03:00:00Z'));
  const view = await service.load(26, 'Alvin');
  assert.deepEqual([view.startDate, view.sprintDays, view.today], ['2026-10-26T16:00:00.000Z', 12, 7]);
  assert.deepEqual(view.tickets.map((ticket) => [ticket.key, ticket.start, ticket.end]), [['QRD-1', 6, 7], ['QRD-2', 7, 8]]);
});

test('mid-sprint the lanes count the work left by status; a future sprint keeps the full SP', async () => {
  const issues = () => [
    issue('QRD-1', { sp: 4, status: 'PR Review' }), issue('QRD-2', { sp: 4, status: 'In Progress' }), issue('QRD-3', { sp: 4, status: 'To Do' }),
  ];
  const store = new MemoryStore();
  const jira = new FakeJira(issues());
  jira.listSprints = async () => [{ ...SPRINT, state: 'active', startDate: '2026-10-27T01:00:00.000Z', endDate: '2026-11-11T14:00:00.000Z' }];
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-11-04T03:00:00Z'));
  const view = await service.load(26, 'Danu');
  const byKey = new Map(view.tickets.map((ticket) => [ticket.key, ticket]));
  assert.deepEqual(['QRD-1', 'QRD-2', 'QRD-3'].map((key) => [byKey.get(key)!.sp, byKey.get(key)!.left, byKey.get(key)!.dur]), [[4, 1, 0.5], [4, 2, 1], [4, 4, 2]]);

  const futureStore = new MemoryStore();
  const future = new FakeJira(issues());
  const planning = new SprintDraftService(futureStore, async () => future, predictions({}), () => new Date('2026-10-20T03:00:00Z'));
  const plan = await planning.load(26, 'Danu');
  assert.deepEqual(plan.tickets.map((ticket) => [ticket.key, ticket.left, ticket.dur]).sort(), [['QRD-1', null, 2], ['QRD-2', null, 2], ['QRD-3', null, 2]]);
});

test('merge state from GitHub decides what is scheduled, is read on load only, and every assignee is listed', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-1', { status: 'In Progress', sp: 3 }),
    issue('QRD-2', { status: 'UAT MERGED', sp: 2 }),
    issue('QRD-3', { assignee: 'Aken', sp: 4 }),
    issue('QRD-4', { assignee: 'M Danu Seta W', status: 'PR Review', sp: 5 }),
    issue('QRD-5', { assignee: 'Yusril', status: 'Done / MERGED', sp: 1 }),
  ]);
  let reads = 0;
  const merges = async (keys: string[]) => {
    reads++;
    assert.deepEqual(keys, ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4', 'QRD-5']);
    return new Map([
      ['QRD-1', { merge: 'merged' as const, pulls: ['qonekid/web#1'] }],
      ['QRD-2', { merge: 'open' as const, pulls: ['qonekid/web#2'] }],
      ['QRD-3', { merge: 'none' as const, pulls: [] }],
      ['QRD-4', { merge: 'merged' as const, pulls: ['qonekid/api#4'] }],
      ['QRD-5', { merge: 'none' as const, pulls: [] }],
    ]);
  };
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, null, merges);
  const view = await service.load(26, 'Danu');
  assert.equal(view.mergeSource, 'github');
  assert.deepEqual(view.tickets.filter((ticket) => !ticket.merged).map((ticket) => [ticket.key, ticket.merge, ticket.pulls, ticket.jiraAhead]), [
    ['QRD-2', 'open', ['qonekid/web#2'], true],
    ['QRD-3', 'none', [], false],
  ]);
  assert.equal(view.landed, 3, 'a Jira-done ticket without any pull request stays off the schedule');
  assert.deepEqual(view.developers, [
    { name: 'Aken', merged: 0, open: 1, sp: 4, leftSp: 4, end: 2 },
    { name: 'Danu', merged: 1, open: 1, sp: 5, leftSp: 2, end: 1 },
    { name: 'M Danu Seta W', merged: 1, open: 0, sp: 5, leftSp: 0, end: null },
    { name: 'Yusril', merged: 1, open: 0, sp: 1, leftSp: 0, end: null },
  ]);
  await service.view('QRD Sprint 26');
  await service.updateTicket('QRD Sprint 26', 'QRD-3', { sp: 2 });
  assert.equal(reads, 1, 'polling and edits never read GitHub');
});

test('when GitHub cannot be read the Jira status decides, and the draft says the merge state came from Jira', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([issue('QRD-1', { status: 'UAT MERGED' }), issue('QRD-2', { status: 'In Progress' })]);
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, null, async () => { throw new Error('GitHub responded 502'); });
  const view = await service.load(26, 'Danu');
  assert.equal(view.mergeSource, 'jira');
  assert.deepEqual(view.tickets.filter((ticket) => !ticket.merged).map((ticket) => [ticket.key, ticket.merge, ticket.jiraAhead]), [['QRD-2', 'unknown', false]]);
  assert.deepEqual(view.developers, [{ name: 'Danu', merged: 1, open: 1, sp: 4, leftSp: 2, end: 1 }]);
  const none = await new SprintDraftService(new MemoryStore(), async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, null, async () => null).load(26, 'Danu');
  assert.equal(none.mergeSource, 'jira');
});

test('moving cards changes only the draft developer, and the free lane appears in the suggestions', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-1', { sp: 4 }), issue('QRD-2', { sp: 4, links: [{ key: 'QRD-1', relation: 'blockedBy' }] }), issue('QRD-3', { sp: 2 }),
    issue('QRD-9', { assignee: 'Aken', status: 'Done' }),
  ]);
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'));
  const view = await service.load(26, 'Danu');
  assert.deepEqual(view.moves.map((move) => [move.keys, move.from, move.to, move.forecastBefore, move.forecastAfter]), [[['QRD-3'], 'Danu', 'Aken', 5, 4]]);
  await assert.rejects(service.moveCards('QRD Sprint 26', ['QRD-404'], 'Aken'), /QRD-404 is not in the QRD Sprint 26 draft/);
  await assert.rejects(service.moveCards('QRD Sprint 26', ['QRD-3'], ' '), /to is required/);
  const moved = await service.moveCards('QRD Sprint 26', view.moves[0].keys, 'Aken');
  assert.equal(moved.tickets.find((ticket) => ticket.key === 'QRD-3')!.dev, 'Aken');
  assert.equal(moved.tickets.find((ticket) => ticket.key === 'QRD-3')!.jiraDev, 'Danu');
  assert.deepEqual(moved.moves, []);
  assert.deepEqual(jira.writes, []);
});

test('the plan reads each card rank from its #N label and lays merged and open cards alike, leaving forecast, moves and landed as they were', async () => {
  const open = () => [
    issue('QRD-1', { sp: 4, labels: ['#2'] }), issue('QRD-2', { sp: 4, labels: ['#3', 'V2'], links: [{ key: 'QRD-1', relation: 'blockedBy' }] }), issue('QRD-3', { sp: 2 }),
    issue('QRD-8', { assignee: 'Aken', sp: 2, labels: ['#1'] }),
  ];
  const merged = [issue('QRD-5', { sp: 2, status: 'Done / MERGED', labels: ['#1'] }), issue('QRD-6', { assignee: 'Aken', sp: 6, status: 'UAT MERGED', labels: ['#2'] })];
  const loadWith = async (issues: PlanningIssue[]) => {
    let seen: QaInputTicket[] = [];
    const predict = async (tickets: QaInputTicket[]) => { seen = tickets; return predictions({})(tickets); };
    const service = new SprintDraftService(new MemoryStore(), async () => new FakeJira(issues), predict, () => new Date('2026-10-26T10:00:00Z'));
    return { view: await service.load(26, 'Danu'), seen: () => seen };
  };
  const { view, seen } = await loadWith([...open(), ...merged]);
  const { view: alone } = await loadWith(open());
  assert.deepEqual(view.tickets.map((ticket) => [ticket.key, ticket.merged, ticket.rank, ticket.planStart, ticket.planDur]), [
    ['QRD-1', false, 2, 1, 2], ['QRD-8', false, 1, 0, 1], ['QRD-3', false, null, 5, 1], ['QRD-2', false, 3, 3, 2],
    ['QRD-5', true, 1, 0, 1], ['QRD-6', true, 2, 1, 3],
  ]);
  const schedule = (tickets: typeof view.tickets) => tickets.filter((ticket) => !ticket.merged).map((ticket) => [ticket.key, ticket.start, ticket.end, ticket.wave]);
  assert.deepEqual(schedule(view.tickets), schedule(alone.tickets));
  assert.deepEqual(view.moves, alone.moves);
  assert.deepEqual(view.findings, alone.findings);
  assert.deepEqual([view.landed, alone.landed], [2, 0]);
  assert.deepEqual(view.developers.map((developer) => [developer.name, developer.merged, developer.open, developer.leftSp, developer.end]), [['Aken', 1, 1, 2, 1], ['Danu', 1, 3, 10, 5]]);
  assert.deepEqual(seen().map((ticket) => ticket.key).sort(), ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-8'], 'the QA bot sees only the open cards');
});

test('an AC line naming another ticket is a dependency (Blocks link) or moves to Reference; Publish writes them without a comment', async () => {
  const { service, jira, store } = setup();
  const view = await service.load(26, 'Alvin');
  const [dependency, reference] = view.findings;
  assert.deepEqual([dependency.refKey, dependency.linked, reference.refKey, reference.linked], ['QRD-1490', false, 'QRD-1363', false]);
  await assert.rejects(service.decide('QRD Sprint 26', reference.id, 'move', null, 'Alvin'), /QRD-1363 is not in this sprint/);
  await service.decide('QRD Sprint 26', dependency.id, 'dependency', null, 'Alvin');
  const decided = await service.decide('QRD Sprint 26', reference.id, 'reference', null, 'Alvin');
  assert.deepEqual(decided.findings.map((finding) => finding.decision?.action), ['dependency', 'reference']);
  assert.equal(jira.writes.length, 0, 'nothing is written to Jira until Publish');

  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual(preview, [{
    key: 'QRD-1511', assigneeFrom: null, assigneeTo: null, acRemoved: ['Works after QRD-1363'], acAdded: [],
    referenceAdded: ['QRD-1363: Works after QRD-1363'], blockedBy: ['QRD-1490'], refused: null,
  }]);
  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(results.filter((result) => result.kind === 'ticket').map((result) => [result.key, result.status]), [['QRD-1511', 'updated']]);
  assert.deepEqual(jira.writes.map(([kind, key]) => [kind, key]), [['reference', 'QRD-1511'], ['ac', 'QRD-1511'], ['link', 'QRD-1511']]);
  assert.deepEqual(jira.writes[0][2], adf(bullets('QRD-1363: Works after QRD-1363')));
  assert.equal(jira.writes[2][2], 'QRD-1490');
  assert.ok(!jira.writes.some(([kind]) => kind === 'comment'));
  assert.deepEqual(JSON.parse(store.draft.tickets.find((ticket: any) => ticket.key === 'QRD-1511').jiraAc), ['Cursor shows', 'An Edit client sees the cursor (QRD-1490)']);
});

test('older wait and drop calls read as dependency and reference, a Blocks link already in Jira decides the line, and a changed AC refuses the write', async () => {
  const { service, jira, store } = setup();
  jira.issues = jira.issues.map((item) => (item.key === 'QRD-1511' ? { ...item, links: [{ key: 'QRD-1490', relation: 'blockedBy' as const }] } : item));
  const view = await service.load(26, 'Alvin');
  assert.deepEqual(view.findings.map((finding) => [finding.refKey, finding.linked]), [['QRD-1490', true], ['QRD-1363', false]]);
  assert.deepEqual(view.blockers, [], 'a linked after-it line is a dependency already');
  store.draft.decisions = JSON.stringify({
    [view.findings[0].id]: { action: 'wait', note: null, by: 'Alvin', at: '2026-10-26T10:00:00.000Z' },
    [view.findings[1].id]: { action: 'drop', note: null, by: 'Alvin', at: '2026-10-26T10:00:00.000Z' },
  });
  const legacy = (await service.view('QRD Sprint 26'))!;
  assert.deepEqual(legacy.findings.map((finding) => finding.decision?.action), ['dependency', 'reference']);
  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual([preview[0].referenceAdded, preview[0].blockedBy], [['QRD-1363: Works after QRD-1363'], []], 'the link Jira already has is not added again');

  jira.now.set('QRD-1511', { ...jira.issues.find((item) => item.key === 'QRD-1511')!, acRaw: '- Someone else edited this' });
  const refused = await service.preview('QRD Sprint 26');
  assert.equal(refused[0].refused, 'The AC changed in Jira after it was loaded; load the sprint again');
  await service.publish('QRD Sprint 26');
  assert.deepEqual(jira.writes, []);
});

test('QA approves a ticket test cases in the draft, and a changed set needs a new approval', async () => {
  const { service, store } = setup();
  await service.load(26, 'Alvin');
  await assert.rejects(service.decide('QRD Sprint 26', 'tc|QRD-1489', 'approve', null, 'Rina'), /QRD-1489 has no test cases to approve/);
  const tcs = [{ id: 'TC-1', ac: 1, title: 'Edit', steps: [], expected: 'Saved' }];
  await service.setTcs('QRD Sprint 26', 'QRD-1489', tcs);
  await assert.rejects(service.decide('QRD Sprint 26', 'tc|QRD-1489', 'ok', null, 'Rina'), /approved with action approve/);
  const approved = await service.decide('QRD Sprint 26', 'tc|QRD-1489', 'approve', null, 'Rina');
  assert.equal(approved.tickets.find((ticket) => ticket.key === 'QRD-1489')!.tcApproved, true);
  store.draft.tickets.find((item: any) => item.key === 'QRD-1489').tcAt = new Date('2026-10-27T00:00:00Z');
  assert.equal((await service.view('QRD Sprint 26'))!.tickets.find((ticket) => ticket.key === 'QRD-1489')!.tcApproved, false);
});
