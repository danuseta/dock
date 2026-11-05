import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { contextText, formatTokens, limitTone, resetLabel, resetsIn, type ChatSessionStatus } from '../chat/status';

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

test('the reset label counts minutes under an hour, then shows the clock, then the day', () => {
  const now = Date.parse('2026-10-08T10:00:00.000Z');
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const later = '2026-10-08T15:30:00.000Z';
  const far = '2026-10-13T10:00:00.000Z';
  const weekday = new Date(far).toLocaleDateString('en-US', { weekday: 'short' });
  assert.strictEqual(resetLabel('2026-10-08T10:42:00.000Z', now), 'resets in 42 min');
  assert.strictEqual(resetLabel(later, now), `resets ${clock(later)}`);
  assert.strictEqual(resetLabel(far, now), `resets ${weekday} ${clock(far)}`);
  assert.strictEqual(resetLabel('2026-10-08T09:59:00.000Z', now), 'reset due');
  assert.strictEqual(resetLabel('nonsense', now), '');
});

test('LimitBars draws only the windows that exist, and the account meter tells none from unseen', () => {
  const line = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'chat', 'StatusLine.tsx'), 'utf8');
  assert.match(line, /\[limits\.fiveHour, limits\.sevenDay\]\.filter\(\(limit\): limit is ChatLimit => Boolean\(limit\)\)/);
  const account = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'ClaudeAccountSection.tsx'), 'utf8');
  assert.match(account, /\{label\} \{seen \? 'none' : '-'\}/);
});

test('the account list shows the probe verdict, the check time and a throttled refresh button', () => {
  const account = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'ClaudeAccountSection.tsx'), 'utf8');
  assert.match(account, /account\.status === 'rejected'/);
  assert.match(account, /Blocked until \$\{resetLabel/);
  assert.match(account, /\{usageSource\(account\)\}/);
  assert.match(account, /account\.status === 'allowed_warning'.*Near the limit/);
  assert.match(account, /disabled=\{refreshing\}/);
});
