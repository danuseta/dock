import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanningBar } from '../agents/PlanningBar';
import { NewTicketsPanel } from '../agents/NewTicketsPanel';
import { RevisionsPanel } from '../agents/RevisionsPanel';
import { FlagBox, Findings, LineBadges } from '../agents/WritingFindings';
import { acGroups, barIssues, belowStandardLines, boardCards, cardMark, cardShown, filterCounts, lineBadgeLabel, panelBadge } from '../agents/boardLogic';
import { planAttention, type DraftNewTicket, type DraftRevision, type DraftTicket, type SprintDraft } from '../agents/planning';
import { chatSuggestions, humanizeChipPrompt } from '../chat/suggestions';
import { WritingMark } from '../components/ticket/WritingMark';
import { ReadinessCard, ReadinessChip } from '../components/ticket/TicketReady';
import { ticketReadiness } from '../lib/ticketDetail';
import { belowStandard, flagReasonValid, humanizePrompt, lintMark, lintTip, type TicketLint } from '../lib/writing';

const BLOCK: TicketLint = { ok: false, findings: [
  { rule: 'W2', field: 'ac', line: 1, level: 'block', text: 'AC 1 says "works correctly" and shows nothing a tester can observe.', fix: 'Write what the tester sees.' },
  { rule: 'W7', field: 'userStory', line: null, level: 'warn', text: 'The User Story is empty.', fix: 'Write "As a ..., I want ..., so ...".' },
] };
const WARN: TicketLint = { ok: true, findings: [{ rule: 'W8', field: 'sp', line: null, level: 'warn', text: '5 story points is more than one ticket should hold.', fix: 'Split the ticket.' }] };
const CLEAN: TicketLint = { ok: true, findings: [] };

const ticket = (key: string, lint: TicketLint | undefined): DraftTicket => ({
  key, summary: `Ticket ${key}`, dev: 'Danu', jiraDev: 'Danu', sp: 2, wave: 1, waveSet: false, status: 'To Do', ac: ['One'], dependsOn: [], start: 0, dur: 1, end: 1, inSprint: true, split: null,
  prediction: null, qaDecision: null, epic: null, frames: [], storyboard: null, tcs: [], tcStale: false, tcPending: false, merge: 'unknown', pulls: [], jiraAhead: false, merged: false, rank: null, planStart: 0, planDur: 1, lint,
});
const fresh = (over: Partial<DraftNewTicket> = {}): DraftNewTicket => ({
  id: 'NEW-1', summary: '[BE] Export', type: 'Task', epic: null, dev: 'Danu', sp: 1, priority: null, userStory: 'u', problem: 'p', ac: ['The export works correctly.'], reference: null, source: 'chat', createdKey: null, error: null, lint: BLOCK, flagReason: null, ...over,
});
const revision = (over: Partial<DraftRevision> = {}): DraftRevision => ({
  key: 'QRD-1602', summary: '[BE] Email CC', status: 'pending', note: null, source: 'chat', inSprint: true, error: null, createdAt: '2026-11-20T08:00:00Z', appliedAt: null,
  fields: [{ name: 'ac', label: 'Acceptance criteria', before: ['One'], after: ['It behaves as expected.'] }], lint: BLOCK, flagReason: null, ...over,
});
const draft = (over: Partial<SprintDraft> = {}) => ({
  sprint: 'QRD Sprint 27', sprintId: 27, status: 'draft', sprintDays: 10, startDate: null, spPerDay: 1, createdBy: null, loadedAt: '2026-11-20T00:00:00Z', publishedAt: null, qaReason: null,
  devs: ['Danu'], blockers: [], canPublish: true, landed: 0, today: null, tickets: [], findings: [], storyboards: [], questions: [], developers: [], mergeSource: 'jira', moves: [], newTickets: [], revisions: [], ...over,
}) as SprintDraft;
const noop = async () => true;

test('the Humanize prompt is the exact text, and the chat chip fills it with a key to paste', () => {
  assert.equal(humanizePrompt('QRD-1602', 'QRD Sprint 27'), 'Humanize QRD-1602 for sprint "QRD Sprint 27": rewrite its fields for a human reader by the writing standard without changing what the AC asks; on a [BE] ticket start every AC line with its check tag, [UI], [API] or [Dev evidence]; and save a revision for me to review.');
  const chip = chatSuggestions('Planning-QRD Sprint 27', 3).find((item) => item.id === 'humanize');
  assert.equal(chip?.label, 'Humanize a ticket');
  assert.equal(chip?.text, humanizeChipPrompt('QRD Sprint 27'));
  assert.match(chip?.text ?? '', /^Humanize <paste ticket key> for sprint "QRD Sprint 27": rewrite its fields/);
});

test('marks: red when a finding blocks, amber when only notes are left, none when clean; the tip lists them', () => {
  assert.equal(lintMark(BLOCK), 'block');
  assert.equal(lintMark(WARN), 'warn');
  assert.equal(lintMark(CLEAN), null);
  assert.equal(lintMark(undefined), null);
  assert.match(lintTip(BLOCK), /^W2 AC 1 says "works correctly"[^\n]*\nW7 The User Story is empty\.$/);
  assert.deepEqual(belowStandard([{ key: 'A', lint: BLOCK }, { key: 'B', lint: WARN }, { key: 'C' }]).map((item) => item.key), ['A']);
  assert.match(renderToStaticMarkup(<WritingMark lint={BLOCK} />), /text-status-conflict[^>]*title="W2 AC 1 says[^"]*"[^>]*aria-label="Below the writing standard"/);
  assert.match(renderToStaticMarkup(<WritingMark lint={WARN} />), /Writing: notes/);
  assert.equal(renderToStaticMarkup(<WritingMark lint={CLEAN} />), '');
});

test('a flag reason is 5 to 300 characters', () => {
  assert.equal(flagReasonValid('okay'), false);
  assert.equal(flagReasonValid(' owner ok '), true);
  assert.equal(flagReasonValid('x'.repeat(300)), true);
  assert.equal(flagReasonValid('x'.repeat(301)), false);
});

test('readiness gets a writing item that fails on a block finding, and a qa item once the prediction ran', () => {
  const base = { key: 'QRD-7', title: '[BE] Export', acceptanceCriteria: '- The export has 3 rows.', summary: { current: true, testData: 'x', ui: false }, tcApproved: true };
  const ok = ticketReadiness({ ...base, lint: CLEAN });
  assert.deepEqual(ok.items.map((item) => item.id), ['refs', 'open', 'summary', 'alone', 'data', 'tc', 'design', 'writing']);
  assert.equal(ok.notReady, false);
  const bad = ticketReadiness({ ...base, lint: BLOCK, prediction: 'ESCALATED' });
  assert.deepEqual(bad.missing.map((item) => [item.id, item.text]), [['writing', 'Below the writing standard: 1 finding to fix'], ['qa', 'QA predicts ESCALATED: the AC may not be testable']]);
  assert.deepEqual([bad.done, bad.total, bad.notReady], [7, 9, true]);
  assert.equal(ticketReadiness({ ...base, lint: WARN, prediction: 'REVISION-RISK' }).notReady, false, 'only ESCALATED fails the qa item; notes do not fail the writing item');
});

test('a Not ready chip shows on the board card and the detail card when an item fails, and Humanize only when it is offered', () => {
  const bad = ticketReadiness({ key: 'QRD-7', title: '[FE] x', acceptanceCriteria: '', lint: BLOCK });
  assert.match(renderToStaticMarkup(<ReadinessChip ready={bad} />), />Not ready</);
  const ok = ticketReadiness({ key: 'QRD-7', title: '[BE] x', acceptanceCriteria: '', lint: CLEAN, summary: { current: true, testData: 'x', ui: false }, tcApproved: true });
  assert.doesNotMatch(renderToStaticMarkup(<ReadinessChip ready={ok} />), /Not ready/);
  assert.match(renderToStaticMarkup(<ReadinessCard ready={bad} startOpen onNavigate={() => undefined} onHumanize={() => undefined} />), /Humanize/);
  assert.doesNotMatch(renderToStaticMarkup(<ReadinessCard ready={bad} startOpen onNavigate={() => undefined} />), /Humanize/);
});

test('the board marks cards by finding, filters to the ones below the standard, and counts them for the bottom bar', () => {
  const d = draft({ tickets: [ticket('QRD-1', BLOCK), ticket('QRD-2', WARN), ticket('QRD-3', CLEAN), ticket('QRD-4', undefined)], newTickets: [fresh()] });
  const cards = boardCards(d);
  assert.deepEqual(cards.map((card) => [card.key, cardMark(card)]), [['QRD-1', 'block'], ['QRD-2', 'warn'], ['QRD-3', null], ['QRD-4', null], ['NEW-1', 'block']]);
  assert.deepEqual(cards.filter((card) => cardShown(card, 'writing')).map((card) => card.key), ['QRD-1', 'NEW-1']);
  assert.equal(filterCounts(cards).writing, 2);
  assert.equal(barIssues(d).writing, 2);
  assert.equal(barIssues(draft({ tickets: [{ ...ticket('QRD-9', BLOCK), merged: true }] })).writing, 0, 'a merged ticket is not planned any more');
});

test('the bottom bar shows "N tickets below the writing standard" and jumps to the Board filter', () => {
  const d = draft({ tickets: [ticket('QRD-1', BLOCK), ticket('QRD-5', BLOCK)] });
  const ready = { items: [], missing: [], sp: 0, capacity: 10, cut: false } as never;
  const html = renderToStaticMarkup(<PlanningBar draft={d} ready={ready} signal={null} busy={false} onShow={() => undefined} onPublish={() => undefined} onRepublish={() => undefined} onWriting={() => undefined} />);
  assert.match(html, /2 tickets below the writing standard/);
  const one = renderToStaticMarkup(<PlanningBar draft={draft({ tickets: [ticket('QRD-1', BLOCK)] })} ready={ready} signal={null} busy={false} onShow={() => undefined} onPublish={() => undefined} onRepublish={() => undefined} onWriting={() => undefined} />);
  assert.match(one, /1 ticket below the writing standard/);
  const none = renderToStaticMarkup(<PlanningBar draft={draft({ tickets: [ticket('QRD-1', CLEAN)] })} ready={ready} signal={null} busy={false} onShow={() => undefined} onPublish={() => undefined} onRepublish={() => undefined} onWriting={() => undefined} />);
  assert.doesNotMatch(none, /writing standard/);
});

test('findings show per field: red for a block, amber for a note, each with its fix', () => {
  const html = renderToStaticMarkup(<Findings lint={BLOCK} field="ac" />);
  assert.match(html, /W2/);
  assert.match(html, /border-status-conflict\/50/);
  assert.match(html, /Write what the tester sees\./);
  assert.match(renderToStaticMarkup(<Findings lint={BLOCK} field="userStory" />), /border-status-warn\/50/);
  assert.equal(renderToStaticMarkup(<Findings lint={BLOCK} field="problem" />), '');
});

test('the flag box asks for a reason of 5 to 300 characters and names the WRITING-FLAG label; Create stays off until it is given', () => {
  const html = renderToStaticMarkup(<FlagBox title="Create NEW-1 with a flag" lint={[BLOCK]} action="Create with flag" busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
  assert.match(html, /WRITING-FLAG/);
  assert.match(html, /5 to 300 characters/);
  assert.match(html, /maxLength="300"|maxlength="300"/i);
  assert.match(html, /<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Create with flag/s);
  assert.match(html, /AC 1 says &quot;works correctly&quot;/);
});

test('a new ticket below the standard is created with a flag; a clean one is created as before', () => {
  const html = (item: DraftNewTicket) => renderToStaticMarkup(<NewTicketsPanel draft={draft({ newTickets: [item] })} busy={false} onSave={noop} onRemove={() => undefined} onCreate={async () => []} />);
  const below = html(fresh());
  assert.match(below, /Create with flag/);
  assert.match(below, /1 blocking/);
  assert.match(below, /Writing findings of ac/);
  assert.doesNotMatch(below, />Create in Jira</);
  const clean = html(fresh({ lint: CLEAN }));
  assert.match(clean, /Create in Jira/);
  assert.doesNotMatch(clean, /Create with flag/);
  assert.match(html(fresh({ createdKey: 'QRD-1700', flagReason: 'The PO agreed' })), /Flagged: The PO agreed/);
});

test('a revision below the standard is applied with a flag, shows its findings per field, and a flagged ticket offers Humanize when no revision exists', () => {
  const panel = (d: SprintDraft, onHumanize?: (key: string) => void) => renderToStaticMarkup(<RevisionsPanel draft={d} busy={false} onSave={noop} onApply={async () => null} onDiscard={() => undefined} onOpenTicket={() => undefined} onHumanize={onHumanize} />);
  const below = panel(draft({ revisions: [revision()] }));
  assert.match(below, /Apply with flag/);
  assert.match(below, /Writing findings of ac/);
  assert.doesNotMatch(below, />Apply to Jira</);
  const clean = panel(draft({ revisions: [revision({ lint: CLEAN })] }));
  assert.match(clean, /Apply to Jira/);
  assert.match(panel(draft({ revisions: [revision({ status: 'applied', appliedAt: '2026-11-21T00:00:00Z', flagReason: 'Owner accepted' })] })), /Flagged: Owner accepted/);
  const empty = panel(draft({ tickets: [ticket('QRD-1', BLOCK), ticket('QRD-3', CLEAN)] }), () => undefined);
  assert.match(empty, /Tickets with writing findings/);
  assert.match(empty, /QRD-1/);
  assert.match(empty, /Humanize/);
  assert.doesNotMatch(empty, /QRD-3/);
  assert.doesNotMatch(panel(draft({ tickets: [ticket('QRD-1', BLOCK)] })), /Humanize/, 'without a chat to ask there is no button');
});

const lineFinding = (rule: string, line: number, level: 'block' | 'warn', text: string) => ({ rule, field: 'ac', line, level, text, fix: 'Fix it.' });
const W2_LINE = lineFinding('W2', 2, 'block', 'AC 2 says "works correctly" and shows nothing a tester can observe.');
const W1_LINE = lineFinding('W1', 3, 'block', 'AC 3 is a placeholder ("TBD").');
const W6_JARGON = lineFinding('W6', 1, 'warn', 'Agent jargon in AC 1: GUESS.');
const W6_LONG = lineFinding('W6', 1, 'warn', 'AC 1 has 41 words; the most is 30.');
const W6_MANY = lineFinding('W6', 2, 'warn', 'AC 2 joins 4 or more behaviours with "and".');
const TICKET_WIDE = { rule: 'W5', field: 'summary', line: null, level: 'warn' as const, text: 'The summary has no prefix.', fix: 'Add [FE].' };
const withLint = (key: string, findings: Array<ReturnType<typeof lineFinding> | typeof TICKET_WIDE>): DraftTicket => ({ ...ticket(key, { ok: !findings.some((item) => item.level === 'block'), findings: findings as never }), ac: ['One', 'Two', 'Three'] });
const refFinding = (key: string, line: number) => ({ id: `ac|${key}|QRD-9|x`, key, line, text: 'Uses QRD-9', refKey: 'QRD-9', kind: 'outside-plan', refEnd: null, ownEnd: null, decision: null, linked: false });

test('the AC check lists a ticket that has only line findings, without reference rows', () => {
  const d = draft({ tickets: [withLint('QRD-1', [W2_LINE, TICKET_WIDE]), withLint('QRD-2', [])] });
  const groups = acGroups(d);
  assert.deepEqual(groups.map((group) => [group.key, group.findings.length, [...group.lines.keys()]]), [['QRD-1', 0, [2]]]);
  assert.deepEqual(acGroups(draft({ tickets: [withLint('QRD-2', [TICKET_WIDE])] })), [], 'ticket-level findings alone do not bring a ticket to this tab');
});

test('line badges read placeholder, vague, too long, several behaviours and agent jargon', () => {
  assert.deepEqual([W1_LINE, W2_LINE, W6_LONG, W6_MANY, W6_JARGON].map((item) => lineBadgeLabel(item)), ['placeholder', 'vague', 'too long', 'several behaviours', 'agent jargon']);
  assert.equal(lineBadgeLabel(lineFinding('W3', 1, 'block', 'AC 1 names QRD-9')), null);
  const html = renderToStaticMarkup(<LineBadges findings={[W2_LINE, W6_MANY]} label={lineBadgeLabel} />);
  assert.match(html, /W2 · vague/);
  assert.match(html, /W6 · several behaviours/);
  assert.match(html, /border-status-conflict\/50/);
  assert.match(html, /border-status-warn\/50/);
  assert.match(html, /flex-wrap/);
  assert.match(html, /title="AC 2 says &quot;works correctly&quot;[^"]*Fix it\."/);
});

test('the header count and the tab badge count undecided references plus AC lines with a block finding', () => {
  const d = draft({
    tickets: [withLint('QRD-1', [W2_LINE, W1_LINE, W6_JARGON]), withLint('QRD-3', [W6_LONG]), withLint('QRD-4', [lineFinding('W3', 1, 'block', 'AC 1 names QRD-9')])],
    findings: [refFinding('QRD-4', 1)],
  });
  assert.equal(belowStandardLines(d), 2, 'W2 and W1 lines; a W6 note and a W3 reference are not counted here');
  assert.equal(panelBadge('ac', { ...d, newTickets: [], storyboards: [], revisions: [] }), 3, '1 undecided reference + 2 block lines');
  assert.equal(belowStandardLines(draft({ tickets: [withLint('QRD-3', [W6_LONG])] })), 0);
});

test('tickets with a block finding come first, and a reference row keeps its line badges', () => {
  const d = draft({
    tickets: [withLint('QRD-5', [W6_LONG]), withLint('QRD-1', [W2_LINE]), withLint('QRD-4', [W6_MANY]), withLint('QRD-6', [lineFinding('W3', 1, 'block', 'AC 1 names QRD-9')])],
    findings: [refFinding('QRD-6', 1)],
  });
  const groups = acGroups(d);
  assert.deepEqual(groups.map((group) => [group.key, group.block]), [['QRD-6', true], ['QRD-1', true], ['QRD-5', false], ['QRD-4', false]]);
  assert.deepEqual(groups[0].findings.map((finding) => finding.line), [1]);
  const tab = readFileSync(fileURLToPath(new URL('../agents/PlanningTab.tsx', import.meta.url)), 'utf8');
  assert.match(tab, /AC \{below === 1 \? 'line' : 'lines'\} below the writing standard/);
  assert.match(tab, /onHumanize\(group\.key\)/);
  assert.match(tab, /humanizePrompt\(key, draft\.sprint\)\)\} \/>\}/);
});

test('the Planning status line says how many tickets joined the sprint since the last load', () => {
  assert.deepEqual(planAttention(null, { questions: [], addedSince: ['QRD-9100', 'QRD-9101'] }).map((item) => item.text), ['2 new tickets since the last load']);
  assert.deepEqual(planAttention(null, { questions: [], addedSince: ['QRD-9100'] }).map((item) => item.text), ['1 new ticket since the last load']);
  assert.deepEqual(planAttention(null, { questions: [], addedSince: [] }), []);
  assert.deepEqual(planAttention(null, { questions: [] }), []);
});
