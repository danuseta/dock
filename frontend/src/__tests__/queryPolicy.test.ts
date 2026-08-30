import assert from 'node:assert';
import test from 'node:test';
import { CACHED_QUERY_OPTIONS, displayAssignee, isInitialQueryLoading, mergeReliableAssignee } from '../lib/queryPolicy';

test('cached page queries render stored data before background work', () => {
  assert.strictEqual(CACHED_QUERY_OPTIONS.fetchPolicy, 'cache-and-network');
  assert.strictEqual(CACHED_QUERY_OPTIONS.nextFetchPolicy, 'cache-first');
  assert.strictEqual(CACHED_QUERY_OPTIONS.returnPartialData, true);
  assert.strictEqual(CACHED_QUERY_OPTIONS.notifyOnNetworkStatusChange, false);
  assert.strictEqual(isInitialQueryLoading(true, undefined), true);
  assert.strictEqual(isInitialQueryLoading(true, { dashboard: [] }), false);
});

test('keeps a reliable assignee while stale Jira cache is revalidated', () => {
  assert.strictEqual(mergeReliableAssignee('M Danu Seta W', 'Unassigned'), 'M Danu Seta W');
  assert.strictEqual(mergeReliableAssignee(undefined, 'M Danu Seta W'), 'M Danu Seta W');
  assert.strictEqual(displayAssignee('Unassigned'), 'Syncing assignee…');
});
