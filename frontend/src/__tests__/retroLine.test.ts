import assert from 'node:assert';
import test from 'node:test';
import { retroLineState } from '../agents/retro';

const item = (overrides: Record<string, unknown> = {}) => ({ status: 'open', source: 'ledger', sessionId: null, dest: 'kit', ...overrides });

test('a ledger line says it was applied from the ledger; a Judge line says it waits for the owner', () => {
  assert.strictEqual(retroLineState(item({ status: 'accepted', sessionId: 's1' })), 'Applied from the ledger, sous is applying it');
  assert.strictEqual(retroLineState(item({ status: 'accepted' })), 'Applied from the ledger', 'a Keep or Problem line only informs');
  assert.strictEqual(retroLineState(item({ status: 'accepted', dest: 'qa-agent' })), 'Applied from the ledger, open a PR to the QA bot repo');
  assert.strictEqual(retroLineState(item({ source: undefined, status: 'accepted' })), 'Applied from the ledger', 'a line without a source is a ledger line');
  assert.strictEqual(retroLineState(item()), 'from the ledger, not applied yet: waits for you');
  assert.strictEqual(retroLineState(item({ source: 'judge' })), 'from Judge: waits for you');
  assert.strictEqual(retroLineState(item({ source: 'judge', status: 'accepted', sessionId: 's2' })), 'accepted, sous is applying it');
  assert.strictEqual(retroLineState(item({ status: 'closed' })), null);
});
