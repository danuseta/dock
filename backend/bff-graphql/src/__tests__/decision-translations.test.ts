import assert from 'node:assert';
import test from 'node:test';
import { normalizeDecisions, normalizeIssues, parseLedger, toOrchestration } from '../integrations/orchestrator';

test('an issue keeps its Indonesian question and options, parallel to the options it kept', () => {
  const [issue] = normalizeIssues([{
    n: 2, at: '2026-11-13T09:00:00.000Z', type: 'QUESTION', level: 'owner', text: 'Keep the old export?',
    options: ['Keep', '', 'Drop'], effects: ['nothing', null, 'removes it'],
    textId: 'Export lama dipertahankan?', optionsId: ['Pertahankan', 'kosong', 'Hapus'],
  }]);
  assert.strictEqual(issue.text, 'Keep the old export?', 'the English text is what sous receives');
  assert.deepStrictEqual(issue.options, ['Keep', 'Drop']);
  assert.strictEqual(issue.textId, 'Export lama dipertahankan?');
  assert.deepStrictEqual(issue.optionsId, ['Pertahankan', 'Hapus']);
});

test('a decision keeps its Indonesian text and one line per alternative', () => {
  const [decision] = normalizeDecisions([{
    n: 4, at: '2026-11-13T09:00:00.000Z', text: 'Show the badge only on hover', status: 'GUESS',
    alts: [{ label: 'Always show it' }, 'bad', { label: 'Hide it', effect: 'no badge' }], optionsId: ['Selalu tampil', null, 'Sembunyikan'],
    textId: 'Badge cuma muncul pas hover',
  }]);
  assert.deepStrictEqual(decision.alts, [{ label: 'Always show it', effect: null }, { label: 'Hide it', effect: 'no badge' }]);
  assert.strictEqual(decision.textId, 'Badge cuma muncul pas hover');
  assert.deepStrictEqual(decision.optionsId, ['Selalu tampil', 'Sembunyikan']);
});

test('without translations a decision and an issue read exactly as before', () => {
  const [decision] = normalizeDecisions([{ at: 'x', text: 'use X', alts: [{ label: 'use Y' }] }]);
  assert.strictEqual('textId' in decision, false);
  assert.strictEqual('optionsId' in decision, false);
  const [issue] = normalizeIssues([{ text: 'Which one?', options: ['A', 'B'], optionsId: ['', null] }]);
  assert.strictEqual('textId' in issue, false);
  assert.strictEqual('optionsId' in issue, false, 'empty translations are left out');
});

test('the ledger carries qaMenu to the run', () => {
  const ledger = { key: 'QRD-1534', title: 't', stage: 'pr', waiting: '', qaMenu: '  Settings > Agents > Sous flow ', updatedAt: '2026-11-13T09:00:00.000Z' };
  const parsed = parseLedger(ledger, new Date('2026-11-14T00:00:00.000Z'));
  assert.strictEqual(parsed.qaMenu, 'Settings > Agents > Sous flow');
  assert.strictEqual(parseLedger({ ...ledger, qaMenu: 5 }).qaMenu, null);
  const row = {
    key: 'QRD-1534', title: 't', stage: 'pr', waiting: '', payload: JSON.stringify(parsed), activity: 'IDLE', activityDetail: null, activityEndedAt: null,
    lastEventAt: null, ledgerUpdatedAt: new Date(parsed.updatedAt), transcriptAt: null, dismissedAt: null,
  };
  assert.strictEqual(toOrchestration(row, new Date('2026-11-14T00:00:00.000Z')).qaMenu, 'Settings > Agents > Sous flow');
});
