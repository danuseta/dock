import assert from 'node:assert';
import test from 'node:test';
import { updateStep } from '../lib/appUpdate';

const OLD = '/assets/index-aaa111.js';
const NEW = '/assets/index-bbb222.js';

test('a newer build on the server reloads the app, unless that would lose typed text or was already tried', () => {
  assert.strictEqual(updateStep(OLD, OLD, false, null), 'none', 'already current');
  assert.strictEqual(updateStep(OLD, NEW, false, null), 'reload');
  assert.strictEqual(updateStep(OLD, NEW, true, null), 'offer', 'text in a box: ask first');
  assert.strictEqual(updateStep(OLD, NEW, false, NEW), 'offer', 'already reloaded for this build once: no loop');
  assert.strictEqual(updateStep(OLD, NEW, false, '/assets/index-older.js'), 'reload', 'a reload for an earlier build does not count');
  assert.strictEqual(updateStep(null, NEW, false, null), 'none', 'development: the page has no build');
  assert.strictEqual(updateStep(OLD, null, false, null), 'none', 'the server could not be asked');
});
