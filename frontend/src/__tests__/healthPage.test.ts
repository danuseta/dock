import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasPage } from '../lib/dockMode';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('the machines page lives at /machines on both DOCKs, apart from the server /health check', () => {
  assert.strictEqual(hasPage('laptop', '/machines'), true);
  assert.strictEqual(hasPage('workspace', '/machines'), true);
  assert.match(read('App.tsx'), /case '\/machines': return <HealthPage \/>/);
  assert.doesNotMatch(read('App.tsx'), /'\/health'/, 'a reload of the page must not hit the JSON health check');
  assert.match(read('components/AppLayout.tsx'), /path: '\/machines', label: 'Health'/);
});

test('the empty machines page tells how to push a doctor report', () => {
  assert.match(read('pages/HealthPage.tsx'), /node doctor\.cjs --push/);
});
