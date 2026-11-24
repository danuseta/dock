import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { sendBroadcast, type BroadcastDeps } from '../integrations/broadcast';
import { DiscordService } from '../integrations/discord';
import { DEFAULT_PR_TAG_TEMPLATE, RoleLookup, normalizePrTagTemplate, sendPrFollowUps, slotsFor, type AllowedMentions, type PrFollowUpDeps } from '../integrations/pr-followup';
import type { PushMessage } from '../integrations/push';

function world(overrides: Partial<PrFollowUpDeps> = {}) {
  const sent: Array<{ content: string; allowedMentions: AllowedMentions }> = [];
  const pushes: PushMessage[] = [];
  const deps: PrFollowUpDeps = {
    roleId: async (name) => (name === 'ITteam' ? '555' : null),
    post: async (content, allowedMentions) => { sent.push({ content, allowedMentions }); },
    push: async (message) => { pushes.push(message); },
    ...overrides,
  };
  return { deps, sent, pushes };
}

const bug = (key: string) => ({ key, issueType: 'Bug' });
const task = (key: string) => ({ key, issueType: 'Task' });

test('the default tag pings the role and asks one reviewer when every ticket is a Bug', async () => {
  const { deps, sent, pushes } = world();
  await sendPrFollowUps(deps, { settings: {}, tickets: [bug('QRD-1565'), bug('QRD-1713')] });
  assert.deepStrictEqual(sent, [{ content: '<@&555> -1 mas mas, thanks', allowedMentions: { parse: [], roles: ['555'] } }]);
  assert.deepStrictEqual(pushes, []);
  assert.strictEqual(DEFAULT_PR_TAG_TEMPLATE, '@{{role}} {{slots}} mas mas, thanks');
});

test('one ticket that is not a Bug asks for two reviewers', async () => {
  const { deps, sent } = world();
  await sendPrFollowUps(deps, { settings: {}, tickets: [bug('QRD-1565'), task('QRD-1579')] });
  assert.strictEqual(sent[0].content, '<@&555> -2 mas mas, thanks');
  assert.deepStrictEqual([slotsFor(['bug']), slotsFor(['Story']), slotsFor(['Bug', 'Sub-task']), slotsFor(['Bug', null])], ['-1', '-2', '-2', null]);
});

test('without an issue type from Jira the tag asks for two and the owner is told', async () => {
  const { deps, sent, pushes } = world();
  await sendPrFollowUps(deps, { settings: {}, tickets: [{ key: 'QRD-1565', issueType: null }] });
  assert.strictEqual(sent[0].content, '<@&555> -2 mas mas, thanks');
  assert.strictEqual(pushes.length, 1);
  assert.match(pushes[0].body, /QRD-1565/);
});

test('a role the bot cannot find goes out as plain text with no ping, and the owner is told', async () => {
  const { deps, sent, pushes } = world({ roleId: async () => null });
  await sendPrFollowUps(deps, { settings: { prTagRole: 'Reviewers' }, tickets: [task('QRD-1579')] });
  assert.deepStrictEqual(sent, [{ content: '@Reviewers -2 mas mas, thanks', allowedMentions: { parse: [] } }]);
  assert.strictEqual(pushes.length, 1);
  assert.match(pushes[0].title, /Reviewers was not pinged/);
  const failing = world({ roleId: async () => { throw new Error('Discord down'); } });
  await sendPrFollowUps(failing.deps, { settings: {}, tickets: [task('QRD-1579')] });
  assert.deepStrictEqual(failing.sent[0].allowedMentions, { parse: [] }, 'a lookup that fails is a role not found');
  assert.strictEqual(failing.pushes.length, 1);
});

test('a saved template and role are used', async () => {
  const { deps, sent } = world({ roleId: async (name) => (name === 'QA' ? '77' : null) });
  await sendPrFollowUps(deps, { settings: { prTagTemplate: 'tolong {{slots}} ya @{{role}}', prTagRole: '@QA' }, tickets: [bug('QRD-1')] });
  assert.deepStrictEqual(sent, [{ content: 'tolong -1 ya <@&77>', allowedMentions: { parse: [], roles: ['77'] } }]);
  assert.throws(() => normalizePrTagTemplate('{{ticketKey}}'), /Unsupported reviewer tag field/);
});

test('with the tag turned off no tag is sent', async () => {
  const { deps, sent, pushes } = world();
  await sendPrFollowUps(deps, { settings: { prTagEnabled: 'false' }, tickets: [task('QRD-1579')] });
  assert.deepStrictEqual(sent, []);
  assert.deepStrictEqual(pushes, []);
});

test('empty notes send no Notes message; notes go before the tag', async () => {
  const empty = world();
  await sendPrFollowUps(empty.deps, { settings: {}, tickets: [task('QRD-1579')], notes: '  \n ' });
  assert.deepStrictEqual(empty.sent.map((message) => message.content), ['<@&555> -2 mas mas, thanks']);
  const { deps, sent } = world();
  await sendPrFollowUps(deps, { settings: {}, tickets: [task('QRD-1579')], notes: 'Migration needs a seed first' });
  assert.deepStrictEqual(sent, [
    { content: 'Notes :\nMigration needs a seed first', allowedMentions: { parse: [] } },
    { content: '<@&555> -2 mas mas, thanks', allowedMentions: { parse: [], roles: ['555'] } },
  ]);
  const long = world();
  await sendPrFollowUps(long.deps, { settings: {}, tickets: [task('QRD-1579')], notes: 'x'.repeat(3000) });
  assert.strictEqual(long.sent[0].content.length, 2000, 'a message stays within the Discord limit');
});

test('a follow-up that fails tells the owner and never throws', async () => {
  const { deps, pushes } = world({ post: async () => { throw new Error('thread gone'); } });
  await sendPrFollowUps(deps, { settings: {}, tickets: [task('QRD-1579')] });
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].title, 'Tag ITteam failed, type it by hand');
});

function broadcastDeps(overrides: Partial<BroadcastDeps> = {}) {
  const moves: string[] = [];
  const deps: BroadcastDeps = {
    relation: async () => ({ ticketKeys: ['QRD-1579'], primaryKey: 'QRD-1579' }),
    ticket: async (key) => ({ key, title: `T ${key}`, url: `https://jira/${key}`, status: 'In Progress', issueType: 'Task' }),
    pullRequests: async () => [{ url: 'https://github.com/o/be/pull/1' }],
    demoLink: async () => null,
    settings: async () => ({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/x' }),
    send: async () => ({ threadId: 'thread-9' }),
    move: async (key) => { moves.push(key); return true; },
    ...overrides,
  };
  return { deps, moves };
}

test('the broadcast hands the thread, the tickets and the notes to the follow-up after the post', async () => {
  const posts: any[] = [];
  const { deps } = broadcastDeps({ followUp: async (post) => { posts.push(post); } });
  assert.strictEqual(await sendBroadcast(deps, { ticketKey: 'QRD-1579', notes: 'see the seed' }), true);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].threadId, 'thread-9');
  assert.strictEqual(posts[0].notes, 'see the seed');
  assert.deepStrictEqual(posts[0].tickets.map((ticket: { issueType: string }) => ticket.issueType), ['Task']);
});

test('a failing follow-up does not fail or undo the broadcast', async () => {
  const { deps, moves } = broadcastDeps({ followUp: async () => { throw new Error('boom'); } });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.strictEqual(await sendBroadcast(deps, { ticketKey: 'QRD-1579' }), true);
  } finally {
    console.error = originalError;
  }
  assert.deepStrictEqual(moves, ['QRD-1579'], 'the ticket still moves to PR Review');
  const notSent: unknown[] = [];
  const failed = broadcastDeps({ send: async () => false, followUp: async (post) => { notSent.push(post); } });
  assert.strictEqual(await sendBroadcast(failed.deps, { ticketKey: 'QRD-1579' }), false);
  assert.deepStrictEqual(notSent, [], 'no follow-up without a post');
});

test('the role lookup reads the server roles once and keeps them for a while', async () => {
  let now = 0;
  const paths: string[] = [];
  const lookup = new RoleLookup({
    config: async () => ({ token: 'bot', guild: 'g1' }),
    request: async (path, token) => { paths.push(`${token} ${path}`); return { status: 200, body: [{ id: '555', name: 'ITteam' }, { id: '6', name: 'QA' }] }; },
    now: () => now,
  }, 1000);
  assert.strictEqual(await lookup.id('ITteam'), '555');
  assert.strictEqual(await lookup.id('itteam'), '555', 'any case');
  assert.strictEqual(await lookup.id('Nobody'), null);
  assert.deepStrictEqual(paths, ['bot /guilds/g1/roles']);
  now = 2000;
  await lookup.id('QA');
  assert.strictEqual(paths.length, 2, 'read again once the cache is old');
  const unset = new RoleLookup({ config: async () => null, request: async () => { throw new Error('not called'); }, now: () => 0 });
  assert.strictEqual(await unset.id('ITteam'), null, 'no bot set up');
  const refused = new RoleLookup({ config: async () => ({ token: 'bot', guild: 'g1' }), request: async () => ({ status: 403, body: null }), now: () => 0 });
  assert.strictEqual(await refused.id('ITteam'), null);
});

test('the webhook post waits for the message and returns the thread it opened; a follow-up goes to that thread', async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url || '', body: JSON.parse(body) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'm1', channel_id: 'thread-42' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const hook = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
    const service = new DiscordService();
    const ticket = { key: 'QRD-1579', title: 'Custom tool', url: 'https://jira/QRD-1579' };
    assert.strictEqual(await service.sendSummary({ ticket, prs: [] }, hook, { threadName: 'PR' }), 'thread-42');
    assert.strictEqual(await service.sendSummary({ ticket, prs: [] }, hook, { threadId: 'thread-7' }), 'thread-42');
    assert.strictEqual(await service.sendSummary({ ticket, prs: [] }, hook), undefined, 'a post to a plain channel opened no thread');
    await service.sendToThread(hook, 'thread-42', '<@&555> -2 mas mas, thanks', { parse: [], roles: ['555'] });
    assert.deepStrictEqual(requests.map((request) => request.url), ['/webhook?wait=true', '/webhook?wait=true&thread_id=thread-7', '/webhook?wait=true', '/webhook?wait=true&thread_id=thread-42']);
    assert.deepStrictEqual(requests[3].body, { content: '<@&555> -2 mas mas, thanks', allowed_mentions: { parse: [], roles: ['555'] } });
    await assert.rejects(service.sendToThread(hook, 'thread-42', 'x'.repeat(2001), { parse: [] }), /2000/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
