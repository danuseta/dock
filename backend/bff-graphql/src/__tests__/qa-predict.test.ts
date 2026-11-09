import test from 'node:test';
import assert from 'node:assert/strict';
import { NOT_INSTALLED, predictQa, type QaInputTicket, type QaRunner } from '../integrations/qa-predict';

const tickets: QaInputTicket[] = [{ key: 'QRD-1511', summary: 'Live cursors', ac: ['needs QRD-1489'], waitsOn: [{ key: 'QRD-1489', endDay: 10.5 }], endDay: 15 }];
const answer = (stdout: string, code = 0): QaRunner => async () => ({ code, stdout, stderr: code ? 'boom\nTypeError: bad input' : '' });

test('a missing predict.mjs gives no prediction and says it is not installed', async () => {
  let ran = false;
  const run = await predictQa(tickets, { script: '/none/predict.mjs', exists: () => false, runner: async () => { ran = true; return { code: 0, stdout: '{}', stderr: '' }; } });
  assert.deepEqual(run, { predictions: null, reason: NOT_INSTALLED });
  assert.equal(ran, false);
});

test('the tickets go in on stdin and each verdict comes back by key', async () => {
  let sent = '';
  const runner: QaRunner = async (_script, stdin) => {
    sent = stdin;
    return { code: 0, stdout: JSON.stringify({ results: [
      { key: 'qrd-1511', prediction: 'ESCALATED', reasons: ['needs Edit share', 3], fix: 'move AC 2 to QRD-1489' },
      { key: 'QRD-1', prediction: 'MAYBE', reasons: [] },
      { key: 'QRD-2', prediction: 'LOLOS', reasons: [], fix: null },
    ] }), stderr: '' };
  };
  const run = await predictQa(tickets, { script: 'p.mjs', exists: () => true, runner });
  assert.deepEqual(JSON.parse(sent), { tickets });
  assert.equal(run.reason, null);
  assert.deepEqual([...run.predictions!.entries()], [
    ['QRD-1511', { prediction: 'ESCALATED', reasons: ['needs Edit share'], fix: 'move AC 2 to QRD-1489' }],
    ['QRD-2', { prediction: 'LOLOS', reasons: [], fix: null }],
  ]);
});

test('bad JSON, a missing results list, a failing exit and a timeout give no prediction with the reason', async () => {
  const opts = (runner: QaRunner) => ({ script: 'p.mjs', exists: () => true, runner });
  assert.deepEqual(await predictQa(tickets, opts(answer('not json'))), { predictions: null, reason: 'QA prediction answered something other than JSON' });
  assert.deepEqual(await predictQa(tickets, opts(answer('{"ok":true}'))), { predictions: null, reason: 'QA prediction answered without a results list' });
  assert.deepEqual(await predictQa(tickets, opts(answer('', 1))), { predictions: null, reason: 'QA prediction failed: TypeError: bad input' });
  const slow: QaRunner = async () => { throw new Error('predict.mjs gave no answer in 60s'); };
  assert.deepEqual(await predictQa(tickets, opts(slow)), { predictions: null, reason: 'QA prediction failed: predict.mjs gave no answer in 60s' });
});
