import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the dependency list renders inside the modal dialog, not under its top layer', () => {
  const dialog = readFileSync(join(src, 'components/ticket/DependencyDialog.tsx'), 'utf8');
  assert.match(dialog, /<div ref=\{setPortal\}>/);
  assert.match(dialog, /container=\{portal\}/);
});
