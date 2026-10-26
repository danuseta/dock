import assert from 'node:assert/strict';
import test from 'node:test';
import { ticketAttention } from '../lib/attention';
import { readFileSync } from 'node:fs';
import { NO_SPRINT, ago, channelLabel, channelTabs, countFor, discordAttention, discordFileUrl, discordMarkdown, fileOpening, kindLabel, matchesSearch, progressOf, slotsOf, sprintGroups, threadsFor, titleParts, wib, wibDay, wibTime, type DiscordThread } from '../lib/discordThreads';

const thread = (id: string, extra: Partial<DiscordThread>): DiscordThread => ({
  id, channelId: 'cb', channel: 'bug-report', kind: 'bug', title: `Thread ${id}`, url: `https://discord.com/channels/g/${id}`, state: 'FLOW_1', why: 'New bug; nobody said on it',
  needsYou: true, older: false, dismissed: false, createdBy: 'Rina', createdByAvatar: null, createdAt: '2026-10-20T09:00:00.000Z', lastActivity: '2026-10-22T09:00:00.000Z',
  messageCount: 1, tags: [], slots: 2, tickets: [], prs: [], claim: null, onIt: [], passes: [], claimerRepliedAt: null, mentionedAt: null, repliedAt: null, messages: [], ...extra,
});

const rows = [
  thread('a', { state: 'YOUR_TURN', lastActivity: '2026-10-22T08:00:00.000Z' }),
  thread('b', { state: 'FLOW_1', lastActivity: '2026-10-22T10:00:00.000Z' }),
  thread('c', { state: 'FLOW_1', older: true, lastActivity: '2026-10-22T11:00:00.000Z' }),
  thread('d', { state: 'TAKEN', needsYou: false, channelId: 'cu', channel: 'uat-bug-report', kind: 'uat' }),
  thread('e', { state: 'REVIEW_ASKED', channelId: 'cp', channel: 'pr-review', kind: 'pr', dismissed: true }),
  thread('f', { state: 'CLOSED', needsYou: false }),
];

test('Needs you lists fresh threads by state, quiet ones after; Open and Done split the rest', () => {
  assert.deepStrictEqual(threadsFor(rows, 'all', 'needs').map((row) => row.id), ['b', 'a', 'c'], 'FLOW_1 before YOUR_TURN, the quiet one last, a dismissed one out');
  assert.deepStrictEqual(threadsFor(rows, 'all', 'open').map((row) => row.id), ['c', 'b', 'd', 'a']);
  assert.deepStrictEqual(threadsFor(rows, 'all', 'done').map((row) => row.id).sort(), ['e', 'f']);
  assert.deepStrictEqual(threadsFor(rows, 'cu', 'open').map((row) => row.id), ['d']);
  assert.strictEqual(countFor(rows, 'cp', 'needs'), 0);
  assert.deepStrictEqual(threadsFor(rows, 'all', 'all').map((row) => row.id).sort(), ['a', 'b', 'c', 'd', 'e', 'f'], 'All lists every thread');
});

test('a message becomes markdown with its mentions marked, its line breaks kept and custom emoji named', () => {
  const message = { id: '1', author: 'Rina', avatar: '', mine: false, at: '', text: '@Danu and @Rina QA please, @QA Team -2\n**urgent** <:pepe:123>', mentions: [{ id: '9', name: 'Danu', me: true, role: false }, { id: '2', name: 'Rina QA', me: false, role: false }, { id: '7', name: 'QA Team', me: false, role: true }], attachments: [] };
  assert.strictEqual(discordMarkdown(message), '[@Danu](#mention-me) and [@Rina QA](#mention-other) please, [@QA Team](#mention-role) -2  \n**urgent** :pepe:');
  assert.strictEqual(discordMarkdown({ ...message, mentions: [] }), '@Danu and @Rina QA please, @QA Team -2  \n**urgent** :pepe:');
  assert.strictEqual(kindLabel('uat'), 'UAT bug report');
});

test('ago reads minutes, hours, then days', () => {
  const now = new Date('2026-10-22T12:00:00.000Z');
  assert.deepStrictEqual(['2026-10-22T11:48:00.000Z', '2026-10-22T09:00:00.000Z', '2026-10-19T12:00:00.000Z'].map((at) => ago(at, now)), ['12m', '3h', '3d']);
});

test('a Discord thread joins its ticket row on Home, or gets one of its own', () => {
  const items = discordAttention([
    thread('t1', { tickets: [{ key: 'QRD-1384', status: 'PR Review', assignee: null, sprint: null, sprintActive: false }], why: 'Rina mentioned you' }),
    thread('t2', { title: 'Broadcast preview cut', why: 'Alvin mentioned you', channelId: 'cu', channel: 'uat-bug-report', kind: 'uat' }),
    thread('t5', { title: 'Release checklist', channel: 'Release checklist', channelId: 't5', kind: 'follow', why: 'Rina mentioned you' }),
    thread('t3', { older: true }),
    thread('t4', { dismissed: true }),
  ]);
  assert.deepStrictEqual(items.map((item) => item.id), ['discord-t1', 'discord-t2', 'discord-t5'], 'quiet and dismissed threads stay on the Discord page');
  assert.strictEqual(items[2].message, 'Rina mentioned you in a followed thread: Release checklist');
  assert.strictEqual(items[1].message, 'Alvin mentioned you in #uat-bug-report: Broadcast preview cut');
  const home = ticketAttention([{ id: 'pr-1', type: 'CONFLICT', message: 'Merge conflict', ticketKey: 'QRD-1384' }, ...items], []);
  assert.deepStrictEqual(home.map((row) => [row.id, row.items.map((item) => item.type)]), [['QRD-1384', ['CONFLICT', 'DISCORD']], ['discord-t2', ['DISCORD']], ['discord-t5', ['DISCORD']]]);
});

test('the tabs follow the channels that are on, named once the bot has read them', () => {
  const channels = [
    { id: 'cb', name: 'bug-report', kind: 'bug' as const, thread: false, enabled: true },
    { id: '1527229030439321820', name: null, kind: 'uat' as const, thread: false, enabled: true },
    { id: 't5', name: 'Release checklist', kind: 'follow' as const, thread: true, enabled: true },
    { id: 'cx', name: 'old', kind: 'bug' as const, thread: false, enabled: false },
  ];
  assert.deepStrictEqual(channelTabs(channels).map((tab) => tab.label), ['All', '#bug-report', '1527229030439321820', 'Release checklist']);
  assert.strictEqual(channelLabel(channels[3]), '#old');
});

test('times are written in WIB whatever the browser zone', () => {
  assert.strictEqual(wib('2026-10-22T16:05:00.000Z'), '22 Oct 23:05 WIB');
  assert.strictEqual(wibTime('2026-10-22T16:05:00.000Z'), '23:05 WIB');
  assert.strictEqual(wibDay('2026-10-22T18:00:00.000Z'), 'Fri 23 Oct', 'past midnight in Jakarta is the next day');
});

test('search reads the title, ticket keys, people and messages', () => {
  const row = thread('s', {
    title: 'Contact name wrong', createdBy: 'Rina', tickets: [{ key: 'QRD-1384', status: null, assignee: null, sprint: null, sprintActive: false }],
    messages: [{ id: 'm', author: 'Aken', avatar: '', mine: false, at: '', text: 'reassign dari HP', mentions: [], attachments: [] }],
  });
  for (const query of ['', 'contact', 'qrd-1384', 'rina', 'aken', 'DARI hp']) assert.ok(matchesSearch(row, query), query);
  assert.ok(!matchesSearch(row, 'broadcast'));
});

test('threads group by the sprint of their ticket: active first, then the newest sprint, none last', () => {
  const ticket = (sprint: string | null, sprintActive = false) => [{ key: 'QRD-1', status: null, assignee: null, sprint, sprintActive }];
  const groups = sprintGroups([
    thread('a', { tickets: ticket('Sprint 24') }),
    thread('b', { tickets: [] }),
    thread('c', { tickets: ticket('Sprint 25', true) }),
    thread('d', { tickets: ticket('Sprint 9') }),
    thread('e', { tickets: ticket('Sprint 24') }),
  ]);
  assert.deepStrictEqual(groups.map((group) => [group.name, group.active, group.threads.map((row) => row.id)]), [
    ['Sprint 25', true, ['c']], ['Sprint 24', false, ['a', 'e']], ['Sprint 9', false, ['d']], [NO_SPRINT, false, ['b']],
  ]);
});

test('the title marks its ticket keys, and each row has one progress chip', () => {
  assert.deepStrictEqual(titleParts('feat(qrd-1398): folder move'), [{ text: 'feat(', ticket: false }, { text: 'qrd-1398', ticket: true }, { text: '): folder move', ticket: false }]);
  assert.deepStrictEqual(titleParts('Kanban label hilang'), [{ text: 'Kanban label hilang', ticket: false }]);
  assert.strictEqual(progressOf(thread('p', {})), 'open');
  assert.strictEqual(progressOf(thread('p', { claim: { author: 'Bima', mine: false, at: '' } })), 'progress');
  assert.strictEqual(progressOf(thread('p', { state: 'CLOSED', claim: { author: 'Bima', mine: false, at: '' } })), 'done');
  assert.strictEqual(progressOf(thread('p', { dismissed: true })), 'done');
  assert.strictEqual(progressOf(thread('p', { repliedAt: '2026-10-22T09:00:00.000Z' })), 'progress', 'the owner replied');
});

test('a pull request fills two reviewer slots: Pass is green, on it is yellow, and two Pass labels make it done', () => {
  const pr = (onIt: string[], passes: string[], extra: Partial<DiscordThread> = {}) => thread('pr', { kind: 'pr', onIt, passes, ...extra });
  assert.deepStrictEqual([slotsOf(pr([], [])), progressOf(pr([], []))], [['free', 'free'], 'open']);
  assert.deepStrictEqual([slotsOf(pr(['Bima'], [])), progressOf(pr(['Bima'], []))], [['onit', 'free'], 'open']);
  assert.deepStrictEqual([slotsOf(pr(['Alvin', 'Bima'], ['alvinPass'])), progressOf(pr(['Alvin', 'Bima'], ['alvinPass']))], [['pass', 'onit'], 'progress']);
  assert.deepStrictEqual([slotsOf(pr(['Alvin', 'Bima', 'Rina'], ['alvinPass', 'bimaPass'])), progressOf(pr(['Alvin', 'Bima'], ['alvinPass', 'bimaPass']))], [['pass', 'pass'], 'done']);
  assert.deepStrictEqual(slotsOf(pr([], ['alvinPass'])), ['pass', 'free'], 'a Pass without on it still fills a slot');
  assert.strictEqual(progressOf(pr(['Bima'], [], { state: 'CLOSED' })), 'done', 'an archived thread is done');
  assert.strictEqual(progressOf(thread('b', { state: 'FIXED' })), 'done', 'a fixed bug is done');
  assert.deepStrictEqual(threadsFor([pr(['Alvin', 'Bima'], ['alvinPass', 'bimaPass'], { state: 'NOT_YOURS', needsYou: false })], 'all', 'done').map((row) => row.id), ['pr'], 'two Pass labels put it under Done');
  assert.deepStrictEqual([slotsOf(pr(['Bima'], [], { slots: 1 })), progressOf(pr(['Bima'], [], { slots: 1 })), progressOf(pr(['Bima'], ['bimaPass'], { slots: 1 }))], [['onit'], 'progress', 'done'], 'a -1 pull request has one slot');
});

test('a text file opens in the viewer, a PDF in a tab, through DOCK; any other file only downloads; the page starts on All', () => {
  assert.equal(fileOpening({ name: 'log.txt', type: 'text/plain; charset=utf-8' }), 'text');
  assert.equal(fileOpening({ name: 'data.json', type: null }), 'text');
  assert.equal(fileOpening({ name: 'bukti.PDF', type: null }), 'pdf');
  assert.equal(fileOpening({ name: 'x', type: 'application/pdf' }), 'pdf');
  assert.equal(fileOpening({ name: 'app.zip', type: 'application/zip' }), null);
  assert.equal(discordFileUrl('https://cdn.discordapp.com/attachments/1/2/a b.pdf?ex=1', 'a b.pdf', true), '/api/discord/file?url=https%3A%2F%2Fcdn.discordapp.com%2Fattachments%2F1%2F2%2Fa%20b.pdf%3Fex%3D1&name=a%20b.pdf&download=1');
  assert.match(readFileSync(new URL('../pages/DiscordPage.tsx', import.meta.url), 'utf8'), /useState<ThreadView>\('all'\)/);
});
