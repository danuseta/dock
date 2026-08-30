import assert from 'node:assert';
import test from 'node:test';
import { getApprovalLabels } from '../lib/ticketApprovals';

test('shows Jira labels ending in Pass as readable approval markers', () => {
  assert.deepStrictEqual(
    getApprovalLabels(['alvinPass', 'kenPass', 'needs-review', 'passive', 'uat_pass']),
    ['ALVIN APPROVED', 'KEN APPROVED', 'UAT APPROVED'],
  );
});
