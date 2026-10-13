import assert from 'node:assert';
import test from 'node:test';
import { isSettledStatus, mergeAttention, pullRequestProblems, withoutSettledTickets } from '../integrations/attention';

const item = (type: string, ticketKey: string | null) => ({ id: `${type}-${ticketKey}`, type, message: type, ticketKey });

test('an open pull request reports its conflict, requested changes and failing checks', () => {
  const quiet = { reviewDecision: 'approved', checks: 'passing' } as const;
  assert.deepStrictEqual(pullRequestProblems({ mergeable: true, mergeable_state: 'clean' }, quiet), []);
  assert.deepStrictEqual(pullRequestProblems({ mergeable: null, mergeable_state: 'unknown' }, quiet), [], 'still being computed is not a conflict');
  assert.deepStrictEqual(pullRequestProblems({ mergeable: false }, quiet), ['CONFLICT']);
  assert.deepStrictEqual(pullRequestProblems({ mergeable: null, mergeable_state: 'dirty' }, quiet), ['CONFLICT']);
  assert.deepStrictEqual(pullRequestProblems({ mergeable: true }, { reviewDecision: 'changes_requested', checks: 'pending' }), ['PR_CHANGES_REQUESTED']);
  assert.deepStrictEqual(pullRequestProblems({ mergeable: false }, { reviewDecision: 'changes_requested', checks: 'failing' }), ['CONFLICT', 'PR_CHANGES_REQUESTED', 'PR_CHECKS_FAILING']);
});

test('UAT CHECK, ReadyForProduction and Done / MERGED are settled; work in progress is not', () => {
  for (const status of ['UAT CHECK', 'ReadyForProduction', 'Done / MERGED', ' done / merged ']) assert.strictEqual(isSettledStatus(status), true, status);
  for (const status of ['PR Review', 'In Progress', 'UAT MERGED', 'UAT BUG / Improvement', '', null, undefined]) assert.strictEqual(isSettledStatus(status), false, String(status));
});

test('a pull request item is dropped when the agent run of that ticket already reports the same problem', () => {
  const agent = [item('AGENT_CHECKS_FAILING', 'QRD-1'), item('AGENT_WAITING', 'QRD-2')];
  const pulls = [item('PR_CHECKS_FAILING', 'QRD-1'), item('PR_CHANGES_REQUESTED', 'QRD-1'), item('PR_CHECKS_FAILING', 'QRD-2'), item('CONFLICT', 'QRD-1')];
  assert.deepStrictEqual(mergeAttention(agent, pulls).map((entry) => entry.id), [
    'AGENT_CHECKS_FAILING-QRD-1', 'AGENT_WAITING-QRD-2', 'PR_CHANGES_REQUESTED-QRD-1', 'PR_CHECKS_FAILING-QRD-2', 'CONFLICT-QRD-1',
  ]);
});

test('every item of a settled ticket is hidden, whatever its type; unknown tickets stay', () => {
  const items = [item('AGENT_WAITING', 'QRD-1'), item('AGENT_AC_FAILED', 'QRD-1'), item('CONFLICT', 'QRD-2'), item('PR_CHECKS_FAILING', 'QRD-3'), item('AGENT_STALLED', 'QRD-4'), item('CONFLICT', null)];
  const statusOf = new Map([['QRD-1', 'Done / MERGED'], ['QRD-2', 'UAT CHECK'], ['QRD-3', 'PR Review']]);
  assert.deepStrictEqual(withoutSettledTickets(items, statusOf).map((entry) => entry.id), ['PR_CHECKS_FAILING-QRD-3', 'AGENT_STALLED-QRD-4', 'CONFLICT-null']);
});
