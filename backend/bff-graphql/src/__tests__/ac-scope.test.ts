import test from 'node:test';
import assert from 'node:assert/strict';
import { acFindings, findingId, isDoneStatus, normalizeAcLine, splitAc } from '../integrations/ac-scope';

const ends = new Map([['QRD-1511', 15], ['QRD-1489', 10.5], ['QRD-1286', 8.5], ['QRD-1490', 16]]);
const status = (statuses: Record<string, string>) => (key: string) => statuses[key] ?? 'To Do';

test('the AC field splits into lines without bullets, numbers or empty lines', () => {
  assert.deepEqual(splitAc('- One line\n\n2. Second   line\r\n* [ ] third\n• fourth\n   '), ['One line', 'Second line', '[ ] third', 'fourth']);
  assert.deepEqual(splitAc(null), []);
  assert.equal(normalizeAcLine('  -  Shows   QRD-1 '), 'Shows QRD-1');
});

test('a line needing a ticket that ends later is after-it, one ending first is lands-first', () => {
  const findings = acFindings([
    { key: 'QRD-1511', ac: ['Cursor shows in the editor', 'An Edit client sees the cursor (QRD-1489)', 'Presence from qrd-1286 shows first'] },
    { key: 'QRD-1489', ac: ['The edit share opens (QRD-1490)'] },
  ], ends, status({}));
  assert.deepEqual(findings.map((finding) => [finding.key, finding.line, finding.refKey, finding.kind]), [
    ['QRD-1511', 2, 'QRD-1489', 'lands-first'],
    ['QRD-1511', 3, 'QRD-1286', 'lands-first'],
    ['QRD-1489', 1, 'QRD-1490', 'after-it'],
  ]);
  assert.deepEqual([findings[2].refEnd, findings[2].ownEnd], [16, 10.5]);
});

test('a done ticket lands first whatever the plan says, a ticket outside the plan is outside-plan', () => {
  const findings = acFindings([{ key: 'QRD-1286', ac: ['Needs QRD-1490 and QRD-1363 and QRD-77, not QRD-1286 itself'] }], ends, status({ 'QRD-1490': 'UAT MERGED', 'QRD-1363': 'Ready for Production' }));
  assert.deepEqual(findings.map((finding) => [finding.refKey, finding.kind, finding.refEnd]), [
    ['QRD-1490', 'lands-first', null],
    ['QRD-1363', 'lands-first', null],
    ['QRD-77', 'outside-plan', null],
  ]);
});

test('the finding id survives the line moving and the done statuses are the agreed four', () => {
  assert.equal(findingId('QRD-1', 'QRD-2', '- needs  QRD-2'), 'ac|QRD-1|QRD-2|needs QRD-2');
  assert.deepEqual(['UAT CHECK', 'uat merged', 'Ready for Production', 'Done', 'PR Review'].map(isDoneStatus), [true, true, true, true, false]);
});
