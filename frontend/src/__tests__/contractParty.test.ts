import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { partyOf, scoutOf } from '../lib/blackboard';

const here = dirname(fileURLToPath(import.meta.url));

test('the Party block Guild Master writes is read field by field, with its log number', () => {
  const text = '# Materials\r\nContract: not found\r\n\r\n## Party\r\nmode: light\r\nworker: sous-ticket-worker (haiku)\r\nverify: sous-verifier (sonnet), browser-verifier dry-run\r\nskip: planner, FINAL, video\r\nby: Guild Master, log #31\r\nScout: FE · ~2 files · no contract change → light\r\n';
  assert.deepEqual(partyOf(text), { mode: 'light', worker: 'sous-ticket-worker (haiku)', verify: 'sous-verifier (sonnet), browser-verifier dry-run', skip: 'planner, FINAL, video', by: 'Guild Master, log #31', log: 31 });
  assert.equal(scoutOf(text), 'Scout: FE · ~2 files · no contract change → light');
  assert.equal(partyOf('# Materials\nContract: not found\n'), null, 'no block is an empty Party');
  assert.deepEqual(partyOf('## Party\nmode: turbo\nby: me\n'), { mode: null, worker: null, verify: null, skip: null, by: 'me', log: null }, 'an unknown mode is no mode, a hand-written block has no log');
  assert.equal(partyOf('## Party\n\nmode: light\n')?.mode, null, 'only the lines right under the heading are the Party');
});

test('Contract shows the Party block, who wrote it and the log number, and keeps the empty text otherwise', () => {
  const view = readFileSync(join(here, '../pages/blackboard/ContractView.tsx'), 'utf8');
  assert.match(view, /const party = text \? partyOf\(text\) : null;/);
  assert.match(view, /Written by Guild Master after the owner's "ya" · log #\$\{party\.log\}/);
  assert.match(view, /Empty: every sous-ticket-runner agent is called as usual/);
});
