import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DraftNewTicket, DraftRevision } from '../agents/planning';
import { barIssues, panelBadge } from '../agents/boardLogic';
import { acLineDiff, pendingRevisions, revisionFieldLabel, revisionFieldNames, revisionFields, revisionForm, revisionInput, ticketsToReview } from '../agents/revisions';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const revision = (over: Partial<DraftRevision>): DraftRevision => ({
  key: 'QRD-1602', summary: '[BE] Email CC', status: 'pending', note: 'AC two is not testable', source: 'chat', inSprint: false, error: null, createdAt: '2026-11-20T08:00:00Z', appliedAt: null,
  fields: [
    { name: 'ac', label: 'Acceptance criteria', before: ['One', 'Two'], after: ['One', 'Two, testable'] },
    { name: 'summary', label: 'Summary', before: ['[BE] Email CC'], after: ['[BE] Email CC resolves variables'] },
  ],
  ...over,
});
const fresh = (over: Partial<DraftNewTicket>): DraftNewTicket => ({
  id: 'NEW-1', summary: 'S', type: 'Task', epic: null, dev: 'Danu', sp: 1, priority: null, userStory: 'u', problem: 'p', ac: ['a'], reference: null, source: 'chat', createdKey: null, error: null, ...over,
});
const counts = { tickets: [], findings: [], storyboards: [] };

test('the AC diff keeps the same lines, strikes the removed ones and adds the new ones in reading order', () => {
  assert.deepEqual(acLineDiff(['One', 'Two', 'Three'], ['One', 'Two, testable', 'Three', 'Four']), [
    { text: 'One', kind: 'same' },
    { text: 'Two', kind: 'removed' },
    { text: 'Two, testable', kind: 'added' },
    { text: 'Three', kind: 'same' },
    { text: 'Four', kind: 'added' },
  ]);
  assert.deepEqual(acLineDiff([], ['A']), [{ text: 'A', kind: 'added' }]);
  assert.deepEqual(acLineDiff(['A'], []), [{ text: 'A', kind: 'removed' }]);
  assert.deepEqual(acLineDiff(['A', 'B'], ['B', 'A']).map((line) => line.kind).sort(), ['added', 'removed', 'same']);
});

test('a revision shows its fields in the fixed order with their labels', () => {
  assert.deepEqual(revisionFields(revision({})).map((field) => field.name), ['summary', 'ac']);
  assert.deepEqual(revisionFieldNames(revision({})), ['Summary', 'Acceptance criteria']);
  assert.equal(revisionFieldLabel({ name: 'openToConfirm', label: '' }), 'Open to confirm', 'DOCK has a label when the server sends none');
  assert.equal(revisionFieldLabel({ name: 'problem', label: 'Problem' }), 'Problem');
});

test('the Tickets tab and the bottom bar count new tickets not created and revisions still pending', () => {
  const draft = {
    ...counts,
    newTickets: [fresh({}), fresh({ id: 'NEW-2', createdKey: 'QRD-1700' })],
    revisions: [revision({}), revision({ key: 'QRD-1603', status: 'applied', appliedAt: '2026-11-20T09:00:00Z' }), revision({ key: 'QRD-1604' })],
  };
  assert.deepEqual(pendingRevisions(draft).map((item) => item.key), ['QRD-1602', 'QRD-1604']);
  assert.deepEqual(ticketsToReview(draft), { fresh: 1, revisions: 2, total: 3 });
  assert.equal(panelBadge('new', draft), 3);
  assert.equal(barIssues(draft).revisions, 2);
  assert.deepEqual(ticketsToReview({}), { fresh: 0, revisions: 0, total: 0 });
  const bar = source('../agents/PlanningBar.tsx');
  assert.match(bar, /\{counts\.fresh \+ counts\.revisions\} to review/);
  assert.match(bar, /onShow\('new'\)/, 'the chip opens the Tickets tab');
});

test('the edit form reads back into the save input with every field of the revision, the note and the source', () => {
  const form = revisionForm(revision({}));
  assert.deepEqual(form, { summary: '[BE] Email CC resolves variables', ac: 'One\nTwo, testable' });
  assert.deepEqual(revisionInput({ ...form, summary: '  New   title ', ac: ' One \n\n Three ' }, revision({})), {
    input: { note: 'AC two is not testable', source: 'chat', summary: 'New title', ac: ['One', 'Three'] }, error: null,
  });
  assert.equal(revisionInput({ summary: ' ' }, revision({})).error, 'Write a summary');
  assert.equal(revisionInput({ type: 'Epic' }, revision({})).error, 'Type is Task, Story, Bug');
  assert.equal(revisionInput({ ac: Array.from({ length: 41 }, (_, index) => `Line ${index}`).join('\n') }, revision({})).error, 'At most 40 AC lines');
  assert.equal(revisionInput({ ac: 'x'.repeat(1001) }, revision({})).error, 'An AC line is at most 1000 characters');
  assert.equal(revisionInput({ reference: 'x'.repeat(2001) }, revision({})).error, 'Reference is at most 2000 characters');
  assert.equal(revisionInput({ userStory: '' }, revision({ note: null })).error, null, 'a text field may be emptied');
});

test('Planning names the tab Tickets with a New and a Revisions section, and the revision mutations use the contract names', () => {
  const tab = source('../agents/PlanningTab.tsx');
  assert.match(tab, /\['new', 'Tickets'\]\]/);
  assert.match(tab, /<TicketsPanel/);
  const panel = source('../agents/RevisionsPanel.tsx');
  assert.match(panel, /heading\('New', counts\.fresh\)/);
  assert.match(panel, /heading\('Revisions', counts\.revisions\)/);
  assert.match(panel, /Assignee, sprint, status and every other field stay untouched/);
  assert.match(panel, /Applied to Jira \{whenText\(revision\.appliedAt\)\}/);
  assert.match(panel, /draft new tickets or to rewrite tickets that already exist/);
  const queries = source('../graphql/queries.ts');
  assert.match(queries, /revisions \{ \$\{SPRINT_DRAFT_REVISION_FIELDS\} \}/);
  assert.match(queries, /key summary status note source fields \{ name label before after \} inSprint error createdAt appliedAt flagReason/);
  assert.match(queries, /saveSprintDraftRevision\(sprint: \$sprint, key: \$key, input: \$input\) \{ \$\{SPRINT_DRAFT_FIELDS\} \}/);
  assert.match(queries, /applySprintDraftRevision\(sprint: \$sprint, key: \$key, flag: \$flag\) \{ key kind status detail \}/);
  assert.match(queries, /discardSprintDraftRevision\(sprint: \$sprint, key: \$key\) \{ \$\{SPRINT_DRAFT_FIELDS\} \}/);
  assert.match(queries, /\$input: SprintDraftRevisionInput!/);
});
