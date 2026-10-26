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

test('an open tab looks for a deploy every minute and when it gets focus or comes back online, not only when it is shown again', async () => {
  const { readFileSync } = await import('node:fs');
  const { UPDATE_CHECK_MS } = await import('../lib/appUpdate');
  assert.strictEqual(UPDATE_CHECK_MS, 60_000);
  const layout = readFileSync(new URL('../components/AppLayout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /setInterval\(check, UPDATE_CHECK_MS\)/);
  for (const event of ["'visibilitychange'", "'focus'", "'online'"]) assert.ok(layout.includes(`addEventListener(${event}, check)`), event);
  const update = readFileSync(new URL('../lib/appUpdate.ts', import.meta.url), 'utf8');
  assert.match(update, /\[role="dialog"\]/, 'an open dialog is offered the update, not reloaded');
  assert.match(update, /box\.getClientRects\(\)\.length > 0 && box\.value\.trim\(\) !== ''/, 'the hidden prefilled Report bug box does not block the reload');
});
