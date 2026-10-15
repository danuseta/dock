import assert from 'node:assert';
import test from 'node:test';
import { deferredLines, fillSummary, type FillLog } from '../agents/cronRound';

const at = '2026-10-14T02:05:00.000Z';
const fill = (overrides: Partial<FillLog> = {}): FillLog => ({ at, skipped: null, started: [], parked: [], deferred: [], notMoved: [], failed: [], ...overrides });

test('the last fill reads as one sentence', () => {
  const when = new Date(at).toLocaleString();
  assert.strictEqual(fillSummary(null), 'Nothing has run yet.');
  assert.strictEqual(fillSummary(fill({ skipped: 'outside work hours: not a work day' })), `${when}: nothing taken, outside work hours: not a work day.`);
  assert.strictEqual(fillSummary(fill()), `${when}: started nothing.`);
  assert.strictEqual(
    fillSummary(fill({ started: ['QRD-1', 'QRD-3'], parked: ['QRD-2'], notMoved: ['QRD-3'], failed: ['QRD-9'] })),
    `${when}: started QRD-1, QRD-3; parked QRD-2; Jira did not move QRD-3; failed QRD-9.`,
  );
  assert.strictEqual(
    fillSummary(fill({ started: ['QRD-4'], released: ['QRD-1'] })),
    `${when}: started QRD-4; start failed, back to To Do: QRD-1.`,
  );
});

test('deferred tickets are grouped by their reason', () => {
  const full = 'slots full: 2 of 2 in use';
  const cap = 'daily cap reached: 6 started today';
  assert.deepStrictEqual(deferredLines(fill({ deferred: [{ key: 'QRD-3', reason: full }, { key: 'QRD-8', reason: cap }, { key: 'QRD-4', reason: full }] })), [
    `${full}: QRD-3, QRD-4`,
    `${cap}: QRD-8`,
  ]);
  assert.deepStrictEqual(deferredLines(null), []);
});

test('the settings form round-trips the config and turns its text fields back into lists and numbers', async () => {
  const { configFromForm, formFromConfig } = await import('../agents/cronRound');
  const config = {
    enabled: true, machine: 'workspace', parallel: 2, workStart: 9, workEnd: 17, workDays: [1, 2, 3, 4, 5], activeFrom: null, activeUntil: '2026-12-31',
    maxPerDay: 6, mode: 'auto', sprint: 'active', labels: ['be', 'fe'], todoStatuses: ['To Do'],
    inProgressStatus: 'In Progress', model: null, effort: 'high', usageBrakePercent: 70, notifyUserId: '123456789',
  };
  const form = formFromConfig(JSON.stringify(config));
  assert.deepStrictEqual([form.labels, form.model, form.parallel, form.activeFrom], ['be, fe', '', '2', '']);
  assert.deepStrictEqual(JSON.parse(configFromForm(form)), config);
  assert.deepStrictEqual(
    JSON.parse(configFromForm({ ...form, workDays: [6, 1], labels: '', parallel: 'two' })),
    { ...config, workDays: [1, 6], labels: [], parallel: 'two' },
  );
});
