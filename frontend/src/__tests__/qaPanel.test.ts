import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PREDICTION_LABEL, qaBusy, qaLine, qaPhase, qaVideoUrl, shortTc, uatPrediction, verdictVariant, type QaRun, type QaTrigger } from '../chat/qa';

const run = (extra: Partial<QaRun> = {}): QaRun => ({
  runId: '20261104T071926Z',
  state: 'done',
  step: 'judge',
  steps: [{ id: 'stack', label: 'Stack', state: 'done' }, { id: 'tests', label: 'Tests', state: 'done' }],
  testCases: [
    { id: 'QRD-1286-TC001', title: 'own avatar', ac: [1], state: 'passed', seconds: 23, video: 'videos/QRD-1286-TC001.webm', note: null },
    { id: 'QRD-1286-TC008', title: 'manual', ac: [4], state: 'blocked', seconds: 0, video: null, note: 'manual' },
  ],
  verdict: 'ESCALATED',
  rule: 'J-ESCALATED',
  passed: 1,
  failed: 0,
  blocked: 1,
  error: null,
  startedAt: '2026-11-04T07:19:26.000Z',
  updatedAt: '2026-11-04T07:25:00.000Z',
  finishedAt: '2026-11-04T07:25:00.000Z',
  ...extra,
});
const trigger = (extra: Partial<QaTrigger> = {}): QaTrigger => ({ at: '2026-11-04T08:00:00.000Z', sessionId: 's1', pullRequests: [], error: null, ...extra });

test('no run and no session is idle', () => {
  assert.strictEqual(qaPhase({ trigger: null, run: null }), 'idle');
  assert.strictEqual(qaLine({ trigger: null, run: null }, 'idle'), 'No QA run yet.');
});

test('a QA session newer than the last run is still preparing', () => {
  const phase = qaPhase({ trigger: trigger(), run: run() });
  assert.strictEqual(phase, 'preparing');
  assert.ok(qaBusy(phase));
});

test('a run that started after the session shows the run', () => {
  assert.strictEqual(qaPhase({ trigger: trigger({ at: '2026-11-04T07:00:00.000Z' }), run: run() }), 'done');
});

test('a session that did not start says why', () => {
  const qa = { trigger: trigger({ sessionId: null, error: 'Turns are full' }), run: null };
  assert.strictEqual(qaPhase(qa), 'not-started');
  assert.strictEqual(qaLine(qa, 'not-started'), 'QA did not start: Turns are full');
});

test('a running run counts the finished test cases', () => {
  const live = run({ state: 'running', step: 'tests', testCases: [run().testCases[0], { ...run().testCases[1], state: 'running' }] });
  assert.strictEqual(qaPhase({ trigger: null, run: live }), 'running');
  assert.strictEqual(qaLine({ trigger: null, run: live }, 'running'), 'Tests 1/2');
});

test('a finished run shows its counts, a failed one its error', () => {
  assert.strictEqual(qaLine({ trigger: null, run: run() }, 'done'), '1 passed · 0 failed · 1 blocked');
  const failed = run({ state: 'failed', error: 'login failed' });
  assert.strictEqual(qaLine({ trigger: null, run: failed }, qaPhase({ trigger: null, run: failed })), 'Stopped: login failed');
});

test('verdicts, ids and video links', () => {
  assert.strictEqual(verdictVariant('LOLOS'), 'success');
  assert.strictEqual(verdictVariant('REVISION'), 'danger');
  assert.strictEqual(verdictVariant('ESCALATED'), 'warn');
  assert.strictEqual(shortTc('QRD-1286-TC001'), 'TC001');
  assert.strictEqual(qaVideoUrl('QRD-1286', '20261104T071926Z', 'videos/QRD-1286-TC001.webm'), '/api/qa-local/QRD-1286/20261104T071926Z/videos/QRD-1286-TC001.webm');
});

test('QRD-1534: the local verdict reads as what UAT will likely say', () => {
  assert.strictEqual(uatPrediction('LOLOS'), 'PASS');
  assert.strictEqual(uatPrediction('ESCALATED'), 'ESCALATED');
  assert.strictEqual(uatPrediction('REVISION'), 'NOT PASSED');
  assert.strictEqual(uatPrediction('REVISION-RISK'), 'NOT PASSED');
  assert.strictEqual(uatPrediction('NOT PASSED'), 'NOT PASSED');
  assert.strictEqual(uatPrediction(null), null);
  assert.strictEqual(uatPrediction('SOMETHING'), null);
  assert.strictEqual(PREDICTION_LABEL, 'Prediksi di UAT');
});

test('QRD-1534: the QA panel has no verdict badge, no deploy gate line and no test case list, and never gates anything', () => {
  const panel = readFileSync(fileURLToPath(new URL('../chat/QaPanel.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(panel, /<Badge|verdictVariant/, 'no verdict badge');
  assert.doesNotMatch(panel, /DeployGate|GET_DEPLOY_GATE|UAT CHECK/, 'no deploy gate line');
  assert.doesNotMatch(panel, /testCases|aria-label="Test cases"/, 'no list of test cases');
  assert.match(panel, /Run after PR/);
  assert.match(panel, /'Run QA'/);
  assert.match(panel, /uatPrediction\(run\.verdict\)/);
  assert.match(panel, /PREDICTION_LABEL/);
});
