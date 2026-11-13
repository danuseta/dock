import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EVERYONE, QA_QUEUE_REFRESH_MS, filterQueue, formatWait, peopleOf, shortName, waitText, type QaQueueRow } from '../lib/qaQueue';
import { hasPage } from '../lib/dockMode';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');
const row = (key: string, assignee: string | null, overrides: Partial<QaQueueRow> = {}): QaQueueRow => ({ position: 1, key, summary: key, status: 'UAT CHECK', assignee, labels: [], kind: 'queue', waitsOn: [], enteredAt: null, waitingMinutes: null, ...overrides });

test('the QA queue filters per person by first name, and Punya saya by the Jira user', () => {
  const rows = [row('QRD-1', 'M Danu Seta W'), row('QRD-2', 'Alvin Theofilus Sutikno'), row('QRD-3', 'M Danu Seta W'), row('QRD-4', null)];
  assert.deepEqual(peopleOf(rows), [{ name: 'Danu', count: 2 }, { name: 'Alvin', count: 1 }, { name: 'Belum ada', count: 1 }]);
  assert.deepEqual(filterQueue(rows, 'Danu', false, null).map((item) => item.key), ['QRD-1', 'QRD-3']);
  assert.deepEqual(filterQueue(rows, EVERYONE, true, 'm danu seta w').map((item) => item.key), ['QRD-1', 'QRD-3']);
  assert.deepEqual(filterQueue(rows, EVERYONE, true, null), [], 'without the Jira user nothing is mine');
  assert.equal(shortName('Yusril Izza'), 'Yusril');
});

test('waits read in minutes, hours and days; a wait-dependency row names what it waits on', () => {
  assert.deepEqual([formatWait(null), formatWait(42), formatWait(86), formatWait(60 * 26)], ['-', '42m', '1h 26m', '1d 2h']);
  assert.equal(waitText({ waitsOn: ['QRD-1307'] }), 'Nunggu QRD-1307');
  assert.equal(waitText({ waitsOn: [] }), 'Nunggu dependency');
});

test('the QA queue page refreshes every 60 seconds, sits in the Team group next to Planning, and the ticket shows its place', () => {
  assert.equal(QA_QUEUE_REFRESH_MS, 60_000);
  const page = read('pages/QaQueuePage.tsx');
  assert.match(page, /pollInterval: QA_QUEUE_REFRESH_MS/);
  assert.match(page, /Punya saya/);
  assert.match(read('App.tsx'), /case '\/qa-queue': return <QaQueuePage/);
  assert.match(read('components/AppLayout.tsx'), /label: 'Planning'[^\n]*\n\s*\{ path: '\/qa-queue', label: 'QA queue'[^\n]*group: 'Team'/);
  assert.equal(hasPage('laptop', '/qa-queue'), true);
  assert.match(read('pages/TicketDetailPage.tsx'), /Antrean QA: #\{qaData\.qaQueuePosition\}/);
});

test('a capped queue says how many are left; an assignee without a name, or a run without a stage, never throws', async () => {
  const { moreText } = await import('../lib/qaQueue');
  assert.deepEqual([moreText({ capped: false, more: null }), moreText({ capped: true, more: 120 }), moreText({ capped: true, more: -1 })], [null, '+120 lagi', '+ lagi']);
  const nameless = { ...row('QRD-9', null), assignee: undefined as unknown as string | null };
  assert.equal(shortName(undefined as unknown as string | null), 'Belum ada');
  assert.deepEqual(peopleOf([nameless]), [{ name: 'Belum ada', count: 1 }]);
  assert.deepEqual(filterQueue([nameless], EVERYONE, true, 'Danu'), []);
  const { stageLabel, stageName } = await import('../agents/runs');
  assert.equal(stageLabel(undefined), '');
  assert.equal(stageLabel(null).toUpperCase(), '', 'Home AgentRunStrip upper-cases the label');
  assert.equal(stageName(undefined, 'review'), '');
  assert.equal(stageLabel('pr'), 'PR');
});
