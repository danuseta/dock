import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bumpVersion, titlesOf } from '../../../tools/version.mjs';

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

test('a GitHub merge commit counts by the pull request title in its body; sync merges count nothing', () => {
  const entry = (subject, body = '') => `${subject}\x1f${body}\x1e`;
  const log = [
    entry('Merge pull request #137 from danuseta/feat/x', 'feat(QRD-1456): bypassPermissions chat mode\n'),
    entry('Merge pull request #140 from danuseta/fix/y', '\nfix(QRD-1456): sidebar groups reach main\n'),
    entry("Merge remote-tracking branch 'origin/main' into feat/z"),
    entry('Merge pull request #134 from danuseta/main', 'Release: main to stable'),
    entry('fix: pushed straight to main'),
  ].join('\n');
  assert.deepEqual(titlesOf(log), ['feat(QRD-1456): bypassPermissions chat mode', 'fix(QRD-1456): sidebar groups reach main', "Merge remote-tracking branch 'origin/main' into feat/z", 'Release: main to stable', 'fix: pushed straight to main']);
  assert.equal(bumpVersion('2.0.0', titlesOf(log)), '2.1.2');
});

test('the sidebar label always shows the version, with the channel, and the commit in its tooltip', () => {
  const layout = readFileSync(join(frontendRoot, 'src/components/AppLayout.tsx'), 'utf8');
  assert.match(layout, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(layout, /import\.meta\.env\.VITE_APP_CHANNEL/);
  assert.match(layout, /import\.meta\.env\.VITE_APP_COMMIT/);
  assert.doesNotMatch(layout, /`main · \$\{appCommit\}`/);
  assert.match(layout, /title=\{versionTitle\}/);
  assert.match(layout, /\{versionLabel\}/);
});
