import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasPage } from '../lib/dockMode';
import { groupChecks, isStale, workspaceReport, type DoctorReport } from '../lib/doctorReport';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('the machines page lives at /machines on the workspace DOCK only, apart from the server /health check', () => {
  assert.strictEqual(hasPage('laptop', '/machines'), false);
  assert.strictEqual(hasPage('workspace', '/machines'), true);
  assert.match(read('App.tsx'), /case '\/machines': return <HealthPage \/>/);
  assert.doesNotMatch(read('App.tsx'), /'\/health'/, 'a reload of the page must not hit the JSON health check');
  assert.match(read('components/AppLayout.tsx'), /path: '\/machines', label: 'Health'/);
});

test('the empty machines page tells how to push a doctor report', () => {
  assert.match(read('pages/HealthPage.tsx'), /node doctor\.cjs --push/);
});

const report = (machine: string, checks: DoctorReport['checks']): DoctorReport => ({ machine, host: machine, os: 'linux', at: '2026-10-20T00:00:00Z', receivedAt: '2026-10-20T00:00:00Z', checks });

test('the page reads the workspace report and leaves the laptop one out', () => {
  const ws = report('workspace', [{ name: 'rtk', ok: true }]);
  assert.strictEqual(workspaceReport([report('laptop', [{ name: 'rtk', ok: true }]), ws]), ws);
  assert.strictEqual(workspaceReport([report('laptop', [{ name: 'rtk', ok: true }])]), null);
});

test('checks are grouped in doctor order and an unknown check goes to Other', () => {
  const groups = groupChecks([
    { name: 'chromium', ok: false }, { name: 'rtk', ok: true }, { name: 'hooks', ok: true }, { name: 'gpu', ok: true }, { name: 'ffmpeg', ok: true },
  ]);
  assert.deepStrictEqual(groups.map((group) => [group.name, group.checks.map((check) => check.name)]), [
    ['Tools', ['rtk', 'ffmpeg']], ['DOCK', ['hooks']], ['Browser', ['chromium']], ['Other', ['gpu']],
  ]);
});

test('a report older than 24 hours is stale', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  assert.strictEqual(isStale('2026-10-19T23:00:00Z', now), true);
  assert.strictEqual(isStale('2026-10-20T01:00:00Z', now), false);
});
