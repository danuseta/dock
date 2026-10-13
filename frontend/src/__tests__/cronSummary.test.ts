import assert from 'node:assert';
import test from 'node:test';
import { roundSummary } from '../agents/cronRound';

test('the last round reads as one sentence', () => {
  const at = '2026-10-14T02:05:00.000Z';
  const when = new Date(at).toLocaleString();
  assert.strictEqual(roundSummary(null), 'No round has run yet.');
  assert.strictEqual(roundSummary({ at, skipped: 'machine workspace is offline', started: [], parked: [], notMoved: [], failed: [] }), `${when}: skipped, machine workspace is offline.`);
  assert.strictEqual(roundSummary({ at, skipped: null, started: [], parked: [], notMoved: [], failed: [] }), `${when}: started nothing.`);
  assert.strictEqual(
    roundSummary({ at, skipped: null, started: ['QRD-1', 'QRD-3'], parked: ['QRD-2'], notMoved: ['QRD-3'], failed: ['QRD-9'] }),
    `${when}: started QRD-1, QRD-3; parked QRD-2; Jira did not move QRD-3; failed QRD-9.`,
  );
});

test('the settings form round-trips the config and turns its text fields back into lists and numbers', async () => {
  const { configFromForm, formFromConfig } = await import('../agents/cronRound');
  const config = { enabled: true, hoursWib: [9, 14], machine: 'workspace', parallel: 2, perRound: 3, sprint: 'active', labels: ['be', 'fe'], todoStatuses: ['To Do'], inProgressStatus: 'In Progress', model: null, effort: 'high', usageBrakePercent: 70, notifyUserId: '123456789' };
  const form = formFromConfig(JSON.stringify(config));
  assert.deepStrictEqual([form.hoursWib, form.labels, form.model, form.parallel], ['9, 14', 'be, fe', '', '2']);
  assert.deepStrictEqual(JSON.parse(configFromForm(form)), config);
  assert.deepStrictEqual(JSON.parse(configFromForm({ ...form, hoursWib: ' 8 ,, 20 ', labels: '', parallel: 'two' })), { ...config, hoursWib: [8, 20], labels: [], parallel: 'two' });
});
