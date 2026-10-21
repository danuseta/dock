import assert from 'node:assert/strict';
import test from 'node:test';
import { keyState, quotaText } from '../lib/elevenLabsKeys';

test('a key reads as parked, in use or ready', () => {
  assert.match(keyState({ name: 'a', masked: 'sk_aaa...1111', current: true, parkedUntil: '2026-10-17T11:00:00.000Z' }), /^parked until /);
  assert.equal(keyState({ name: 'a', masked: 'sk_aaa...1111', current: true, parkedUntil: null }), 'in use');
  assert.equal(keyState({ name: 'b', masked: 'sk_bbb...2222', current: false }), 'ready');
});

test('quota reads as characters left of the limit with the reset date', () => {
  assert.equal(quotaText({ characterCount: 17_600, characterLimit: 30_000, resetsAt: '2026-11-03T12:00:00.000Z' }), '12,400 of 30,000 characters left · resets 3 Nov');
  assert.equal(quotaText({ characterCount: 31_000, characterLimit: 30_000 }), '0 of 30,000 characters left');
});
