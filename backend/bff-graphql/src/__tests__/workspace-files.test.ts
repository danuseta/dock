import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_PREVIEW_BYTES, WorkspaceFiles, WorkspaceFilesError, isMasked } from '../integrations/workspace-files';

function home() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dock-home-'));
  mkdirSync(path.join(root, 'projects', 'app'), { recursive: true });
  mkdirSync(path.join(root, '.ssh'));
  writeFileSync(path.join(root, '.ssh', 'id_ed25519'), 'PRIVATE');
  writeFileSync(path.join(root, 'projects', 'app', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'projects', 'app', '.env'), 'DB_PASSWORD=hunter2');
  writeFileSync(path.join(root, 'projects', 'app', 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  writeFileSync(path.join(root, 'notes.txt'), 'x'.repeat(MAX_PREVIEW_BYTES + 10));
  return root;
}

test('secrets are masked by folder and by name; source files named after one stay readable', () => {
  for (const masked of ['.ssh', '.ssh/config', 'projects/app/.env', 'projects/app/.env.local', '.claude/.credentials.json', '.config/gh/hosts.yml', '.git-credentials', 'keys/server.pem', 'qonflo-pass', '.qonflo.pass', 'id_rsa', '.docker/config.json']) {
    assert.strictEqual(isMasked(masked), true, masked);
  }
  for (const open of ['', 'projects', 'projects/app/.env.example', 'src/token.service.ts', 'src/reset-password.tsx', 'README.md', '.bashrc', '.config/Code/settings.json']) {
    assert.strictEqual(isMasked(open), false, open);
  }
});

test('a folder lists folders first, marks secrets, and knows its parent', async () => {
  const root = home();
  try {
    const files = new WorkspaceFiles(root);
    const top = await files.dir('');
    assert.deepStrictEqual(top.entries.map((entry) => [entry.name, entry.kind, entry.masked]), [['.ssh', 'dir', true], ['projects', 'dir', false], ['notes.txt', 'file', false]]);
    assert.strictEqual(top.parent, null);
    const app = await files.dir('projects/app/');
    assert.strictEqual(app.parent, 'projects');
    assert.deepStrictEqual(app.entries.map((entry) => [entry.path, entry.masked]), [['projects/app/.env', true], ['projects/app/index.ts', false], ['projects/app/logo.png', false]]);
    await assert.rejects(files.dir('.ssh'), WorkspaceFilesError, 'a secret folder stays closed');
    await assert.rejects(files.dir('notes.txt'), WorkspaceFilesError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file sends its text, never a secret, and only the first 512 KB; binaries send no text', async () => {
  const root = home();
  try {
    const files = new WorkspaceFiles(root);
    assert.strictEqual((await files.file('projects/app/index.ts')).text, 'export const a = 1;\n');
    const secret = await files.file('projects/app/.env');
    assert.deepStrictEqual([secret.masked, secret.text], [true, null]);
    assert.deepStrictEqual([(await files.file('.ssh/id_ed25519')).text, (await files.file('.ssh/id_ed25519')).masked], [null, true]);
    const binary = await files.file('projects/app/logo.png');
    assert.deepStrictEqual([binary.binary, binary.text], [true, null]);
    const big = await files.file('notes.txt');
    assert.deepStrictEqual([big.truncated, big.text?.length], [true, MAX_PREVIEW_BYTES]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nothing outside the home folder is read, by .. or through a link', async () => {
  const root = home();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dock-outside-'));
  try {
    writeFileSync(path.join(outside, 'secret.txt'), 'outside');
    const files = new WorkspaceFiles(root);
    await assert.rejects(files.file('../secret.txt'), WorkspaceFilesError);
    await assert.rejects(files.dir('projects/../../'), WorkspaceFilesError);
    let linked = true;
    try { symlinkSync(outside, path.join(root, 'out'), 'junction'); } catch { linked = false; }
    if (linked) await assert.rejects(files.dir('out'), /leads out of the home folder/);
    await assert.rejects(files.file('missing.txt'), /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
