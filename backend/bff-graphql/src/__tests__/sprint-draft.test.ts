import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraSprintClient, type PlanningIssue, type PlanningSprint, type RevisionIssue } from '../integrations/jira-sprint';
import type { QaInputTicket, QaRun } from '../integrations/qa-predict';
import { SprintDraftService, TC_MARKER, acSideEffects, acValueLines, diffLines, finalAc, rewriteAcValue, sprintProject, type DraftJira, type DraftStore } from '../integrations/sprint-draft';
import type { SprintDraftInput, SprintDraftNewTicketData, SprintDraftRevisionData, SprintDraftRevisionUpdate, SprintDraftTicketInput } from '../storage/service';
import { StoryboardMissing } from '../integrations/storyboard';
import { testLinks } from '../integrations/jira';

const adf = (...blocks: any[]) => ({ type: 'doc', version: 1, content: blocks });
const para = (...content: any[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const bullets = (...items: string[]) => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [para(text(item))] })) });

class MemoryStore implements DraftStore {
  draft: any = null;
  settings: Array<{ key: string; value: string }> = [];
  async getSettings() { return this.settings; }
  revisions: any[] = [];
  async getSprintDraft(sprint: string) { return this.draft?.sprint === sprint ? { ...this.draft, tickets: this.draft.tickets.map((ticket: any) => ({ ...ticket })), newTickets: this.draft.newTickets.map((ticket: any) => ({ ...ticket })), revisions: this.revisions.filter((item) => item.draftSprint === sprint).map((item) => ({ ...item })) } : null; }
  async replaceSprintDraft(draft: SprintDraftInput, tickets: SprintDraftTicketInput[]) {
    this.draft = {
      ...draft, status: 'draft', decisions: this.draft?.decisions ?? '{}', qaReason: null, loadedAt: new Date('2026-11-09T00:00:00Z'), publishedAt: null,
      newTickets: this.draft?.newTickets ?? [], newTicketSeq: this.draft?.newTicketSeq ?? 0,
      tickets: tickets.map((ticket, position) => ({ ...ticket, ac: JSON.stringify(ticket.ac), jiraAc: JSON.stringify(ticket.jiraAc), dependsOn: JSON.stringify(ticket.dependsOn), frames: JSON.stringify(ticket.frames ?? []), prediction: null, position })),
    };
  }
  async addSprintDraftTickets(_sprint: string, tickets: SprintDraftTicketInput[], addedKeys: string[]) {
    const base = this.draft.tickets.length;
    tickets.forEach((ticket, index) => this.draft.tickets.push({ ...ticket, ac: JSON.stringify(ticket.ac), jiraAc: JSON.stringify(ticket.jiraAc), dependsOn: JSON.stringify(ticket.dependsOn), frames: JSON.stringify(ticket.frames ?? []), tcs: '[]', prediction: null, position: base + index }));
    this.draft.addedKeys = JSON.stringify(addedKeys);
  }
  async listSprintDrafts() { return this.draft ? [{ sprint: this.draft.sprint, sprintId: this.draft.sprintId, status: this.draft.status }] : []; }
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
  async addSprintDraftNewTicket(_sprint: string, data: SprintDraftNewTicketData) {
    this.draft.newTicketSeq += 1;
    const id = `NEW-${this.draft.newTicketSeq}`;
    this.draft.newTickets.push({ createdKey: null, error: null, ...data, id, position: this.draft.newTicketSeq });
    return id;
  }
  async updateSprintDraftNewTicket(_sprint: string, id: string, data: Partial<SprintDraftNewTicketData>) { Object.assign(this.draft.newTickets.find((ticket: any) => ticket.id === id), data); }
  async removeSprintDraftNewTicket(_sprint: string, id: string) { this.draft.newTickets = this.draft.newTickets.filter((ticket: any) => ticket.id !== id); }
  async saveSprintDraftRevision(sprint: string, key: string, data: SprintDraftRevisionData) {
    const pending = this.revisions.find((item) => item.draftSprint === sprint && item.key === key && item.status === 'pending');
    if (pending) Object.assign(pending, data);
    else this.revisions.push({ id: `rev-${this.revisions.length + 1}`, draftSprint: sprint, key, status: 'pending', appliedAt: null, appliedBy: null, createdAt: new Date(), ...data });
  }
  async updateSprintDraftRevision(id: string, data: SprintDraftRevisionUpdate) { Object.assign(this.revisions.find((item) => item.id === id), data); }
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
  created: Array<Record<string, any>> = [];
  failSummary: string | null = null;
  accountLookups: Array<[string, string]> = [];
  async createIssue(fields: Record<string, any>) {
    if (fields.summary === this.failSummary) throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { errorMessages: [], errors: { customfield_10341: 'User Story is required' } } } });
    this.created.push(fields);
    return `QRD-${1600 + this.created.length}`;
  }
  async projectAccounts(project: string, name: string) { this.accountLookups.push([project, name]); return name === 'Budi' ? ['acc-b1', 'acc-b2'] : this.users[name] ?? []; }
  revisionIssues = new Map<string, RevisionIssue>();
  edits: Array<[string, Record<string, unknown>]> = [];
  failEdit: unknown = null;
  async revisionIssue(key: string) { return this.revisionIssues.get(key) ?? null; }
  async editIssue(key: string, fields: Record<string, unknown>) {
    if (this.failEdit) throw this.failEdit;
    this.edits.push([key, fields]);
  }
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
    { key: 'QRD-1', summary: 'One', type: 'Story', status: 'To Do', assignee: null, sp: 3, acRaw: 'x', links: [{ key: 'QRD-2', relation: 'blockedBy' }], epic: null, descriptionRaw: null, labels: [], referenceRaw: null, userStoryRaw: null, problemRaw: null },
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

test('the Jira client finds the Test link type by its phrases or name, writes FE tests BE, and reads Test links both ways', async () => {
  const calls: Array<[string, string, unknown]> = [];
  let types: any[] = [{ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, { name: 'Relates', inward: 'relates to', outward: 'relates to' }];
  const client = new JiraSprintClient({
    get: async (url: string) => { calls.push(['get', url, null]); return { issueLinkTypes: types }; },
    post: async (url: string, body: unknown) => { calls.push(['post', url, body]); },
  });
  assert.equal(await client.testLinkType(), null);
  assert.deepEqual(calls[0], ['get', '/rest/api/3/issueLinkType', null]);
  types = [...types, { name: 'Tests', inward: 'is tested by', outward: 'tests' }];
  assert.equal(await client.testLinkType(), 'Tests');
  types = [{ name: 'Test', inward: 'checked by', outward: 'checks' }];
  assert.equal(await client.testLinkType(), 'Test');
  await client.addTestLink('QRD-1582', 'QRD-1579', 'Tests');
  assert.deepEqual(calls.at(-1), ['post', '/rest/api/3/issueLink', { type: { name: 'Tests' }, inwardIssue: { key: 'QRD-1582' }, outwardIssue: { key: 'QRD-1579' } }]);
  const type = { name: 'Test', inward: 'is tested by', outward: 'tests' };
  assert.deepEqual(testLinks([{ type, inwardIssue: { key: 'QRD-1582' } }, { type: { name: 'Blocks' }, inwardIssue: { key: 'QRD-1' } }]), [{ key: 'QRD-1582', relation: 'testedBy' }]);
  assert.deepEqual(testLinks([{ type, outwardIssue: { key: 'QRD-1579' } }]), [{ key: 'QRD-1579', relation: 'tests' }]);
  assert.deepEqual(testLinks(null), []);
});

test('the QA prediction gets the Blocks links both ways with the other ticket summary, so a [BE] ticket finds its [FE] pair', async () => {
  const { service, seen } = setup();
  await service.load(26, 'Alvin');
  const input = Object.fromEntries(seen().map((ticket) => [ticket.key, ticket.links]));
  assert.deepEqual(input['QRD-1490'], [{ key: 'QRD-1489', type: 'is blocked by', summary: 'Ticket QRD-1489' }]);
  assert.deepEqual(input['QRD-1489'], [{ key: 'QRD-1490', type: 'blocks', summary: 'Ticket QRD-1490' }]);
  assert.deepEqual(input['QRD-1511'], []);
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
  assert.deepEqual(view.blockers, ['ac|QRD-1511|QRD-1490|An Edit client sees the cursor (QRD-1490)'], 'an undecided ESCALATED prediction is not a blocker');
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
  assert.deepEqual((await service.decide('QRD Sprint 26', 'qa|QRD-1511', 'clear', null, 'Alvin')).blockers, []);
  const results = await service.publish('QRD Sprint 26');
  assert.ok(results.some((result) => result.kind === 'ticket' && result.status === 'updated'), 'an undecided QA prediction does not refuse publish');
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
    { key: 'QRD-1489', assigneeFrom: 'Aken', assigneeTo: 'Danu', acRemoved: [], acAdded: [], referenceAdded: [], blockedBy: [], testsFor: [], pairWarning: null, refused: null },
    { key: 'QRD-1511', assigneeFrom: null, assigneeTo: null, acRemoved: ['An Edit client sees the cursor (QRD-1490)'], acAdded: [], referenceAdded: [], blockedBy: [], testsFor: [], pairWarning: null, refused: null },
    { key: 'QRD-1490', assigneeFrom: null, assigneeTo: null, acRemoved: [], acAdded: ['An Edit client sees the cursor (QRD-1490)'], referenceAdded: [], blockedBy: [], testsFor: [], pairWarning: null, refused: null },
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
    referenceAdded: ['QRD-1363: Works after QRD-1363'], blockedBy: ['QRD-1490'], testsFor: [], pairWarning: null, refused: null,
  }]);
  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(results.filter((result) => result.kind === 'ticket').map((result) => [result.key, result.status]), [['QRD-1511', 'updated']]);
  assert.deepEqual(jira.writes.map(([kind, key]) => [kind, key]), [['reference', 'QRD-1511'], ['ac', 'QRD-1511'], ['link', 'QRD-1511']]);
  assert.deepEqual(jira.writes[0][2], adf(bullets('QRD-1363: Works after QRD-1363')));
  assert.equal(jira.writes[2][2], 'QRD-1490');
  assert.ok(!jira.writes.some(([kind]) => kind === 'comment'));
  assert.deepEqual(JSON.parse(store.draft.tickets.find((ticket: any) => ticket.key === 'QRD-1511').jiraAc), ['Cursor shows', 'An Edit client sees the cursor (QRD-1490)']);
});

/** The dependency test's sprint with QRD-1511 an [FE] ticket and QRD-1490 its [BE] ticket, and Jira with or without the Test link type. */
async function pairSetup(testType: string | null, beSummary = '[BE][Cursor] Store the edit cursor') {
  const ctx = setup();
  ctx.jira.issues = ctx.jira.issues.map((item) => (item.key === 'QRD-1511' ? { ...item, summary: '[FE][Cursor] Show the edit cursor' } : item.key === 'QRD-1490' ? { ...item, summary: beSummary } : item));
  let typeReads = 0;
  Object.assign(ctx.jira, {
    testLinkType: async () => { typeReads += 1; return testType; },
    addTestLink: async (tester: string, tested: string, typeName: string) => { ctx.jira.writes.push(['test', tester, [tested, typeName]]); },
  });
  const view = await ctx.service.load(26, 'Alvin');
  await ctx.service.decide('QRD Sprint 26', view.findings[0].id, 'dependency', null, 'Alvin');
  await ctx.service.decide('QRD Sprint 26', view.findings[1].id, 'reference', null, 'Alvin');
  return { ...ctx, typeReads: () => typeReads };
}

test('Publish adds a Test link with the Blocks link it writes when an [FE] ticket waits on a [BE] ticket', async () => {
  const { service, jira, typeReads } = await pairSetup('Test');
  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual([preview[0].blockedBy, preview[0].testsFor, preview[0].pairWarning], [['QRD-1490'], ['QRD-1490'], null]);
  assert.equal(typeReads(), 1);
  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(jira.writes.filter(([kind]) => kind === 'link' || kind === 'test'), [['link', 'QRD-1511', 'QRD-1490'], ['test', 'QRD-1511', ['QRD-1490', 'Test']]]);
  assert.deepEqual(results.filter((result) => result.kind === 'link'), [{ key: 'QRD-1511', kind: 'link', status: 'created', detail: 'QRD-1511 tests QRD-1490' }]);
  assert.equal(typeReads(), 2, 'the link types are read once per preview and once per publish');
});

test('without the Test link type Publish writes the Blocks link only and the preview warns', async () => {
  const { service, jira } = await pairSetup(null);
  const preview = await service.preview('QRD Sprint 26');
  assert.deepEqual([preview[0].testsFor, preview[0].pairWarning], [[], 'Link type Test not found in Jira; ask a Jira admin to add it (tests / is tested by)']);
  const results = await service.publish('QRD Sprint 26');
  assert.deepEqual(results.filter((result) => result.kind === 'ticket').map((result) => result.status), ['updated']);
  assert.deepEqual(jira.writes.filter(([kind]) => kind === 'link' || kind === 'test'), [['link', 'QRD-1511', 'QRD-1490']]);
});

test('no Test link when the waited-on ticket is not [BE], when Repo: BE says it is, and none for a Blocks link Jira already has', async () => {
  const fe = await pairSetup('Test', '[FE][Cursor] Another screen');
  assert.deepEqual((await fe.service.preview('QRD Sprint 26'))[0].testsFor, []);
  assert.equal(fe.typeReads(), 0, 'no pair, no link type read');
  const repo = await pairSetup('Test', 'Store the edit cursor');
  repo.store.draft.tickets.find((ticket: any) => ticket.key === 'QRD-1490').description = 'Repo: BE';
  assert.deepEqual((await repo.service.preview('QRD Sprint 26'))[0].testsFor, ['QRD-1490']);
  const linked = await pairSetup('Test');
  linked.jira.now.set('QRD-1511', { ...linked.jira.issues.find((item) => item.key === 'QRD-1511')!, links: [{ key: 'QRD-1490', relation: 'blockedBy' }] });
  const preview = await linked.service.preview('QRD Sprint 26');
  assert.deepEqual([preview[0].blockedBy, preview[0].testsFor], [[], []], 'an already published pair gets no Test link backfilled');
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

test('a ticket carried over from a closed sprint is left out once merged, and goes first on its lane while open', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-10', { status: 'UAT CHECK', labels: ['#1'] }),
    issue('QRD-11', { status: 'UAT BUG / Improvement', labels: ['#4'] }),
    issue('QRD-20', { labels: ['#1'] }),
    issue('QRD-21', { status: 'UAT CHECK' }),
  ]);
  (jira as DraftJira).carriedKeys = async () => ['QRD-10', 'QRD-11'];
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'));
  const view = await service.load(SPRINT.id, 'Rina');
  assert.deepEqual(view.tickets.map((ticket) => ticket.key).sort(), ['QRD-11', 'QRD-20', 'QRD-21']);
  assert.equal(view.carriedPast, 1);
  assert.equal(view.landed, 1);
  const byKey = new Map(view.tickets.map((ticket) => [ticket.key, ticket]));
  assert.equal(byKey.get('QRD-11')!.carried, true);
  assert.equal(byKey.get('QRD-20')!.carried, false);
  assert.equal(byKey.get('QRD-11')!.planStart, 0);
  assert.equal(byKey.get('QRD-20')!.planStart, 1);
  assert.equal(view.developers.find((developer) => developer.name === 'Danu')!.merged, 1);
});

test('an open carried ticket stays on the plan but is not checked again: no AC reference, QA prediction or storyboard', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([
    issue('QRD-11', { status: 'UAT BUG / Improvement', epic: 'QRD-21', acRaw: '- Works after QRD-99' }),
    issue('QRD-20', { epic: 'QRD-1233', acRaw: '- Works after QRD-98' }),
  ]);
  (jira as DraftJira).carriedKeys = async () => ['QRD-11'];
  let seen: string[] = [];
  const predict = async (tickets: QaInputTicket[]) => { seen = tickets.map((ticket) => ticket.key); return predictions({ 'QRD-11': 'ESCALATED', 'QRD-20': 'ESCALATED' })(tickets); };
  const read: string[] = [];
  const storyboard = async (epic: string) => { read.push(epic); return { epic, version: 2, previous: 1, path: 'p', page: '1', frames: [], changed: [] }; };
  const service = new SprintDraftService(store, async () => jira, predict, () => new Date('2026-10-26T10:00:00Z'), undefined, storyboard);
  const view = await service.load(SPRINT.id, 'Rina');
  assert.deepEqual(view.tickets.map((ticket) => ticket.key).sort(), ['QRD-11', 'QRD-20']);
  assert.deepEqual(view.findings.map((finding) => finding.key), ['QRD-20']);
  assert.deepEqual(seen, ['QRD-20']);
  assert.equal(view.tickets.find((ticket) => ticket.key === 'QRD-11')!.prediction, null);
  assert.deepEqual(read, ['QRD-1233']);
  assert.deepEqual(view.storyboards.map((board) => board.epic), ['QRD-1233']);
});

test('without carriedKeys every ticket of the sprint stays in the draft', async () => {
  const { service } = setup();
  const view = await service.load(SPRINT.id, 'Rina');
  assert.equal(view.carriedPast, 0);
  assert.ok(view.tickets.every((ticket) => ticket.carried === false));
});

test('the Jira client reads the carried over tickets as the sprint tickets that are also in a closed sprint', async () => {
  const bodies: unknown[] = [];
  const client = new JiraSprintClient({
    get: async () => ({}),
    post: async (_url: string, body: unknown) => { bodies.push(body); return { issues: [{ key: 'QRD-5', fields: { issuetype: { name: 'Story' }, status: { name: 'UAT CHECK' } } }] }; },
  });
  assert.deepEqual(await client.fetchCarriedKeys(699), ['QRD-5']);
  assert.equal((bodies[0] as { jql: string }).jql, 'sprint = 699 AND sprint in closedSprints()');
});

function splitSetup(weeks: Record<string, number>) {
  const { store, jira } = setup();
  const cache = new Map<string, any>();
  const edits: string[] = [];
  let state: any = { page: 'Sprint 26 split', pageId: '1', version: 3, readAt: 'now', error: null, weeks: Object.fromEntries(Object.entries(weeks).map(([key, week]) => [key, { week, note: null }])), kept: {} };
  const source = {
    read: async () => (state ? { ...state, kept: {} } : null),
    get: async (sprint: string) => cache.get(sprint) ?? null,
    save: async (sprint: string, value: any) => { if (value) cache.set(sprint, value); else cache.delete(sprint); },
  };
  const original = store.updateSprintDraftTicket.bind(store);
  store.updateSprintDraftTicket = async (sprint, key, data) => { edits.push(key); return original(sprint, key, data); };
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, null, null, null, source);
  return { service, edits, setState: (next: any) => { state = next; } };
}

test('a load reads the split page and lists the tickets in another week without changing the draft', async () => {
  const { service, edits } = splitSetup({ 'QRD-1489': 1, 'QRD-1490': 1, 'QRD-9999': 2 });
  const view = await service.load(26, 'Alvin');
  assert.deepEqual(view.split?.diffs, [{ key: 'QRD-1490', draftWeek: 2, splitWeek: 1, note: null }]);
  assert.deepEqual([view.split?.page, view.split?.rows], ['Sprint 26 split', 3]);
  assert.deepEqual(edits, [], 'the draft is only changed when the planner clicks');
  assert.equal(view.tickets.find((ticket) => ticket.key === 'QRD-1490')!.wave, 2);
});

test('Use split page sets that ticket week, Keep hides the difference until the page changes', async () => {
  const { service } = splitSetup({ 'QRD-1490': 1, 'QRD-1511': 2 });
  await service.load(26, 'Alvin');
  const used = await service.useSplit('QRD Sprint 26', 'QRD-1490');
  assert.equal(used.tickets.find((ticket) => ticket.key === 'QRD-1490')!.wave, 1);
  assert.deepEqual(used.split?.diffs.map((diff) => diff.key), ['QRD-1511']);
  const kept = await service.keepSplit('QRD Sprint 26', 'QRD-1511');
  assert.deepEqual(kept.split?.diffs, []);
  assert.equal(kept.split?.kept, 1);
  await assert.rejects(() => service.useSplit('QRD Sprint 26', 'QRD-1489'), /gives no week for QRD-1489/);
  await assert.rejects(() => service.keepSplit('QRD Sprint 26', 'QRD-1489'), /gives no week for QRD-1489/);
});

test('a kept difference survives a reload while the page still says that week', async () => {
  const { service, setState } = splitSetup({ 'QRD-1511': 2 });
  await service.load(26, 'Alvin');
  await service.keepSplit('QRD Sprint 26', 'QRD-1511');
  assert.deepEqual((await service.load(26, 'Alvin')).split?.diffs, []);
  setState({ page: 'Sprint 26 split', pageId: '1', version: 4, readAt: 'now', error: null, weeks: { 'QRD-1511': { week: 3, note: null } }, kept: {} });
  assert.deepEqual((await service.load(26, 'Alvin')).split?.diffs.map((diff) => diff.splitWeek), [3]);
});

test('without a split page, or with one that gave nothing, Planning shows the draft as before', async () => {
  const none = splitSetup({});
  none.setState(null);
  assert.equal((await none.service.load(26, 'Alvin')).split ?? null, null);
  const broken = splitSetup({});
  broken.setState({ page: 'Gone', pageId: null, version: null, readAt: 'now', error: 'Split page "Gone" was not found', weeks: {}, kept: {} });
  const view = await broken.service.load(26, 'Alvin');
  assert.deepEqual([view.split?.error, view.split?.diffs, view.tickets.length], ['Split page "Gone" was not found', [], 3]);
});

test('publish hands the sprint to the after-publish hook once the draft is published', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([issue('QRD-1489', { assignee: 'Aken', sp: 5, acRaw: adf(bullets('The client edits the skill')) })]);
  const seen: string[] = [];
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, null, null, null, null, async (sprint) => { seen.push(`${sprint}:${store.draft.status}`); });
  await service.load(26, 'Alvin');
  await service.publish('QRD Sprint 26');
  assert.deepEqual(seen, ['QRD Sprint 26:published']);
});

const NEW_TICKET = { summary: '[FE] Export the sprint plan', type: 'Task', userStory: 'As a planner I want an export so I can share the plan', problem: 'The plan cannot leave DOCK', ac: ['- The export holds every ticket'], source: 'sheet row 2' };

test('new tickets get NEW-n ids that are never reused, keep the fields an update leaves out, and refuse what is out of range', async () => {
  const { service } = setup();
  await service.load(26, 'Alvin');
  const first = await service.saveNewTicket('QRD Sprint 26', null, NEW_TICKET);
  assert.equal(first.id, 'NEW-1');
  assert.deepEqual(first.view.newTickets, [{
    id: 'NEW-1', summary: '[FE] Export the sprint plan', type: 'Task', epic: null, dev: null, sp: null, priority: null,
    userStory: 'As a planner I want an export so I can share the plan', problem: 'The plan cannot leave DOCK', ac: ['The export holds every ticket'], reference: null, source: 'sheet row 2',
    createdKey: null, error: null, flagReason: null, lint: { ok: true, findings: [] },
  }]);
  assert.equal((await service.saveNewTicket('QRD Sprint 26', null, {})).id, 'NEW-2');
  const blank = (await service.view('QRD Sprint 26'))!.newTickets[1];
  assert.deepEqual([blank.summary, blank.type, blank.source, blank.ac], ['', 'Task', 'manual', []], 'an empty ticket starts as a Task from manual');
  const updated = await service.saveNewTicket('QRD Sprint 26', 'NEW-1', { type: 'story', epic: 'qrd-1233', dev: 'Aken', sp: 3, priority: 'high', reference: 'Discord: https://discord.com/x' });
  assert.deepEqual(updated.view.newTickets[0], { ...first.view.newTickets[0], type: 'Story', epic: 'QRD-1233', dev: 'Aken', sp: 3, priority: 'High', reference: 'Discord: https://discord.com/x' });
  await service.saveNewTicket('QRD Sprint 26', 'NEW-1', { priority: null, sp: null, epic: null });
  assert.equal((await service.view('QRD Sprint 26'))!.newTickets[0].priority, null);
  await service.removeNewTicket('QRD Sprint 26', 'NEW-2');
  assert.equal((await service.saveNewTicket('QRD Sprint 26', null, {})).id, 'NEW-3', 'a removed id is not given out again');
  assert.deepEqual((await service.view('QRD Sprint 26'))!.newTickets.map((ticket) => ticket.id), ['NEW-1', 'NEW-3']);

  const refused: Array<[unknown, RegExp]> = [
    [{ summary: 'x'.repeat(201) }, /Summary is at most 200 characters/],
    [{ type: 'Epic' }, /Type is Task, Story or Bug/],
    [{ priority: 'Urgent' }, /Priority is Highest, High, Medium, Low, Lowest/],
    [{ sp: 101 }, /SP must be from 0 to 100/],
    [{ sp: -1 }, /SP must be from 0 to 100/],
    [{ ac: Array.from({ length: 41 }, (_, index) => `Line ${index}`) }, /at most 40 AC lines/],
    [{ ac: ['ok', 'x'.repeat(1001)] }, /AC line 2 is at most 1000 characters/],
    [{ ac: 'one line' }, /ac must be a list of lines/],
    [{ userStory: 'x'.repeat(4001) }, /User Story is at most 4000 characters/],
    [{ problem: 'x'.repeat(4001) }, /Problem Definition is at most 4000 characters/],
    [{ reference: 'x'.repeat(2001) }, /Reference is at most 2000 characters/],
    [{ epic: 'not an epic' }, /Epic must be an epic key/],
    [{ summary: 5 }, /Summary must be text/],
  ];
  for (const [input, message] of refused) await assert.rejects(service.saveNewTicket('QRD Sprint 26', 'NEW-1', input), message);
  await assert.rejects(service.saveNewTicket('QRD Sprint 26', 'NEW-7', {}), /NEW-7 is not a new ticket of the QRD Sprint 26 draft/);
  await assert.rejects(service.removeNewTicket('QRD Sprint 26', 'NEW-2'), /NEW-2 is not a new ticket/);
  await assert.rejects(service.saveNewTicket('QRD Sprint 9', null, {}), /No draft for QRD Sprint 9/);
  for (let count = 2; count < 30; count++) await service.saveNewTicket('QRD Sprint 26', null, {});
  await assert.rejects(service.saveNewTicket('QRD Sprint 26', null, {}), /at most 30 new tickets/);
});

test('preview lists one create per new ticket not created yet, refused while a required field is empty', async () => {
  const { service } = setup();
  await service.load(26, 'Alvin');
  await service.saveNewTicket('QRD Sprint 26', null, NEW_TICKET);
  await service.saveNewTicket('QRD Sprint 26', null, { summary: '[FE] Half drafted', userStory: 'As a dev' });
  const creates = (await service.preview('QRD Sprint 26')).filter((change) => change.create);
  assert.deepEqual(creates.map((change) => [change.key, change.refused, change.create!.id, change.acAdded, change.blockedBy, change.assigneeTo]), [
    ['NEW-1', null, 'NEW-1', [], [], null],
    ['NEW-2', 'Missing Problem Definition, at least one AC line', 'NEW-2', [], [], null],
  ]);
  await service.saveNewTicket('QRD Sprint 26', null, {});
  assert.equal((await service.preview('QRD Sprint 26')).find((change) => change.key === 'NEW-3')!.refused, 'Missing summary, User Story, Problem Definition, at least one AC line');
});

test('publish creates each new ticket in the sprint, records the key or the error, and one failure never stops the others', async () => {
  const { service, store, jira } = setup();
  await service.load(26, 'Alvin');
  await service.saveNewTicket('QRD Sprint 26', null, { ...NEW_TICKET, type: 'Story', epic: 'QRD-1233', dev: 'Aken', sp: 3, priority: 'High', reference: 'Discord: https://discord.com/x' });
  await service.saveNewTicket('QRD Sprint 26', null, { ...NEW_TICKET, summary: 'Boom' });
  await service.saveNewTicket('QRD Sprint 26', null, { ...NEW_TICKET, summary: '[FE] No problem yet', problem: '' });
  await service.saveNewTicket('QRD Sprint 26', null, { ...NEW_TICKET, summary: '[FE] Two Budis', dev: 'Budi' });
  jira.failSummary = 'Boom';
  const results = (await service.publish('QRD Sprint 26')).filter((result) => result.kind === 'create');
  assert.deepEqual(results, [
    { key: 'NEW-1', kind: 'create', status: 'created', detail: 'QRD-1601' },
    { key: 'NEW-2', kind: 'create', status: 'failed', detail: 'Jira responded 400: Request failed with status code 400 (customfield_10341: User Story is required)' },
    { key: 'NEW-3', kind: 'create', status: 'refused', detail: 'Missing Problem Definition' },
    { key: 'NEW-4', kind: 'create', status: 'created', detail: 'QRD-1602; created unassigned: more than one Jira user is named Budi' },
  ]);
  assert.deepEqual(jira.created[0], {
    project: { key: 'QRD' },
    issuetype: { name: 'Story' },
    summary: '[FE] Export the sprint plan',
    customfield_10341: adf(para(text('As a planner I want an export so I can share the plan'))),
    customfield_10331: adf(para(text('The plan cannot leave DOCK'))),
    customfield_10332: adf(bullets('The export holds every ticket')),
    customfield_10333: adf(bullets('Discord: https://discord.com/x')),
    customfield_10016: 3,
    customfield_10020: 26,
    parent: { key: 'QRD-1233' },
    labels: ['dock-plan'],
    priority: { name: 'High' },
    assignee: { accountId: 'acc-aken' },
  });
  assert.equal(jira.created[1].assignee, undefined, 'no single match leaves the ticket unassigned');
  assert.deepEqual(jira.created[1].priority, { name: 'Medium' });
  assert.equal('parent' in jira.created[1] || 'customfield_10016' in jira.created[1] || 'customfield_10333' in jira.created[1], false);
  assert.deepEqual(jira.accountLookups, [['QRD', 'Aken'], ['QRD', 'Budi']]);
  const after = (await service.view('QRD Sprint 26'))!.newTickets;
  assert.deepEqual(after.map((ticket) => [ticket.id, ticket.createdKey, ticket.error]), [
    ['NEW-1', 'QRD-1601', null],
    ['NEW-2', null, 'Jira responded 400: Request failed with status code 400 (customfield_10341: User Story is required)'],
    ['NEW-3', null, 'Missing Problem Definition'],
    ['NEW-4', 'QRD-1602', null],
  ]);
  assert.equal(store.draft.status, 'draft', 'a ticket that was not created keeps the draft unpublished');
  await assert.rejects(service.saveNewTicket('QRD Sprint 26', 'NEW-1', { sp: 5 }), /NEW-1 is already created in Jira as QRD-1601/);

  await service.saveNewTicket('QRD Sprint 26', 'NEW-2', { summary: '[FE] Fixed' });
  await service.saveNewTicket('QRD Sprint 26', 'NEW-3', { problem: 'Now written' });
  assert.deepEqual((await service.preview('QRD Sprint 26')).filter((change) => change.create).map((change) => change.key), ['NEW-2', 'NEW-3'], 'a created ticket is not created again');
  const second = (await service.publish('QRD Sprint 26')).filter((result) => result.kind === 'create');
  assert.deepEqual(second.map((result) => [result.key, result.status, result.detail]), [['NEW-2', 'created', 'QRD-1603'], ['NEW-3', 'created', 'QRD-1604']]);
  assert.equal(jira.created.length, 4);
  assert.equal((await service.view('QRD Sprint 26'))!.newTickets[1].error, null);
  assert.equal(store.draft.status, 'published');
});

test('the Jira client creates an issue and finds assignable users of a project by exact name', async () => {
  const calls: Array<[string, string, unknown]> = [];
  const client = new JiraSprintClient({
    get: async (url, params) => { calls.push(['get', url, params]); return [{ displayName: 'Aken', accountId: 'acc-1' }, { displayName: 'Aken Putra', accountId: 'acc-2' }]; },
    post: async (url, body) => { calls.push(['post', url, body]); return { id: '1', key: 'QRD-1601' }; },
  });
  assert.deepEqual(await client.projectAssignableAccounts('QRD', 'aken'), ['acc-1']);
  assert.deepEqual(calls[0], ['get', '/rest/api/3/user/assignable/search', { project: 'QRD', query: 'aken', maxResults: 50 }]);
  assert.equal(await client.createIssue({ summary: 'x' }), 'QRD-1601');
  assert.deepEqual(calls[1], ['post', '/rest/api/3/issue', { fields: { summary: 'x' } }]);
});

test('Create in Jira makes the chosen new tickets only: no AC, assignee or link is written and the draft stays unpublished', async () => {
  const { service, store, jira } = setup();
  await service.load(26, 'Alvin');
  await service.moveCards('QRD Sprint 26', ['QRD-1'], 'Aken').catch(() => undefined);
  await service.saveNewTicket('QRD Sprint 26', null, NEW_TICKET);
  await service.saveNewTicket('QRD Sprint 26', null, { ...NEW_TICKET, summary: '[FE] Second one' });
  const status = store.draft.status;
  const one = await service.createNewTicketsOnly('QRD Sprint 26', ['NEW-2']);
  assert.deepEqual(one.map((result) => [result.key, result.status, result.detail]), [['NEW-2', 'created', 'QRD-1601']]);
  assert.deepEqual(jira.writes, [], 'nothing but the new ticket reaches Jira');
  assert.equal(store.draft.status, status);
  assert.equal(store.draft.newTickets.find((ticket: any) => ticket.id === 'NEW-1').createdKey ?? null, null, 'a ticket not chosen waits');
  const rest = await service.createNewTicketsOnly('QRD Sprint 26', null);
  assert.deepEqual(rest.map((result) => [result.key, result.status]), [['NEW-1', 'created']]);
  await assert.rejects(service.createNewTicketsOnly('QRD Sprint 26', null), /no new ticket waiting to be created/);
  await assert.rejects(service.createNewTicketsOnly('QRD Sprint 26', ['NEW-9']), /NEW-9 is not a new ticket/);
});

test('the project of the new tickets comes from the sprint keys, QRD without any', () => {
  assert.equal(sprintProject(['ABC-1', 'ABC-2', 'QRD-3']), 'ABC');
  assert.equal(sprintProject([]), 'QRD');
});

test('an epic marked as having no storyboard says none until the mark is cleared', async () => {
  const store = new MemoryStore();
  const jira = new FakeJira([issue('QRD-1500', { epic: 'QRD-1300' })]);
  const storyboard = async (): Promise<never> => { throw new StoryboardMissing('No Confluence page titled "Storyboard" for QRD-1300.'); };
  const service = new SprintDraftService(store, async () => jira, predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, storyboard);
  const view = await service.load(26, 'Alvin');
  assert.deepEqual(view.storyboards.map((board) => [board.epic, board.none]), [['QRD-1300', false]]);
  const marked = await service.decide('QRD Sprint 26', 'sbnone|QRD-1300', 'none', null, 'Alvin');
  assert.deepEqual(marked.storyboards.map((board) => [board.epic, board.none]), [['QRD-1300', true]]);
  await assert.rejects(service.decide('QRD Sprint 26', 'sbnone|QRD-1300', 'checked', null, 'Alvin'), /marked with action none/);
  await assert.rejects(service.decide('QRD Sprint 26', 'sbnone|QRD-9999', 'none', null, 'Alvin'), /No ticket of QRD Sprint 26 belongs to QRD-9999/);
  const cleared = await service.decide('QRD Sprint 26', 'sbnone|QRD-1300', 'clear', null, 'Alvin');
  assert.equal(cleared.storyboards[0].none, false);
});

// ---- Revisions of tickets that exist in Jira ------------------------------------------------------------------------

const UPDATED = '2026-11-19T08:00:00.000+0700';

function revisionIssue(key: string, over: Partial<RevisionIssue> = {}, fields: Record<string, unknown> = {}): RevisionIssue {
  return {
    key, summary: `Ticket ${key}`, type: 'Story', updated: UPDATED,
    fields: {
      customfield_10341: adf(para(text('As a planner I want one export'))),
      customfield_10331: adf(para(text('The plan cannot leave DOCK'))),
      customfield_10332: adf(bullets('The client edits the skill', 'Changes wait for Publish')),
      customfield_10333: null,
      customfield_10337: 'Which format?',
      ...fields,
    },
    ...over,
  };
}

function revisionSetup() {
  const setupResult = setup();
  setupResult.jira.revisionIssues.set('QRD-1489', revisionIssue('QRD-1489'));
  setupResult.jira.revisionIssues.set('QRD-1602', revisionIssue('QRD-1602', { summary: 'Export in the backlog', type: 'Task' }));
  return setupResult;
}

test('a revision snapshots Jira when it is saved, replaces the pending one, and refuses what it may not change', async () => {
  const { service, jira, store } = revisionSetup();
  await service.load(26, 'Alvin');
  const saved = await service.saveRevision('QRD Sprint 26', 'qrd-1489', { summary: '[FE] Edit the skill', ac: ['The client edits the skill', 'Changes wait for the owner'], note: 'AC follows the thread' }, 'chat');
  assert.deepEqual(saved.revision, {
    key: 'QRD-1489', summary: 'Ticket QRD-1489', status: 'pending', note: 'AC follows the thread', source: 'chat',
    fields: [
      { name: 'summary', label: 'Summary', before: ['Ticket QRD-1489'], after: ['[FE] Edit the skill'] },
      { name: 'ac', label: 'Acceptance Criteria', before: ['The client edits the skill', 'Changes wait for Publish'], after: ['The client edits the skill', 'Changes wait for the owner'] },
    ],
    inSprint: true, error: null, createdAt: saved.revision.createdAt, appliedAt: null, flagReason: null, lint: { ok: true, findings: [] },
  });
  assert.equal(store.revisions[0].jiraUpdated, UPDATED);

  const backlog = await service.saveRevision('QRD Sprint 26', 'QRD-1602', { type: 'bug', openToConfirm: 'Who owns the export?\nCSV or XLSX?', reference: '- Discord: https://discord.com/x' }, 'chat');
  assert.equal(backlog.revision.inSprint, false, 'a backlog ticket is not in the sprint');
  assert.deepEqual(backlog.revision.fields.map((field) => [field.name, field.before, field.after]), [
    ['type', ['Task'], ['Bug']],
    ['reference', [], ['Discord: https://discord.com/x']],
    ['openToConfirm', ['Which format?'], ['Who owns the export?', 'CSV or XLSX?']],
  ]);

  const replaced = await service.saveRevision('QRD Sprint 26', 'QRD-1489', { userStory: 'As a planner I want two exports' }, 'chat');
  assert.deepEqual(replaced.revision.fields.map((field) => field.name), ['userStory'], 'a new revision replaces the pending one whole');
  assert.equal(replaced.revision.note, null);
  assert.equal(replaced.view.revisions.filter((item) => item.key === 'QRD-1489').length, 1);

  jira.revisionIssues.set('QRD-1489', revisionIssue('QRD-1489', { updated: '2026-11-20T09:00:00.000+0700' }, { customfield_10341: adf(para(text('Changed by a teammate'))), customfield_10331: adf(para(text('Problem now'))) }));
  const edited = await service.saveRevision('QRD Sprint 26', 'QRD-1489', { userStory: 'As a planner I want three exports', problem: 'Still no export' }, 'manual');
  assert.deepEqual(edited.revision.fields.map((field) => [field.name, field.before]), [['userStory', ['As a planner I want one export']], ['problem', ['Problem now']]], 'an edit from the panel keeps the snapshot of the fields it had');
  assert.equal(edited.revision.source, 'chat');
  assert.equal(store.revisions.find((item) => item.key === 'QRD-1489').jiraUpdated, UPDATED);
  const fresh = await service.saveRevision('QRD Sprint 26', 'QRD-1489', { userStory: 'As a planner I want three exports' }, 'chat');
  assert.deepEqual(fresh.revision.fields[0].before, ['Changed by a teammate'], 'the agent writing it again takes a new snapshot');

  const refused: Array<[unknown, RegExp]> = [
    [{}, /A revision changes at least one field/],
    [{ summary: null, ac: null }, /A revision changes at least one field/],
    [{ assignee: 'Aken' }, /assignee is not a field a revision may change/],
    [{ sprint: 27 }, /sprint is not a field a revision may change/],
    [{ summary: '  ' }, /Summary cannot be empty/],
    [{ summary: 'x'.repeat(201) }, /Summary is at most 200 characters/],
    [{ type: 'Epic' }, /Type is Task, Story or Bug/],
    [{ ac: Array.from({ length: 41 }, (_, index) => `Line ${index}`) }, /A revision holds at most 40 AC lines/],
    [{ ac: ['ok', 'x'.repeat(1001)] }, /AC line 2 is at most 1000 characters/],
    [{ userStory: 'x'.repeat(4001) }, /User Story is at most 4000 characters/],
    [{ problem: 'x'.repeat(4001) }, /Problem Definition is at most 4000 characters/],
    [{ reference: 'x'.repeat(2001) }, /Reference is at most 2000 characters/],
    [{ openToConfirm: 'x'.repeat(4001) }, /Open to confirm is at most 4000 characters/],
    [{ summary: 'Ok', source: 'sheet' }, /Source is chat or manual/],
    ['text', /revision must be an object/],
  ];
  for (const [input, message] of refused) await assert.rejects(service.saveRevision('QRD Sprint 26', 'QRD-1489', input, 'chat'), message);
  await assert.rejects(service.saveRevision('QRD Sprint 26', 'QRD-9999', { summary: 'Ok' }, 'chat'), /QRD-9999 is not in Jira/);
  await assert.rejects(service.saveRevision('QRD Sprint 26', 'not a key', { summary: 'Ok' }, 'chat'), /key must be a ticket key/);
  await assert.rejects(service.saveRevision('QRD Sprint 9', 'QRD-1489', { summary: 'Ok' }, 'chat'), /No draft for QRD Sprint 9/);

  for (let n = 1; n <= 28; n++) {
    jira.revisionIssues.set(`QRD-${2000 + n}`, revisionIssue(`QRD-${2000 + n}`));
    await service.saveRevision('QRD Sprint 26', `QRD-${2000 + n}`, { summary: 'Ok' }, 'chat');
  }
  jira.revisionIssues.set('QRD-2999', revisionIssue('QRD-2999'));
  await assert.rejects(service.saveRevision('QRD Sprint 26', 'QRD-2999', { summary: 'Ok' }, 'chat'), /at most 30 pending revisions/);
  await service.saveRevision('QRD Sprint 26', 'QRD-1489', { summary: 'Replaced at the limit' }, 'chat');
});

test('apply writes only the fields that differ from Jira now, in Jira format, and updates the draft ticket AC', async () => {
  const { service, jira } = revisionSetup();
  await service.load(26, 'Alvin');
  await service.saveRevision('QRD Sprint 26', 'QRD-1489', {
    summary: 'Ticket QRD-1489', type: 'Story', userStory: 'As a planner I want two exports\nSo the team sees them',
    ac: ['The client edits the skill', 'Changes wait for the owner'], openToConfirm: 'CSV only', problem: 'The plan cannot leave DOCK',
  }, 'chat');
  const result = await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu');
  assert.deepEqual(result, { key: 'QRD-1489', kind: 'revision', status: 'updated', detail: 'User Story, Acceptance Criteria, Open to confirm written to Jira' });
  assert.deepEqual(jira.edits, [['QRD-1489', {
    customfield_10341: adf(para(text('As a planner I want two exports')), para(text('So the team sees them'))),
    customfield_10332: adf(bullets('The client edits the skill', 'Changes wait for the owner')),
    customfield_10337: 'CSV only',
  }]], 'unchanged fields are not sent; a text field Jira holds as text stays text');
  assert.deepEqual(jira.writes, [], 'nothing else of the ticket is written');
  const view = (await service.view('QRD Sprint 26'))!;
  assert.deepEqual(view.tickets.find((ticket) => ticket.key === 'QRD-1489')!.ac, ['The client edits the skill', 'Changes wait for the owner'], 'the draft does not look stale');
  assert.deepEqual([view.revisions[0].status, view.revisions[0].appliedAt, view.revisions[0].error], ['applied', '2026-10-26T10:00:00.000Z', null]);
  jira.now.set('QRD-1489', issue('QRD-1489', { assignee: 'Aken', sp: 5, acRaw: adf(bullets('The client edits the skill', 'Changes wait for the owner')) }));
  assert.deepEqual((await service.preview('QRD Sprint 26')).filter((change) => change.key === 'QRD-1489'), [], 'publish does not see the applied AC as a change');
  await assert.rejects(service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu'), /QRD-1489 has no pending revision in the QRD Sprint 26 draft/);

  await service.saveRevision('QRD Sprint 26', 'QRD-1602', { summary: 'Export in the backlog' }, 'chat');
  assert.deepEqual((await service.view('QRD Sprint 26'))!.revisions.map((item) => [item.key, item.status]), [['QRD-1602', 'pending'], ['QRD-1489', 'applied']], 'pending first');
  assert.deepEqual(await service.applyRevision('QRD Sprint 26', 'QRD-1602', 'Danu'), { key: 'QRD-1602', kind: 'revision', status: 'updated', detail: 'Jira already holds these values' });
  assert.equal(jira.edits.length, 1, 'a revision Jira already holds writes nothing');
});

test('apply is refused when the ticket changed in Jira after the revision, and a failed write keeps the revision pending', async () => {
  const { service, jira } = revisionSetup();
  await service.load(26, 'Alvin');
  await service.saveRevision('QRD Sprint 26', 'QRD-1489', { summary: '[FE] Edit the skill' }, 'chat');
  jira.revisionIssues.set('QRD-1489', revisionIssue('QRD-1489', { updated: '2026-11-20T10:00:00.000+0700' }));
  const refused = await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu');
  assert.deepEqual(refused, { key: 'QRD-1489', kind: 'revision', status: 'refused', detail: 'QRD-1489 changed in Jira after this revision was written; ask the agent to write it again' });
  assert.deepEqual(jira.edits, []);
  let revision = (await service.view('QRD Sprint 26'))!.revisions[0];
  assert.deepEqual([revision.status, revision.error], ['pending', refused.detail]);

  await service.saveRevision('QRD Sprint 26', 'QRD-1489', { summary: '[FE] Edit the skill' }, 'chat');
  jira.failEdit = Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { errorMessages: [], errors: { summary: 'Summary is too long' } } } });
  const failed = await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu');
  assert.deepEqual(failed, { key: 'QRD-1489', kind: 'revision', status: 'failed', detail: 'Jira responded 400: Request failed with status code 400 (summary: Summary is too long)' });
  revision = (await service.view('QRD Sprint 26'))!.revisions[0];
  assert.deepEqual([revision.status, revision.error], ['pending', failed.detail]);

  jira.revisionIssues.delete('QRD-1489');
  assert.deepEqual(await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu'), { key: 'QRD-1489', kind: 'revision', status: 'failed', detail: 'QRD-1489 is not in Jira' });
});

test('discard keeps the revision as history and leaves it out of the draft', async () => {
  const { service, store } = revisionSetup();
  await service.load(26, 'Alvin');
  await service.saveRevision('QRD Sprint 26', 'QRD-1489', { summary: '[FE] Edit the skill' }, 'chat');
  const view = await service.discardRevision('QRD Sprint 26', 'qrd-1489');
  assert.deepEqual(view.revisions, []);
  assert.equal(store.revisions[0].status, 'discarded');
  await assert.rejects(service.discardRevision('QRD Sprint 26', 'QRD-1489'), /QRD-1489 has no pending revision/);
  await assert.rejects(service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu'), /QRD-1489 has no pending revision/);
  const again = await service.saveRevision('QRD Sprint 26', 'QRD-1489', { summary: '[FE] Edit it again' }, 'chat');
  assert.equal(again.view.revisions.length, 1, 'a discarded revision does not hold a new one');
  assert.equal(store.revisions.length, 2);
});

test('the Jira client reads the revision fields with updated and writes an edit in one PUT', async () => {
  const calls: Array<[string, string, unknown]> = [];
  const client = new JiraSprintClient({
    get: async (url, params) => {
      calls.push(['get', url, params]);
      if (url.endsWith('QRD-404')) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      return { key: 'QRD-1602', fields: { summary: 'Export', issuetype: { name: 'Task' }, updated: UPDATED, customfield_10332: 'x' } };
    },
    post: async () => ({}),
    put: async (url, body) => { calls.push(['put', url, body]); },
  });
  assert.deepEqual(await client.revisionIssueNow('QRD-1602'), { key: 'QRD-1602', summary: 'Export', type: 'Task', updated: UPDATED, fields: { summary: 'Export', issuetype: { name: 'Task' }, updated: UPDATED, customfield_10332: 'x' } });
  assert.deepEqual(calls[0], ['get', '/rest/api/3/issue/QRD-1602', { fields: 'summary,issuetype,updated,customfield_10341,customfield_10330,customfield_10331,customfield_10332,customfield_10333,customfield_10337' }]);
  assert.equal(await client.revisionIssueNow('QRD-404'), null);
  await client.editIssue('QRD-1602', { summary: 'New' });
  assert.deepEqual(calls.at(-1), ['put', '/rest/api/3/issue/QRD-1602', { fields: { summary: 'New' } }]);
});

const BLOCKED_NEW = { ...NEW_TICKET, ac: ['The export works correctly.'] };

test('Create in Jira refuses a new ticket below the writing standard, and lets it in with a reason and the WRITING-FLAG label', async () => {
  const { service, jira, store } = setup();
  await service.load(26, 'Alvin');
  await service.saveNewTicket('QRD Sprint 26', null, BLOCKED_NEW);
  const view = (await service.view('QRD Sprint 26'))!;
  assert.equal(view.newTickets[0].lint.ok, false);
  assert.deepEqual(view.newTickets[0].lint.findings.map((item) => item.rule), ['W2']);
  assert.match((await service.preview('QRD Sprint 26')).find((change) => change.key === 'NEW-1')!.refused ?? '', /^Below the writing standard: AC 1 says "works correctly"/);
  const refused = await service.createNewTicketsOnly('QRD Sprint 26', ['NEW-1']);
  assert.deepEqual(refused.map((result) => [result.key, result.status]), [['NEW-1', 'refused']]);
  assert.match(refused[0].detail ?? '', /Create or apply it with a flag and a reason/);
  assert.equal(jira.created.length, 0, 'nothing reaches Jira');
  await assert.rejects(service.createNewTicketsOnly('QRD Sprint 26', ['NEW-1'], { reason: 'ok' }), /flag reason is 5 to 300 characters/);
  await assert.rejects(service.createNewTicketsOnly('QRD Sprint 26', ['NEW-1'], { reason: 'x'.repeat(301) }), /flag reason is 5 to 300 characters/);
  const flagged = await service.createNewTicketsOnly('QRD Sprint 26', ['NEW-1'], { reason: 'The PO agreed to write the AC later' });
  assert.deepEqual(flagged.map((result) => [result.key, result.status]), [['NEW-1', 'created']]);
  assert.deepEqual(jira.created[0].labels, ['dock-plan', 'WRITING-FLAG']);
  assert.equal(store.draft.newTickets[0].flagReason, 'The PO agreed to write the AC later');
  assert.equal((await service.view('QRD Sprint 26'))!.newTickets[0].flagReason, 'The PO agreed to write the AC later');
});

test('a new ticket that meets the standard is created without the flag label and a reason is not stored', async () => {
  const { service, jira, store } = setup();
  await service.load(26, 'Alvin');
  await service.saveNewTicket('QRD Sprint 26', null, NEW_TICKET);
  await service.createNewTicketsOnly('QRD Sprint 26', ['NEW-1'], { reason: 'not needed here' });
  assert.deepEqual(jira.created[0].labels, ['dock-plan']);
  assert.equal(store.draft.newTickets[0].flagReason ?? null, null);
});

test('Apply refuses a revision below the writing standard, and applies it with a reason and the WRITING-FLAG label', async () => {
  const { service, jira, store } = revisionSetup();
  const labels: Array<[string, string]> = [];
  (jira as unknown as { addLabel: (key: string, label: string) => Promise<void> }).addLabel = async (key, label) => { labels.push([key, label]); };
  await service.load(26, 'Alvin');
  const saved = await service.saveRevision('QRD Sprint 26', 'QRD-1489', { ac: ['The client edits the skill', 'It behaves as expected.'] }, 'chat');
  assert.equal(saved.revision.lint.ok, false);
  assert.deepEqual(saved.revision.lint.findings.map((item) => [item.rule, item.line]), [['W2', 2]]);
  const refused = await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu');
  assert.equal(refused.status, 'refused');
  assert.match(refused.detail ?? '', /^Below the writing standard/);
  assert.deepEqual([jira.edits, labels], [[], []], 'nothing reaches Jira');
  assert.match(store.revisions[0].error, /Below the writing standard/);
  await assert.rejects(service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu', { reason: 'no' }), /flag reason is 5 to 300 characters/);
  const result = await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu', { reason: 'Owner accepted the wording' });
  assert.equal(result.status, 'updated');
  assert.equal(jira.edits.length, 1);
  assert.deepEqual(labels, [['QRD-1489', 'WRITING-FLAG']]);
  assert.equal(store.revisions[0].flagReason, 'Owner accepted the wording');
  assert.equal((await service.view('QRD Sprint 26'))!.revisions[0].flagReason, 'Owner accepted the wording');
});

test('a revision that meets the standard applies without a reason and without the label', async () => {
  const { service, jira } = revisionSetup();
  const labels: Array<[string, string]> = [];
  (jira as unknown as { addLabel: (key: string, label: string) => Promise<void> }).addLabel = async (key, label) => { labels.push([key, label]); };
  await service.load(26, 'Alvin');
  await service.saveRevision('QRD Sprint 26', 'QRD-1489', { ac: ['The client edits the skill', 'Changes wait for the owner'] }, 'chat');
  assert.equal((await service.applyRevision('QRD Sprint 26', 'QRD-1489', 'Danu')).status, 'updated');
  assert.deepEqual(labels, []);
});

test('Publish adds WRITING-FLAG to sprint tickets with a block finding and leaves the others and the flagged ones alone', async () => {
  const { service, jira } = setup();
  const labels: Array<[string, string]> = [];
  (jira as unknown as { addLabel: (key: string, label: string) => Promise<void> }).addLabel = async (key, label) => { labels.push([key, label]); };
  const view = await service.load(26, 'Alvin');
  assert.deepEqual(view.tickets.filter((ticket) => !ticket.lint.ok).map((ticket) => ticket.key), ['QRD-1511'], 'W3: its AC names tickets it has no link to');
  const results = await service.publish('QRD Sprint 26', 'Danu');
  assert.deepEqual(labels.filter(([, label]) => label === 'WRITING-FLAG'), [['QRD-1511', 'WRITING-FLAG']]);
  const line = results.find((result) => result.key === 'Writing flag');
  assert.deepEqual([line?.kind, line?.status], ['label', 'updated']);
  jira.issues = jira.issues.map((item) => (item.key === 'QRD-1511' ? { ...item, labels: ['WRITING-FLAG'] } : item));
  labels.length = 0;
  await service.publish('QRD Sprint 26', 'Danu');
  assert.deepEqual(labels.filter(([, label]) => label === 'WRITING-FLAG'), [], 'a ticket that already carries it is not labelled again');
});

test('Load from Jira stores the type, description, User Story and Problem, so the draft check runs W4 and W7 too', async () => {
  const { service, jira, store } = setup();
  jira.issues = [
    issue('QRD-2001', { type: 'Bug', acRaw: '- The save button works.', descriptionRaw: 'Clicking Save does nothing.', userStoryRaw: adf(para(text('As a planner I want it saved'))), problemRaw: adf(para(text('Save is broken'))) } as Partial<PlanningIssue>),
    issue('QRD-2002', { type: 'Task', acRaw: '- The list shows 3 rows.', descriptionRaw: null, userStoryRaw: null, problemRaw: adf(para(text('No story'))) } as Partial<PlanningIssue>),
    issue('QRD-2003', { type: 'Bug', acRaw: '- Expected: it saves.\n- Actual: nothing happens.', userStoryRaw: adf(para(text('As a planner I want it'))), problemRaw: adf(para(text('p'))) } as Partial<PlanningIssue>),
  ];
  const view = await service.load(26, 'Alvin');
  const lintOf = (key: string) => view.tickets.find((ticket) => ticket.key === key)!.lint.findings.map((item) => item.rule);
  assert.deepEqual(lintOf('QRD-2001').filter((rule) => rule === 'W4'), ['W4'], 'a Bug without Expected and Actual is blocked');
  assert.deepEqual(lintOf('QRD-2002').filter((rule) => rule === 'W7'), ['W7'], 'an empty User Story is a note');
  assert.deepEqual(lintOf('QRD-2003').filter((rule) => rule === 'W4' || rule === 'W7'), []);
  const stored = store.draft.tickets.find((ticket: any) => ticket.key === 'QRD-2001');
  assert.deepEqual([stored.issueType, stored.description, stored.userStory, stored.problem], ['Bug', 'Clicking Save does nothing.', 'As a planner I want it saved', 'Save is broken']);
  store.draft.tickets.forEach((ticket: any) => Object.assign(ticket, { issueType: null, description: null, userStory: null, problem: null }));
  const old = (await service.view('QRD Sprint 26'))!;
  assert.deepEqual(old.tickets.flatMap((ticket) => ticket.lint.findings.map((item) => item.rule)).filter((rule) => rule === 'W4' || rule === 'W7'), [], 'a draft loaded before the fields were read skips W4 and W7');
});

test('the refresh adds tickets that joined the sprint after the last load, lints them, and leaves the planner calls alone', async () => {
  const { service, jira, store } = setup();
  const loaded = await service.load(26, 'Alvin');
  await service.updateTicket('QRD Sprint 26', 'QRD-1489', { dev: 'Aken', wave: 2 });
  await service.decide('QRD Sprint 26', loaded.findings[0].id, 'reference', null, 'Alvin');
  const before = (await service.view('QRD Sprint 26'))!;
  jira.issues = [...jira.issues, issue('QRD-9100', { acRaw: '- TBD', sp: 1 }), issue('QRD-9101', { acRaw: '- The list shows 3 rows.', sp: 1 })];
  const added = await service.refreshNewTickets();
  assert.deepEqual(added, { 'QRD Sprint 26': ['QRD-9100', 'QRD-9101'] });
  const view = (await service.view('QRD Sprint 26'))!;
  assert.deepEqual(view.addedSince, ['QRD-9100', 'QRD-9101']);
  assert.deepEqual(view.tickets.map((ticket) => ticket.key).filter((key) => key.startsWith('QRD-91')).sort(), ['QRD-9100', 'QRD-9101']);
  assert.deepEqual(view.tickets.find((ticket) => ticket.key === 'QRD-9100')!.lint.findings.filter((item) => item.level === 'block').map((item) => item.rule), ['W1'], 'the new ticket is linted');
  const mine = (key: string, source: typeof before) => source.tickets.find((ticket) => ticket.key === key)!;
  assert.deepEqual([mine('QRD-1489', view).dev, mine('QRD-1489', view).wave], [mine('QRD-1489', before).dev, mine('QRD-1489', before).wave], 'the planner change stays');
  assert.equal(view.findings.find((finding) => finding.id === loaded.findings[0].id)?.decision?.action, 'reference', 'the owner decision stays');
  assert.equal(store.draft.tickets.length, before.tickets.length + 2);
  assert.deepEqual(await service.refreshNewTickets(), {}, 'the refresh runs at most once an hour');
  assert.deepEqual(await service.addNewTickets('QRD Sprint 26'), [], 'a ticket already in the draft is not added again');
  assert.equal((await service.load(26, 'Alvin')).addedSince.length, 0, 'a load starts the count again');
});

test('the refresh does nothing on a DOCK that is not the planner\'s, and for a sprint that is no longer open', async () => {
  const guarded = new SprintDraftService(new MemoryStore(), async () => new FakeJira([issue('QRD-1')]), predictions({}), () => new Date('2026-10-26T10:00:00Z'), undefined, undefined, undefined, async () => 'Only Danu can change the draft');
  assert.deepEqual(await guarded.refreshNewTickets(), {});
  const { service, jira } = setup();
  await service.load(26, 'Alvin');
  jira.listSprints = async () => [{ ...SPRINT, id: 99 }];
  jira.issues = [...jira.issues, issue('QRD-9200')];
  assert.deepEqual(await service.refreshNewTickets(), {});
});
