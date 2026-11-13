import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';
import { joinPath, nameProblem, renamedPath } from '../lib/workspacePaths';

test('the Workspace page is on the workspace DOCK only', () => {
  assert.equal(hasPage('workspace', '/workspace'), true);
  assert.equal(hasPage('laptop', '/workspace'), false);
});

test('names typed on the Workspace page become paths in the open folder', () => {
  assert.equal(joinPath('', 'notes.md'), 'notes.md');
  assert.equal(joinPath('projects/app', 'src'), 'projects/app/src');
  assert.equal(renamedPath('projects/app/a.ts', 'b.ts'), 'projects/app/b.ts');
  assert.equal(renamedPath('top.txt', 'renamed.txt'), 'renamed.txt');
  assert.equal(nameProblem('ok.txt'), null);
  assert.notEqual(nameProblem('  '), null);
  assert.notEqual(nameProblem('..'), null);
  assert.notEqual(nameProblem('a/b'), null);
  assert.notEqual(nameProblem('a\\b'), null);
});

test('the Worktrees tab cleans only merged rows without a refusal, and Home reminds while the rule is not off', async () => {
  const { cleanable, filterWorktrees, folderOf, reminderText } = await import('../lib/worktrees');
  const base = { repo: 'be', branch: 'feat/QRD-1-x', ticketKey: 'QRD-1', pulls: [], dirty: false, changes: [], session: false, devServer: false, mergedSince: null };
  const rows = [
    { ...base, path: '/p/.worktrees/QRD-1-be', merge: 'merged', refusals: [] },
    { ...base, path: '/p/.worktrees/QRD-2-be', merge: 'merged', dirty: true, refusals: ['ada perubahan lokal'] },
    { ...base, path: '/p/.worktrees/QRD-3-be', merge: 'open', refusals: ['belum merged'] },
  ];
  assert.deepEqual(rows.filter(cleanable).map((row) => folderOf(row.path)), ['QRD-1-be']);
  assert.deepEqual(filterWorktrees(rows, 'open').map((row) => folderOf(row.path)), ['QRD-3-be']);
  assert.equal(reminderText({ mode: 'notify', rows }), '2 worktree udah merged, 1 bisa dibersihin sekarang.');
  assert.equal(reminderText({ mode: 'off', rows }), null);
  assert.equal(reminderText({ mode: 'notify', rows: [rows[2]] }), null);
});
