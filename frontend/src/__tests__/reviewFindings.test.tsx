import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { LatestFindings, ReviewHistoryTable, type ReviewHistoryProps } from '../pages/blackboard/ReviewHistory';
import { LightBadge } from '../agents/AutoReviewList';
import type { AutoReviewRow } from '../agents/autoReviews';
import { hasReviewHistory, isPending, latestRound, lightTickets, markerSummary, reviewHistory, splitMarker, type ReviewRound } from '../lib/reviewRounds';
import { lightSteps, type LightValues } from '../lib/lightRunner';

const auto = (extra: Partial<AutoReviewRow> = {}): AutoReviewRow => ({
  id: 'a1', ticketKey: 'QRD-1529', prUrl: 'https://github.com/qonekid/repo/pull/9', headSha: '9f3c2a1ffff', threadUrl: 'https://discord.com/channels/1/2', sessionId: null, status: 'blockers', detail: '1 blocker',
  startedAt: '2026-11-17T10:41:00.000Z', finishedAt: null, round: 1, postStatus: 'sent', postAt: '2026-11-17T10:43:00.000Z', postText: 'mas rizky, ada blocker 1.\nDOCK-REVIEW on it by <@1> · round 1 · @ 9f3c2a1', postDetail: null, ...extra,
});

const round = (extra: Partial<ReviewRound> = {}): ReviewRound => ({
  id: 'r1', status: 'reported', summary: 'QRD-1529: 1 finding', threadUrl: 'https://discord.com/channels/1/3', at: '2026-11-17T10:58:00.000Z', mode: 'light', replyStatus: 'pending', replyAt: '2026-11-17T11:00:00.000Z',
  replyText: 'mas rizky, fixed di b71e0d4.\nDOCK-FIX round 1 · head b71e0d4', replyDetail: null, ...extra,
});

const props = (extra: Partial<ReviewHistoryProps> = {}): ReviewHistoryProps => ({
  rows: reviewHistory([auto()], [round()]), busy: false, editing: null, onCancel: () => undefined, onEdit: () => undefined, onText: () => undefined, onSave: () => undefined, onClose: () => undefined, ...extra,
});

interface Node { type?: unknown; props?: { children?: unknown; onClick?: () => void; [key: string]: unknown } }
const walk = (node: unknown, found: Node[] = []): Node[] => {
  if (Array.isArray(node)) { node.forEach((child) => walk(child, found)); return found; }
  if (node && typeof node === 'object') { found.push(node as Node); walk((node as Node).props?.children, found); }
  return found;
};
const text = (node: unknown): string => walk(node).map((item) => item.props?.children).filter((child): child is string => typeof child === 'string').join('|');
const buttons = (tree: unknown, label: string) => walk(tree).filter((item) => item.props?.onClick && text(item) === label);

test('the history lists your DOCK reviews and the teammate rounds in time order, with the Discord status of each', () => {
  const rows = reviewHistory([auto({ id: 'a2', startedAt: '2026-11-17T11:20:00.000Z', round: 2, postStatus: 'cancelled' })], [round({ replyStatus: 'sent' })]);
  assert.deepEqual(rows.map((row) => [row.kind, row.who, row.discord]), [['round', "Teammate's DOCK", 'sent'], ['review', 'Your DOCK', 'cancelled']]);
  const html = renderToStaticMarkup(<ReviewHistoryTable {...props({ rows })} />);
  for (const word of ['Round', 'Time', 'Who', 'Summary', 'Discord', 'Your DOCK', "Teammate&#x27;s DOCK", 'sent', 'cancelled']) assert.ok(html.includes(word), word);
  assert.doesNotMatch(html, /Cancel post/);
});

test('only a pending post has Cancel post and Edit, and each calls its handler with the row', () => {
  const cancelled: string[] = [];
  const edited: string[] = [];
  const rows = reviewHistory([auto({ postStatus: 'pending' })], [round({ replyStatus: 'sent' })]);
  const view = props({ rows, onCancel: (row) => cancelled.push(row.id), onEdit: (row) => edited.push(row.id) });
  const tree = ReviewHistoryTable(view);
  assert.equal(buttons(tree, 'Cancel post').length, 1);
  assert.equal(buttons(tree, 'Edit').length, 1);
  buttons(tree, 'Cancel post')[0].props?.onClick?.();
  buttons(tree, 'Edit')[0].props?.onClick?.();
  assert.deepEqual(cancelled, ['a1']);
  assert.deepEqual(edited, ['a1']);
  assert.equal(isPending(rows[0]), true);
});

test('a teammate round with a pending reply can be cancelled too', () => {
  const cancelled: Array<[string, string]> = [];
  const tree = ReviewHistoryTable(props({ rows: reviewHistory([], [round()]), onCancel: (row) => cancelled.push([row.kind, row.id]) }));
  buttons(tree, 'Cancel post')[0].props?.onClick?.();
  assert.deepEqual(cancelled, [['round', 'r1']]);
});

test('editing shows the text without the marker line, the marker read only, and Save passes the row', () => {
  const saved: string[] = [];
  const rows = reviewHistory([auto({ postStatus: 'pending' })], []);
  const html = renderToStaticMarkup(<ReviewHistoryTable {...props({ rows, editing: { id: 'a1', text: 'mas rizky, ada blocker 1.' } })} />);
  assert.match(html, /<textarea[^>]*aria-label="Post text"[^>]*>mas rizky, ada blocker 1\.<\/textarea>/);
  assert.match(html, /DOCK-REVIEW on it by &lt;@1&gt; · round 1/);
  assert.match(html, /added by DOCK/);
  assert.doesNotMatch(html, /Cancel post/);
  const tree = ReviewHistoryTable(props({ rows, editing: { id: 'a1', text: 'x' }, onSave: (row) => saved.push(row.id) }));
  buttons(tree, 'Save')[0].props?.onClick?.();
  assert.deepEqual(saved, ['a1']);
  assert.equal(splitMarker('hello\nDOCK-FIX round 2 · head b71e0d4').body, 'hello');
  assert.equal(splitMarker('no marker').marker, '');
});

test('the latest round shows its findings with the mode, and a missing mode reads unknown', () => {
  assert.match(renderToStaticMarkup(<LatestFindings round={round()} />), />light</);
  assert.match(renderToStaticMarkup(<LatestFindings round={round({ mode: 'full' })} />), />full</);
  assert.match(renderToStaticMarkup(<LatestFindings round={round({ mode: null })} />), /mode unknown/);
  assert.match(renderToStaticMarkup(<LatestFindings round={round()} />), /QRD-1529: 1 finding/);
});

test('a ticket has review history when it has a round or an auto review; the newest round wins', () => {
  const sessions = [
    { id: 's1', ticketKey: 'QRD-1529', reviewRound: round({ id: 'old', at: '2026-11-17T09:00:00.000Z', mode: 'full' }) },
    { id: 's2', ticketKey: 'qrd-1529', reviewRound: round() },
    { id: 's3', ticketKey: 'QRD-1', reviewRound: round({ id: 'other', mode: 'full' }) },
    { id: 's4', ticketKey: 'QRD-1529', reviewRound: null },
  ];
  const rounds = sessions.flatMap((session) => (session.reviewRound ? [session.reviewRound] : [])).filter((item) => item.id !== 'other');
  assert.equal(rounds.length, 2);
  assert.equal(latestRound(rounds)?.id, 'r1');
  assert.equal(hasReviewHistory([], []), false);
  assert.equal(hasReviewHistory([auto()], []), true);
  assert.equal(hasReviewHistory([], rounds), true);
  assert.deepEqual([...lightTickets(sessions)], ['QRD-1529']);
});

test('the Discord column shows the body and a muted line built from the marker, not the raw marker', () => {
  assert.equal(markerSummary('DOCK-REVIEW on it by <@1> · round 1 · @ 9f3c2a1 · Request change · 1 blocker'), 'round 1 · @9f3c2a1 · Request change · 1 blocker');
  assert.equal(markerSummary('DOCK-FIX round 2 · head b71e0d4'), 'round 2 · head b71e0d4');
  const rows = reviewHistory([auto({ postText: 'mas rizky, ada blocker 1.\nDOCK-REVIEW on it by <@1> · round 1 · @ 9f3c2a1 · Request change · 1 blocker' })], []);
  const html = renderToStaticMarkup(<ReviewHistoryTable {...props({ rows })} />);
  assert.match(html, /mas rizky, ada blocker 1\./);
  assert.match(html, /round 1 · @9f3c2a1 · Request change · 1 blocker/);
  assert.doesNotMatch(html, /DOCK-REVIEW on it by/);
});

test('the Blackboard reads every round of the ticket from reviewRoundsForTicket', () => {
  for (const file of ['../pages/BlackboardPage.tsx', '../pages/blackboard/ReviewFindings.tsx']) assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /GET_REVIEW_ROUNDS_FOR_TICKET/);
  assert.match(readFileSync(new URL('../graphql/queries.ts', import.meta.url), 'utf8'), /reviewRoundsForTicket\(key: \$key\)/);
});

test('the Agents run row shows LIGHT, and the page wires it from the rounds query', () => {
  assert.match(renderToStaticMarkup(<LightBadge />), />LIGHT</);
  const page = readFileSync(new URL('../pages/AgentsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /lightKeys\.has\(run\.key\.toUpperCase\(\)\) && <LightBadge/);
});

test('the Blackboard has the Review findings entry and the Sessions page links to it', () => {
  const board = readFileSync(new URL('../pages/BlackboardPage.tsx', import.meta.url), 'utf8');
  assert.match(board, /entry\(REVIEW_ENTRY, Eye, 'Review findings'/);
  assert.match(board, /<ReviewFindings ticketKey=\{picked\} \/>/);
  const sessions = readFileSync(new URL('../pages/SessionsPage.tsx', import.meta.url), 'utf8');
  assert.match(sessions, /file=%40review/);
});

test('the review findings component calls the four cancel and edit mutations', () => {
  const source = readFileSync(new URL('../pages/blackboard/ReviewFindings.tsx', import.meta.url), 'utf8');
  for (const mutation of ['CANCEL_AUTO_REVIEW_POST', 'EDIT_AUTO_REVIEW_POST', 'CANCEL_REVIEW_REPLY_POST', 'EDIT_REVIEW_REPLY_POST']) assert.match(source, new RegExp(`useMutation\\(${mutation}`));
  const mutations = readFileSync(new URL('../graphql/mutations.ts', import.meta.url), 'utf8');
  assert.match(mutations, /cancelAutoReviewPost\(id: \$id\)/);
  assert.match(mutations, /editAutoReviewPost\(id: \$id, text: \$text\)/);
  assert.match(mutations, /cancelReviewReplyPost\(id: \$id\)/);
  assert.match(mutations, /editReviewReplyPost\(id: \$id, text: \$text\)/);
});

test('the light runner steps follow the settings, and an off runner has none', () => {
  const light: LightValues = { lightRunnerOn: true, lightForFindings: true, lightForParty: true, lightForRetro: false, lightMaxLines: 150, lightMaxFiles: 3, lightWorkerModel: 'sonnet', lightBrowserCheck: true, lightBlastCheck: true, lightBlastLoops: 2, lightPublish: 'push' };
  assert.deepEqual(lightSteps(light), ['scout', 'brief', 'worker · sonnet', 'verifier', 'browser check (FE)', 'blast check', 'publisher · push to PR']);
  assert.deepEqual(lightSteps({ ...light, lightBrowserCheck: false, lightBlastCheck: false, lightWorkerModel: 'haiku', lightPublish: 'draft' }), ['scout', 'brief', 'worker · haiku', 'verifier', 'publisher · draft PR']);
  assert.deepEqual(lightSteps({ ...light, lightRunnerOn: false }), []);
});
