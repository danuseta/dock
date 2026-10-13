import assert from 'node:assert';
import test from 'node:test';
import { sessionIdFromSearch, sessionUrl } from '../chat/sessionRoute';

test('the open session lives in the address and a reload or shared link reads it back', () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000021';
  assert.strictEqual(sessionUrl(id), `/sessions?session=${id}`);
  assert.strictEqual(sessionUrl(null), '/sessions');
  assert.strictEqual(sessionIdFromSearch(`?session=${id}`), id);
  assert.strictEqual(sessionIdFromSearch(`?x=1&session=${id}`), id);
  assert.strictEqual(sessionIdFromSearch(''), null);
  assert.strictEqual(sessionIdFromSearch('?session='), null);
  assert.strictEqual(sessionIdFromSearch('?session=../../etc'), null);
  assert.strictEqual(sessionIdFromSearch(`?session=${'a'.repeat(65)}`), null);
});
