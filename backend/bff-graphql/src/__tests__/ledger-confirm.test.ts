import assert from 'node:assert';
import test from 'node:test';
import { DecisionGate } from '../integrations/decision-gate';
import { confirmArgs, writeConfirmations, type LedgerConfirmDeps } from '../integrations/ledger-confirm';

type Decision = { n: number; status: string; text: string; replaces?: number };

/** A fake status.cjs over one ledger: `show` prints it, `decide --replaces n` adds an owner decision and supersedes D-n. */
function kit(options: { decisions?: Decision[]; missing?: boolean; available?: boolean; failDecide?: boolean } = {}) {
  const decisions: Decision[] = (options.decisions ?? [{ n: 1, status: 'DECIDED', text: 'one' }, { n: 2, status: 'GUESS', text: 'two' }, { n: 3, status: 'USULAN', text: 'three' }]).map((item) => ({ ...item }));
  const calls: string[][] = [];
  const ingested: Array<{ ledger: { key: string; decisions: Decision[] }; machine: string }> = [];
  const deps: LedgerConfirmDeps = {
    available: () => options.available ?? true,
    status: async (args) => {
      calls.push(args);
      if (args[0] === 'show') {
        if (options.missing) throw new Error('no ledger');
        return JSON.stringify({ key: args[1], decisions });
      }
      if (options.failDecide) throw new Error('ledger locked');
      const replaced = decisions.find((item) => item.n === Number(args[args.indexOf('--replaces') + 1]));
      if (replaced) replaced.status = 'SUPERSEDED';
      decisions.push({ n: decisions.length + 1, status: args[args.indexOf('--status') + 1], text: args[2], replaces: replaced?.n });
      return `${args[1]} decision #${decisions.length}`;
    },
    ingest: async (ledger, machine) => { ingested.push({ ledger: ledger as { key: string; decisions: Decision[] }, machine }); },
  };
  return { deps, calls, ingested, decisions };
}

test('a confirmation becomes an owner decision with the same text that supersedes the guess', () => {
  assert.deepStrictEqual(confirmArgs('QRD-1511', { n: 2, text: 'Tooltip shows name and version' }), [
    'decide', 'QRD-1511', 'Owner confirmed D-2 in DOCK: Tooltip shows name and version', '--status', 'DECIDED', '--by', 'owner', '--replaces', '2',
  ]);
});

test('confirmed guesses are written to the ledger and DOCK gets the new ledger', async () => {
  const k = kit();
  assert.strictEqual(await writeConfirmations(k.deps, 'QRD-1511', 'workspace', [{ n: 2, text: 'two' }, { n: 3, text: 'three' }]), 'written');
  assert.deepStrictEqual(k.decisions.filter((item) => item.status === 'GUESS' || item.status === 'USULAN'), []);
  assert.deepStrictEqual(k.decisions.slice(3).map((item) => [item.status, item.replaces]), [['DECIDED', 2], ['DECIDED', 3]]);
  assert.strictEqual(k.ingested.length, 1);
  assert.strictEqual(k.ingested[0].machine, 'workspace');
  assert.ok(k.ingested[0].ledger.decisions.some((item) => item.text === 'Owner confirmed D-2 in DOCK: two'));
});

test('a guess the ledger already settled is not written twice', async () => {
  const k = kit({ decisions: [{ n: 2, status: 'SUPERSEDED', text: 'two' }, { n: 3, status: 'DECIDED', text: 'Owner confirmed D-2 in DOCK: two' }] });
  assert.strictEqual(await writeConfirmations(k.deps, 'QRD-1511', 'workspace', [{ n: 2, text: 'two' }]), 'skipped');
  assert.deepStrictEqual(k.calls.map((args) => args[0]), ['show']);
  assert.strictEqual(k.ingested.length, 0);
});

test('without the kit, or without a ledger on this machine, nothing is written', async () => {
  const off = kit({ available: false });
  assert.strictEqual(await writeConfirmations(off.deps, 'QRD-1511', 'workspace', [{ n: 2, text: 'two' }]), 'skipped');
  assert.deepStrictEqual(off.calls, []);
  const elsewhere = kit({ missing: true });
  assert.strictEqual(await writeConfirmations(elsewhere.deps, 'QRD-1511', 'laptop', [{ n: 2, text: 'two' }]), 'skipped');
  assert.deepStrictEqual(elsewhere.calls.map((args) => args[0]), ['show']);
});

const run = (decisions: Decision[]) => ({
  key: 'QRD-1511',
  kind: 'build' as const,
  machine: 'workspace',
  prBe: null,
  prFe: null,
  issues: [],
  decisions: decisions.map((item) => ({ at: '', by: 'sous', issue: null, cancelNote: null, effect: null, alts: [], replaces: null, supersededBy: null, ...item })) as never,
});

function gate(writeLedger?: (key: string, machine: string, decisions: Array<{ n: number; text: string }>) => Promise<'written' | 'skipped'>) {
  const cache = new Map<string, unknown>();
  const events: string[] = [];
  const g = new DecisionGate({
    getCache: async (namespace, key) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace, key, value) => { cache.set(`${namespace}:${key}`, value); },
    markReady: async () => true,
    event: async (_key, kind, detail) => { events.push(`${kind} ${detail}`); },
    afterReady: async () => undefined,
    writeLedger,
  });
  return { g, events };
}

test('the gate hands the confirmed decisions with their text to the ledger writer', async () => {
  const written: Array<{ key: string; machine: string; decisions: Array<{ n: number; text: string }> }> = [];
  const { g } = gate(async (key, machine, decisions) => { written.push({ key, machine, decisions }); return 'written'; });
  const confirmed = await g.confirm(run([{ n: 2, status: 'GUESS', text: 'two' }, { n: 3, status: 'GUESS', text: 'three' }, { n: 4, status: 'GUESS', text: 'four' }]), [2, 4]);
  assert.deepStrictEqual(confirmed, [2, 4]);
  assert.deepStrictEqual(written, [{ key: 'QRD-1511', machine: 'workspace', decisions: [{ n: 2, text: 'two' }, { n: 4, text: 'four' }] }]);
});

test('a failed ledger write keeps the confirmation and says so on the run', async () => {
  const k = kit({ failDecide: true });
  const { g, events } = gate((key, machine, decisions) => writeConfirmations(k.deps, key, machine, decisions));
  assert.deepStrictEqual(await g.confirm(run([{ n: 2, status: 'GUESS', text: 'two' }]), [2]), [2]);
  assert.deepStrictEqual(await g.confirmed('QRD-1511'), [2]);
  assert.ok(events.includes('OWNER_CONFIRMED D-2'));
  assert.ok(events.includes('LEDGER_WRITE_FAILED D-2: ledger locked'), events.join(' | '));
});
