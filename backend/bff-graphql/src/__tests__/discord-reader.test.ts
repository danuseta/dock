import assert from 'node:assert';
import test from 'node:test';
import { DiscordReader, ON_IT, buildRow, sortThread, toMessage, type DiscordResponse, type RawMessage, type RawThread } from '../integrations/discord-reader';
import { ThreadService, channelIdOf, withJira, type Channel, type ChannelKind, type SyncStatus, type ThreadRecord, type ThreadRow, type ThreadStore, type ThreadView } from '../integrations/discord-threads';

const ME = '900';
const user = (id: string, name: string) => ({ id, username: name.toLowerCase(), global_name: name });
const RINA = user('101', 'Rina');
const HAMZAH = user('102', 'Hamzah');
const DANU = user(ME, 'Danu');

let clock = 0;
const msg = (author: ReturnType<typeof user>, content: string, mentions: Array<ReturnType<typeof user>> = []): RawMessage => {
  clock += 1;
  return { id: String(1000 + clock), content, timestamp: new Date(Date.UTC(2026, 9, 20, 9, clock)).toISOString(), author, mentions, attachments: [] };
};
const sorted = (kind: ChannelKind, raw: RawMessage[], owner: string | null = RINA.id, closed = false, followed = false) =>
  sortThread(kind, followed, owner, closed, raw.map((message) => toMessage(message, ME)), ME);

test('on it is read with or without the space and in any case', () => {
  for (const text of ['on it', 'On it!', 'onit', 'ok ONIT ya', 'aku on it']) assert.ok(ON_IT.test(text), text);
  for (const text of ['online', 'monitor', 'button it', 'onions']) assert.ok(!ON_IT.test(text), text);
});

test('a bug report thread follows who took it and who spoke last', () => {
  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop on Safari')]).state, 'FLOW_1');
  assert.strictEqual(sorted('uat', [msg(RINA, 'Import fails')]).state, 'FLOW_3');
  assert.strictEqual(sorted('bug', [msg(RINA, '<@900> please check', [DANU])]).state, 'FLOW_2');
  assert.strictEqual(sorted('uat', [msg(RINA, '<@900> please check', [DANU])]).state, 'FLOW_4');

  const taken = sorted('bug', [msg(RINA, 'Login loop'), msg(HAMZAH, 'onit')]);
  assert.strictEqual(taken.state, 'TAKEN');
  assert.strictEqual(taken.claim?.author, 'Hamzah');
  assert.strictEqual(taken.claimerRepliedAt, null);

  const mine = sorted('bug', [msg(RINA, 'Login loop'), msg(DANU, 'on it')]);
  assert.strictEqual(mine.state, 'YOURS_IN_PROGRESS');
  assert.strictEqual(mine.claim?.mine, true);

  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(DANU, 'on it'), msg(RINA, 'video attached')]).state, 'YOUR_TURN');
  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(DANU, 'fixed in #918')]).state, 'WAITING_ON_REPORTER');
  assert.strictEqual(sorted('bug', [msg(DANU, 'fixed'), msg(RINA, '<@900> still broken', [DANU])]).state, 'YOUR_TURN');
  assert.strictEqual(sorted('bug', [msg(HAMZAH, 'on it'), msg(RINA, '<@900> can you look', [DANU])]).state, 'FLOW_2', 'a mention to the owner wins over somebody else taking it');
  assert.strictEqual(sorted('bug', [msg(RINA, 'x')], RINA.id, true).state, 'CLOSED');
});

test('the claimer writing again is what counts as a reply to the claim', () => {
  const others = sorted('pr', [msg(DANU, 'Review please'), msg(HAMZAH, 'on it'), msg(RINA, 'video for context')], ME);
  assert.strictEqual(others.claimerRepliedAt, null, 'a message from someone else is not a reply to the claim');
  const answered = sorted('pr', [msg(DANU, 'Review please'), msg(HAMZAH, 'on it'), msg(HAMZAH, 'left two comments')], ME);
  assert.ok(answered.claimerRepliedAt);
});

test('pr-review keeps only the owner own threads and the ones that ask the owner', () => {
  assert.strictEqual(sorted('pr', [msg(DANU, 'Review #921'), msg(HAMZAH, 'comment on SkillPicker')], ME).state, 'FLOW_5');
  assert.strictEqual(sorted('pr', [msg(DANU, 'Review #921')], ME).state, 'WAITING_ON_REPORTER');
  assert.strictEqual(sorted('pr', [msg(RINA, 'Review #930 <@900>', [DANU])]).state, 'REVIEW_ASKED');
  assert.strictEqual(sorted('pr', [msg(RINA, 'Review #930'), msg(DANU, 'on it')]).state, 'YOURS_IN_PROGRESS');
  assert.strictEqual(sorted('pr', [msg(RINA, 'Review #930'), msg(HAMZAH, 'on it')]).state, 'NOT_YOURS');
});

test('a followed channel keeps only what involves the owner; a followed thread always stays', () => {
  assert.strictEqual(sorted('follow', [msg(RINA, 'Deploy at 3')]).state, 'NOT_YOURS');
  assert.strictEqual(sorted('follow', [msg(RINA, 'Deploy at 3 <@900>', [DANU])]).state, 'YOUR_TURN');
  assert.strictEqual(sorted('follow', [msg(RINA, 'Deploy at 3'), msg(DANU, 'ok')]).state, 'WAITING_ON_REPORTER');
  assert.strictEqual(sorted('follow', [msg(RINA, 'Deploy at 3')], RINA.id, false, true).state, 'FOLLOWING');
});

test('a channel is followed from its id or any discord.com/channels link', () => {
  assert.strictEqual(channelIdOf(' 1527228669725114459 '), '1527228669725114459');
  assert.strictEqual(channelIdOf('https://discord.com/channels/1389235158414000200/1525182530184286289'), '1525182530184286289');
  assert.strictEqual(channelIdOf('https://discord.com/channels/1389235158414000200/1525182530184286289/1530000000000000001'), '1525182530184286289', 'a message link points at its channel');
  assert.throws(() => channelIdOf('#bug-report'), /Paste a Discord channel id/);
});

test('a row names its tickets, pull requests and mentions', () => {
  const thread: RawThread = { id: '1298000000000000000', parent_id: 'f1', name: '[Inbox] qrd-1384 contact name wrong', owner_id: RINA.id, last_message_id: '1003', message_count: 3, applied_tags: ['t1', 't9'] };
  const raw = [msg(RINA, 'Repro <@900>', [DANU]), msg(DANU, 'fix in https://github.com/acme/api/pull/912 and https://github.com/acme/api/pull/912')];
  const row = buildRow({ id: 'f1', name: 'bug-report', kind: 'bug', thread: false, enabled: true }, 'g1', thread, new Map([['t1', 'QRD-1391']]), raw, ME);
  assert.deepStrictEqual(row.tickets, ['QRD-1384', 'QRD-1391']);
  assert.deepStrictEqual(row.prs, ['https://github.com/acme/api/pull/912']);
  assert.deepStrictEqual(row.tags, ['QRD-1391']);
  assert.strictEqual(row.url, 'https://discord.com/channels/g1/1298000000000000000');
  assert.strictEqual(row.messages[0].text, 'Repro @Danu');
  assert.deepStrictEqual(row.messages[0].mentions, [{ id: ME, name: 'Danu', me: true }]);
  assert.strictEqual(row.createdBy, 'Rina');
  assert.deepStrictEqual([row.channelId, row.channel, row.kind], ['f1', 'bug-report', 'bug']);
  assert.strictEqual(row.needsYou, false, 'the owner replied last');
});

function memoryStore(): ThreadStore & { records: Map<string, ThreadRecord> } {
  const records = new Map<string, ThreadRecord>();
  const dismissals = new Map<string, Date>();
  return {
    records,
    rows: async () => [...records.values()].filter((row) => !row.removedAt),
    upsertRow: async (row) => { records.set(row.id, { id: row.id, payload: JSON.stringify(row), lastActivity: new Date(row.lastActivity), lastMessageId: row.lastMessageId, removedAt: null }); },
    removeRows: async (ids, now) => { for (const id of ids) records.set(id, { ...(records.get(id) as ThreadRecord), removedAt: now }); },
    dismissed: async () => dismissals,
    addDismissal: async (id, at) => { dismissals.set(id, at); },
  };
}

const NOW = new Date('2026-10-22T12:00:00Z');
const SETTINGS: Record<string, string> = { discordBotToken: 'tok', discordGuildId: 'g1' };
const CHANNELS: Channel[] = [
  { id: 'fb', name: null, kind: 'bug', thread: false, enabled: true },
  { id: 'fu', name: 'uat-bug-report', kind: 'uat', thread: false, enabled: true },
  { id: 'fp', name: 'pr-review', kind: 'pr', thread: false, enabled: true },
  { id: 'off', name: 'old', kind: 'bug', thread: false, enabled: false },
];

function reader(routes: Record<string, DiscordResponse | DiscordResponse[]>, settings = SETTINGS, channels = CHANNELS) {
  const service = new ThreadService(memoryStore());
  let status: SyncStatus = { syncedAt: '2026-10-22T11:00:00.000Z', error: null, requests: 0 };
  const calls: string[] = [];
  const waits: number[] = [];
  const saved = new Map<string, Channel>(channels.map((channel) => [channel.id, { ...channel }]));
  const instance = new DiscordReader({
    now: () => NOW,
    setting: async (key) => settings[key] ?? null,
    ownerId: async () => ME,
    request: async (path) => {
      calls.push(path);
      const route = routes[path];
      if (!route) return { status: 404, body: null };
      return Array.isArray(route) ? (route.shift() as DiscordResponse) : route;
    },
    sleep: async (ms) => { waits.push(ms); },
    channels: async () => [...saved.values()],
    saveChannel: async (channel) => { saved.set(channel.id, channel); },
    stored: () => service.stored(),
    save: (rows) => service.save(rows),
    status: async () => status,
    saveStatus: async (next) => { status = next; },
  });
  return { instance, service, calls, waits, saved };
}

const ok = (body: unknown): DiscordResponse => ({ status: 200, body });
const forum = (name: string) => ({ id: name, name, type: 15, available_tags: [] });
const bugThread: RawThread = { id: '2001', parent_id: 'fb', name: 'Login loop', owner_id: RINA.id, last_message_id: 'm1', message_count: 1 };
const prThread: RawThread = { id: '2002', parent_id: 'fp', name: 'Review #930', owner_id: RINA.id, last_message_id: 'm2', message_count: 1 };
const oldArchived: RawThread = { id: '2003', parent_id: 'fu', name: 'Old', owner_id: RINA.id, last_message_id: 'm3', thread_metadata: { archived: true, archive_timestamp: '2026-09-01T00:00:00Z' } };
const otherChannel: RawThread = { id: '2004', parent_id: 'chat', name: 'Lunch', owner_id: RINA.id, last_message_id: 'm4' };

const routesFor = () => ({
  '/channels/fb': ok(forum('bug-report')), '/channels/fu': ok(forum('uat-bug-report')), '/channels/fp': ok(forum('pr-review')),
  '/guilds/g1/threads/active': ok({ threads: [bugThread, prThread, otherChannel] }),
  '/channels/fb/threads/archived/public?limit=50': ok({ threads: [] }),
  '/channels/fu/threads/archived/public?limit=50': ok({ threads: [oldArchived] }),
  '/channels/fp/threads/archived/public?limit=50': ok({ threads: [] }),
  '/channels/2001/messages?limit=50': ok([msg(RINA, 'Login loop on Safari')]),
  '/channels/2002/messages?limit=50': ok([msg(RINA, 'Review #930 please')]),
});

test('a sync keeps the forum threads that matter and skips messages that did not change', async () => {
  const { instance, service, calls } = reader(routesFor());
  const status = await instance.sync();
  assert.strictEqual(status.error, null);
  assert.strictEqual(status.syncedAt, NOW.toISOString());
  assert.deepStrictEqual((await service.list()).map((row) => [row.id, row.state]), [['2001', 'FLOW_1']], 'the pr-review thread is not about the owner, the archived one is too old and the chat channel is not a forum');
  assert.ok(!calls.includes('/channels/2003/messages?limit=50'));
  assert.ok(!calls.includes('/channels/off'), 'a turned off channel is not read');

  calls.length = 0;
  await instance.sync();
  assert.deepStrictEqual(calls.filter((path) => path.includes('/messages')), ['/channels/2002/messages?limit=50'], 'the kept thread is not read again while its last message is the same');
});

test('the reader learns channel names and follows a thread outside the channels', async () => {
  const followedThread: RawThread & { type: number } = { id: '3001', type: 11, parent_id: 'chat', name: 'Release 2.4 checklist', owner_id: RINA.id, last_message_id: 'x1', message_count: 1 };
  const routes = { ...routesFor(), '/channels/3001': ok(followedThread), '/channels/3001/messages?limit=50': ok([msg(RINA, 'Step 1 done')]) };
  const { instance, service, saved } = reader(routes, SETTINGS, [...CHANNELS, { id: '3001', name: null, kind: 'follow', thread: false, enabled: true }]);
  await instance.sync();
  assert.strictEqual(saved.get('fb')?.name, 'bug-report', 'a channel added before the bot was set up gets its name');
  assert.strictEqual(saved.get('3001')?.thread, true);
  const row = (await service.list()).find((entry) => entry.id === '3001');
  assert.deepStrictEqual([row?.state, row?.channel, row?.kind], ['FOLLOWING', 'Release 2.4 checklist', 'follow']);
});

test('adding a channel asks Discord for its name and refuses another server', async () => {
  const { instance, saved } = reader({
    '/channels/1527228669725114459': ok({ id: '1527228669725114459', name: 'pr-review', type: 15, guild_id: 'g1' }),
    '/channels/1500000000000000000': ok({ id: '1500000000000000000', name: 'elsewhere', type: 0, guild_id: 'g2' }),
  }, SETTINGS, []);
  const added = await instance.addChannel('https://discord.com/channels/1389235158414000200/1527228669725114459', 'pr');
  assert.deepStrictEqual(added, { id: '1527228669725114459', name: 'pr-review', kind: 'pr', thread: false, enabled: true });
  await assert.rejects(instance.addChannel('1500000000000000000', 'bug'), /another Discord server/);
  assert.deepStrictEqual([...saved.keys()], ['1527228669725114459']);

  const unset = reader({}, {}, []);
  assert.deepStrictEqual(await unset.instance.addChannel('1525182530184286289', 'bug'), { id: '1525182530184286289', name: null, kind: 'bug', thread: false, enabled: true }, 'without the bot the name waits for the first sync');
  assert.deepStrictEqual(unset.calls, []);
});

test('a rate limit waits and goes on; a refused token keeps the old list and says why', async () => {
  const routes = routesFor() as Record<string, DiscordResponse | DiscordResponse[]>;
  routes['/guilds/g1/threads/active'] = [{ status: 429, body: { retry_after: 1.2 } }, ok({ threads: [bugThread] })];
  const limited = reader(routes);
  assert.strictEqual((await limited.instance.sync()).error, null);
  assert.deepStrictEqual(limited.waits, [1200]);

  const refused = reader({ '/channels/fb': { status: 401, body: null } });
  const status = await refused.instance.sync();
  assert.strictEqual(status.error, 'Discord refused the bot token');
  assert.strictEqual(status.syncedAt, '2026-10-22T11:00:00.000Z', 'the time of the last good sync stays');

  const unset = reader({}, {});
  assert.strictEqual((await unset.instance.sync()).error, 'Discord reader is not set up');
  assert.deepStrictEqual(unset.calls, []);
});

test('Mark done holds until the thread has a newer message', async () => {
  const { instance, service } = reader(routesFor());
  await instance.sync();
  const [row] = await service.list();
  assert.strictEqual(await service.dismiss(row.id, row.lastActivity), true);
  assert.strictEqual((await service.list())[0].dismissed, true);
  await service.save([{ ...(row as ThreadRow), lastActivity: '2026-10-22T13:00:00.000Z' }]);
  assert.strictEqual((await service.list())[0].dismissed, false);
  assert.strictEqual(await service.dismiss('missing', row.lastActivity), false);
});

test('Jira settles a thread, and a quiet thread that needs the owner is older', () => {
  const base = { needsYou: true, dismissed: false, state: 'FLOW_1', why: 'New bug', lastActivity: '2026-10-22T10:00:00.000Z' } as unknown as ThreadView;
  const rows = withJira([
    { ...base, id: 'a', tickets: ['QRD-1'] },
    { ...base, id: 'b', tickets: ['QRD-2'] },
    { ...base, id: 'c', tickets: [], lastActivity: '2026-10-18T10:00:00.000Z' },
  ], new Map([['QRD-1', { status: 'Done / MERGED', assignee: 'Danu' }], ['QRD-2', { status: 'In Progress', assignee: null }]]), (status) => status === 'Done / MERGED', NOW);
  assert.deepStrictEqual(rows.map((row) => [row.id, row.state, row.needsYou, row.older]), [['a', 'HANDLED', false, false], ['b', 'FLOW_1', true, false], ['c', 'FLOW_1', true, true]]);
  assert.deepStrictEqual(rows[0].tickets, [{ key: 'QRD-1', status: 'Done / MERGED', assignee: 'Danu' }]);
});
