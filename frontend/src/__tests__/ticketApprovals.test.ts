import assert from 'node:assert';
import test from 'node:test';
import { getPassLabels } from '../lib/ticketApprovals';

test('shows Jira labels ending in Pass as written, once each', () => {
  assert.deepStrictEqual(
    getPassLabels(['alvinPass', 'kenPass', 'needs-review', 'passive', 'uat_pass', ' alvinPass ', 'pass']),
    ['alvinPass', 'kenPass', 'uat_pass'],
  );
});
