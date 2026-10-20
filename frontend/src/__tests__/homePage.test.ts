import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasPage } from '../lib/dockMode';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

test('Home shows service health only where the Monitoring page exists', () => {
  assert.equal(hasPage('laptop', '/monitoring'), true);
  assert.equal(hasPage('workspace', '/monitoring'), false);
  const home = read('pages/HomePage.tsx');
  assert.match(home, /const showMonitors = hasPage\(mode, '\/monitoring'\)/);
  assert.match(home, /\{showMonitors && <article/);
  assert.match(home, /label: 'Agents running'/);
});

test('the workspace Home does not ask the BFF to check every monitor live', () => {
  const queries = read('graphql/queries.ts');
  const home = queries.slice(queries.indexOf('GET_HOME_SECONDARY'), queries.indexOf('`;', queries.indexOf('GET_HOME_SECONDARY')));
  assert.match(home, /monitors\(refresh: true\) @include\(if: \$monitors\)/);
  assert.match(read('pages/HomePage.tsx'), /monitors: showMonitors/);
});
