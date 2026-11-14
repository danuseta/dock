import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JudgeDays } from '../agents/JudgeDays';
import { JudgeDaySheetView } from '../agents/JudgeDaySheetView';
import { SprintSheet } from '../agents/SprintSheet';
import {
  callOf, dayLabel, flagText, dayStatusText, discordFindingHref, filterByGrade, findingHref, flaggedMessages, gradeOf, judgeHref, judgeOnlySprint, judgeRoute, mergeRetroItems, retroSprintOptions,
  type JudgeDaySheet, type JudgeDays as JudgeDaysData, type JudgeFinding,
} from '../agents/judge';
import { planningRedirect } from '../agents/plan';
import type { RetroItem } from '../agents/retro';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageIdFromSearch } from '../chat/sessionRoute';
import { SessionJudgeView } from '../chat/SessionJudgeView';
import { judgeAttention, signalOf, ticketAttention } from '../lib/attention';
import { JUDGE_DEFAULTS, readJudgeSettings } from '../settings/judgeSettings';

const finding = (id: string, cause: string, extra: Partial<JudgeFinding> = {}): JudgeFinding => ({
  id, sessionId: 's1', day: '2026-11-13', messageId: null, threadUrl: null, cause, causeLabel: cause, text: `${cause} text`, quote: '', shouldHave: 'Hand the rebase to the lead.',
  judgeCall: 'mistake', ownerCall: null, call: 'mistake', note: null, createdAt: '2026-11-13T14:40:00.000Z', ...extra,
});

const row = (day: string, extra: Partial<JudgeDaysData['days'][number]> = {}) => ({
  day, sessions: 8, judged: 8, pending: 0, failed: 0, findings: 5, totalFindings: 5, sessionsWithFindings: 3, grade: 'C', status: 'waiting', confirmedAt: null,
  cutoffAt: '2026-11-14T05:00:00.000Z', judgedAt: '2026-11-13T14:40:00.000Z', ownerWaitMinutes: 126, ...extra,
});

const sheet: JudgeDaysData['sheet'] = {
  dayCount: 2, daysAnswered: 1, sessions: 14, judged: 14, waiting: 0, failed: 0, lastRun: '2026-11-13T14:40:00.000Z', findings: 5, findingSessions: 3, grade: 'B', previousGrade: 'C', ownerHours: 6.4,
  causes: [{ cause: 'stopped-with-way-out', label: 'Stopped with a way out', count: 3 }], waitingDays: [{ day: '2026-11-13', findings: 5 }], summary: null,
};

const daySheet = (findings: JudgeFinding[]): JudgeDaySheet => ({
  ...row('2026-11-13'), note: null, previousDay: '2026-11-12', nextDay: null,
  sessionList: [
    { sessionId: 's1', title: 'Task-QRD-1292', ticketKey: 'QRD-1292', origin: 'cron', startedAt: '2026-11-13T02:00:00.000Z', lastMessageAt: '2026-11-13T04:00:00.000Z', status: 'judged', grade: 'D', ownerWaitMinutes: 0, error: null, findings },
    { sessionId: 's2', title: 'Review-QRD-1521', ticketKey: 'QRD-1521', origin: 'cron', startedAt: null, lastMessageAt: null, status: 'judged', grade: 'A', ownerWaitMinutes: 0, error: null, findings: [] },
  ],
});

const noop = () => undefined;
const sheetView = (findings: JudgeFinding[], calls: Record<string, 'mistake' | 'not'> = {}, onConfirm: () => void = noop) => renderToStaticMarkup(
  <JudgeDaySheetView sheet={daySheet(findings)} calls={calls} notes={{}} dayNote="" busy={false} onCall={noop} onNote={noop} onNoteDone={noop} onDayNote={noop} onBack={noop} onDay={noop} onConfirm={onConfirm} onNavigate={noop} />,
);

test('days list: one row per day with counts, grade and status, and the Sprint sheet as the last row', () => {
  const data: JudgeDaysData = { sprint: 'QRD Sprint 26', activeSprint: 'QRD Sprint 26', previous: 'QRD Sprint 25', days: [row('2026-11-13'), row('2026-11-12', { status: 'confirmed', confirmedAt: '2026-11-13T01:20:00.000Z', grade: 'B', findings: 4, sessionsWithFindings: 2 })], sheet };
  const html = renderToStaticMarkup(<JudgeDays data={data} busy={false} onOpenDay={noop} onOpenSprint={noop} onJudgeNow={noop} />);
  assert.match(html, /Fri 13 Nov/);
  assert.match(html, /8 sessions · 5 findings in 3 sessions/);
  assert.match(html, /Waiting for you/);
  assert.match(html, /Confirmed 13 Nov 08:20/);
  assert.match(html, /1 to answer · 1 of 2 answered/);
  assert.ok(html.indexOf('Sprint sheet') > html.indexOf('Thu 12 Nov'), 'the Sprint sheet is the last row');
  assert.match(html, /patterns to accept · grade B · 6.4 h owner time lost/);
  assert.strictEqual(dayStatusText({ status: 'stood', confirmedAt: null }), "Judge's call stood (not answered)");
  assert.strictEqual(dayStatusText({ status: 'nothing', confirmedAt: null }), 'Nothing to answer');
  assert.strictEqual(dayLabel('2026-11-13'), 'Fri 13 Nov');
});

test('day sheet: back buttons top and bottom, previous day, Judge\'s calls preset, and Confirm names the day', () => {
  const html = sheetView([finding('f1', 'misread-ac-scope', { threadUrl: 'https://discord.com/channels/1/1566728431/99' })]);
  assert.strictEqual(html.match(/Days of the sprint/g)?.length, 2, 'back to the list at the top and the bottom');
  assert.match(html, /Thu 12 Nov/);
  assert.match(html, /Confirm Fri 13 Nov/);
  assert.match(html, /role="radio" aria-checked="true"[^>]*>Mistake</, "Judge's call is preset");
  assert.match(html, /Should have:<\/b> Hand the rebase to the lead\./);
  assert.match(html, /1 session without findings: Review-QRD-1521 · all A/);
  assert.match(html, /Not answered by noon tomorrow\?/);
});

test('flipping a finding to Not a mistake recounts the session grade on the sheet', () => {
  const findings = [finding('f1', 'misread-ac-scope', { threadUrl: 'https://discord.com/channels/1/2/3' }), finding('f2', 'skipped-step')];
  assert.match(sheetView(findings), /aria-label="Grade D"/);
  const flipped = sheetView(findings, { f1: 'not' });
  assert.match(flipped, /aria-label="Grade B"/);
  assert.match(flipped, /aria-label="Why it is not a mistake \(optional\)"/, 'a note field opens under Not a mistake');
  assert.strictEqual(gradeOf(findings.map((item) => ({ ...item, ownerCall: 'not' })), 0), 'A');
  assert.strictEqual(callOf({ judgeCall: 'mistake', ownerCall: null }), 'mistake', "an unanswered finding keeps Judge's call");
});

test('a flagged message is framed red with its cause; ?message= highlights it', () => {
  const flags = flaggedMessages([finding('f1', 'stopped-with-way-out', { messageId: 7, causeLabel: 'Stopped with a way out' }), finding('f2', 'skipped-step', { messageId: 8, ownerCall: 'not' })]);
  assert.deepStrictEqual([...flags.keys()], [7], 'a finding called not a mistake is not flagged');
  assert.strictEqual(flagText(flags.get(7)!), 'Judge: Stopped with a way out · Hand the rebase to the lead.');
  const src = join(dirname(fileURLToPath(import.meta.url)), '..');
  const list = readFileSync(join(src, 'chat/activity/TranscriptList.tsx'), 'utf8');
  assert.match(list, /data-message-id=\{message\.id\}/g, 'every owner and assistant message is addressable');
  assert.match(list, /flag && 'rounded-sm border border-status-conflict/, 'a flagged message is framed red');
  assert.match(list, /focused && 'ring-2 ring-accent/, 'the ?message= target is highlighted');
  const thread = readFileSync(join(src, 'chat/ChatThread.tsx'), 'utf8');
  assert.match(thread, /querySelector\(`\[data-message-id="\$\{focusMessageId\}"\]`\)/);
  assert.match(thread, /scrollIntoView\(\{ block: 'center' \}\)/);
  assert.match(thread, /oldest > focusMessageId\) void loadOlder\(\)/, 'older pages load until the message is there');
  assert.strictEqual(messageIdFromSearch('?session=s1&message=7'), 7);
  assert.strictEqual(messageIdFromSearch('?session=s1&message=abc'), null);
});

test('Open goes to the session at the message, or to the Discord page thread at the reviewer\'s message', () => {
  assert.strictEqual(findingHref({ sessionId: 's1', messageId: 7, threadUrl: null }), '/sessions?session=s1&message=7');
  assert.strictEqual(findingHref({ sessionId: 's1', messageId: null, threadUrl: 'https://discord.com/channels/111/1566728431/1566730000' }), '/discord?thread=1566728431&message=1566730000');
  assert.strictEqual(discordFindingHref('https://discord.com/channels/111/222'), '/discord?thread=222');
  assert.strictEqual(discordFindingHref('https://example.com/x'), null);
});

test('Both shows a line found by the ledger and by Judge once, with two source chips', () => {
  const item = (id: string, text: string, source: string, kind = 'problem'): RetroItem => ({ id, kind, text, evidence: [id], dest: 'kit', status: 'open', sessionId: null, source, updatedAt: '' });
  const items = [item('l1', 'Prettier was not run in verify.', 'ledger'), item('j1', 'prettier was NOT run in verify', 'judge'), item('j2', 'Guard refusal goes to the owner', 'judge'), item('l2', 'Prettier was not run in verify.', 'ledger', 'try')];
  const both = mergeRetroItems(items, 'both');
  assert.deepStrictEqual(both.map((entry) => [entry.item.id, entry.sources, entry.others.map((other) => other.id)]), [['l1', ['ledger', 'judge'], ['j1']], ['j2', ['judge'], []], ['l2', ['ledger'], []]]);
  assert.deepStrictEqual(mergeRetroItems(items, 'ledger').map((entry) => entry.item.id), ['l1', 'l2']);
  assert.deepStrictEqual(mergeRetroItems(items, 'judge').map((entry) => entry.item.id), ['j1', 'j2']);
  const html = renderToStaticMarkup(<SprintSheet sprint="QRD Sprint 26" previous="QRD Sprint 25" sheet={sheet} patterns={both} busy={false} onBack={noop} onOpenDay={noop} onAction={noop} />);
  assert.match(html, />Ledger<\/span><span[^>]*>Judge</);
  assert.strictEqual(html.match(/Days of the sprint/g)?.length, 2, 'the Sprint sheet has its back button top and bottom');
  assert.match(html, /QRD Sprint 25 was C/);
});

test('routes: ?day opens a sheet, the old Agents link keeps its day, and the list drops it', () => {
  assert.deepStrictEqual(judgeRoute('?tab=retro&day=2026-11-13'), { day: '2026-11-13', sprintSheet: false });
  assert.deepStrictEqual(judgeRoute('?tab=retro&day=13-11'), { day: null, sprintSheet: false });
  assert.deepStrictEqual(judgeRoute('?tab=retro&sheet=sprint'), { day: null, sprintSheet: true });
  assert.strictEqual(planningRedirect('/agents?tab=sprint&sub=retro&day=2026-11-13'), '/planning?tab=retro&day=2026-11-13');
  assert.strictEqual(judgeHref('?tab=retro&day=2026-11-13', {}), '/planning?tab=retro');
  assert.strictEqual(judgeHref('?tab=retro', { day: '2026-11-12' }), '/planning?tab=retro&day=2026-11-12');
});

test('Sessions filter by grade, the sidebar block and Home\'s Needs you line', () => {
  const sessions = [{ id: 'a', judge: { status: 'judged', grade: 'C' } }, { id: 'b', judge: null }, { id: 'c', judge: { status: 'judged', grade: 'A' } }];
  assert.deepStrictEqual(filterByGrade(sessions, 'C').map((session) => session.id), ['a']);
  assert.strictEqual(filterByGrade(sessions, 'any').length, 3);
  const block = renderToStaticMarkup(<SessionJudgeView judge={{ status: 'judged', grade: 'C', judgedAt: '2026-11-13T14:12:00.000Z', ownerWaitMinutes: 90, error: null, findings: [finding('f1', 'stopped-with-way-out', { causeLabel: 'Stopped with a way out' }), finding('f2', 'self-inflicted-rework', { causeLabel: 'Self-inflicted rework' })] }} canAct busy={false} notice={null} onAgain={noop} />);
  assert.match(block, /Judge · 13 Nov 21:12/);
  assert.match(block, /aria-label="Grade C"/);
  assert.match(block, /2 findings · owner waited about 1.5 h/);
  assert.match(block, /Judge again/);
  const items = judgeAttention([{ day: '2026-11-13', findings: 5 }], dayLabel);
  assert.strictEqual(items[0].message, 'Judge: Fri 13 Nov waiting (5 findings)');
  assert.strictEqual(signalOf('JUDGE_DAY').group, 'answer');
  assert.strictEqual(ticketAttention(items, []).length, 1);
});

test('Settings › Judge starts off with the planned defaults', () => {
  assert.strictEqual(JUDGE_DEFAULTS.on, false);
  assert.deepStrictEqual(readJudgeSettings(null), JUDGE_DEFAULTS);
  assert.deepStrictEqual(JUDGE_DEFAULTS.windows, [{ from: '21:00', to: '23:30' }, { from: '08:00', to: '09:00' }]);
  assert.deepStrictEqual([JUDGE_DEFAULTS.idleMinutes, JUDGE_DEFAULTS.noonCutoff, JUDGE_DEFAULTS.account], [30, '12:00', '']);
  assert.strictEqual(readJudgeSettings('{"on":true}').on, true);
});

test('the Retro picker offers the active sprint the dashboard does not list yet, and the Judge view lands on it until a sprint is picked', () => {
  const list = [
    { id: 665, name: 'QRD Sprint 25', state: 'closed', startDate: '2026-10-14T11:05:06.645Z' },
    { id: 666, name: 'QRD Sprint 26', state: 'closed', startDate: '2026-10-28T02:06:29.812Z' },
  ];
  assert.deepStrictEqual(retroSprintOptions(list, 'QRD Sprint 27').map((option) => option.value), ['judge:QRD Sprint 27', '666', '665']);
  assert.deepStrictEqual(retroSprintOptions(list, 'QRD Sprint 26').map((option) => option.value), ['666', '665'], 'a listed sprint is not added twice');
  const base = { view: 'both' as const, picked: null, sprintChosen: false, daysSprint: 'QRD Sprint 27', retroSprint: 'QRD Sprint 26' };
  assert.strictEqual(judgeOnlySprint(base), 'QRD Sprint 27');
  assert.strictEqual(judgeOnlySprint({ ...base, view: 'ledger' }), null, 'the ledger view keeps its retro');
  assert.strictEqual(judgeOnlySprint({ ...base, sprintChosen: true, daysSprint: 'QRD Sprint 26' }), null, 'a picked sprint shows its own days');
  assert.strictEqual(judgeOnlySprint({ ...base, sprintChosen: true, picked: 'QRD Sprint 27' }), 'QRD Sprint 27');
});
