import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { attachmentUrl, createDiscordFilesRouter, servedType } from '../routes/discord-files';

const LINK = 'https://cdn.discordapp.com/attachments/1/2/bukti%20uat.pdf?ex=1&is=2&hm=3';

test('only an https Discord attachment link is fetched; text is always served as plain text', () => {
  assert.strictEqual(attachmentUrl(LINK)?.hostname, 'cdn.discordapp.com');
  assert.ok(attachmentUrl('https://media.discordapp.net/attachments/1/2/a.png'));
  for (const url of ['http://cdn.discordapp.com/attachments/1/2/a.pdf', 'https://cdn.discordapp.com/avatars/1/a.png', 'https://evil.example/attachments/1/2/a.pdf', 'https://cdn.discordapp.com.evil.example/attachments/1', 'file:///etc/passwd', 'nope', 42]) {
    assert.strictEqual(attachmentUrl(url), null, String(url));
  }
  assert.strictEqual(servedType('text/plain; charset=utf-8'), 'text/plain; charset=utf-8');
  assert.strictEqual(servedType('text/html'), 'text/plain; charset=utf-8', 'HTML is shown as text, never rendered');
  assert.strictEqual(servedType('application/json'), 'text/plain; charset=utf-8');
  assert.strictEqual(servedType('application/pdf'), 'application/pdf');
  assert.strictEqual(servedType('image/png'), 'image/png');
  for (const type of ['application/zip', 'image/svg+xml', 'application/x-msdownload', null]) assert.strictEqual(servedType(type), null, String(type));
});

test('the router streams the file with its name, refuses other links, other types and a locked DOCK', async () => {
  let unlocked = true;
  const fetched: string[] = [];
  const files: Record<string, { type: string; body: string }> = {
    'bukti%20uat.pdf': { type: 'application/pdf', body: '%PDF-1.4' },
    'log.txt': { type: 'text/plain; charset=utf-8', body: '<script>alert(1)</script>' },
    'app.zip': { type: 'application/zip', body: 'PK' },
  };
  const app = express();
  app.use('/api/discord', createDiscordFilesRouter({
    authorize: async () => unlocked,
    fetchFile: async (url) => {
      fetched.push(url);
      const file = files[new URL(url).pathname.split('/').pop() ?? ''];
      return file ? new Response(file.body, { headers: { 'content-type': file.type, 'content-length': String(file.body.length) } }) : new Response('gone', { status: 404 });
    },
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discord/file`;
  const open = (url: string, extra = '') => fetch(`${base}?url=${encodeURIComponent(url)}${extra}`);
  try {
    const pdf = await open(LINK);
    assert.strictEqual(pdf.status, 200);
    assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(pdf.headers.get('x-content-type-options'), 'nosniff');
    assert.match(pdf.headers.get('content-disposition') || '', /^inline; filename\*=UTF-8''bukti%20uat\.pdf$/);
    assert.strictEqual(await pdf.text(), '%PDF-1.4');
    assert.match((await open(LINK, '&download=1&name=Bukti.pdf')).headers.get('content-disposition') || '', /^attachment; filename\*=UTF-8''Bukti\.pdf$/);
    const log = await open('https://cdn.discordapp.com/attachments/1/2/log.txt');
    assert.strictEqual(log.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.strictEqual(await log.text(), '<script>alert(1)</script>');
    assert.strictEqual((await open('https://cdn.discordapp.com/attachments/1/2/app.zip')).status, 415);
    assert.strictEqual((await open('https://cdn.discordapp.com/attachments/1/2/missing.pdf')).status, 404);
    const before = fetched.length;
    assert.strictEqual((await open('https://evil.example/attachments/1/2/a.pdf')).status, 400);
    assert.strictEqual(fetched.length, before, 'a link outside Discord is never fetched');
    assert.strictEqual((await fetch(base, { method: 'POST' })).status, 405);
    unlocked = false;
    assert.strictEqual((await open(LINK)).status, 401);
  } finally {
    server.close();
  }
});
