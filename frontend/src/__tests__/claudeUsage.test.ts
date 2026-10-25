import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fillDays, formatCost, formatTokens, periodRange, USAGE_PERIODS, validCustomRange } from '../lib/claudeUsage';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('the period chips are Today, 7 days, 30 days and Custom, and the presets end today', () => {
  assert.deepEqual(USAGE_PERIODS.map((period) => period.label), ['Today', '7 days', '30 days', 'Custom']);
  const now = new Date(2026, 9, 25, 15, 30);
  assert.deepEqual(periodRange('today', now), { from: '2026-10-25', to: '2026-10-25' });
  assert.deepEqual(periodRange('7d', now), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(periodRange('30d', now), { from: '2026-09-26', to: '2026-10-25' });
});

test('a custom range needs both dates, in order, within 366 days', () => {
  assert.equal(validCustomRange('2026-10-01', '2026-10-25'), true);
  assert.equal(validCustomRange('2025-10-25', '2026-10-25'), true);
  assert.equal(validCustomRange('2025-10-24', '2026-10-25'), false);
  assert.equal(validCustomRange('', '2026-10-25'), false);
  assert.equal(validCustomRange('2026-10-26', '2026-10-25'), false);
});

test('tokens and cost read compactly', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12_345), '12.3K');
  assert.equal(formatTokens(322_984_397), '322.98M');
  assert.equal(formatCost(110.9925), '$110.99');
});

test('Home carries the Claude usage card with the period chips, the not installed and error states', () => {
  assert.match(read('pages/HomePage.tsx'), /<ClaudeUsageCard \/>/);
  const card = read('components/ClaudeUsageCard.tsx');
  assert.match(card, /Claude usage/);
  assert.match(card, /USAGE_PERIODS\.map/);
  assert.match(card, /aria-pressed=\{period === item\.id\}/);
  assert.match(card, /type="date"/);
  assert.match(card, /ccusage is not installed on this workspace\./);
  assert.match(card, /Loading Claude usage\.\.\./);
  assert.match(card, /aria-label="Usage per day"/);
  assert.match(read('graphql/queries.ts'), /claudeUsage\(from: \$from, to: \$to\)/);
});

test('usage is always read from the server, never from a cached unavailable answer, and drawn as day columns', () => {
  const card = read('components/ClaudeUsageCard.tsx');
  assert.match(card, /fetchPolicy: 'network-only'/);
  assert.match(card, /<ol className="flex h-36 items-end/);
  assert.doesNotMatch(card, /style=\{\{ width:/);
});

test('every day of the range gets a column, zero when ccusage reported nothing', () => {
  const days = fillDays('2026-10-29', '2026-11-02', [{ date: '2026-10-30', totalTokens: 5, cost: 1 }, { date: '2026-11-02', totalTokens: 7, cost: 2 }]);
  assert.deepEqual(days.map((day) => `${day.date}:${day.totalTokens}`), ['2026-10-29:0', '2026-10-30:5', '2026-10-31:0', '2026-11-01:0', '2026-11-02:7']);
});
