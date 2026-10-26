import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { Blackboard, cleanRelative, fileKind } from '../integrations/blackboard';
import { createBlackboardRouter } from '../routes/blackboard';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'blackboard-'));
  const put = (relative: string, body: string | Buffer, at?: Date) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    if (at) utimesSync(file, at, at);
  };
  put('QRD-1230/NOW.md', '# NOW - QRD-1230', new Date('2026-10-26T07:26:00Z'));
  put('QRD-1230/review.md', '## Verdict\napprove', new Date('2026-10-26T07:20:00Z'));
  put('QRD-1230/screenshots/r2-ac3-tooltip-dark.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), new Date('2026-10-26T06:49:00Z'));
  put('QRD-1230/.hidden.md', 'not listed');
  put('QRD-1230/notes.exe', 'MZ', new Date('2026-10-26T06:00:00Z'));
  put('QRD-1347/NOW.md', '# NOW - QRD-1347', new Date('2026-10-26T07:31:00Z'));
  put('QRD-106/EPIC.md', '# Epic', new Date('2026-10-20T00:00:00Z'));
  put('QRD-106/tickets/QRD-1500/NOW.md', '# NOW - QRD-1500', new Date('2026-10-25T00:00:00Z'));
  put('not-a-ticket/NOW.md', 'skipped');
  put('outside.md', 'secret');
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('cleanRelative keeps plain relative paths and refuses anything that could leave the folder', () => {
  assert.strictEqual(cleanRelative('screenshots/a.png'), 'screenshots/a.png');
  assert.strictEqual(cleanRelative('screenshots\\a.png'), 'screenshots/a.png');
  for (const bad of ['', '../outside.md', 'a/../../x', '/etc/passwd', 'C:/x', '.hidden.md', 'a//b', 'a\0b']) assert.strictEqual(cleanRelative(bad), null, bad);
  assert.deepStrictEqual(['a.md', 'b.PNG', 'c.mp4', 'd.exe'].map(fileKind), ['text', 'image', 'video', 'other']);
});

test('tickets and files: newest first, epic boards nested, hidden files left out, generated files marked', async () => {
  const { root, done } = fixture();
  try {
    const board = new Blackboard(root);
    const tickets = await board.tickets();
    assert.deepStrictEqual(tickets.map((t) => [t.key, t.epic]), [['QRD-1347', null], ['QRD-1230', null], ['QRD-1500', 'QRD-106'], ['QRD-106', null]]);
    assert.strictEqual(tickets.find((t) => t.key === 'QRD-1230')?.files, 4);
    const files = await board.files('qrd-1230');
    assert.deepStrictEqual(files?.map((f) => [f.path, f.kind, f.generated]), [
      ['NOW.md', 'text', true], ['notes.exe', 'other', false], ['review.md', 'text', false], ['screenshots/r2-ac3-tooltip-dark.png', 'image', false],
    ]);
    assert.deepStrictEqual((await board.files('QRD-106'))?.map((f) => f.path), ['EPIC.md'], 'the epic lists its own files, not its tickets');
    assert.deepStrictEqual((await board.files('QRD-1500'))?.map((f) => f.path), ['NOW.md']);
    assert.strictEqual(await board.files('QRD-9999'), null);
    assert.strictEqual(await board.files('../x'), null);
  } finally { done(); }
});

test('open: only listed types inside the ticket folder; traversal, symlinks out and unknown types are refused', async (t) => {
  const { root, done } = fixture();
  try {
    const board = new Blackboard(root);
    const opened = await board.open('QRD-1230', 'screenshots/r2-ac3-tooltip-dark.png');
    assert.deepStrictEqual([opened.mime, opened.size, opened.name], ['image/png', 4, 'r2-ac3-tooltip-dark.png']);
    await assert.rejects(() => board.open('QRD-1230', '../outside.md'), /Bad file path/);
    await assert.rejects(() => board.open('QRD-1230', 'notes.exe'), /not shown/);
    await assert.rejects(() => board.open('QRD-1230', 'missing.md'), /No such file/);
    await assert.rejects(() => board.open('QRD-9999', 'NOW.md'), /No blackboard/);
    try {
      symlinkSync(path.join(root, 'outside.md'), path.join(root, 'QRD-1230', 'link.md'));
    } catch {
      t.diagnostic('symlinks not available here; the escape check is not exercised');
      return;
    }
    await assert.rejects(() => board.open('QRD-1230', 'link.md'), /No such file/);
  } finally { done(); }
});

test('router: read-only, behind the unlock check, serves lists and file bytes with nosniff', async () => {
  const { root, done } = fixture();
  let unlocked = true;
  const app = express();
  app.use('/api/blackboard', createBlackboardRouter({ board: new Blackboard(root), authorize: async () => unlocked }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/blackboard`;
  try {
    const list = await (await fetch(`${base}/tickets`)).json();
    assert.strictEqual(list.tickets[0].key, 'QRD-1347');
    const files = await (await fetch(`${base}/QRD-1230/files`)).json();
    assert.strictEqual(files.files.length, 4);
    const file = await fetch(`${base}/QRD-1230/file?path=review.md`);
    assert.strictEqual(file.status, 200);
    assert.match(file.headers.get('content-type') || '', /text\/markdown/);
    assert.strictEqual(file.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(await file.text(), '## Verdict\napprove');
    assert.match((await fetch(`${base}/QRD-1230/file?path=review.md&download=1`)).headers.get('content-disposition') || '', /^attachment/);
    assert.strictEqual((await fetch(`${base}/QRD-1230/file?path=..%2Foutside.md`)).status, 400);
    assert.strictEqual((await fetch(`${base}/QRD-9999/files`)).status, 404);
    assert.strictEqual((await fetch(`${base}/tickets`, { method: 'POST' })).status, 405);
    unlocked = false;
    assert.strictEqual((await fetch(`${base}/tickets`)).status, 401);
  } finally {
    server.close();
    done();
  }
});
