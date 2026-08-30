import assert from 'node:assert';
import test from 'node:test';
import { dockerStatusTone, formatBytes } from '../lib/dockerRuntime';

test('formats Docker metrics for compact inventory views', () => {
  assert.strictEqual(formatBytes(null), '—');
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(1_572_864), '1.5 MB');
  assert.match(dockerStatusTone('running'), /status-merged/);
  assert.match(dockerStatusTone('exited'), /muted-foreground/);
});
