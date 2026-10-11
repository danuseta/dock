import assert from 'node:assert';
import { readFileSync } from 'node:fs';
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

test('the deploy job stamps the frontend version before building the image', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const stamp = workflow.indexOf('npm pkg set version=1.0.${{ github.run_number }} --workspace=frontend');
  assert.ok(stamp > workflow.indexOf('deploy:'));
  assert.ok(stamp < workflow.indexOf('docker/build-push-action'));
});
