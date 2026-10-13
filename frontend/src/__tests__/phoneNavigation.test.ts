import assert from 'node:assert';
import test from 'node:test';
import { PHONE_PRIMARY_PATHS, phoneMore } from '../lib/phoneNavigation';

const items = [
  { path: '/', badge: 0 }, { path: '/dashboard', badge: 0 }, { path: '/agents', badge: 0 }, { path: '/sessions', badge: 0 },
  { path: '/calendar', badge: 0 }, { path: '/sprint', badge: 0 }, { path: '/monitoring', badge: 0 }, { path: '/docker', badge: 0 },
  { path: '/attention', badge: 3 }, { path: '/settings', badge: 0 },
];

test('a phone shows four pages and puts the other six behind More, with their badges added up', () => {
  assert.deepStrictEqual(PHONE_PRIMARY_PATHS, ['/', '/dashboard', '/agents', '/sessions']);
  const more = phoneMore(items, '/agents');
  assert.deepStrictEqual(more.items.map((item) => item.path), ['/calendar', '/sprint', '/monitoring', '/docker', '/attention', '/settings']);
  assert.deepStrictEqual([more.badge, more.active], [3, false]);
  assert.strictEqual(phoneMore(items, '/settings').active, true, 'More is lit while one of its pages is open');
});
