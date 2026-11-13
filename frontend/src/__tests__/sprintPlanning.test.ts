import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { panelOf, planningRedirect, planningRoute } from '../agents/plan';
import { applyTemplate, defaultFlow } from '../agents/planningFlow';
import {
  UNASSIGNED, barPlace, changeCount, publishReadiness, dayOf, decisionLabel, findingKindLabel, lanes, parseWave, predictionTone, publishHint, scopeSummary, sortFindings,
  forecastOf, lateDays, lateText, shortDate, underWay, planningChatTitle, questionsLine, spanOf, devColors, handOffs, landingDay, openQuestionsOf, ranks, teamStats, waitersOf, storyboardDecisionId, storyboardLine, tcsToText, textToTcs, waveRows, workingDayLabels, scheduleWindow, laneOf, laneCount, planRange, githubLine, scheduled, developerLine, freeFrom, moveLine, moveForecast, checklistTcs, myTickets, qaChecklist, undecidedFinding, type DraftFinding, type DraftTicket, type SprintDraft,
} from '../agents/planning';

const ticket = (over: Partial<DraftTicket>): DraftTicket => ({
  key: 'QRD-1', summary: 'One', dev: 'Danu', jiraDev: 'Danu', sp: 3, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [],
  start: 0, dur: 1.5, end: 1.5, inSprint: true, split: null, prediction: null, qaDecision: null, merge: 'open', pulls: [], jiraAhead: false, merged: false, rank: null, planStart: 0, planDur: 1.5, ...over,
});
const finding = (over: Partial<DraftFinding>): DraftFinding => ({ id: 'x', key: 'QRD-1', line: 1, text: 't', refKey: 'QRD-2', kind: 'lands-first', refEnd: 1, ownEnd: 2, decision: null, ...over });

test('/planning opens Draft by default, reads the panel, and every old Agents link opens the matching tab', () => {
  assert.deepEqual(planningRoute(''), { tab: 'draft', panel: null });
  assert.deepEqual(planningRoute('?tab=retro'), { tab: 'retro', panel: null });
  assert.deepEqual(planningRoute('?tab=draft&panel=qa'), { tab: 'draft', panel: 'qa' });
  assert.deepEqual(planningRoute('?tab=nope&panel=nope'), { tab: 'draft', panel: null });
  assert.equal(planningRedirect('/agents?tab=sprint&sub=planning'), '/planning?tab=draft');
  assert.equal(planningRedirect('/agents?tab=sprint&sub=planning&panel=ac'), '/planning?tab=draft&panel=ac');
  assert.equal(planningRedirect('/agents?tab=sprint&sub=plan'), '/planning?tab=plan');
  assert.equal(planningRedirect('/agents?tab=sprint'), '/planning?tab=plan');
  assert.equal(planningRedirect('/agents?tab=sprint&sub=retro'), '/planning?tab=retro');
  assert.equal(planningRedirect('/agents?tab=retro'), '/planning?tab=retro');
  assert.equal(planningRedirect('/agents?run=QRD-1'), '/agents?run=QRD-1', 'an Office link stays');
  assert.equal(planningRedirect('/agents?tab=library'), '/agents?tab=library');
  assert.equal(planningRedirect('/sprint?tab=sprint'), '/sprint?tab=sprint');
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
  assert.equal(decisionLabel(decision('dependency')), 'Dependency · link Blocks dipasang waktu Publish');
  assert.equal(decisionLabel(decision('wait')), 'Dependency · link Blocks dipasang waktu Publish', 'an older wait reads as dependency');
  assert.equal(decisionLabel(decision('reference')), 'Pindah ke Reference');
  assert.equal(decisionLabel(decision('drop')), 'Pindah ke Reference', 'an older drop reads as reference');
  assert.equal(decisionLabel(decision('approve')), 'Disetujui QA');
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

test('Planning opens a Planning-<sprint> chat in the floating ChatDock, which polls the draft, and lists the open questions', () => {
  assert.equal(planningChatTitle('QRD Sprint 27'), 'Planning-QRD Sprint 27');
  assert.equal(questionsLine([]), null);
  const question = { id: 'q1', text: 'Both tabs?', key: null, askedAt: 'a', answered: true, answeredBy: 'Alvin', answeredAt: 'b' };
  assert.equal(questionsLine([question, { ...question, id: 'q2', answered: false }]), '1/2 answered');
  const tab = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  assert.match(tab, /<PlanningChat sprint=\{chosen\.name\} \/>/);
  assert.match(tab, /pollInterval: 10000/);
  assert.doesNotMatch(tab, /xl:grid-cols-\[420px/);
  // The button and the hook that opens the chat live in two files, for fast refresh.
  const chat = ['../agents/PlanningChat.tsx', '../agents/usePlanningChat.ts'].map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')).join('\n');
  assert.doesNotMatch(chat, /ChatThread/);
  assert.ok(chat.includes('chatStore.openSession('));
  assert.ok(chat.includes('Open planning chat'));
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

test('late days: the forecast day minus the due day, in working days of the plan', () => {
  assert.equal(lateDays(12, 18), 6);
  assert.equal(lateDays(12, 12), 0);
  assert.equal(lateDays(12, 10), -2);
  assert.equal(lateText(6), '6 working days late');
  assert.equal(lateText(1), '1 working day late');
  assert.equal(lateText(0), 'on time');
  assert.equal(lateText(-2), '2 days early');
  assert.equal(lateText(-1), '1 day early');
});

test('Sprint 26 mid-sprint: due Wed 11 Nov on day 12, the last lane lands Thu 19 Nov on day 18', () => {
  const draft = { sprintDays: 12, tickets: [ticket({ key: 'QRD-1', start: 10, end: 13.5 }), ticket({ key: 'QRD-2', dev: 'Aken', start: 12, end: 17.5 })] };
  assert.deepEqual(forecastOf(draft), { due: 12, day: 18, end: 17.5, late: 6 });
  const labels = workingDayLabels('2026-10-26T16:00:00.000Z', 18);
  assert.deepEqual([labels[11], labels[17]], ['Wed 11 Nov', 'Thu 19 Nov']);
  assert.equal(shortDate(labels[11]), '11 Nov');
  assert.equal(forecastOf({ sprintDays: 12, tickets: [ticket({ end: 9 })] }).late, -3);
  assert.equal(forecastOf({ sprintDays: 12, tickets: [] }).day, 1);
});

test('lanes sum the work left next to the full SP; a draft without left is not under way', () => {
  const tickets = [ticket({ key: 'QRD-1', sp: 8, left: 1 }), ticket({ key: 'QRD-2', sp: 5, left: 2.5 }), ticket({ key: 'QRD-3', sp: 3, left: 3 })];
  const [lane] = lanes({ devs: ['Danu'], tickets });
  assert.deepEqual([lane.left, lane.sp], [6.5, 16]);
  assert.equal(underWay({ tickets }), true);
  assert.equal(underWay({ tickets: [ticket({ left: null })] }), false);
  assert.equal(lanes({ devs: ['Danu'], tickets: [ticket({ sp: 3 })] })[0].left, 3);
});

test('schedule window runs from day 1 to the latest of forecast, plan end and sprint end', () => {
  const tickets = [ticket({ end: 12 }), ticket({ key: 'QRD-2', merged: true, merge: 'merged', end: 30, planStart: 2, planDur: 1 })];
  assert.deepEqual(scheduleWindow({ sprintDays: 10, tickets }), { first: 1, last: 12 }, 'a merged card leaves the forecast alone');
  assert.deepEqual(scheduleWindow({ sprintDays: 10, tickets: [ticket({ end: 3, planStart: 12, planDur: 2.5 })] }), { first: 1, last: 15 });
  assert.deepEqual(scheduleWindow({ sprintDays: 10, tickets: [ticket({ end: 3 })] }), { first: 1, last: 10 });
  assert.deepEqual(scheduled([ticket({}), ticket({ key: 'QRD-2', merged: true })]).map((item) => item.key), ['QRD-1']);
});

test('laneOf draws every card at its plan place: merged faded, late past today, To Do apart, jiraAhead and moved flagged', () => {
  const draft = {
    sprintDays: 10, today: 6, tickets: [
      ticket({ key: 'QRD-1', merge: 'open', status: 'In Progress', pulls: ['qonflo/app#12 · open'], planStart: 6, planDur: 2 }),
      ticket({ key: 'QRD-2', merge: 'none', status: 'To Do', planStart: 8, planDur: 2 }),
      ticket({ key: 'QRD-3', merged: true, merge: 'merged', status: 'UAT CHECK', planStart: 0, planDur: 2 }),
      ticket({ key: 'QRD-4', merge: 'open', status: 'UAT MERGED', jiraAhead: true, pulls: ['qonflo/app#13 · open'], planStart: 2, planDur: 1 }),
      ticket({ key: 'QRD-6', merge: 'open', status: 'PR Review', planStart: 3, planDur: 2 }),
      ticket({ key: 'QRD-7', merge: 'open', status: 'PR Review', planStart: 4.5, planDur: 1 }),
      ticket({ key: 'QRD-5', dev: 'Aken', jiraDev: 'Danu', merge: 'none', status: 'To Do', planStart: 0, planDur: 1 }),
    ],
  };
  const bars = laneOf(draft, 'Danu');
  assert.deepEqual(bars.map((bar) => [bar.ticket.key, bar.kind, bar.late, bar.third, bar.ahead]), [
    ['QRD-3', 'done', false, 'merged · UAT CHECK', null],
    ['QRD-4', 'progress', true, 'late · UAT MERGED', 'Jira says UAT MERGED, PR open'],
    ['QRD-6', 'progress', true, 'late · PR Review', null],
    ['QRD-7', 'progress', false, 'PR Review', null],
    ['QRD-1', 'progress', false, 'qonflo/app#12 · open', null],
    ['QRD-2', 'todo', false, 'To Do · no PR yet', null],
  ]);
  assert.deepEqual([bars[0].left, bars[0].width], ['0%', '20%']);
  assert.deepEqual([bars[5].left, bars[5].width], ['80%', '20%']);
  assert.equal(laneCount(bars), '1 merged · 5 open');
  assert.equal(laneOf(draft, 'Aken')[0].moved, true);
  assert.equal(laneOf({ ...draft, today: null }, 'Danu').some((bar) => bar.late), false, 'nothing is late before day 1');
  assert.deepEqual(laneOf(draft, 'Nobody'), []);
});

test('the hover reads the plan days on the calendar and what GitHub says', () => {
  const labels = ['Thu 5 Nov', 'Fri 6 Nov', 'Mon 9 Nov'];
  assert.equal(planRange({ planStart: 1, planDur: 1.5 }, labels), 'D2 Fri 6 Nov → D3 Mon 9 Nov');
  assert.equal(planRange({ planStart: 0, planDur: 0 }, labels), 'D1 Thu 5 Nov → D1 Thu 5 Nov');
  assert.equal(planRange({ planStart: 3, planDur: 1 }, labels), 'D4 → D4');
  assert.deepEqual(githubLine({ merged: true, merge: 'merged', jiraAhead: false }, 'github'), { text: '✓ merged', tone: 'ok' });
  assert.deepEqual(githubLine({ merged: true, merge: 'none', jiraAhead: false }, 'github'), { text: '✓ done in Jira', tone: 'ok' });
  assert.deepEqual(githubLine({ merged: false, merge: 'open', jiraAhead: true }, 'github'), { text: 'PR still open', tone: 'warn' });
  assert.deepEqual(githubLine({ merged: false, merge: 'open', jiraAhead: false }, 'github'), { text: 'PR open', tone: 'none' });
  assert.deepEqual(githubLine({ merged: false, merge: 'none', jiraAhead: false }, 'github'), { text: 'no PR yet', tone: 'none' });
  assert.deepEqual(githubLine({ merged: false, merge: 'unknown', jiraAhead: false }, 'jira'), { text: 'not read: GitHub unavailable', tone: 'none' });
});

test('developer tile and move texts', () => {
  assert.equal(developerLine({ merged: 17, open: 0 }, 'github'), '17 cards merged on GitHub · 0 open');
  assert.equal(developerLine({ merged: 1, open: 2 }, 'jira'), '1 card done in Jira · 2 open');
  assert.equal(freeFrom(13), 'free from D13');
  assert.equal(freeFrom(null), 'free from D1');
  assert.equal(moveLine({ keys: ['QRD-1278', 'QRD-1290'], sp: 4, from: 'Shovian', to: 'Danu' }), 'QRD-1278, QRD-1290 4 SP · Shovian → Danu');
  assert.equal(moveForecast({ forecastBefore: 3, forecastAfter: 2 }, ['Mon 9 Nov', 'Tue 10 Nov', 'Wed 11 Nov']), 'forecast D3 (Wed 11 Nov) → D2 (Tue 10 Nov)');
  assert.equal(moveForecast({ forecastBefore: 17, forecastAfter: 13 }, []), 'forecast D17 → D13');
});

const ready = (over: Partial<SprintDraft> = {}) => ({
  tickets: [ticket({ key: 'QRD-1', sp: 10 }), ticket({ key: 'QRD-2', sp: 10, storyboard: { version: 2, frames: ['F1'], held: false, checked: { action: 'checked', note: null, by: 'PO', at: '' } } })],
  developers: [{ name: 'Danu', merged: 0, open: 2, sp: 20, leftSp: 20, end: null }], sprintDays: 10, spPerDay: 2, today: null,
  findings: [finding({ id: 'f1', kind: 'after-it', decision: { action: 'wait', note: null, by: 'PO', at: '' } }), finding({ id: 'f2', linked: true })],
  storyboards: [{ epic: 'QRD-100', version: 2, previous: 1, path: null, page: null, frames: 4, changed: ['F1'], changedAt: null, checkedAt: '', error: null }],
  scopeCut: null,
  ...over,
});

test('Siap publish 4 dari 4: SP fit, references and ESCALATED decided, storyboard recorded and checked', () => {
  const result = publishReadiness(ready(), null);
  assert.deepEqual([result.done, result.total, result.missing], [4, 4, []]);
  assert.deepEqual(result.items.map((item) => item.id), ['scope', 'ac', 'qa', 'storyboard']);
  assert.equal(result.items[0].text, '20 SP muat di kapasitas 20 SP');
});

test('Siap publish 2 dari 4: SP over capacity without a cut and an undecided ESCALATED ticket, each linked to its panel', () => {
  const result = publishReadiness(ready({
    tickets: [ticket({ key: 'QRD-1', sp: 25 }), ticket({ key: 'QRD-2', sp: 5, prediction: { prediction: 'ESCALATED', reasons: [], fix: null } })],
  }), null);
  assert.deepEqual([result.done, result.total], [2, 4]);
  assert.deepEqual(result.missing.map((item) => [item.id, item.panel, item.text]), [
    ['scope', 'scope', '30 SP untuk kapasitas 20 SP'],
    ['qa', 'qa', '1 tiket diprediksi ESCALATED belum diputusin'],
  ]);
  assert.equal(result.missing[0].detail, 'Belum ada keputusan potong scope');
  const cut = publishReadiness(ready({ tickets: [ticket({ key: 'QRD-1', sp: 25 })], scopeCut: { action: 'cut', note: 'QRD-1 pindah ke Sprint 28', by: 'PO', at: '' } }), null);
  assert.equal(cut.items[0].ok, true, 'a written scope cut counts as fit');
  const open = publishReadiness(ready({ findings: [finding({ id: 'f1', key: 'QRD-7', kind: 'after-it' })], storyboards: [] }), null);
  assert.deepEqual(open.missing.map((item) => [item.id, item.detail]), [['ac', 'QRD-7'], ['storyboard', 'Belum ada storyboard yang dibaca']]);
});

test('Siap publish leaves out an item whose planning stage is skipped; no flow counts all four', () => {
  const draft = ready({ storyboards: [], tickets: [ticket({ key: 'QRD-1', sp: 5, prediction: { prediction: 'ESCALATED', reasons: [], fix: null } })] });
  assert.deepEqual([publishReadiness(draft, defaultFlow()).done, publishReadiness(draft, defaultFlow()).total], [2, 4]);
  const short = publishReadiness(draft, applyTemplate(defaultFlow(), 'Cuma scope + publish'));
  assert.deepEqual([short.done, short.total, short.items.map((item) => item.id)], [1, 1, ['scope']]);
  const noQa = publishReadiness(draft, applyTemplate(defaultFlow(), 'Tanpa QA'));
  assert.deepEqual([noQa.done, noQa.total, noQa.missing.map((item) => item.id)], [2, 3, ['storyboard']]);
});

test('the QA checklist splits the AC: a line for Reference or moved is not tested here, a line naming a dependency waits for it', () => {
  const draftTicket = ticket({ key: 'QRD-1510', ac: ['Owner sees the rule', 'Allow is grey on the consent page (QRD-1307)', 'The MCP drawer greys its button (QRD-1312)', 'Token rotates (QRD-1500)'] });
  const findings = [
    finding({ id: 'a', key: 'QRD-1510', line: 2, refKey: 'QRD-1307', linked: true }),
    finding({ id: 'b', key: 'QRD-1510', line: 3, refKey: 'QRD-1312', decision: { action: 'reference', note: null, by: 'Danu', at: '' } }),
    finding({ id: 'c', key: 'QRD-1510', line: 4, refKey: 'QRD-1500' }),
    finding({ id: 'd', key: 'QRD-9', line: 1, refKey: 'QRD-1510' }),
  ];
  const list = qaChecklist(draftTicket, findings, ['Owner lihat rule-nya']);
  assert.deepEqual(list.here.map((line) => [line.n, line.waitsOn, line.textId]), [[1, [], 'Owner lihat rule-nya'], [2, ['QRD-1307'], null], [4, ['QRD-1500'], null]]);
  assert.deepEqual(list.notHere.map((line) => [line.n, line.testedIn]), [[3, 'QRD-1312']]);
  const tcs = checklistTcs(list);
  assert.deepEqual(tcs.map((tc) => [tc.id, tc.ac, tc.steps]), [['TC-1', 1, []], ['TC-2', 2, ['Tunggu QRD-1307 sampai UAT CHECK']], ['TC-3', 4, ['Tunggu QRD-1500 sampai UAT CHECK']]]);
  assert.equal(qaChecklist(draftTicket, [finding({ key: 'QRD-1510', line: 3, refKey: 'QRD-1312', decision: { action: 'drop', note: null, by: null, at: '' } })]).notHere.length, 1, 'an older drop is not tested here either');
});

test('Tiket saya lists the open draft tickets of the DOCK owner by Jira name, merged ones left out', () => {
  const tickets = [ticket({ key: 'QRD-1510', dev: 'M Danu Seta W' }), ticket({ key: 'QRD-1292', dev: 'm danu seta w ' }), ticket({ key: 'QRD-1498', dev: 'Indra' }), ticket({ key: 'QRD-1312', dev: 'M Danu Seta W', merged: true })];
  assert.deepEqual(myTickets({ tickets }, 'M Danu Seta W').map((item) => item.key), ['QRD-1292', 'QRD-1510']);
  assert.deepEqual(myTickets({ tickets }, null), []);
  assert.deepEqual(planningRoute('?tab=draft&panel=mine'), { tab: 'draft', panel: 'mine' });
});

test('Siap publish counts an after-it line with a Blocks link as decided', () => {
  const linked = publishReadiness(ready({ findings: [finding({ id: 'f1', key: 'QRD-7', kind: 'after-it', linked: true })] }), null);
  assert.equal(linked.items.find((item) => item.id === 'ac')!.ok, true);
});

test('Siap publish and AC check count the same undecided lines: every line naming another ticket with no Blocks link and no call', () => {
  const findings = [
    finding({ id: 'a', key: 'QRD-1', kind: 'lands-first' }), finding({ id: 'b', key: 'QRD-2', kind: 'outside-plan' }), finding({ id: 'c', key: 'QRD-3', kind: 'after-it' }),
    finding({ id: 'd', key: 'QRD-4', linked: true }), finding({ id: 'e', key: 'QRD-5', decision: { action: 'reference', note: null, by: 'PO', at: '' } }),
  ];
  const item = publishReadiness(ready({ findings }), null).items.find((entry) => entry.id === 'ac')!;
  assert.equal(findings.filter(undecidedFinding).length, 3);
  assert.deepEqual([item.ok, item.text, item.detail], [false, '3 rujukan tiket lain belum diputusin', 'QRD-1, QRD-2, QRD-3']);
  const source = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  assert.ok(source.includes('{findings.filter(undecidedFinding).length} belum diputusin'), 'AC check counts with the same predicate');
});

test('the Draft panel follows the URL on load and on Back / Forward', () => {
  assert.equal(panelOf('?tab=draft&panel=ac', 'team'), 'ac');
  assert.equal(panelOf('?tab=draft&panel=nope', 'team'), 'team');
  const source = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  assert.ok(source.includes('useState<PlanningPanel>(() => panelOf(window.location.search, initialPanel))'));
  assert.ok(source.includes("window.addEventListener('popstate', follow)"));
});

test("Tiket saya stays usable on a developer's read-only DOCK: it renders outside the disabled fieldset", () => {
  const tab = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  const mine = tab.indexOf("shown === 'mine' && <MyTicketsPanel");
  const fieldset = tab.indexOf('<fieldset disabled={!planner}');
  assert.ok(mine > 0 && fieldset > 0 && mine < fieldset);
});
