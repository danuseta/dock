import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';

test('the Workspace page is on the workspace DOCK only', () => {
  assert.equal(hasPage('workspace', '/workspace'), true);
  assert.equal(hasPage('laptop', '/workspace'), false);
});
