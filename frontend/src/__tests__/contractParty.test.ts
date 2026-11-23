import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { partyOf, partySigned, scoutOf } from '../lib/blackboard';

const here = dirname(fileURLToPath(import.meta.url));

test('the Party block Guild Master writes is read field by field, with its log number and its exact lines', () => {
  const text = '# Materials\r\nContract: not found\r\n\r\n## Party\r\nmode: light\r\nworker: sous-ticket-worker (haiku)\r\nby: Guild Master, log #31\r\nScout: FE · ~2 files · no contract change → light\r\n';
  assert.deepEqual(partyOf(text), { mode: 'light', worker: 'sous-ticket-worker (haiku)', verify: null, skip: null, by: 'Guild Master, log #31', log: 31, lines: ['mode: light', 'worker: sous-ticket-worker (haiku)', 'by: Guild Master, log #31'] });
  assert.equal(scoutOf(text), 'Scout: FE · ~2 files · no contract change → light');
  assert.equal(partyOf('# Materials\nContract: not found\n'), null, 'no block is an empty Party');
  assert.deepEqual(partyOf('## Party\nmode: turbo\nby: me\n'), { mode: null, worker: null, verify: null, skip: null, by: 'me', log: null, lines: ['mode: turbo', 'by: me'] }, 'an unknown mode is no mode, a hand-written block has no log');
  assert.equal(partyOf('## Party\n\nmode: light\n')?.mode, null, 'only the lines right under the heading are the Party');
});

test('a Party is shown as written by Guild Master only when DOCK verified that log entry and the block is exactly its lines', () => {
  const party = partyOf('## Party\nmode: light\nworker: sous-ticket-worker (sonnet)\nby: Guild Master, log #7\n');
  const lines = ['mode: light', 'worker: sous-ticket-worker (sonnet)', 'by: Guild Master, log #7'];
  assert.equal(partySigned(party, { log: 7, lines }), true);
  assert.equal(partySigned(party, null), false, 'DOCK found no signed entry');
  assert.equal(partySigned(party, { log: 6, lines }), false, 'another log number');
  assert.equal(partySigned(party, { log: 7, lines: ['mode: full', 'by: Guild Master, log #7'] }), false, 'the block was edited');
  assert.equal(partySigned(null, { log: 7, lines }), false);
});

test('Contract labels the Party from the backend check, and keeps the empty text otherwise', () => {
  const view = readFileSync(join(here, '../pages/blackboard/ContractView.tsx'), 'utf8');
  assert.match(view, /const signed = partySigned\(party, signedData\?\.guildMasterParty\);/);
  assert.match(view, /signed \? `Written by Guild Master after the owner's "ya" · log #\$\{party\.log\}` : 'Not from the Guild Master log/);
  assert.match(view, /Empty: every sous-ticket-runner agent is called as usual/);
});
