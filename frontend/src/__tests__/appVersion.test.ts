import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = join(frontendRoot, '..');

test('the sidebar version comes from package.json instead of a literal', () => {
  const layout = readFileSync(join(frontendRoot, 'src/components/AppLayout.tsx'), 'utf8');
  assert.doesNotMatch(layout, />\s*v\d+\.\d+\.\d+\s*</);
  assert.match(layout, /import \{ version as appVersion \} from '\.\.\/\.\.\/package\.json'/);
  assert.match(layout, /v\{appVersion\}/);
});

test('the autobump script stamps the version the sidebar reads', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'dock-autobump-'));
  try {
    mkdirSync(join(sandbox, 'scripts'));
    mkdirSync(join(sandbox, 'frontend'));
    cpSync(join(repoRoot, 'scripts/autobump-version.mjs'), join(sandbox, 'scripts/autobump-version.mjs'));
    writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.1' }));
    writeFileSync(join(sandbox, 'frontend/package.json'), JSON.stringify({ name: 'frontend', version: '1.0.1' }));
    execFileSync(process.execPath, [join(sandbox, 'scripts/autobump-version.mjs'), '1.0.57'], { stdio: 'pipe' });
    assert.strictEqual(JSON.parse(readFileSync(join(sandbox, 'frontend/package.json'), 'utf8')).version, '1.0.57');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('the deploy job stamps the version before building the image', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const stamp = workflow.indexOf('scripts/autobump-version.mjs');
  assert.ok(stamp > workflow.indexOf('deploy:'));
  assert.ok(stamp < workflow.indexOf('docker/build-push-action'));
});
