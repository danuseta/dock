import assert from 'node:assert';
import test from 'node:test';
import { discordTeam, ensureTeamChannels, parseDiscordTeam, workspaceDiscordSetting, type DiscordTeam } from '../integrations/discord-team';
import type { Channel } from '../integrations/discord-threads';

const GUILD = '1389235158414000200';
const FILE = JSON.stringify({ discord: { guild: GUILD, channels: [
  { id: '1525182530184286289', name: 'bugreport', kind: 'bug' },
  { id: '1527229030439321820', name: 'uat-bug-report', kind: 'uat' },
  { id: '1527228669725114459', name: 'pull-request', kind: 'pr' },
] } });

test('the team file gives the server and the forums; a bad entry is skipped and a bad file gives nothing', () => {
  const team = parseDiscordTeam(FILE);
  assert.strictEqual(team?.guild, GUILD);
  assert.deepStrictEqual(team?.channels.map((channel) => [channel.name, channel.kind]), [['bugreport', 'bug'], ['uat-bug-report', 'uat'], ['pull-request', 'pr']]);
  const mixed = parseDiscordTeam(JSON.stringify({ discord: { guild: GUILD, channels: [{ id: 'x', kind: 'bug' }, { id: '1525182530184286289', kind: 'chat' }, { id: '1525182530184286289', kind: 'follow' }] } }));
  assert.deepStrictEqual(mixed?.channels.map((channel) => channel.kind), ['follow']);
  assert.strictEqual(parseDiscordTeam('{'), null);
  assert.strictEqual(parseDiscordTeam(JSON.stringify({ discord: { guild: 'abc', channels: [] } })), null);
  assert.strictEqual(parseDiscordTeam(JSON.stringify({ other: true })), null);
});

test('the file is read from DOCK_TEAM_FILE once; a missing or unreadable file means no team defaults', () => {
  let reads = 0;
  const read = () => { reads += 1; return FILE; };
  assert.strictEqual(discordTeam({ DOCK_TEAM_FILE: '/kit/dock-team.json' }, read)?.guild, GUILD);
  discordTeam({ DOCK_TEAM_FILE: '/kit/dock-team.json' }, read);
  assert.strictEqual(reads, 1);
  assert.strictEqual(discordTeam({}, read), null);
  assert.strictEqual(discordTeam({ DOCK_TEAM_FILE: '/nope.json' }, () => { throw new Error('ENOENT'); }), null);
});

test('an empty setting falls back to the template token and the team server; other keys get nothing', () => {
  const team = parseDiscordTeam(FILE);
  assert.strictEqual(workspaceDiscordSetting('discordBotToken', { DOCK_DISCORD_BOT_TOKEN: ' bot-token ' }, team), 'bot-token');
  assert.strictEqual(workspaceDiscordSetting('discordBotToken', {}, team), null);
  assert.strictEqual(workspaceDiscordSetting('discordGuildId', {}, team), GUILD);
  assert.strictEqual(workspaceDiscordSetting('discordGuildId', {}, null), null);
  assert.strictEqual(workspaceDiscordSetting('discordUserId', { DOCK_DISCORD_BOT_TOKEN: 'x' }, team), null);
});

test('team forums are followed once: a missing one is added on, a known one is marked, a switched-off one stays off, the user\'s own are untouched', async () => {
  const rows = new Map<string, Channel>([
    ['1527229030439321820', { id: '1527229030439321820', name: 'uat-bug-report', kind: 'uat', thread: false, enabled: false, team: false }],
    ['999999999999999999', { id: '999999999999999999', name: 'mine', kind: 'follow', thread: true, enabled: true, team: false }],
  ]);
  const store = { list: async () => [...rows.values()], save: async (channel: Channel) => { rows.set(channel.id, channel); } };
  const team = parseDiscordTeam(FILE) as DiscordTeam;
  assert.strictEqual(await ensureTeamChannels(store, team), 3);
  assert.deepStrictEqual([...rows.values()].map((channel) => [channel.name, channel.enabled, channel.team]), [
    ['uat-bug-report', false, true], ['mine', true, false], ['bugreport', true, true], ['pull-request', true, true],
  ]);
  assert.strictEqual(await ensureTeamChannels(store, team), 0, 'nothing to do the second time');
  assert.strictEqual(await ensureTeamChannels(store, null), 0);
});

test('a team forum cannot be removed, the user\'s own can', async () => {
  const { isTeamChannel } = await import('../integrations/discord-team');
  const channels = [{ id: '1', team: true }, { id: '2', team: false }, { id: '3' }];
  assert.deepStrictEqual(['1', '2', '3', '4'].map((id) => isTeamChannel(channels, id)), [true, false, false, false]);
});
