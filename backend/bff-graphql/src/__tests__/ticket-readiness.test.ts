import assert from 'node:assert';
import test from 'node:test';
import { lintTicket } from '../integrations/ticket-lint';
import { readinessLine, ticketReadiness, type ReadinessInput } from '../integrations/ticket-readiness';

const READY: ReadinessInput = {
  key: 'QRD-7', title: '[BE] Export the plan', acceptanceCriteria: '- The export has 3 rows.', summary: { current: true, testData: 'Sprint 27', ui: false }, tcApproved: true,
  lint: lintTicket({ summary: '[BE] Export the plan', ac: ['The export has 3 rows.'] }), prediction: 'LOLOS',
};

test('a complete ticket has nine items and no Readiness line', () => {
  const ready = ticketReadiness(READY);
  assert.deepStrictEqual(ready.items.map((item) => item.id), ['refs', 'open', 'summary', 'alone', 'data', 'tc', 'design', 'writing', 'qa']);
  assert.strictEqual(ready.done, 9);
  assert.strictEqual(readinessLine(ready), null);
});

test('the Readiness line is exactly "Readiness <done>/<total>: <id> (<text>); <id> (<text>)"', () => {
  const ready = ticketReadiness({ ...READY, summary: { current: true, testData: null, ui: false }, tcApproved: false });
  assert.strictEqual(readinessLine(ready), 'Readiness 7/9: data (Test data not named); tc (Test cases not approved by QA)');
});

test('the writing item fails on a block finding and the qa item on ESCALATED; without a prediction there is no qa item', () => {
  const bad = ticketReadiness({ ...READY, lint: lintTicket({ ac: ['TBD'] }), prediction: 'ESCALATED' });
  assert.strictEqual(readinessLine(bad), 'Readiness 7/9: writing (Below the writing standard: 1 finding to fix); qa (QA predicts ESCALATED: the AC may not be testable)');
  const none = ticketReadiness({ ...READY, prediction: null });
  assert.strictEqual(none.total, 8);
  assert.ok(!none.items.some((item) => item.id === 'qa'));
  assert.strictEqual(readinessLine(ticketReadiness({ ...READY, summary: null, prediction: null })), 'Readiness 5/8: summary (No summary yet); data (Test data: no summary yet); design (Design: no summary yet)');
});

test('references, open to confirm, waiting tickets and a missing design link read as on the ticket detail', () => {
  const ready = ticketReadiness({
    ...READY, title: '[FE] Show it', acceptanceCriteria: '- Uses QRD-1603.\n- Uses QRD-1604.', blockedBy: ['QRD-1604'], openToConfirm: 'Which color?', statuses: { 'QRD-1604': 'In Progress' },
  });
  assert.strictEqual(readinessLine(ready), 'Readiness 5/9: refs (Undecided references to other tickets: 1); open (Open to confirm is not empty); alone (Tickets the AC waits on, not in UAT yet: 2); design (UI ticket without a design link)');
});
