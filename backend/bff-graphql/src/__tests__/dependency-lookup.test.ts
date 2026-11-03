import assert from 'node:assert';
import test, { beforeEach } from 'node:test';
import { lookupDependencies, resetDependencyLookup } from '../integrations/dependency-lookup';

beforeEach(() => resetDependencyLookup());

test('a looked-up key is served from the memo for 10 minutes, then fetched again', async () => {
  let calls = 0;
  let at = 1000;
  const fetchTicket = async () => { calls += 1; return { title: 'T', assignee: 'Ann', status: 'MERGED' }; };
  const first = await lookupDependencies(['QRD-1253', 'QRD-1253'], fetchTicket, () => at);
  assert.deepStrictEqual(first.get('QRD-1253'), { title: 'T', assignee: 'Ann', status: 'MERGED' });
  assert.strictEqual(calls, 1);
  at += 9 * 60 * 1000;
  await lookupDependencies(['QRD-1253'], fetchTicket, () => at);
  assert.strictEqual(calls, 1);
  at += 2 * 60 * 1000;
  await lookupDependencies(['QRD-1253'], fetchTicket, () => at);
  assert.strictEqual(calls, 2);
});

test('a failed lookup is remembered as a miss for 2 minutes', async () => {
  let calls = 0;
  let at = 1000;
  const fetchTicket = async () => { calls += 1; throw new Error('down'); };
  const first = await lookupDependencies(['QRD-9'], fetchTicket, () => at);
  assert.strictEqual(first.size, 0);
  at += 60 * 1000;
  await lookupDependencies(['QRD-9'], fetchTicket, () => at);
  assert.strictEqual(calls, 1);
  at += 61 * 1000;
  await lookupDependencies(['QRD-9'], fetchTicket, () => at);
  assert.strictEqual(calls, 2);
});

test('at most 20 distinct keys are fetched per call', async () => {
  const seen: string[] = [];
  const keys = Array.from({ length: 25 }, (_, i) => `QRD-${i + 1}`);
  await lookupDependencies(keys, async (key) => { seen.push(key); return { title: key }; });
  assert.strictEqual(seen.length, 20);
});
