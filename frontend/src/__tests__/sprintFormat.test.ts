import assert from 'node:assert';
import test from 'node:test';
import { fmt, fmt0, formatUpdated, parseResult, pct, sprintOptionLabel, toneVariant, trendPath, trendX, trendY, type TrendGeometry } from '../sprint/format';

const geometry: TrendGeometry = { width: 400, height: 200, left: 40, right: 20, top: 10, bottom: 30 };

test('number helpers match the reference dashboard formatting', () => {
  assert.strictEqual(fmt(79.6), '79.6');
  assert.strictEqual(fmt(0.1 + 0.2), '0.3');
  assert.strictEqual(fmt0(0), '');
  assert.strictEqual(fmt0(2.5), '2.5');
  assert.strictEqual(pct(0.5849), '58%');
});

test('tones map to badge variants', () => {
  assert.deepStrictEqual(['g', 'a', 'r'].map((tone) => toneVariant(tone as 'g' | 'a' | 'r')), ['success', 'warn', 'danger']);
});

test('parseResult tolerates empty and broken payloads', () => {
  assert.strictEqual(parseResult(null), null);
  assert.strictEqual(parseResult('{oops'), null);
  assert.strictEqual(parseResult('{"cutoff":"x"}')?.cutoff, 'x');
});

test('timestamps render in WIB and sprint labels carry the date range', () => {
  assert.strictEqual(formatUpdated(null), 'never');
  assert.match(formatUpdated('2026-01-05T23:00:00Z'), /06:00 WIB/);
  assert.strictEqual(
    sprintOptionLabel({ id: 5, name: 'QRD Sprint 5', state: 'active', startDate: '2026-01-05T02:00:00Z', endDate: '2026-01-19T02:00:00Z', computedAt: null, lastError: null }),
    'QRD Sprint 5 · 2026-01-05 – 2026-01-19 (active)',
  );
});

test('trend geometry puts 0 at the bottom, 100 at the top, and centres a single point', () => {
  assert.strictEqual(trendY(100, geometry), 10);
  assert.strictEqual(trendY(0, geometry), 170);
  assert.strictEqual(trendY(250, geometry), 10);
  assert.strictEqual(trendX(0, 1, geometry), 210);
  assert.strictEqual(trendX(0, 3, geometry), 40);
  assert.strictEqual(trendX(2, 3, geometry), 380);
});

test('trendPath joins the points across sprints without load, like the reference chart', () => {
  assert.strictEqual(trendPath([100, null, 0], geometry), 'M40.0,10.0 L380.0,170.0');
  assert.strictEqual(trendPath([100, 0], geometry), 'M40.0,10.0 L380.0,170.0');
  assert.strictEqual(trendPath([null, null], geometry), '');
});
