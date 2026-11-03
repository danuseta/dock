import assert from 'node:assert';
import test from 'node:test';
import { getPassLabels, openConflict, passCount, slotsForTicket } from '../lib/ticketApprovals';

test('shows Jira labels ending in Pass as written, once each', () => {
  assert.deepStrictEqual(
    getPassLabels(['alvinPass', 'kenPass', 'needs-review', 'passive', 'uat_pass', ' alvinPass ', 'pass']),
    ['alvinPass', 'kenPass', 'uat_pass'],
  );
});

test('counts Pass labels against the reviewer slots, capped', () => {
  assert.deepStrictEqual(passCount([]), { n: 0, of: 2 });
  assert.deepStrictEqual(passCount(['aPass', 'bPass']), { n: 2, of: 2 });
  assert.deepStrictEqual(passCount(['aPass', 'bPass', 'cPass']), { n: 2, of: 2 });
  assert.deepStrictEqual(passCount(['aPass', 'bPass'], 1), { n: 1, of: 1 });
});

test('flags a conflict only on an open or draft pull request that reports mergeable false', () => {
  assert.equal(openConflict([{ status: 'open', mergeable: null }]), false);
  assert.equal(openConflict([{ status: 'merged', mergeable: false }]), false);
  assert.equal(openConflict([{ status: 'open', mergeable: false }]), true);
});

test('takes the reviewer slots from the pull request thread of the ticket, else 2', () => {
  const threads = [{ kind: 'bug', slots: 5, tickets: [{ key: 'QRD-1' }] }, { kind: 'pr', slots: 1, tickets: [{ key: 'QRD-1' }] }];
  assert.equal(slotsForTicket(threads, 'QRD-1'), 1);
  assert.equal(slotsForTicket(threads, 'QRD-2'), 2);
  assert.equal(slotsForTicket(undefined, 'QRD-1'), 2);
});
