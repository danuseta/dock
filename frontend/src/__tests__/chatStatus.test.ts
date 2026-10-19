import assert from 'node:assert';
import test from 'node:test';
import { contextText, formatTokens, limitTone, resetsIn, type ChatSessionStatus } from '../chat/status';

const status = (overrides: Partial<ChatSessionStatus> = {}): ChatSessionStatus => ({
  sessionId: 's1', model: 'Opus 4.7 (1M context)', effort: 'high', fastMode: false, contextPercentage: 39.6, contextTokens: 395000, contextSize: 1000000,
  costUsd: 12.5, cacheWarm: true, cacheHitRatio: 0.93, receivedAt: '2026-10-08T10:00:00.000Z', stale: false, ...overrides,
});

test('usage levels split at 40 and 70 like the terminal status line', () => {
  assert.deepStrictEqual([0, 39.9, 40, 70, 70.1, 100].map(limitTone), ['ok', 'ok', 'warn', 'warn', 'danger', 'danger']);
});

test('token counts read as k and M', () => {
  assert.deepStrictEqual([950, 395000, 1000000, 1500000].map(formatTokens), ['950', '395k', '1M', '1.5M']);
});

test('reset times count down from now', () => {
  const now = Date.parse('2026-10-08T10:00:00.000Z');
  assert.strictEqual(resetsIn('2026-10-08T10:42:00.000Z', now), 'resets in 42 min');
  assert.strictEqual(resetsIn('2026-10-08T12:05:00.000Z', now), 'resets in 2 h 05 min');
  assert.strictEqual(resetsIn('2026-10-13T10:00:00.000Z', now), 'resets in 5 d');
  assert.strictEqual(resetsIn('2026-10-08T09:59:00.000Z', now), 'reset due');
  assert.strictEqual(resetsIn('nonsense', now), '');
});

test('the context text shows the share and the token count', () => {
  assert.strictEqual(contextText(status()), 'ctx 40% 395k/1M');
});
