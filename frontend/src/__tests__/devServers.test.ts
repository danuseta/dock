import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';
import { canStop, filterLog } from '../lib/devServers';

test('the dev servers page is on the workspace DOCK only', () => {
  assert.equal(hasPage('workspace', '/dev-servers'), true);
  assert.equal(hasPage('laptop', '/dev-servers'), false);
});

test('a log search keeps the lines that hold the text, any case', () => {
  const log = '[frontend] VITE ready\n[frontend] error: port busy\n[backend] Error in boot';
  assert.equal(filterLog(log, 'error'), '[frontend] error: port busy\n[backend] Error in boot');
  assert.equal(filterLog(log, '  '), log);
});

test('a running or starting app can be stopped, a stopped or failed one cannot', () => {
  assert.deepEqual((['running', 'starting', 'stopped', 'failed'] as const).map(canStop), [true, true, false, false]);
});
