import assert from 'node:assert';
import test from 'node:test';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';

test('cached page queries render stored data before background work', () => {
  assert.strictEqual(CACHED_QUERY_OPTIONS.fetchPolicy, 'cache-first');
  assert.strictEqual(CACHED_QUERY_OPTIONS.nextFetchPolicy, 'cache-first');
  assert.strictEqual(CACHED_QUERY_OPTIONS.returnPartialData, true);
  assert.strictEqual(isInitialQueryLoading(true, undefined), true);
  assert.strictEqual(isInitialQueryLoading(true, { dashboard: [] }), false);
});
