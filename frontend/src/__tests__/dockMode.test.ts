import assert from 'node:assert';
import test from 'node:test';
import { hasPage, showsChatDock } from '../lib/dockMode';

const pages = ['/', '/dashboard', '/agents', '/sessions', '/calendar', '/sprint', '/monitoring', '/docker', '/attention', '/settings'];

test('the laptop DOCK leaves only Sessions out', () => {
  assert.deepStrictEqual(pages.filter((path) => !hasPage('laptop', path)), ['/sessions']);
});

test('the workspace DOCK leaves Monitoring, Docker Services and Calendar out', () => {
  assert.deepStrictEqual(pages.filter((path) => !hasPage('workspace', path)), ['/calendar', '/monitoring', '/docker']);
});

test('the floating chat shows on the workspace DOCK except on the Sessions page, and never on the laptop DOCK', () => {
  assert.strictEqual(showsChatDock('workspace', '/sessions'), false);
  assert.strictEqual(showsChatDock('workspace', '/sessions/abc'), false);
  assert.strictEqual(showsChatDock('workspace', '/dashboard'), true);
  assert.strictEqual(showsChatDock('laptop', '/dashboard'), false);
});
