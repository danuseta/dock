import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { agentsRoute, driftReason, driftStateLabel, edgeStateText, groupsText, hasMap, isMapping, jiraPlaceLabel, mappedText, pendingEdges, sortDrift, sourceLabel, type SprintPlan } from '../agents/plan';
import { RETRO_NUMBERS, causeShare } from '../agents/retro';
import { signalOf } from '../lib/attention';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const plan = (over: Partial<SprintPlan> = {}): SprintPlan => ({
  sprint: 'Sprint 12', status: 'idle', error: null, sessionId: null, mappedAt: '2026-11-03T08:00:00.000Z', groups: [['QRD-1', 'QRD-2'], ['QRD-3']],
  tickets: [
    { key: 'QRD-1', title: 'One', status: 'To Do', position: 1, held: false, edges: [] },
    { key: 'QRD-2', title: 'Two', status: 'To Do', position: 2, held: true, edges: [
      { id: 'e1', ticketKey: 'QRD-2', dependsOnKey: 'QRD-1', dependsOnTitle: 'One', dependsOnAssignee: null, dependsOnStatus: null, source: 'inferred', reason: 'same file', state: 'pending' },
      { id: 'e2', ticketKey: 'QRD-2', dependsOnKey: 'QRD-9', dependsOnTitle: null, dependsOnAssignee: 'Ana', dependsOnStatus: 'PR Review', source: 'jira', reason: 'link', state: 'accepted' },
    ] },
  ],
  ...over,
});

test('agentsRoute keeps Office and Library; Sprint moved to Planning', () => {
  assert.equal(agentsRoute('?tab=library'), 'library');
  assert.equal(agentsRoute('?tab=sprint'), 'office');
  assert.equal(agentsRoute(''), 'office');
});

test('plan helpers label the source, the state and the map', () => {
  assert.equal(sourceLabel('jira'), 'Jira');
  assert.equal(sourceLabel('inferred'), 'Inferred');
  assert.equal(edgeStateText('accepted'), 'Accepted');
  assert.equal(edgeStateText('rejected'), 'Rejected');
  assert.equal(edgeStateText('pending'), 'Waiting for your call');
  assert.equal(isMapping(plan({ status: 'mapping' })), true);
  assert.equal(isMapping(plan()), false);
  assert.equal(isMapping(null), false);
  assert.equal(mappedText(null, new Date()), 'Not mapped yet');
  assert.equal(mappedText('2026-11-03T08:00:00.000Z', new Date('2026-11-03T09:00:00.000Z')), 'Mapped 1h ago');
  assert.deepEqual(pendingEdges(plan()).map((edge) => edge.id), ['e1']);
  assert.equal(hasMap(plan()), true);
  assert.equal(hasMap(plan({ mappedAt: null })), false);
  assert.equal(hasMap(null), false);
  assert.deepEqual(groupsText(plan().groups), ['QRD-1 · QRD-2']);
});

test('the retro lists the three dependency numbers and Home ranks PLAN_DEPENDENCY', () => {
  const fields = RETRO_NUMBERS.map(([field]) => field);
  for (const field of ['blockedWaits', 'mergeConflicts', 'stackedRebases']) assert.ok(fields.includes(field as never), field);
  assert.deepEqual(signalOf('PLAN_DEPENDENCY'), { rank: 6, group: 'answer', label: 'DEPENDENCY' });
});

test('Planning shows Now, Draft and Retro, the Plan page is the Order panel of Draft, Agents keeps Office and Library, Home opens the plan, and the phone ping is wired', () => {
  const page = source('../pages/AgentsPage.tsx');
  assert.match(page, /\['office', 'Office', Building2\], \['library', 'Library', Library\]\]/);
  assert.doesNotMatch(page, /PlanningTab|<PlanTab|<RetroTab/);
  assert.match(source('../pages/PlanningPage.tsx'), /\[\['now', 'Now'\], \['draft', 'Draft'\], \['retro', 'Retro'\]\]/);
  assert.match(source('../pages/PlanningPage.tsx'), /\{tab === 'now' \? <SprintTab \/> : tab === 'draft' \? <PlanningTab initialPanel=\{route\.panel \?\? undefined\} \/> : <RetroTab onNavigate=\{onNavigate\} \/>/);
  assert.match(source('../agents/PlanningTab.tsx'), /shown === 'order' && <PlanTab \/>/);
  assert.doesNotMatch(source('../agents/PhoneTabs.tsx'), /'sprint'/);
  assert.match(source('../components/HomeAttention.tsx'), /\/planning\?tab=plan/);
  assert.match(source('../lib/notificationEvents.ts'), /PLAN_DEPENDENCY: \{ prefix: 'plan', title: 'waits for your call' \}/);
  const tab = source('../agents/PlanTab.tsx');
  assert.match(tab, /edge\.dependsOnStatus &&/);
  for (const text of ['Map dependencies', 'Accept', 'Reject', 'Use this order', 'Safe in parallel']) assert.ok(tab.includes(text), text);
});

test('the suggestion shows the Jira place, the move reason and At risk per row, and same-file edges only as merge-conflict risk', () => {
  assert.equal(jiraPlaceLabel({ jiraOrder: 4, wave: 1 }), '#4');
  assert.equal(jiraPlaceLabel({ jiraOrder: null, wave: 2 }), 'Wave 2');
  assert.equal(jiraPlaceLabel({ jiraOrder: null, wave: null }), '');
  const tab = source('../agents/PlanTab.tsx');
  for (const text of ['plan.suggestion.map', 'Jira {jiraPlaceLabel(row)}', 'row.reason', 'At risk', 'Merge-conflict risk (same file)', '<FileRisk edges={plan.fileEdges} />']) assert.ok(tab.includes(text), text);
  const fileRisk = tab.slice(tab.indexOf('const FileRisk'));
  assert.doesNotMatch(fileRisk.slice(0, fileRisk.indexOf('\n);') + 3), /Accept|onAction/);
  assert.match(source('../graphql/queries.ts'), /suggestion \{ key title jiraOrder wave jiraPosition waitedOn atRisk reason \}\s+fileEdges \{ ticketKey dependsOnKey dependsOnTitle reason \}/);
});

test('AC drift rows name why a line is held and put held ones first', () => {
  const row = { id: 'a', key: 'QRD-1511', line: 4, text: 'Edit client', refKey: 'QRD-1489', refStatus: 'To Do', refDev: 'Aken', refEnd: 3, ownEnd: 7, reason: 'slipped', state: 'held', decision: null };
  assert.equal(driftReason(row), 'QRD-1489 was planned to land D3, before QRD-1511, and has not. It is To Do.');
  assert.equal(driftReason({ ...row, reason: 'after-it', refEnd: 9 }), 'QRD-1489 lands D9, after QRD-1511 (D7). It is To Do.');
  assert.equal(driftStateLabel('move-pending'), 'Move pending');
  assert.deepEqual(sortDrift([{ ...row, id: 'b', state: 'wait' }, row]).map((item) => item.id), ['a', 'b']);
  const tab = source('../agents/PlanTab.tsx');
  for (const text of ['Move to Reference', 'Needs PO', 'Move to', 'ac-move-pending']) assert.ok(tab.includes(text), text);
});

test('the retro shows QA escalations by cause team-wide and labels the QA bot triage rules', () => {
  assert.equal(causeShare(2, [{ count: 4 }, { count: 2 }]), 50);
  assert.equal(causeShare(0, []), 0);
  const tab = source('../agents/RetroTab.tsx');
  for (const text of ['QA escalations', "'qa-agent': 'QA bot triage rule", 'Planning did not predict']) assert.ok(tab.includes(text), text);
});

test('Plan lists AC lines teammates move in, with Accept into AC and Decline with a reason', () => {
  const tab = source('../agents/PlanTab.tsx');
  for (const text of ['AC from teammates', 'Accept into AC', 'Decline', 'Why it does not belong here', '<AcInSection />']) assert.ok(tab.includes(text), text);
  assert.equal(driftStateLabel('move-accepted'), 'Accepted, remove by hand');
});
