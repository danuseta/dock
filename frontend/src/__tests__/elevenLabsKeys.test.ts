import assert from 'node:assert/strict';
import test from 'node:test';
import { keyState } from '../lib/elevenLabsKeys';

test('a key reads as parked, in use or ready', () => {
  assert.match(keyState({ name: 'a', masked: 'sk_aaa...1111', current: true, parkedUntil: '2026-10-17T11:00:00.000Z' }), /^parked until /);
  assert.equal(keyState({ name: 'a', masked: 'sk_aaa...1111', current: true, parkedUntil: null }), 'in use');
  assert.equal(keyState({ name: 'b', masked: 'sk_bbb...2222', current: false }), 'ready');
});
