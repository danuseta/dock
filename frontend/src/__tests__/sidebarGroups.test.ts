import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const layout = readFileSync(join(src, 'components/AppLayout.tsx'), 'utf8');

const labelsOf = (group: string) => [...layout.matchAll(new RegExp(`label: '([^']+)'[^\n]*group: '${group}'`, 'g'))].map((match) => match[1]);

test('the sidebar titles three groups with the pages the owner assigned', () => {
  assert.match(layout, /\['Work', 'Team', 'System'\]\.map\(\(title\)/);
  assert.deepEqual(labelsOf('Work'), ['Home', 'Board', 'Agents', 'Blackboard', 'Sessions', 'Decisions', 'Demo Videos', 'Calendar']);
  assert.deepEqual(labelsOf('Team'), ['Sprint', 'Discord']);
  assert.deepEqual(labelsOf('System'), ['Monitoring', 'Docker Services', 'Dev Servers', 'Workspace', 'Health', 'DOCK Issues', 'System Settings']);
});

test('a group with no page in this mode is dropped, and a collapsed sidebar shows a divider instead of the title', () => {
  assert.match(layout, /\.filter\(\(group\) => group\.items\.length > 0\)/);
  assert.match(layout, /<ul aria-label=\{group\.title\}/);
  assert.match(layout, /\{!preferences\.collapsed && <p [^>]*uppercase[^>]*>\{group\.title\}<\/p>\}/);
  assert.match(layout, /index > 0 && \(preferences\.collapsed \? '[^']*min-\[761px\]:border-t[^']*' : 'min-\[761px\]:mt-4'\)/);
});
