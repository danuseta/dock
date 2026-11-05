import assert from 'node:assert';
import test from 'node:test';
import { usageSource } from '../components/claudeAccountSource';

const AT = '2026-11-05T06:11:00.000Z';

test('a row filled by a turn says so, a probed row shows when it was checked, an empty row says nothing was seen', () => {
  assert.match(usageSource({ source: 'status', seenAt: AT, checkedAt: AT }), /^Seen .+ from a turn$/);
  assert.match(usageSource({ source: 'probe', seenAt: AT, checkedAt: AT }), /^Checked /);
  assert.match(usageSource({ source: null, seenAt: null, checkedAt: AT }), /^Checked /);
  assert.strictEqual(usageSource({ source: null, seenAt: null, checkedAt: null }), 'no usage seen yet');
});
