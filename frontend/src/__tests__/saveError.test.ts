import test from 'node:test';
import assert from 'node:assert';
import { saveErrorText } from '../lib/saveError';

test('a refused value shows the server reason', () => {
  assert.strictEqual(saveErrorText({ graphQLErrors: [{ message: 'Invalid light runner setting: lightMaxLines', extensions: { code: 'BAD_USER_INPUT' } }] }), 'Not saved: Invalid light runner setting: lightMaxLines');
});

test('anything else keeps the connection message', () => {
  assert.strictEqual(saveErrorText(new Error('Failed to fetch')), 'Not saved. Check the connection, then try again.');
  assert.strictEqual(saveErrorText({ graphQLErrors: [{ message: 'Unlock DOCK to continue', extensions: { code: 'UNAUTHENTICATED' } }] }), 'Not saved. Check the connection, then try again.');
  assert.strictEqual(saveErrorText(null), 'Not saved. Check the connection, then try again.');
});
