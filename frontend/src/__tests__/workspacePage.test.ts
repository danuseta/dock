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
