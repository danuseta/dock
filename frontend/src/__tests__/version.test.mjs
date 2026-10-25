import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bumpVersion } from '../../../tools/version.mjs';

const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));

test('feat bumps minor and resets patch', () => {
  assert.equal(bumpVersion('1.1.4', ['feat: add x']), '1.2.0');
  assert.equal(bumpVersion('1.1.0', ['feat(QRD-1): add x', 'feat!: break']), '1.3.0');
});

test('fix bumps patch', () => {
  assert.equal(bumpVersion('1.1.0', ['fix: a', 'fix(ui): b']), '1.1.2');
});

test('a later feat resets the patch counted from earlier fixes', () => {
  assert.equal(bumpVersion('1.1.0', ['fix: a', 'fix: b', 'feat: c', 'fix: d']), '1.2.1');
});

test('other prefixes, merge commits and Release commits do not bump', () => {
  assert.equal(bumpVersion('1.1.0', ['chore: x', 'docs: y', 'Merge pull request #1', 'Release: v1.9.9', 'feature talk']), '1.1.0');
});

test('no commits keeps the baseline', () => {
  assert.equal(bumpVersion('1.1.0', []), '1.1.0');
});

test('the sidebar label shows the version with the channel, or main with the commit', () => {
  const layout = readFileSync(join(frontendRoot, 'src/components/AppLayout.tsx'), 'utf8');
  assert.match(layout, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(layout, /import\.meta\.env\.VITE_APP_CHANNEL/);
  assert.match(layout, /import\.meta\.env\.VITE_APP_COMMIT/);
  assert.match(layout, /`main · \$\{appCommit\}`/);
  assert.match(layout, /\{versionLabel\}/);
});
