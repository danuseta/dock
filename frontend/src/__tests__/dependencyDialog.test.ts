import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dependencyChoices, matchesChoice } from '../lib/ticketDetail';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the dependency list renders inside the dialog, as wide as it, with a search box', () => {
  const dialog = readFileSync(join(src, 'components/ticket/DependencyDialog.tsx'), 'utf8');
  assert.doesNotMatch(dialog, /<Select\b/, 'a portalled select opens under the modal top layer and wider than the dialog');
  assert.match(dialog, /role="listbox"/);
  assert.match(dialog, /type="search"/);
});

test('choices put the active sprint first and the newest key first, without the ticket itself', () => {
  const choices = dependencyChoices([
    { key: 'QRD-999', title: 'Alpha', sprintState: 'CLOSED' },
    { key: 'QRD-1001', title: 'Zeta', sprintState: 'ACTIVE' },
    { key: 'QRD-1200', title: 'Beta', sprintState: null },
    { key: 'QRD-1002', title: 'Gamma', sprintState: 'ACTIVE' },
    { key: 'QRD-1001', title: 'Zeta again', sprintState: 'ACTIVE' },
    { key: 'QRD-1500', title: 'Itself', sprintState: 'ACTIVE' },
  ], 'QRD-1500');
  assert.deepEqual(choices.map((choice) => choice.key), ['QRD-1002', 'QRD-1001', 'QRD-1200', 'QRD-999']);
});

test('the search matches the key or the title, ignoring case', () => {
  const choice = { key: 'QRD-1402', title: 'Folder tag filter' };
  assert.equal(matchesChoice(choice, ''), true);
  assert.equal(matchesChoice(choice, 'qrd-14'), true);
  assert.equal(matchesChoice(choice, 'TAG fil'), true);
  assert.equal(matchesChoice(choice, 'inbox'), false);
});
