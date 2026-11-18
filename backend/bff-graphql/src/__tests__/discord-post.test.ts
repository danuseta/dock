import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DiscordPoster, isImage, parseDiscordBlock, threadIdOf, webhookTarget, type DiscordPostHttp } from '../integrations/discord-post';

const HOOK = 'https://discord.com/api/webhooks/123/token-abc';

function recorder(id: string | null = 'msg1') {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const http: DiscordPostHttp = {
    post: async (url, body) => { calls.push({ method: 'post', url, body }); return { data: { id: id ?? undefined } }; },
    patch: async (url, body) => { calls.push({ method: 'patch', url, body }); return {}; },
    delete: async (url) => { calls.push({ method: 'delete', url }); return {}; },
  };
  return { calls, http };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = (text: string) => Buffer.concat([PNG, Buffer.from(text)]);

async function evidence() {
  const base = await mkdtemp(path.join(tmpdir(), 'dock-post-'));
  const root = path.join(base, 'kirim-QRD-1');
  await mkdir(root);
  await writeFile(path.join(root, 'a.png'), png('bytes of a'));
  await writeFile(path.join(root, 'b.jpg'), Buffer.concat([JPEG, Buffer.from('bytes of b')]));
  await writeFile(path.join(root, 'notes.txt'), 'text');
  await writeFile(path.join(root, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await writeFile(path.join(base, 'secret.png'), 'outside');
  return { base, root };
}

test('a post goes to the thread with wait=true, carries the owner name, pings nobody, shows no previews and returns the message id', async () => {
  const { calls, http } = recorder('99');
  const result = await new DiscordPoster(http).post(HOOK, 'hello', { threadId: '222', username: 'Danu (DOCK)' });
  assert.deepEqual(result, { id: '99', skipped: [] });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, HOOK);
  assert.equal(url.searchParams.get('wait'), 'true');
  assert.equal(url.searchParams.get('thread_id'), '222');
  assert.deepEqual(calls[0].body, { content: 'hello', allowed_mentions: { parse: [] }, flags: 4, username: 'Danu (DOCK)' });
});

test('images from the evidence folder go as multipart attachments in the order given, named as in the message', async () => {
  const { base, root } = await evidence();
  try {
    const { calls, http } = recorder();
    const result = await new DiscordPoster(http).post(HOOK, 'see (gambar a.png)', { threadId: '222', files: { root, names: ['a.png', 'b.jpg'] } });
    assert.deepEqual(result.skipped, []);
    const form = calls[0].body as FormData;
    assert.ok(form instanceof FormData);
    const payload = JSON.parse(String(form.get('payload_json')));
    assert.deepEqual(payload.attachments, [{ id: 0, filename: 'a.png' }, { id: 1, filename: 'b.jpg' }]);
    assert.equal(payload.flags, 4);
    const first = form.get('files[0]') as File;
    assert.equal(first.name, 'a.png');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), png('bytes of a'));
    assert.equal((form.get('files[1]') as File).name, 'b.jpg');
    assert.equal(new URL(calls[0].url).searchParams.get('thread_id'), '222');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a name that leaves the folder, an absolute path, a missing or too big file, or another extension is skipped and named back', async () => {
  const { base, root } = await evidence();
  try {
    const { calls, http } = recorder();
    const names = ['../secret.png', '..\\secret.png', path.join(base, 'secret.png'), 'C:/Windows/win.png', 'big.png', 'notes.txt', 'missing.png', 'a.png'];
    const result = await new DiscordPoster(http).post(HOOK, 'x', { threadId: '1', files: { root, names } });
    assert.deepEqual(result.skipped, names.slice(0, -1));
    assert.deepEqual(JSON.parse(String((calls[0].body as FormData).get('payload_json'))).attachments, [{ id: 0, filename: 'a.png' }]);

    const none = await new DiscordPoster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root: path.join(base, 'nope'), names: ['a.png'] } });
    assert.deepEqual(none.skipped, ['a.png'], 'a folder that does not exist sends nothing');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a link inside the folder that points outside it is skipped', async (t) => {
  const { base, root } = await evidence();
  try {
    try {
      await symlink(path.join(base, 'secret.png'), path.join(root, 'link.png'));
    } catch {
      t.skip('this machine cannot make symbolic links');
      return;
    }
    const result = await new DiscordPoster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, names: ['link.png'] } });
    assert.deepEqual(result.skipped, ['link.png']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('at most ten images go with one message; the rest are named back', async () => {
  const { base, root } = await evidence();
  try {
    const names = Array.from({ length: 12 }, (_, index) => `${index}.png`);
    for (const name of names) await writeFile(path.join(root, name), png('x'));
    const { calls, http } = recorder();
    const result = await new DiscordPoster(http).post(HOOK, 'many', { threadId: '1', files: { root, names } });
    assert.equal(JSON.parse(String((calls[0].body as FormData).get('payload_json'))).attachments.length, 10);
    assert.deepEqual(result.skipped, ['10.png', '11.png']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a post Discord answers without a message id fails', async () => {
  const { http } = recorder(null);
  await assert.rejects(new DiscordPoster(http).post(HOOK, 'x', { threadId: '1' }), /did not return/);
});

test('edit and delete go to the message through the same webhook, in the thread', async () => {
  const { calls, http } = recorder();
  const poster = new DiscordPoster(http);
  await poster.edit(HOOK, '555', 'changed', '222');
  await poster.remove(HOOK, '555', '222');
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ['patch', `${HOOK}/messages/555?thread_id=222`],
    ['delete', `${HOOK}/messages/555?thread_id=222`],
  ]);
  assert.deepEqual(calls[0].body, { content: 'changed', allowed_mentions: { parse: [] }, flags: 4 });
});

test('the thread id comes from a Discord channel link', () => {
  assert.equal(threadIdOf('https://discord.com/channels/111/222'), '222');
  assert.equal(threadIdOf('https://example.com/x'), null);
  assert.equal(webhookTarget(`${HOOK}?x=1`, '7', undefined, true), `${HOOK}?x=1&wait=true&thread_id=7`);
});

test('a post can ping only the users it lists, and only real user ids', async () => {
  const { calls, http } = recorder();
  await new DiscordPoster(http).post(HOOK, '<@71111> <@99999> fixed', { threadId: '1', users: ['71111', '71111', 'everyone', '12'] });
  assert.deepEqual((calls[0].body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: ['71111'] });
  await new DiscordPoster(http).post(HOOK, 'x', { threadId: '1', users: [] });
  assert.deepEqual((calls[1].body as { allowed_mentions: unknown }).allowed_mentions, { parse: [] });
});

test('the last DISCORD block of a reply is the body, its GAMBAR lines the images; none or an empty one is null', () => {
  const reply = 'draft\n<<<DISCORD\nold\n<<<AKHIR DISCORD>>>\nmore\n<<<DISCORD\nmas danu, fixed (gambar a.png)\nGAMBAR: a.png\n  gambar:  b-dark.png \nGAMBAR: a.png\n<<<AKHIR DISCORD>>>\nDOCK-REVIEW-ROUND r1 valid=1 invalid=0 pushed=yes';
  assert.deepEqual(parseDiscordBlock(reply), { body: 'mas danu, fixed (gambar a.png)', images: ['a.png', 'b-dark.png'] });
  assert.deepEqual(parseDiscordBlock('<<<DISCORD>>> one line <<<AKHIR DISCORD>>>'), { body: 'one line', images: [] });
  assert.equal(parseDiscordBlock('<<<DISCORD\nGAMBAR: a.png\n<<<AKHIR DISCORD>>>'), null);
  assert.equal(parseDiscordBlock('no block <<<AKHIR DISCORD>>>'), null);
  assert.equal(parseDiscordBlock(null), null);
  const many = `<<<DISCORD\nx\n${Array.from({ length: 12 }, (_, index) => `GAMBAR: ${index}.png`).join('\n')}\n<<<AKHIR DISCORD>>>`;
  assert.equal(parseDiscordBlock(many)?.images.length, 10);
});

test('a file whose bytes are no image, or that is hard-linked to a file elsewhere, is skipped', async (t) => {
  const { base, root } = await evidence();
  try {
    await writeFile(path.join(root, 'fake.png'), 'not an image at all');
    await writeFile(path.join(root, 'shot.gif'), Buffer.from('GIF89a....'));
    await writeFile(path.join(root, 'shot.webp'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]));
    const result = await new DiscordPoster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, names: ['fake.png', 'shot.gif', 'shot.webp'] } });
    assert.deepEqual(result.skipped, ['fake.png']);
    assert.ok(isImage(png('x')) && isImage(Buffer.from([0xff, 0xd8, 0xff, 0xdb])) && !isImage(Buffer.from('%PDF-1.7')));
    try {
      await writeFile(path.join(base, 'elsewhere.png'), png('outside'));
      await link(path.join(base, 'elsewhere.png'), path.join(root, 'hard.png'));
    } catch {
      t.skip('this machine cannot make hard links');
      return;
    }
    const linked = await new DiscordPoster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, names: ['hard.png'] } });
    assert.deepEqual(linked.skipped, ['hard.png']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
