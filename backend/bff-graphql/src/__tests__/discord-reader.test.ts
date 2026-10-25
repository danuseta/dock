import assert from 'node:assert';
import test from 'node:test';
import { CHECK_ASKED, DiscordReader, FINISHED, FIXED, NOT_YET, ON_IT, ROW_VERSION, buildRow, slotsOf, sortThread, toMessage, type DiscordResponse, type RawMessage, type RawThread, type RawUser } from '../integrations/discord-reader';
import { ThreadService, channelIdOf, withJira, type Channel, type ChannelKind, type SyncStatus, type ThreadRecord, type ThreadRow, type ThreadStore, type ThreadView } from '../integrations/discord-threads';

const ME = '900';
const user = (id: string, name: string) => ({ id, username: name.toLowerCase(), global_name: name });
const RINA = user('101', 'Rina');
const HAMZAH = user('102', 'Hamzah');
const DANU = user(ME, 'Danu');

let clock = 0;
const msg = (author: RawUser, content: string, mentions: RawUser[] = []): RawMessage => {
  clock += 1;
  return { id: String(1000 + clock), content, timestamp: new Date(Date.UTC(2026, 9, 20, 9, clock)).toISOString(), author, mentions, attachments: [] };
};
const ROLE = { id: 'r7', name: 'ITteam' };
const SERVER = { roles: new Map([[ROLE.id, ROLE.name]]), channels: new Map<string, string>(), myRoles: new Set([ROLE.id]) };
const sorted = (kind: ChannelKind, raw: RawMessage[], owner: string | null = RINA.id, closed = false, followed = false, tags: string[] = [], slots = 2) =>
  sortThread(kind, followed, owner, closed, raw.map((message) => toMessage(message, ME, SERVER)), ME, tags, slots);
const toRole = (author: RawUser, content: string): RawMessage => ({ ...msg(author, content), mention_roles: [ROLE.id] });

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

  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(DANU, 'on it'), msg(RINA, 'video attached')]).state, 'YOURS_IN_PROGRESS', 'a message without a mention keeps it in progress');
  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(DANU, 'aku lihat dulu')]).state, 'WAITING_ON_REPORTER', 'a reply without on it is in progress too');
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

test('a message names its roles and channels, and every author has an avatar', () => {
  const server = { roles: new Map([['1444724098537357434', 'QA Team']]), channels: new Map([['555', 'bug-report']]), myRoles: new Set<string>() };
  const raw: RawMessage = {
    ...msg({ ...RINA, avatar: 'a1b2' }, '<@&1444724098537357434> -2 retest, see <#555>, not <@&999> or <#777>'),
    mention_roles: ['1444724098537357434', '999'],
    attachments: [{ filename: 'shot.png', size: 2048, content_type: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png?ex=6a&is=69&hm=x', width: 1280, height: 720 }],
  };
  const message = toMessage(raw, ME, server);
  assert.strictEqual(message.text, '@QA Team -2 retest, see #bug-report, not <@&999> or <#777>', 'a role or channel the server does not list keeps its token');
  assert.deepStrictEqual(message.mentions, [{ id: '1444724098537357434', name: 'QA Team', me: false, role: true }]);
  assert.strictEqual(message.avatar, `https://cdn.discordapp.com/avatars/${RINA.id}/a1b2.png?size=64`);
  assert.deepStrictEqual(message.attachments, [{ name: 'shot.png', size: 2048, type: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png?ex=6a&is=69&hm=x', width: 1280, height: 720 }]);
  assert.strictEqual(toMessage(msg({ id: '1389235158414000200', username: 'new' }, 'hi'), ME).avatar, 'https://cdn.discordapp.com/embed/avatars/5.png', 'no avatar: the default Discord picks from the id');
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
  assert.deepStrictEqual(row.messages[0].mentions, [{ id: ME, name: 'Danu', me: true, role: false }]);
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
  const bodies: unknown[] = [];
  const waits: number[] = [];
  const saved = new Map<string, Channel>(channels.map((channel) => [channel.id, { ...channel }]));
  const instance = new DiscordReader({
    now: () => NOW,
    setting: async (key) => settings[key] ?? null,
    ownerId: async () => ME,
    request: async (path, _token, body) => {
      calls.push(path);
      if (body !== undefined) bodies.push(body);
      const route = routes[path];
      if (!route) return { status: 404, body: null };
      return Array.isArray(route) ? (route.shift() as DiscordResponse) : route;
    },
    sleep: async (ms) => { waits.push(ms); },
    channels: async () => [...saved.values()],
    saveChannel: async (channel) => { saved.set(channel.id, channel); },
    stored: () => service.stored(),
    save: (rows) => service.save(rows),
    saveOne: (row) => service.saveOne(row),
    removeOne: (id) => service.removeOne(id),
    status: async () => status,
    saveStatus: async (next) => { status = next; },
  });
  return { instance, service, calls, bodies, waits, saved };
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
  '/guilds/g1/roles': ok([{ id: 'r1', name: 'QA Team' }]),
  '/guilds/g1/channels': ok([{ id: 'fb', name: 'bug-report' }]),
  '/guilds/g1/members/900': ok({ roles: ['r1'] }),
});

test('a sync keeps the forum threads that matter and skips messages that did not change', async () => {
  const { instance, service, calls } = reader(routesFor());
  const status = await instance.sync();
  assert.strictEqual(status.error, null);
  assert.strictEqual(status.syncedAt, NOW.toISOString());
  assert.deepStrictEqual((await service.list()).map((row) => [row.id, row.state]).sort(), [['2001', 'FLOW_1'], ['2002', 'NOT_YOURS']], 'every pull request stays, the archived one is too old and the chat channel is not a forum');
  assert.ok(!calls.includes('/channels/2003/messages?limit=50'));
  assert.ok(!calls.includes('/channels/off'), 'a turned off channel is not read');

  calls.length = 0;
  await instance.sync();
  assert.deepStrictEqual(calls.filter((path) => path.includes('/messages')), [], 'a kept thread is not read again while its last message is the same');
});

test('a stored row of an older shape is built again; role and channel names are read only when a row is built', async () => {
  const { instance, service, calls } = reader(routesFor());
  await instance.sync();
  assert.strictEqual(calls.filter((path) => path === '/guilds/g1/roles').length, 1);
  const [row] = await service.list();
  assert.strictEqual(row.version, ROW_VERSION);
  await service.save([{ ...(row as ThreadRow), version: ROW_VERSION - 1 }]);

  calls.length = 0;
  await instance.sync();
  assert.ok(calls.includes('/channels/2001/messages?limit=50'), 'the old row is read again');
  assert.strictEqual(calls.filter((path) => path === '/guilds/g1/roles').length, 1, 'once per sync, not once per thread');
  assert.strictEqual((await service.list())[0].version, ROW_VERSION);
});

test('attachment links about to expire are refreshed once and remembered; a refusal keeps the old links', async () => {
  const expired = `https://cdn.discordapp.com/attachments/1/2/a.png?ex=${Math.floor(NOW.getTime() / 1000 - 60).toString(16)}&is=0&hm=old`;
  const lasting = `https://cdn.discordapp.com/attachments/1/2/b.png?ex=${Math.floor(NOW.getTime() / 1000 + 86400).toString(16)}&is=0&hm=ok`;
  const renewed = `https://cdn.discordapp.com/attachments/1/2/a.png?ex=${Math.floor(NOW.getTime() / 1000 + 86400).toString(16)}&is=0&hm=new`;
  const file = (url: string) => ({ name: 'a.png', size: 1, type: 'image/png', url, width: 1, height: 1 });
  const row = { id: 'r', messages: [{ attachments: [file(expired), file(lasting)] }] } as unknown as ThreadRow;
  const { instance, calls, bodies } = reader({ '/attachments/refresh-urls': ok({ refreshed_urls: [{ original: expired, refreshed: renewed }] }) });

  const [fresh] = await instance.freshen([row]);
  assert.deepStrictEqual(fresh.messages[0].attachments.map((item) => item.url), [renewed, lasting]);
  assert.deepStrictEqual(bodies, [{ attachment_urls: [expired] }], 'only the expiring link is sent');
  await instance.freshen([row]);
  assert.strictEqual(calls.length, 1, 'the refreshed link is remembered');

  const refused = reader({ '/attachments/refresh-urls': { status: 403, body: null } });
  assert.deepStrictEqual((await refused.instance.freshen([row]))[0].messages[0].attachments.map((item) => item.url), [expired, lasting]);
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
  ], new Map([['QRD-1', { status: 'Done / MERGED', assignee: 'Danu', sprint: 'Sprint 25', sprintActive: true, labels: ['alvinPass', ' bimaPass ', 'pass', 'backend'] }], ['QRD-2', { status: 'In Progress', assignee: null, sprint: null, sprintActive: false, labels: [] }]]), (status) => status === 'Done / MERGED', NOW);
  assert.deepStrictEqual(rows.map((row) => [row.id, row.state, row.needsYou, row.older]), [['a', 'HANDLED', false, false], ['b', 'FLOW_1', true, false], ['c', 'FLOW_1', true, true]]);
  assert.deepStrictEqual(rows[0].tickets, [{ key: 'QRD-1', status: 'Done / MERGED', assignee: 'Danu', sprint: 'Sprint 25', sprintActive: true }]);
  assert.deepStrictEqual(rows[0].passes, ['alvinPass', 'bimaPass'], 'a bare pass is not a person');
  assert.deepStrictEqual(rows[1].passes, []);
});

test('a new bug nobody took does not need the owner; a mention still does', () => {
  const row = (raw: RawMessage[]) => buildRow({ id: 'f1', name: 'bug-report', kind: 'bug', thread: false, enabled: true }, 'g1', { id: '1298000000000000001', parent_id: 'f1', name: 'Bug', owner_id: RINA.id }, new Map(), raw, ME);
  assert.deepStrictEqual([row([msg(RINA, 'Login loop')]).state, row([msg(RINA, 'Login loop')]).needsYou], ['FLOW_1', false]);
  assert.strictEqual(row([msg(RINA, '<@900> login loop', [DANU])]).needsYou, true);
});

test('fix said as done settles a taken bug; belum fix or prefix does not', () => {
  for (const text of ['udah fix di staging', 'Fixed in build 412', 'sudah FIX ya']) assert.ok(FIXED.test(text), text);
  for (const text of ['belum fix', 'blm fixed', 'not fixed yet', 'prefix salah', 'lagi fixing']) assert.ok(!FIXED.test(text), text);

  const fixed = sorted('bug', [msg(RINA, 'Login loop'), msg(HAMZAH, 'on it'), msg(HAMZAH, 'udah fix di staging')]);
  assert.deepStrictEqual([fixed.state, fixed.why], ['FIXED', 'Hamzah: "udah fix di staging"']);
  assert.strictEqual(sorted('uat', [msg(RINA, 'Import fails'), msg(HAMZAH, 'onit'), msg(RINA, 'fixed?'), msg(HAMZAH, 'fixed')]).state, 'FIXED');
  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(HAMZAH, 'fixed')]).state, 'FIXED', 'a fix counts without an on it');
  assert.strictEqual(sorted('bug', [msg(RINA, 'Login loop'), msg(HAMZAH, 'on it'), msg(HAMZAH, 'fixed'), msg(RINA, 'masih kejadian')]).state, 'TAKEN', 'a newer message opens it again');
});

test('a Jira link settles the bug and adds its ticket', () => {
  const thread: RawThread = { id: '1298000000000000002', parent_id: 'f1', name: 'Broadcast preview cut', owner_id: RINA.id };
  const raw = [msg(RINA, 'Preview cuts long templates'), msg(HAMZAH, 'udah dibuatin https://mysales.atlassian.net/browse/qrd-1405')];
  const row = buildRow({ id: 'f1', name: 'uat-bug-report', kind: 'uat', thread: false, enabled: true }, 'g1', thread, new Map(), raw, ME);
  assert.deepStrictEqual([row.state, row.why, row.tickets], ['TICKET_MADE', 'Hamzah linked the Jira ticket', ['QRD-1405']]);
  assert.strictEqual(sorted('bug', [...raw, msg(RINA, 'masih error')]).state, 'TICKET_MADE', 'the work moved to Jira, so a later complaint stays there');
});

test('on it counts each reviewer once and leaves out the author of the pull request', () => {
  const thread: RawThread = { id: '1298000000000000003', parent_id: 'fp', name: 'feat(QRD-1398): folder move', owner_id: ME };
  const raw = [msg(DANU, 'Review please, on it after lunch'), msg(HAMZAH, 'on it'), msg(RINA, 'onit'), msg(HAMZAH, 'on it, second pass')];
  const row = buildRow({ id: 'fp', name: 'pull-request', kind: 'pr', thread: false, enabled: true }, 'g1', thread, new Map(), raw, ME);
  assert.deepStrictEqual(row.onIt, ['Hamzah', 'Rina']);
  const bug = buildRow({ id: 'f1', name: 'bug-report', kind: 'bug', thread: false, enabled: true }, 'g1', { ...thread, parent_id: 'f1', owner_id: RINA.id }, new Map(), [msg(RINA, 'on it myself')], ME);
  assert.deepStrictEqual(bug.onIt, ['Rina'], 'in a bug thread the reporter can take it');
});

test('a Gateway event reads its one thread again; other servers, unknown channels and deletes are handled', async () => {
  const routes = routesFor() as Record<string, DiscordResponse | DiscordResponse[]>;
  const { instance, service, calls } = reader(routes);
  await instance.sync();
  routes['/channels/2001'] = ok(bugThread);
  routes['/channels/2001/messages?limit=50'] = ok([msg(RINA, 'Login loop on Safari'), msg(RINA, '<@900> any news?', [DANU])]);

  calls.length = 0;
  await instance.onEvent('MESSAGE_CREATE', { guild_id: 'g9', channel_id: '2001' });
  await instance.onEvent('MESSAGE_CREATE', { guild_id: 'g1', channel_id: '999' });
  assert.deepStrictEqual(calls, [], 'another server and an unfollowed channel are dropped');

  await instance.onEvent('MESSAGE_CREATE', { guild_id: 'g1', channel_id: '2001' });
  assert.deepStrictEqual(calls, ['/channels/2001', '/channels/2001/messages?limit=50'], 'one thread, two requests');
  assert.deepStrictEqual((await service.list()).find((row) => row.id === '2001')?.state, 'FLOW_2');

  const fresh: RawThread = { id: '2009', parent_id: 'fb', name: 'Logout loop', owner_id: RINA.id, last_message_id: 'n1' };
  routes['/channels/2009'] = ok(fresh);
  routes['/channels/2009/messages?limit=50'] = ok([msg(RINA, 'Logout loop')]);
  await instance.onEvent('THREAD_CREATE', { guild_id: 'g1', id: '2009', parent_id: 'fb' });
  assert.ok((await service.list()).some((row) => row.id === '2009'), 'a new thread of a followed channel appears');
  await instance.onEvent('MESSAGE_CREATE', { guild_id: 'g1', channel_id: '2009' });
  assert.strictEqual(calls.filter((path) => path === '/channels/2009/messages?limit=50').length, 2, 'and its messages are followed from then on');

  await instance.onEvent('THREAD_DELETE', { guild_id: 'g1', id: '2009', parent_id: 'fb' });
  assert.ok(!(await service.list()).some((row) => row.id === '2009'));
});

test('the team words for done, try again and still broken', () => {
  for (const text of ['ok kak sdh aman jg ini', 'Oke, udah done mas', 'Iya dah bisa', 'sdh ak geser ke rfp', 'udah kutes dan aman']) assert.ok(FINISHED.test(text), text);
  for (const text of ['ini bsa di cek ya', 'bisa dicoba lagi mas', 'sudah deploy ke staging', 'updated']) assert.ok(CHECK_ASKED.test(text), text);
  for (const text of ['msh msh sama kak diaku blm bsa', 'msh blm bisa kak', 'di device ku masih sama', 'tetap', 'masih error', 'gabisa']) assert.ok(NOT_YET.test(text), text);
  for (const text of ['udah gak error lagi', 'Oke mas, aku cek ya', 'sdh aman kak']) assert.ok(!NOT_YET.test(text), text);
});

test('a bug is done by a closing tag, a finish word or a check request, and opens again when the reporter says it still fails', () => {
  assert.deepStrictEqual([sorted('bug', [msg(RINA, 'Secret key changes')], RINA.id, false, false, ['High', 'Resolved']).state, sorted('uat', [msg(RINA, 'x')], RINA.id, false, false, ['Done']).state], ['FIXED', 'FIXED']);
  assert.strictEqual(sorted('bug', [msg(RINA, 'x')], RINA.id, false, false, ['JiraTasked']).state, 'TICKET_MADE');
  assert.strictEqual(sorted('uat', [msg(RINA, 'PDF image wrong'), msg(HAMZAH, 'on it'), msg(RINA, 'ok kak sdh aman jg ini')]).state, 'FIXED');
  const asked = [msg(RINA, 'Mask name not resolved'), msg(HAMZAH, 'ini bsa di cek ya')];
  assert.strictEqual(sorted('bug', asked).state, 'FIXED', 'a check request with no answer is done');
  assert.strictEqual(sorted('bug', [...asked, msg(RINA, 'Oke mas')]).state, 'FIXED', 'an okay keeps it done');
  assert.strictEqual(sorted('bug', [...asked, msg(RINA, 'msh blm bisa kak')]).state, 'FLOW_1', 'still broken opens it again');
  assert.strictEqual(sorted('bug', [...asked, msg(RINA, 'msh blm bisa kak'), msg(HAMZAH, 'bisa dicek lagi')]).state, 'FIXED');
  assert.strictEqual(sorted('bug', [msg(RINA, 'x'), msg(RINA, 'mas bisa dicek?')]).state, 'FLOW_1', 'the reporter asking is not a check request');
  assert.strictEqual(sorted('bug', [msg(RINA, 'WA cannot connect'), msg(HAMZAH, 'Oke2 mas ta coba lg, thanks mas')]).state, 'FLOW_1', 'thanks alone is not done');
});

test('a mention newer than the done message asks the owner again; an older one does not', () => {
  assert.strictEqual(sorted('bug', [msg(RINA, '<@900> login loop', [DANU]), msg(HAMZAH, 'udah fix')]).state, 'FIXED');
  assert.strictEqual(sorted('bug', [msg(HAMZAH, 'udah fix'), msg(HAMZAH, '<@900> tolong lihat juga', [DANU])]).state, 'FLOW_2');
});

test('a role tag asks a member while a reviewer slot is free; when full only a direct tag does', () => {
  assert.strictEqual(sorted('bug', [toRole(RINA, '<@&r7> login loop')]).state, 'FLOW_2', 'a tag of a role the owner has counts');
  const ask = toRole(RINA, '<@&r7> -1 review #930');
  assert.strictEqual(sorted('pr', [ask]).state, 'REVIEW_ASKED');
  assert.strictEqual(sorted('pr', [ask, msg(HAMZAH, 'on it')], RINA.id, false, false, [], 1).state, 'NOT_YOURS', 'the one slot is taken');
  assert.strictEqual(sorted('pr', [ask, msg(HAMZAH, 'on it')], RINA.id, false, false, [], 2).state, 'REVIEW_ASKED', 'a second slot is free');
  assert.strictEqual(sorted('pr', [ask, msg(HAMZAH, 'on it'), msg(RINA, '<@900> can you take it', [DANU])], RINA.id, false, false, [], 1).state, 'REVIEW_ASKED', 'a direct tag counts when full');
  assert.strictEqual(sorted('pr', [ask, msg(DANU, 'on it'), msg(HAMZAH, 'on it')], RINA.id, false, false, [], 1).state, 'YOURS_IN_PROGRESS');
  assert.strictEqual(sorted('pr', [ask, msg(DANU, 'on it'), toRole(RINA, '<@&r7> updated')], RINA.id, false, false, [], 1).state, 'REVIEW_ASKED', 'a reviewer tagged again after their reply');
});

test('the reviewers a pull request asks for come from its first message, then its tags, else two', () => {
  const first = (text: string) => [toMessage(msg(RINA, text), ME)];
  assert.strictEqual(slotsOf(first('@ITteam -1 feat(QRD-1234): x'), RINA.id, ['-2']), 1);
  assert.strictEqual(slotsOf(first('feat(QRD-1234): x'), RINA.id, ['High', '-1']), 1);
  assert.strictEqual(slotsOf(first('feat(QRD-1234): x - 2 files'), RINA.id, []), 2);
  const opening = [toMessage(msg(RINA, '[BUGFIX] review QRD-1418 please'), ME), toMessage(msg(RINA, '@ITteam -1'), ME), toMessage(msg(HAMZAH, 'on it'), ME)];
  assert.strictEqual(slotsOf(opening, RINA.id, []), 1, 'a -1 in a second opening message by the poster counts');
  const later = [toMessage(msg(RINA, 'feat(QRD-1336): x'), ME), toMessage(msg(HAMZAH, 'LGTM'), ME), toMessage(msg(RINA, '-1 guys'), ME)];
  assert.strictEqual(slotsOf(later, RINA.id, ['-2']), 2, 'a -1 written after a reviewer replied does not change the ask');
  const followUp = [toMessage(msg(RINA, '@ITteam -2 feat(QRD-1234): x'), ME), toMessage(msg(HAMZAH, 'on it'), ME), toMessage(msg(RINA, '@ITteam -1'), ME)];
  assert.strictEqual(slotsOf(followUp, RINA.id, []), 2, 'the first -N the poster wrote stays when a follow-up says -1');
  const askedLate = [toMessage(msg(RINA, 'feat(QRD-1234): x'), ME), toMessage(msg(HAMZAH, 'which repo?'), ME), toMessage(msg(RINA, '@ITteam -1'), ME), toMessage(msg(RINA, '@ITteam -2'), ME)];
  assert.strictEqual(slotsOf(askedLate, RINA.id, []), 1, 'with no opening -N and no tag, the first -N the poster wrote counts');
  const BOT = user('103', 'sous-rina');
  const botPost = [msg(BOT, 'Jira: QRD-1460, review please'), toRole(RINA, '-1 <@&r7>'), msg(HAMZAH, 'on it buat besok')];
  assert.strictEqual(slotsOf(botPost.map((message) => toMessage(message, ME, SERVER)), BOT.id, []), 1, 'a bot posted the thread and a person asked the role with -1');
  assert.strictEqual(sorted('pr', botPost, BOT.id, false, false, [], 1).state, 'NOT_YOURS', 'the one slot is taken');
  const row = buildRow({ id: 'fp', name: 'pull-request', kind: 'pr', thread: false, enabled: true }, 'g1', { id: '1298000000000000009', parent_id: 'fp', name: 'PR', owner_id: RINA.id }, new Map(), [msg({ ...RINA, avatar: 'a1' }, '-1 please'), msg(HAMZAH, 'on it')], ME);
  assert.deepStrictEqual([row.slots, row.createdByAvatar], [1, `https://cdn.discordapp.com/avatars/${RINA.id}/a1.png?size=64`], 'the avatar is the poster, not the last writer');
});

test('a pull request with a Pass for every reviewer it asked for stops needing the owner', () => {
  const pr = { needsYou: true, dismissed: false, kind: 'pr', state: 'REVIEW_ASKED', why: '', lastActivity: NOW.toISOString(), tickets: ['QRD-9'] } as unknown as ThreadView;
  const jira = new Map([['QRD-9', { status: 'PR Review', assignee: null, sprint: null, sprintActive: false, labels: ['alvinPass'] }]]);
  assert.deepStrictEqual(withJira([{ ...pr, slots: 1 }, { ...pr, slots: 2 }], jira, () => false, NOW).map((row) => row.needsYou), [false, true]);
});

test('a changed tag builds the row again even when the last message is the same', async () => {
  const routes = routesFor() as Record<string, DiscordResponse | DiscordResponse[]>;
  routes['/channels/fb'] = ok({ ...forum('bug-report'), available_tags: [{ id: 'tr', name: 'Resolved' }] });
  const { instance, service } = reader(routes);
  await instance.sync();
  assert.strictEqual((await service.list()).find((row) => row.id === '2001')?.state, 'FLOW_1');
  routes['/guilds/g1/threads/active'] = ok({ threads: [{ ...bugThread, applied_tags: ['tr'] }, prThread] });
  await instance.sync();
  assert.strictEqual((await service.list()).find((row) => row.id === '2001')?.state, 'FIXED');
});
