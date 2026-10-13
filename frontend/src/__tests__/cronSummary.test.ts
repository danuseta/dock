import assert from 'node:assert';
import test from 'node:test';
import { roundSummary } from '../agents/cronRound';

test('the last round reads as one sentence', () => {
  const at = '2026-10-14T02:05:00.000Z';
  const when = new Date(at).toLocaleString();
  assert.strictEqual(roundSummary(null), 'No round has run yet.');
  assert.strictEqual(roundSummary({ at, skipped: 'machine workspace is offline', started: [], parked: [], notMoved: [], failed: [] }), `${when}: skipped, machine workspace is offline.`);
  assert.strictEqual(roundSummary({ at, skipped: null, started: [], parked: [], notMoved: [], failed: [] }), `${when}: started nothing.`);
  assert.strictEqual(
    roundSummary({ at, skipped: null, started: ['QRD-1', 'QRD-3'], parked: ['QRD-2'], notMoved: ['QRD-3'], failed: ['QRD-9'] }),
    `${when}: started QRD-1, QRD-3; parked QRD-2; Jira did not move QRD-3; failed QRD-9.`,
  );
});
