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
  assert.match(home, /services healthy/);
});

test('the Home greeting names the owner from the ownerName query and shows no name before it loads', () => {
  const home = read('pages/HomePage.tsx');
  assert.match(home, /useQuery\(GET_OWNER_NAME, CACHED_QUERY_OPTIONS\)/);
  assert.match(home, /\{greeting\}\{ownerData\?\.ownerName \? `, \$\{ownerData\.ownerName\}` : ''\}\./);
  assert.doesNotMatch(home, /'Danu'/);
  assert.match(read('graphql/queries.ts'), /query GetOwnerName \{\s*ownerName\s*\}/);
});

test('Home keeps three blocks: the header with quick links, Needs you, and My tickets with each agent', () => {
  const home = read('pages/HomePage.tsx');
  assert.doesNotMatch(home, /GoogleSearch/);
  assert.doesNotMatch(home, /aria-label="Work overview"/);
  assert.match(home, /aria-label="Quick links"/);
  assert.match(home, /<HomeAttention rows=\{attention\}/);
  assert.match(home, /My tickets/);
  assert.match(home, /<AgentRunStrip run=\{run\}/);
  assert.doesNotMatch(home, />Current work</);
});

test('Needs you pages five tickets at a time and a filter starts again on page one', () => {
  const panel = read('components/HomeAttention.tsx');
  assert.match(panel, /const PAGE_SIZE = 5;/);
  assert.match(panel, /pageOf\(shown, page, PAGE_SIZE\)/);
  assert.match(panel, /setFilter\(option\.value\); setPage\(1\);/);
  assert.match(panel, /aria-label="Next page"/);
});

test('the workspace Home does not ask the BFF to check every monitor live', () => {
  const queries = read('graphql/queries.ts');
  const home = queries.slice(queries.indexOf('GET_HOME_SECONDARY'), queries.indexOf('`;', queries.indexOf('GET_HOME_SECONDARY')));
  assert.match(home, /monitors\(refresh: true\) @include\(if: \$monitors\)/);
  assert.match(read('pages/HomePage.tsx'), /monitors: showMonitors/);
});
