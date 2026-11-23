import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { panelOf, planningRoute } from '../agents/plan';
import {
  UNASSIGNED, acLineId, capacityOf, countedNewTickets, draftSummaryText, freshAcId, newTicketMissing, publishReadiness, storyboardNoneId, translatePrompt, unrecordedEpics, untranslatedKeys,
  type DraftFinding, type TicketSummaryLite, type DraftNewTicket, type DraftTicket, type SprintDraft, type StoryboardState,
} from '../agents/planning';
import { barIssues, boardCards, boardLanes, cardShown, chatFoldedOf, chatFoldedValue, filterCounts, findingGroups, keyParts, newTicketForm, newTicketInput, outsidePlanOpen, panelBadge, teamViewOf } from '../agents/boardLogic';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const ticket = (over: Partial<DraftTicket>): DraftTicket => ({
  key: 'QRD-1', summary: 'One', dev: 'Danu', jiraDev: 'Danu', sp: 3, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [],
  start: 0, dur: 1.5, end: 1.5, inSprint: true, split: null, prediction: null, qaDecision: null, epic: null, frames: [], storyboard: null, tcs: [], tcStale: false, tcPending: false,
  merge: 'open', pulls: [], jiraAhead: false, merged: false, rank: null, planStart: 0, planDur: 1.5, ...over,
});
const finding = (over: Partial<DraftFinding>): DraftFinding => ({ id: 'x', key: 'QRD-1', line: 1, text: 't', refKey: 'QRD-2', kind: 'lands-first', refEnd: 1, ownEnd: 2, decision: null, ...over });
const fresh = (over: Partial<DraftNewTicket>): DraftNewTicket => ({
  id: 'NEW-1', summary: '[BE] Email CC', type: 'Task', epic: null, dev: 'Danu', sp: 3, priority: null, userStory: 'As a user I want CC so it reaches them', problem: 'CC is ignored', ac: ['CC resolves variables'],
  reference: null, source: 'sheet row 2', createdKey: null, error: null, ...over,
});
const board = (over: Partial<StoryboardState>): StoryboardState => ({ epic: 'QRD-1531', version: null, previous: null, path: null, page: null, frames: 0, changed: [], changedAt: null, checkedAt: '', error: null, ...over });
const draft = (over: Partial<SprintDraft>): SprintDraft => ({
  sprint: 'QRD Sprint 27', sprintId: 1, status: 'draft', sprintDays: 10, startDate: null, spPerDay: 1, createdBy: null, loadedAt: '', publishedAt: null, qaReason: null,
  devs: ['Danu', 'Aken'], blockers: [], canPublish: true, landed: 0, today: null, tickets: [], findings: [], storyboards: [], questions: [],
  developers: [{ name: 'Danu', merged: 0, open: 1, sp: 3, leftSp: 3, end: null }, { name: 'Aken', merged: 0, open: 1, sp: 3, leftSp: 3, end: null }], mergeSource: 'github', moves: [], newTickets: [], ...over,
});

test('the board has a lane per developer in draft order, a named developer from a new ticket after, and Unassigned last', () => {
  const lanes = boardLanes(draft({
    tickets: [ticket({ key: 'QRD-2', start: 2 }), ticket({ key: 'QRD-1' }), ticket({ key: 'QRD-3', dev: null, sp: 2 }), ticket({ key: 'QRD-4', dev: 'Aken', sp: 8, left: 5 })],
    newTickets: [fresh({ id: 'NEW-1', dev: 'Yusril', sp: 4 }), fresh({ id: 'NEW-2', dev: null, sp: 1 })],
  }), 6);
  assert.deepEqual(lanes.map((lane) => lane.dev), ['Danu', 'Aken', 'Yusril', UNASSIGNED]);
  assert.deepEqual(lanes[0].cards.map((card) => card.key), ['QRD-1', 'QRD-2'], 'schedule order inside a lane');
  assert.deepEqual([lanes[1].load, lanes[1].over], [5, false], 'the load counts SP left once the sprint runs');
  assert.deepEqual([lanes[2].load, lanes[2].cards[0].isNew], [4, true]);
  assert.deepEqual(lanes[3].cards.map((card) => card.key), ['QRD-3', 'NEW-2']);
  assert.equal(lanes[3].share, 0);
  assert.equal(boardLanes(draft({ tickets: [ticket({ sp: 7 })] }), 6)[0].over, true);
  assert.equal(boardLanes(draft({ tickets: [ticket({})] }), 6).some((lane) => lane.dev === UNASSIGNED), false, 'no Unassigned lane when every card has a developer');
});

test('a card shows an orange dot for an undecided AC reference and a violet dot for a storyboard not recorded or an AC to check', () => {
  const cards = boardCards(draft({
    tickets: [
      ticket({ key: 'QRD-1', epic: 'QRD-1531' }), ticket({ key: 'QRD-2', epic: 'QRD-1547' }), ticket({ key: 'QRD-3', epic: 'QRD-913' }),
      ticket({ key: 'QRD-4', storyboard: { version: 2, frames: ['F1'], held: false, checked: null } }),
    ],
    findings: [finding({ id: 'a', key: 'QRD-1' }), finding({ id: 'b', key: 'QRD-2', linked: true }), finding({ id: 'c', key: 'QRD-3', decision: { action: 'reference', note: null, by: null, at: '' } })],
    storyboards: [board({ epic: 'QRD-1531' }), board({ epic: 'QRD-1547', version: 3 }), board({ epic: 'QRD-913', none: true })],
  }));
  assert.deepEqual(cards.map((card) => [card.key, card.flags.ac, card.flags.sb]), [['QRD-1', true, true], ['QRD-2', false, false], ['QRD-3', false, false], ['QRD-4', false, true]]);
  assert.deepEqual(filterCounts(cards), { ac: 1, sb: 2, new: 0, writing: 0 });
});

test('a filter dims the cards it does not keep; All keeps every card', () => {
  const plain = { flags: { ac: false, sb: false }, isNew: false };
  const acCard = { flags: { ac: true, sb: false }, isNew: false };
  const newCard = { flags: { ac: false, sb: false }, isNew: true };
  assert.deepEqual([plain, acCard, newCard].map((card) => cardShown(card, 'all')), [true, true, true]);
  assert.deepEqual([plain, acCard, newCard].map((card) => cardShown(card, 'ac')), [false, true, false]);
  assert.deepEqual([plain, acCard, newCard].map((card) => cardShown(card, 'new')), [false, false, true]);
  assert.deepEqual([plain, acCard, newCard].map((card) => cardShown(card, 'sb')), [false, false, false]);
});

test('a new ticket Publish created and the load already brought in is counted once, as the Jira ticket', () => {
  const loaded = draft({ tickets: [ticket({ key: 'QRD-1600', sp: 3 })], newTickets: [fresh({ id: 'NEW-1', createdKey: 'QRD-1600', sp: 3 }), fresh({ id: 'NEW-2', createdKey: 'QRD-1601', sp: 2 }), fresh({ id: 'NEW-3', sp: 5 })] });
  assert.deepEqual(countedNewTickets(loaded).map((item) => item.id), ['NEW-2', 'NEW-3'], 'a created key not loaded yet still counts');
  assert.equal(capacityOf(loaded).sp, 10);
  assert.deepEqual(boardCards(loaded).map((card) => card.key), ['QRD-1600', 'NEW-2', 'NEW-3']);
  assert.equal(boardCards(loaded)[1].createdKey, 'QRD-1601');
  const capacity = capacityOf(draft({ today: 3 }));
  assert.deepEqual([capacity.days, capacity.perDev, capacity.capacity], [8, 8, 16]);
});

test('Siap publish counts the SP of new tickets against the capacity', () => {
  const tight = draft({ sprintDays: 2, tickets: [ticket({ sp: 3 })], newTickets: [fresh({ sp: 2 })] });
  const scope = publishReadiness(tight, null);
  assert.deepEqual([scope.sp, scope.capacity, scope.items.find((item) => item.id === 'scope')!.ok], [5, 4, false]);
  assert.equal(publishReadiness({ ...tight, newTickets: [] }, null).items.find((item) => item.id === 'scope')!.ok, true);
});

test('Siap publish lists new tickets only when some are not created, and each needs the Jira fields and a developer', () => {
  const none = publishReadiness(draft({}), null);
  assert.equal(none.items.some((item) => item.id === 'new'), false, 'no row while no new ticket waits');
  const created = publishReadiness(draft({ newTickets: [fresh({ createdKey: 'QRD-1600' })] }), null);
  assert.equal(created.items.some((item) => item.id === 'new'), false);
  const ok = publishReadiness(draft({ newTickets: [fresh({})] }), null).items.find((item) => item.id === 'new')!;
  assert.deepEqual([ok.ok, ok.text, ok.panel], [true, '1 new ticket ready to create', 'new']);
  const work = publishReadiness(draft({ newTickets: [fresh({}), fresh({ id: 'NEW-2', dev: null }), fresh({ id: 'NEW-3', ac: [] }), fresh({ id: 'NEW-4', error: 'Field customfield_10341 is required' })] }), null);
  const item = work.items.find((entry) => entry.id === 'new')!;
  assert.deepEqual([item.ok, item.text, item.detail], [false, '3 of 4 new tickets need a field or a developer', 'NEW-2, NEW-3, NEW-4']);
  assert.ok(work.missing.includes(item));
  assert.deepEqual(newTicketMissing(fresh({ summary: ' ', userStory: '', problem: '', ac: [' '] })), ['summary', 'user story', 'problem definition', 'AC']);
  const skipAll = { template: null, stages: (['scope', 'ac', 'storyboard'] as const).map((id) => ({ id, skip: true, owner: 'Planner', approve: false })) };
  assert.deepEqual(publishReadiness(draft({ newTickets: [fresh({})] }), skipAll as never).items.map((entry) => entry.id), ['new'], 'new tickets are not a stage the flow can skip');
});

test('an epic marked "No storyboard" counts as recorded', () => {
  const tickets = [ticket({ key: 'QRD-1', epic: 'QRD-1531' }), ticket({ key: 'QRD-2', epic: 'QRD-913' })];
  const open = draft({ tickets, storyboards: [board({ epic: 'QRD-1531', version: 4 }), board({ epic: 'QRD-913' })] });
  assert.deepEqual(unrecordedEpics(open), ['QRD-913']);
  assert.equal(publishReadiness(open, null).items.find((item) => item.id === 'storyboard')!.ok, false);
  const decided = draft({ tickets, storyboards: [board({ epic: 'QRD-1531', version: 4 }), board({ epic: 'QRD-913', none: true })] });
  assert.deepEqual(unrecordedEpics(decided), []);
  const item = publishReadiness(decided, null).items.find((entry) => entry.id === 'storyboard')!;
  assert.deepEqual([item.ok, item.detail], [true, 'QRD-1531 v4, QRD-913 none']);
  assert.deepEqual(unrecordedEpics(draft({ tickets: [ticket({ epic: 'QRD-17' })] })), ['QRD-17'], 'an epic of a ticket with no storyboard entry is not recorded');
  assert.equal(storyboardNoneId('QRD-913'), 'sbnone|QRD-913');
});

test('bulk "outside plan → Reference" takes only the undecided outside-plan lines of that ticket', () => {
  const findings = [
    finding({ id: 'a', key: 'QRD-1555', kind: 'outside-plan' }), finding({ id: 'b', key: 'QRD-1555', kind: 'outside-plan', line: 2 }),
    finding({ id: 'c', key: 'QRD-1555', kind: 'outside-plan', line: 3, decision: { action: 'dependency', note: null, by: null, at: '' } }),
    finding({ id: 'd', key: 'QRD-1555', kind: 'outside-plan', line: 4, linked: true }), finding({ id: 'e', key: 'QRD-1555', kind: 'lands-first', line: 5 }),
    finding({ id: 'f', key: 'QRD-1555', kind: 'after-it', line: 6 }), finding({ id: 'g', key: 'QRD-1556', kind: 'outside-plan' }),
  ];
  assert.deepEqual(outsidePlanOpen(findings, 'QRD-1555').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(findingGroups(findings).map((group) => [group.key, group.findings.length]), [['QRD-1555', 6], ['QRD-1556', 1]]);
  const tab = source('../agents/PlanningTab.tsx');
  assert.match(tab, /All \{outside\.length\} outside plan → Reference/);
  assert.match(tab, /action: 'reference'/);
});

test('the tabs carry counts for AC check, Storyboard and New tickets, and the bottom bar the same counts', () => {
  const sample = draft({
    tickets: [ticket({ key: 'QRD-1', epic: 'QRD-1531', storyboard: { version: 1, frames: ['F1'], held: false, checked: null } }), ticket({ key: 'QRD-2', carried: true, storyboard: { version: 1, frames: ['F2'], held: false, checked: null } })],
    findings: [finding({ id: 'a' }), finding({ id: 'b', linked: true })],
    storyboards: [board({ epic: 'QRD-1531' })],
    newTickets: [fresh({}), fresh({ id: 'NEW-2', dev: null }), fresh({ id: 'NEW-3', createdKey: 'QRD-1600' })],
  });
  assert.deepEqual(['ac', 'storyboard', 'new', 'team'].map((panel) => panelBadge(panel as never, sample)), [1, 2, 2, 0]);
  assert.deepEqual(barIssues(sample), { ac: 1, epics: 1, checks: 1, fresh: 2, needWork: 1, revisions: 0, writing: 0 });
});

test('the new ticket form reads back into the save input, and says which field does not read', () => {
  const form = newTicketForm(fresh({ ac: ['One', 'Two'], sp: 2.5, epic: 'QRD-1531' }));
  assert.equal(form.ac, 'One\nTwo');
  assert.deepEqual(newTicketInput({ ...form, ac: ' One \n\n Two ', dev: '', epic: 'qrd-1531', reference: ' ' }), {
    input: { summary: '[BE] Email CC', type: 'Task', epic: 'QRD-1531', dev: null, sp: 2.5, priority: 'Medium', userStory: 'As a user I want CC so it reaches them', problem: 'CC is ignored', ac: ['One', 'Two'], reference: null },
    error: null,
  });
  assert.equal(newTicketInput({ ...form, summary: ' ' }).error, 'Write a summary');
  assert.equal(newTicketInput({ ...form, sp: '120' }).error, 'SP is a number from 0 to 100');
  assert.equal(newTicketInput({ ...form, epic: 'Billing' }).error, 'Epic is a key such as QRD-1531');
  assert.equal(newTicketInput({ ...form, sp: '' }).input.sp, null);
  assert.deepEqual(newTicketForm(null), { summary: '', type: 'Task', epic: '', dev: '', sp: '', priority: 'Medium', userStory: '', problem: '', ac: '', reference: '' });
});

test('the old Plan page opens Draft on the Order panel, and Order and New tickets are panels the URL can name', () => {
  assert.deepEqual(planningRoute('?tab=plan'), { tab: 'draft', panel: 'order' });
  assert.equal(panelOf('?tab=draft&panel=new', 'team'), 'new');
  assert.equal(panelOf('?tab=draft&panel=order', 'team'), 'order');
  const page = source('../pages/PlanningPage.tsx');
  assert.match(page, /params\.get\('tab'\) !== 'plan'/);
  assert.match(page, /params\.set\('panel', 'order'\)/);
});

test('Team map opens on Board and remembers Schedule; the chat column remembers being folded', () => {
  assert.equal(teamViewOf(null), 'board');
  assert.equal(teamViewOf('schedule'), 'schedule');
  assert.equal(teamViewOf('nope'), 'board');
  assert.equal(chatFoldedOf(null), false);
  assert.equal(chatFoldedOf(chatFoldedValue(true)), true);
  assert.equal(chatFoldedOf(chatFoldedValue(false)), false);
  const tab = source('../agents/PlanningTab.tsx');
  assert.match(tab, /<fieldset disabled=\{readOnly\} className="contents"><TeamPanel draft=\{draft\} plan=\{plan\} busy=\{busy\} onMove=\{onMove\} \/><\/fieldset>/, 'Schedule is the old team map, still read-only for a developer');
  assert.doesNotMatch(tab, /ReadyBlock/);
});

test('the publish dialog lists the tickets it will create and shows the keys Jira gave them', () => {
  const tab = source('../agents/PlanningTab.tsx');
  assert.match(tab, /Create in Jira · \{creates\.length\}/);
  assert.match(tab, /result\.kind === 'create' && result\.status === 'created'/);
  const queries = source('../graphql/queries.ts');
  assert.match(queries, /refused create \{ \$\{SPRINT_DRAFT_NEW_TICKET_FIELDS\} \}/);
  assert.match(queries, /saveSprintDraftNewTicket\(sprint: \$sprint, id: \$id, input: \$input\)/);
  assert.match(queries, /removeSprintDraftNewTicket\(sprint: \$sprint, id: \$id\)/);
  assert.match(queries, /previousHtmlUrl none/);
});

test('the Draft summary is one plain line of tickets, days and developers, singular when one', () => {
  assert.equal(draftSummaryText(draft({ tickets: [ticket({ key: 'QRD-1' }), ticket({ key: 'QRD-2' })], sprintDays: 7, devs: ['A', 'B'] })), '2 tickets · 7 days · 2 dev');
  assert.equal(draftSummaryText(draft({ tickets: [ticket({ key: 'QRD-1' })], sprintDays: 1, devs: ['A'] })), '1 ticket · 1 day · 1 dev');
  const tab = source('../agents/PlanningTab.tsx');
  assert.doesNotMatch(tab, /AC waiting on other tickets|\} need a decision|storyboard changed/);
});

test('AC check takes the Indonesian line only from a summary written for the AC the ticket holds now', () => {
  const own = ticket({ key: 'QRD-1', ac: ['Line one', 'Line two'], acHash: 'h1' });
  const summary = (over: Partial<TicketSummaryLite>): TicketSummaryLite => ({ key: 'QRD-1', titleId: null, acId: ['Baris satu', 'Baris dua'], current: true, testData: null, acHash: 'h1', ...over });
  assert.equal(acLineId(own, summary({}), 2), 'Baris dua', 'finding.ac is 1-based');
  assert.equal(acLineId(own, summary({ current: false }), 1), null, 'a summary of older AC is hidden');
  assert.equal(acLineId(own, summary({ acHash: 'h0' }), 1), null, 'another hash is hidden');
  assert.equal(acLineId(own, summary({ acId: ['Baris satu'] }), 1), null, 'a count that differs is hidden');
  assert.equal(acLineId(own, summary({ acId: ['Baris satu', ' '] }), 2), null, 'an empty line shows nothing');
  assert.equal(acLineId(own, undefined, 1), null);
  assert.deepEqual(freshAcId(ticket({ ac: ['a', 'b'] }), summary({ acHash: undefined })), ['Baris satu', 'Baris dua'], 'without hashes the server flag decides');
  const plan = draft({ tickets: [own, ticket({ key: 'QRD-2', ac: ['x'] }), ticket({ key: 'QRD-3', ac: ['y'] })] });
  const summaries = new Map([['QRD-1', summary({})], ['QRD-3', summary({ key: 'QRD-3', acId: ['y id'], current: false })]]);
  assert.deepEqual(untranslatedKeys(plan, ['QRD-1', 'QRD-2', 'QRD-3'], summaries), ['QRD-2', 'QRD-3']);
  assert.equal(translatePrompt('QRD Sprint 27', ['QRD-2', 'QRD-3']), 'Write the Indonesian ticket summaries (sprint-draft summary) for QRD-2, QRD-3 in sprint "QRD Sprint 27": the Indonesian title and one Indonesian line per AC line.');
});

test('an AC line is cut around the ticket it names, not around a longer key', () => {
  assert.deepEqual(keyParts('Wait for qrd-12 and QRD-123', 'QRD-12'), [{ text: 'Wait for ', hit: false }, { text: 'qrd-12', hit: true }, { text: ' and QRD-123', hit: false }]);
  assert.deepEqual(keyParts('No key', 'QRD-9'), [{ text: 'No key', hit: false }]);
});
