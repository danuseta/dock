import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DiscordPoster, isImage, parseDiscordBlock, readImageList, replaceImageNames, threadIdOf, webhookTarget, type DiscordPostHttp } from '../integrations/discord-post';
import { drawtextValue, fitCaption, imageWidth, labelLayout, stampArgs, type ImageStamper, type PostImage } from '../integrations/image-label';

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
const imgs = (...files: string[]): PostImage[] => files.map((file, index) => ({ n: index + 1, file, caption: '' }));
const copyStamp: ImageStamper = async (_source, output, image) => writeFile(output, png(`stamped ${image.n}`));
const poster = (http: DiscordPostHttp, stamp: ImageStamper = copyStamp) => new DiscordPoster(http, stamp);

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
  const result = await poster(http).post(HOOK, 'hello', { threadId: '222', username: 'Danu (DOCK)' });
  assert.deepEqual(result, { id: '99', skipped: [], unlabelled: [] });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, HOOK);
  assert.equal(url.searchParams.get('wait'), 'true');
  assert.equal(url.searchParams.get('thread_id'), '222');
  assert.deepEqual(calls[0].body, { content: 'hello', allowed_mentions: { parse: [] }, flags: 4, username: 'Danu (DOCK)' });
});

test('images go as labelled copies named gambar-N in number order, and the originals and temp copies are left as they were', async () => {
  const { base, root } = await evidence();
  try {
    const { calls, http } = recorder();
    const stamped: Array<{ source: string; output: string; image: PostImage }> = [];
    const stamp: ImageStamper = async (source, output, image) => {
      stamped.push({ source, output, image });
      await writeFile(output, png(`stamped ${image.n}`));
    };
    const images = [{ n: 2, file: 'b.jpg', caption: 'second' }, { n: 1, file: 'a.png', caption: 'first' }];
    const result = await poster(http, stamp).post(HOOK, 'see gambar 1', { threadId: '222', files: { root, images } });
    assert.deepEqual([result.skipped, result.unlabelled], [[], []]);
    assert.deepEqual(stamped.map((call) => [path.basename(call.source), path.basename(call.output), call.image.caption]), [['a.png', 'gambar-1.png', 'first'], ['b.jpg', 'gambar-2.jpg', 'second']]);
    const form = calls[0].body as FormData;
    assert.ok(form instanceof FormData);
    const payload = JSON.parse(String(form.get('payload_json')));
    assert.deepEqual(payload.attachments, [{ id: 0, filename: 'gambar-1.png' }, { id: 1, filename: 'gambar-2.jpg' }]);
    assert.equal(payload.flags, 4);
    const first = form.get('files[0]') as File;
    assert.equal(first.name, 'gambar-1.png');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), png('stamped 1'));
    assert.equal((form.get('files[1]') as File).name, 'gambar-2.jpg');
    assert.equal(new URL(calls[0].url).searchParams.get('thread_id'), '222');
    assert.deepEqual(await readFile(path.join(root, 'a.png')), png('bytes of a'), 'the original is never changed');
    await assert.rejects(stat(path.dirname(stamped[0].output)), 'the temp copies are removed after the post');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('an image the stamper cannot label goes up unlabelled under its gambar-N name and is named back', async () => {
  const { base, root } = await evidence();
  try {
    const { calls, http } = recorder();
    const stamp: ImageStamper = async (_source, output, image) => {
      if (image.n === 1) throw new Error('spawn ffmpeg ENOENT');
      await writeFile(output, png('stamped'));
    };
    const result = await poster(http, stamp).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs('a.png', 'b.jpg') } });
    assert.deepEqual(result.unlabelled, ['a.png']);
    const form = calls[0].body as FormData;
    const first = form.get('files[0]') as File;
    assert.equal(first.name, 'gambar-1.png');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), png('bytes of a'));
    assert.deepEqual(Buffer.from(await (form.get('files[1]') as File).arrayBuffer()), png('stamped'));
    const empty = await poster(recorder().http, async () => undefined).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs('a.png') } });
    assert.deepEqual(empty.unlabelled, ['a.png'], 'a stamper that writes nothing counts as a failure');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a name that leaves the folder, an absolute path, a missing or too big file, or another extension is skipped and named back', async () => {
  const { base, root } = await evidence();
  try {
    const { calls, http } = recorder();
    const names = ['../secret.png', '..\\secret.png', path.join(base, 'secret.png'), 'C:/Windows/win.png', 'big.png', 'notes.txt', 'missing.png', 'a.png'];
    const result = await poster(http).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs(...names) } });
    assert.deepEqual(result.skipped, names.slice(0, -1));
    assert.deepEqual(JSON.parse(String((calls[0].body as FormData).get('payload_json'))).attachments, [{ id: 0, filename: 'gambar-8.png' }]);

    const none = await poster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root: path.join(base, 'nope'), images: imgs('a.png') } });
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
    const result = await poster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs('link.png') } });
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
    const result = await poster(http).post(HOOK, 'many', { threadId: '1', files: { root, images: imgs(...names) } });
    assert.equal(JSON.parse(String((calls[0].body as FormData).get('payload_json'))).attachments.length, 10);
    assert.deepEqual(result.skipped, ['10.png', '11.png']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a post Discord answers without a message id fails', async () => {
  const { http } = recorder(null);
  await assert.rejects(poster(http).post(HOOK, 'x', { threadId: '1' }), /did not return/);
});

test('edit and delete go to the message through the same webhook, in the thread', async () => {
  const { calls, http } = recorder();
  const client = poster(http);
  await client.edit(HOOK, '555', 'changed', '222');
  await client.remove(HOOK, '555', '222');
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
  await poster(http).post(HOOK, '<@71111> <@99999> fixed', { threadId: '1', users: ['71111', '71111', 'everyone', '12'] });
  assert.deepEqual((calls[0].body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: ['71111'] });
  await poster(http).post(HOOK, 'x', { threadId: '1', users: [] });
  assert.deepEqual((calls[1].body as { allowed_mentions: unknown }).allowed_mentions, { parse: [] });
});

test('the last DISCORD block of a reply is the body, its GAMBAR lines the images; none or an empty one is null', () => {
  const reply = 'draft\n<<<DISCORD\nold\n<<<AKHIR DISCORD>>>\nmore\n<<<DISCORD\nmas danu, fixed (gambar a.png)\nGAMBAR: a.png\n  gambar:  b-dark.png \nGAMBAR: a.png\n<<<AKHIR DISCORD>>>\nDOCK-REVIEW-ROUND r1 valid=1 invalid=0 pushed=yes';
  assert.deepEqual(parseDiscordBlock(reply), { body: 'mas danu, fixed (gambar 1)', images: [{ n: 1, file: 'a.png', caption: '' }, { n: 2, file: 'b-dark.png', caption: '' }] });
  assert.deepEqual(parseDiscordBlock('<<<DISCORD>>> one line <<<AKHIR DISCORD>>>'), { body: 'one line', images: [] });
  assert.equal(parseDiscordBlock('<<<DISCORD\nGAMBAR: a.png\n<<<AKHIR DISCORD>>>'), null);
  assert.equal(parseDiscordBlock('no block <<<AKHIR DISCORD>>>'), null);
  assert.equal(parseDiscordBlock(null), null);
  const many = `<<<DISCORD\nx\n${Array.from({ length: 12 }, (_, index) => `GAMBAR: ${index}.png`).join('\n')}\n<<<AKHIR DISCORD>>>`;
  assert.equal(parseDiscordBlock(many)?.images.length, 10);
});

test('GAMBAR N lines with a caption, numbered without a caption, and old lines mixed are read into numbered images', () => {
  const reply = [
    '<<<DISCORD',
    'mas indra, ada blocker 2. 1) blocker, fe: gambar 1 buat new agent tool, gambar 2 buat ?file= (gambar 10-tool-noparent-agent.png, 11-file-noparent).',
    '2) blocker, fe: edit meta template (15-probe-meta_edit.png) belum ada crumb lab.',
    'GAMBAR 2: 11-file-noparent.png | ?file= gak kebuka',
    'GAMBAR 1: 10-tool-noparent-agent.png | New › Agent tool dari Lab root',
    'GAMBAR 4: 15-probe-meta_edit.png',
    'GAMBAR: 16-probe-auto.png',
    'gambar 1: ini bukan baris gambar karena tanpa nama file',
    '<<<AKHIR DISCORD>>>',
  ].join('\n');
  const block = parseDiscordBlock(reply);
  assert.deepEqual(block?.images, [
    { n: 1, file: '10-tool-noparent-agent.png', caption: 'New › Agent tool dari Lab root' },
    { n: 2, file: '11-file-noparent.png', caption: '?file= gak kebuka' },
    { n: 3, file: '16-probe-auto.png', caption: '' },
    { n: 4, file: '15-probe-meta_edit.png', caption: '' },
  ]);
  assert.equal(block?.body, [
    'mas indra, ada blocker 2. 1) blocker, fe: gambar 1 buat new agent tool, gambar 2 buat ?file= (gambar 1, gambar 2).',
    '2) blocker, fe: edit meta template (gambar 4) belum ada crumb lab.',
    'gambar 1: ini bukan baris gambar karena tanpa nama file',
  ].join('\n'));
  const twice = parseDiscordBlock('<<<DISCORD\nx\nGAMBAR 1: a.png | one\nGAMBAR 1: b.png | two\nGAMBAR 3: a.png\n<<<AKHIR DISCORD>>>');
  assert.deepEqual(twice?.images, [{ n: 1, file: 'a.png', caption: 'one' }, { n: 2, file: 'b.png', caption: 'two' }], 'a taken number moves on and a file counts once');
  const many = `<<<DISCORD\nx\n${Array.from({ length: 12 }, (_, index) => `GAMBAR ${index + 1}: ${index}.png | c${index}`).join('\n')}\n<<<AKHIR DISCORD>>>`;
  assert.deepEqual(parseDiscordBlock(many)?.images.map((image) => image.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a file name left in the text reads gambar N; a plain word that only looks like a short stem is left alone', () => {
  const images = [{ n: 1, file: '01-lab-root.png', caption: '' }, { n: 2, file: 'a.png', caption: '' }];
  assert.equal(replaceImageNames('lihat 01-lab-root.png, Gambar 01-lab-root dan a.png. ini a test, x01-lab-root.png tetap', images), 'lihat gambar 1, gambar 1 dan gambar 2. ini a test, x01-lab-root.png tetap');
});

test('saved images are read in the new shape and the older list of file names', () => {
  assert.deepEqual(readImageList(JSON.stringify([{ n: 2, file: 'b.png', caption: 'two' }, { n: 1, file: 'a.png', caption: 'one' }])), [{ n: 1, file: 'a.png', caption: 'one' }, { n: 2, file: 'b.png', caption: 'two' }]);
  assert.deepEqual(readImageList(JSON.stringify(['a.png', 'b.png'])), [{ n: 1, file: 'a.png', caption: '' }, { n: 2, file: 'b.png', caption: '' }]);
  assert.deepEqual(readImageList(JSON.stringify([{ n: 1, file: 'a.png' }, { n: 1, file: 'b.png' }, { n: 0, file: 'c.png' }, 7])), [{ n: 1, file: 'a.png', caption: '' }]);
  assert.deepEqual(readImageList('not json'), []);
  assert.deepEqual(readImageList(null), []);
});

test('the ffmpeg arguments pad a yellow strip above the image and draw GAMBAR N and the caption in it, escaped and sized by width', () => {
  const args = stampArgs({ source: '/in/a.png', output: '/tmp/gambar-1.png', font: 'C:/Windows/Fonts/arialbd.ttf', width: 1440, image: { n: 1, file: 'a.png', caption: "it's 50%: a\\b [x], y;" } });
  assert.deepEqual(args.slice(0, 6), ['-hide_banner', '-loglevel', 'error', '-y', '-i', '/in/a.png']);
  assert.deepEqual(args.slice(-3), ['-frames:v', '1', '/tmp/gambar-1.png']);
  const filter = args[args.indexOf('-vf') + 1];
  const [pad, title, caption] = filter.split(/(?<!\\),/);
  assert.equal(pad, 'pad=iw:ih+84:0:84:color=0xF5B041');
  assert.match(title, /^drawtext=fontfile=C\\\\:\/Windows\/Fonts\/arialbd\.ttf:expansion=none:text=GAMBAR 1:fontsize=40:fontcolor=0x1A1306:x=24:y=56-ascent$/);
  assert.match(caption, /:fontsize=26:/);
  assert.ok(caption.includes(`text=${drawtextValue("it's 50%: a\\b [x], y;")}:`));
  assert.equal(drawtextValue("a:b'c%d\\e[f],g;"), "a\\\\:b\\\\\\'c\\\\%d\\\\\\\\e\\[f\\]\\,g\\;");
  assert.deepEqual([labelLayout(720, 1).strip, labelLayout(720, 1).title, labelLayout(2880, 1).strip, labelLayout(2880, 1).caption], [42, 20, 168, 52]);
  assert.ok(stampArgs({ source: 'a.jpg', output: 'gambar-2.jpg', font: 'f.ttf', width: 1440, image: { n: 2, file: 'a.jpg', caption: '' } }).includes('-q:v'));
  assert.equal(stampArgs({ source: 'a.png', output: 'g.png', font: 'f.ttf', width: 1440, image: { n: 2, file: 'a.png', caption: '' } })[7].split(',').length, 2, 'no caption, no second text');
});

test('a long caption is cut to fit the width, and the width comes from the image header', () => {
  const layout = labelLayout(1440, 1);
  const long = 'x'.repeat(500);
  const cut = fitCaption(long, layout.maxChars);
  assert.equal(cut.length, layout.maxChars);
  assert.ok(cut.endsWith('…'));
  assert.equal(fitCaption('  short   caption ', 40), 'short caption');
  const header = Buffer.alloc(24);
  PNG.copy(header);
  header.writeUInt32BE(1440, 16);
  assert.equal(imageWidth(header), 1440);
  assert.equal(imageWidth(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x20, 0x00, 0x00])), 800);
  assert.equal(imageWidth(Buffer.from('nothing')), null);
});

test('a file whose bytes are no image, or that is hard-linked to a file elsewhere, is skipped', async (t) => {
  const { base, root } = await evidence();
  try {
    await writeFile(path.join(root, 'fake.png'), 'not an image at all');
    await writeFile(path.join(root, 'shot.gif'), Buffer.from('GIF89a....'));
    await writeFile(path.join(root, 'shot.webp'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]));
    const result = await poster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs('fake.png', 'shot.gif', 'shot.webp') } });
    assert.deepEqual(result.skipped, ['fake.png']);
    assert.ok(isImage(png('x')) && isImage(Buffer.from([0xff, 0xd8, 0xff, 0xdb])) && !isImage(Buffer.from('%PDF-1.7')));
    try {
      await writeFile(path.join(base, 'elsewhere.png'), png('outside'));
      await link(path.join(base, 'elsewhere.png'), path.join(root, 'hard.png'));
    } catch {
      t.skip('this machine cannot make hard links');
      return;
    }
    const linked = await poster(recorder().http).post(HOOK, 'x', { threadId: '1', files: { root, images: imgs('hard.png') } });
    assert.deepEqual(linked.skipped, ['hard.png']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
