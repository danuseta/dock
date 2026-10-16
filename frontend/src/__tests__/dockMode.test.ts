import assert from 'node:assert';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';

const pages = ['/', '/dashboard', '/agents', '/sessions', '/calendar', '/sprint', '/monitoring', '/docker', '/attention', '/settings'];

test('the laptop DOCK leaves only Sessions out', () => {
  assert.deepStrictEqual(pages.filter((path) => !hasPage('laptop', path)), ['/sessions']);
});

test('the workspace DOCK leaves Calendar and Docker Services out', () => {
  assert.deepStrictEqual(pages.filter((path) => !hasPage('workspace', path)), ['/calendar', '/docker']);
});
