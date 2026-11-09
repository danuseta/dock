import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { agentsRoute } from '../agents/plan';
import {
  UNASSIGNED, barPlace, changeCount, dayOf, decisionLabel, findingKindLabel, lanes, parseWave, predictionTone, publishHint, scopeSummary, sortFindings,
  planningChatTitle, questionsLine, spanOf, devColors, handOffs, landingDay, openQuestionsOf, ranks, teamStats, waitersOf, storyboardDecisionId, storyboardLine, tcsToText, textToTcs, waveRows, workingDayLabels, type DraftFinding, type DraftTicket,
} from '../agents/planning';

const ticket = (over: Partial<DraftTicket>): DraftTicket => ({
  key: 'QRD-1', summary: 'One', dev: 'Danu', jiraDev: 'Danu', sp: 3, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [],
  start: 0, dur: 1.5, end: 1.5, inSprint: true, split: null, prediction: null, qaDecision: null, ...over,
});
const finding = (over: Partial<DraftFinding>): DraftFinding => ({ id: 'x', key: 'QRD-1', line: 1, text: 't', refKey: 'QRD-2', kind: 'lands-first', refEnd: 1, ownEnd: 2, decision: null, ...over });

test('agentsRoute opens Sprint > Planning for sub=planning and keeps Plan as the default', () => {
  assert.deepEqual(agentsRoute('?tab=sprint&sub=planning'), { tab: 'sprint', sub: 'planning' });
  assert.deepEqual(agentsRoute('?tab=sprint&sub=nope'), { tab: 'sprint', sub: 'plan' });
});

test('lanes follow the draft developers, sum SP, count backlog and add Unassigned last', () => {
  const rows = lanes({ devs: ['Aken', 'Danu'], tickets: [
    ticket({ key: 'QRD-2', start: 1.5, end: 3 }), ticket({ key: 'QRD-1' }), ticket({ key: 'QRD-3', dev: 'Aken', sp: 8, inSprint: false, end: 12 }), ticket({ key: 'QRD-4', dev: null, sp: null }),
  ] });
  assert.deepEqual(rows.map((lane) => [lane.dev, lane.sp, lane.tickets.map((item) => item.key), lane.backlog]), [
    ['Aken', 8, ['QRD-3'], 1], ['Danu', 6, ['QRD-1', 'QRD-2'], 0], [UNASSIGNED, 0, ['QRD-4'], 0],
  ]);
  assert.match(rows[0].color, /^var\(--color-dev-[1-8]\)$/);
  assert.equal(rows[2].color, 'var(--color-muted-foreground)');
});

test('days, span, bars and working-day labels', () => {
  assert.deepEqual([dayOf(0), dayOf(2.5), dayOf(3)], ['D1', 'D3', 'D3']);
  assert.equal(spanOf({ sprintDays: 10, tickets: [ticket({ end: 15.5 })] }), 16);
  assert.equal(spanOf({ sprintDays: 10, tickets: [] }), 10);
  assert.deepEqual(barPlace({ start: 2, dur: 1 }, 10), { left: '20%', width: '10%' });
  assert.deepEqual(workingDayLabels('2026-10-29T01:00:00.000Z', 4), ['Thu 29 Oct', 'Fri 30 Oct', 'Mon 2 Nov', 'Tue 3 Nov']);
  assert.deepEqual(workingDayLabels(null, 3), []);
});

test('waves close on their last ticket and are late past the sprint; scope sums in and out', () => {
  const tickets = [ticket({ wave: 1, end: 3 }), ticket({ wave: 2, end: 9, sp: 2 }), ticket({ wave: 2, end: 11, sp: 5, inSprint: false })];
  assert.deepEqual(waveRows({ sprintDays: 10, tickets }), [
    { wave: 1, count: 1, sp: 3, closes: 3, late: false, tickets: [tickets[0]] },
    { wave: 2, count: 2, sp: 7, closes: 11, late: true, tickets: [tickets[1], tickets[2]] },
  ]);
  assert.deepEqual([landingDay(0), landingDay(2.5), landingDay(3), landingDay(10)], [1, 3, 3, 10]);
  assert.deepEqual(scopeSummary({ tickets }), { inSprint: 2, inSprintSp: 5, backlog: 1, backlogSp: 5 });
});

test('findings sort after-it first and decisions read as words', () => {
  const sorted = sortFindings([finding({ key: 'QRD-3' }), finding({ key: 'QRD-9', kind: 'after-it' }), finding({ key: 'QRD-1', line: 2 })]);
  assert.deepEqual(sorted.map((item) => item.key), ['QRD-9', 'QRD-1', 'QRD-3']);
  assert.deepEqual(['after-it', 'lands-first', 'outside-plan'].map(findingKindLabel), ['after it', 'lands first', 'outside plan']);
  const decision = (action: string, note: string | null = null) => ({ action, note, by: 'Alvin', at: '' });
  assert.equal(decisionLabel(decision('move'), 'QRD-2'), 'Moved to QRD-2');
  assert.equal(decisionLabel(decision('wait')), 'Kept, waits');
  assert.equal(decisionLabel(decision('fix', 'AC 3 rewritten')), 'Fixed: AC 3 rewritten');
  assert.equal(decisionLabel(null), null);
});

test('QA tone, publish hint, change count and wave input', () => {
  assert.deepEqual(['LOLOS', 'ESCALATED', 'REVISION-RISK', null].map(predictionTone), ['ok', 'conflict', 'warn', 'none']);
  assert.equal(publishHint({ canPublish: false, blockers: ['a', 'b'], tickets: [ticket({})] }), '2 items need a decision before publish');
  assert.equal(publishHint({ canPublish: false, blockers: ['a'], tickets: [ticket({})] }), '1 item needs a decision before publish');
  assert.equal(publishHint({ canPublish: false, blockers: [], tickets: [] }), 'No tickets in this sprint');
  assert.equal(changeCount([
    { key: 'A', assigneeFrom: null, assigneeTo: 'Ana', acRemoved: [], acAdded: [], refused: null },
    { key: 'B', assigneeFrom: null, assigneeTo: null, acRemoved: ['x'], acAdded: [], refused: 'AC changed' },
  ]), 1);
  assert.deepEqual(['2', '0', ' 3 ', '1.5', '', '-1', '51'].map(parseWave), [2, 0, 3, null, null, null, null]);
});

test('a storyboard line names its version and changed frames, or why there is none', () => {
  const board = { epic: 'QRD-1233', version: 8, previous: 7, path: null, page: '11', frames: 62, changed: ['F7.3'], changedAt: null, checkedAt: '2026-11-09T00:00:00.000Z', error: null };
  assert.equal(storyboardLine(board), 'v8 · 62 frames · 1 frame changed since v7: F7.3');
  assert.equal(storyboardLine({ ...board, previous: null, changed: [] }), 'v8 · 62 frames · first version saved');
  assert.equal(storyboardLine({ ...board, error: 'No Confluence page titled "Storyboard" for QRD-1233.' }), 'No Confluence page titled "Storyboard" for QRD-1233.');
  assert.equal(storyboardDecisionId('QRD-1312', 8), 'sb|QRD-1312|v8');
});

test('Planning opens a Planning-<sprint> chat beside the panel, which polls the draft, and lists the open questions', () => {
  assert.equal(planningChatTitle('QRD Sprint 27'), 'Planning-QRD Sprint 27');
  assert.equal(questionsLine([]), null);
  const question = { id: 'q1', text: 'Both tabs?', key: null, askedAt: 'a', answered: true, answeredBy: 'Alvin', answeredAt: 'b' };
  assert.equal(questionsLine([question, { ...question, id: 'q2', answered: false }]), '1/2 answered');
  const tab = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  assert.match(tab, /<PlanningChat sprint=\{chosen\.name\} \/>/);
  assert.match(tab, /pollInterval: 10000/);
  assert.match(tab, /xl:grid-cols-\[420px_minmax\(0,1fr\)\]/);
  const chat = readFileSync(fileURLToPath(new URL('../agents/PlanningChat.tsx', import.meta.url)), 'utf8');
  assert.match(chat, /h-\[620px\]/);
  assert.match(chat, /xl:sticky/);
  assert.match(chat, /<ChatThread /);
  assert.match(chat, /OPEN_PLANNING_CHAT/);
  assert.ok(chat.includes('create({ variables: { sprint } })'));
});

test('test cases read back from the text the planner edits', () => {
  const tcs = [
    { id: 'TC-1', ac: 2, title: 'Client sees the cursor', steps: ['Open as owner', 'Open as client'], expected: 'Both cursors show' },
    { id: 'TC-2', ac: 3, title: 'No steps', steps: [], expected: 'Shown' },
  ];
  const text = tcsToText(tcs);
  assert.equal(text.split('\n')[0], 'TC-1 · AC 2 · Client sees the cursor');
  assert.deepEqual(textToTcs(text), { tcs, error: null });
  assert.match(textToTcs('TC-1 AC 1 Title\nExpected: x').error ?? '', /first line reads/);
  assert.match(textToTcs('tc-3 | AC 1 | Title\n- step').error ?? '', /TC-3: add an "Expected: \.\.\." line/);
});

test('day 1 reads on the +08:00 calendar: 00:00 +08:00 on Tue 27 Oct is not Mon 26 Oct', () => {
  // The BFF sends day 1 as midnight +08:00, which is the evening before in UTC; a UTC read put D1 a day off.
  assert.deepEqual(workingDayLabels('2026-10-26T16:00:00.000Z', 2), ['Tue 27 Oct', 'Wed 28 Oct']);
  assert.deepEqual(workingDayLabels('2026-10-30T17:00:00.000Z', 1), ['Mon 2 Nov'], 'Saturday +08:00 rolls to Monday');
});

test('developer colours are stable per name, distinct across the team, and ignore Unassigned', () => {
  const team = ['Alvin', 'Danu', 'Indra', 'Yusril', 'Shovian', 'Aken'];
  const colors = devColors(team);
  assert.equal(new Set(colors.values()).size, team.length);
  assert.deepEqual(devColors([...team].reverse()), colors);
  assert.equal(devColors([UNASSIGNED, 'Danu']).has(UNASSIGNED), false);
  for (const value of colors.values()) assert.match(value, /^var\(--color-dev-[1-8]\)$/);
});

test('rank is each developer\'s order by start; waiters and open questions are per ticket', () => {
  const tickets = [
    ticket({ key: 'QRD-3', start: 1.5, end: 3 }), ticket({ key: 'QRD-1', start: 0, end: 1.5 }),
    ticket({ key: 'QRD-2', dev: 'Aken', start: 0, end: 2, dependsOn: ['QRD-1'] }), ticket({ key: 'QRD-4', dev: 'Aken', start: 2, end: 3, dependsOn: ['QRD-1', 'QRD-3'] }),
  ];
  assert.deepEqual(Object.fromEntries(ranks(tickets)), { 'QRD-1': 1, 'QRD-2': 1, 'QRD-3': 2, 'QRD-4': 2 });
  assert.deepEqual(waitersOf(tickets).get('QRD-1')!.map((item) => item.key), ['QRD-2', 'QRD-4']);
  const question = (id: string, key: string | null, answered: boolean) => ({ id, text: id, key, askedAt: '', answered, answeredBy: null, answeredAt: null });
  const open = openQuestionsOf([question('a', 'QRD-1', false), question('b', 'QRD-1', true), question('c', null, false), question('d', 'QRD-1', false)]);
  assert.deepEqual(open.get('QRD-1')!.map((item) => item.id), ['a', 'd']);
  assert.equal(open.size, 1);
});

test('hand-offs cross developers only, sort by landing, and float is the slack before the next starts late', () => {
  const tickets = [
    ticket({ key: 'QRD-1305', dev: 'Alvin', start: 7, end: 8.5 }),
    ticket({ key: 'QRD-1307', dev: 'Danu', start: 11.5, end: 13, dependsOn: ['QRD-1305'] }),
    ticket({ key: 'QRD-1281', dev: 'Indra', start: 10, end: 10.5 }),
    ticket({ key: 'QRD-1427', dev: 'Alvin', start: 11, end: 13, dependsOn: ['QRD-1281', 'QRD-9999'] }),
    ticket({ key: 'QRD-1310', dev: 'Alvin', start: 13, end: 14, dependsOn: ['QRD-1305'] }),
    ticket({ key: 'QRD-1500', dev: null, start: 9, end: 10, dependsOn: ['QRD-1305'] }),
  ];
  assert.deepEqual(handOffs(tickets), [
    { from: 'QRD-1305', fromDev: 'Alvin', to: 'QRD-1307', toDev: 'Danu', lands: 8.5, float: 3 },
    { from: 'QRD-1281', fromDev: 'Indra', to: 'QRD-1427', toDev: 'Alvin', lands: 10.5, float: 0.5 },
  ]);
  assert.equal(handOffs([ticket({ key: 'A', dev: 'Alvin', end: 3 }), ticket({ key: 'B', dev: 'Danu', start: 3, dependsOn: ['A'] })])[0].float, 0);
});

test('team stats: cards, SP, developers, target each, what lands in the sprint and the spread between lanes', () => {
  const tickets = [ticket({ sp: 3 }), ticket({ key: 'QRD-2', dev: 'Aken', sp: 8, inSprint: false }), ticket({ key: 'QRD-3', dev: 'Aken', sp: 2 }), ticket({ key: 'QRD-4', dev: null, sp: 1 })];
  assert.deepEqual(teamStats({ devs: ['Aken', 'Danu'], tickets }), { cards: 4, sp: 14, devs: 2, target: 7, landCards: 3, landSp: 6, spread: 7 });
});
