import assert from 'node:assert';
import test from 'node:test';
import { getApprovalLabels } from '../lib/ticketApprovals';

test('shows only Jira labels containing pass as readable approval markers', () => {
  assert.deepStrictEqual(
    getApprovalLabels(['fe-pass', 'needs-review', 'uat_pass', 'Backend-Passed']),
    ['FE PASS', 'UAT PASS', 'BACKEND PASSED'],
  );
});
