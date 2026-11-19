import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import { acceptRetroLine, autoAcceptLedgerLines, type RetroLine } from '../integrations/retro-apply';

const line = (id: string, overrides: Partial<RetroLine> = {}): RetroLine => ({
  id, sprint: 'S-1', kind: 'try', text: `Line ${id}`, evidence: '["QRD-1"]', dest: 'kit', status: 'open', sessionId: null, source: 'ledger', ...overrides,
});

function world(fail: string[] = []) {
  const rows = new Map<string, RetroLine>();
  const runs: Array<{ title: string; text: string; into: string | null }> = [];
  let sessions = 0;
  return {
    runs,
    rows,
    deps: {
      update: async (id: string, data: { status: string; sessionId: string | null }) => {
        const row = { ...(rows.get(id) ?? line(id)), ...data };
        rows.set(id, row);
        return row;
      },
      run: async (title: string, text: string, into: string | null) => {
        if (fail.some((id) => text.includes(`retro apply ${id}`))) throw new Error('The workspace is not connected');
        runs.push({ title, text, into });
        return into ?? `session-${(sessions += 1)}`;
      },
    },
  };
}

test('the owner accepting a line with somewhere to go opens a sous session with the apply prompt; a note is only marked', async () => {
  const w = world();
  const kit = await acceptRetroLine(line('a', { evidence: '["QRD-1","QRD-2"]' }), w.deps);
  assert.deepStrictEqual([kit.status, kit.sessionId], ['accepted', 'session-1']);
  assert.deepStrictEqual(w.runs, [{ title: 'Retro-apply-S-1', text: 'Pakai skill sous: retro apply a\nDest: kit\nText: Line a\nEvidence: QRD-1; QRD-2', into: null }]);
  for (const dest of ['note', 'qa-agent']) {
    const manual = await acceptRetroLine(line(dest, { dest }), w.deps);
    assert.deepStrictEqual([manual.status, manual.sessionId], ['accepted', null]);
  }
  assert.strictEqual(w.runs.length, 1, 'a manual dest opens no session');
});

test('a ledger draft is accepted without the owner: Try lines share one session, Keep and Problem only inform, Judge lines wait', async () => {
  const w = world();
  const created = [
    line('t1'),
    line('k1', { kind: 'keep' }),
    line('p1', { kind: 'problem', dest: 'kit' }),
    line('t2', { dest: 'memory' }),
    line('n1', { dest: 'note' }),
    line('q1', { dest: 'qa-agent' }),
    line('j1', { source: 'judge' }),
    line('t3', { dest: 'dock' }),
  ];
  const accepted = await autoAcceptLedgerLines(created, [], w.deps);
  assert.deepStrictEqual(accepted.map((row) => [row.id, row.status, row.sessionId]), [
    ['t1', 'accepted', 'session-1'],
    ['k1', 'accepted', null],
    ['p1', 'accepted', null],
    ['t2', 'accepted', 'session-1'],
    ['n1', 'accepted', null],
    ['q1', 'accepted', null],
    ['t3', 'accepted', 'session-1'],
  ]);
  assert.deepStrictEqual(w.runs.map((run) => [run.text.split('\n')[0], run.into]), [
    ['Pakai skill sous: retro apply t1', null],
    ['Pakai skill sous: retro apply t2', 'session-1'],
    ['Pakai skill sous: retro apply t3', 'session-1'],
  ], 'the first Try line opens Retro-apply-<sprint>; the next ones are its next turns');
  assert.strictEqual(w.rows.has('j1'), false, 'a Judge line waits for the owner');
});

test('a ledger line the sprint already accepted is not applied again when the draft repeats it', async () => {
  const w = world();
  const earlier = [line('old', { status: 'accepted', sessionId: 'session-9', text: 'Line t1' }), line('closed', { status: 'closed', text: 'Line t2' })];
  const accepted = await autoAcceptLedgerLines([line('t1'), line('t2')], earlier, w.deps);
  assert.deepStrictEqual(accepted.map((row) => [row.id, row.sessionId]), [['t1', 'session-9'], ['t2', 'session-1']]);
  assert.deepStrictEqual(w.runs.map((run) => run.text.split('\n')[0]), ['Pakai skill sous: retro apply t2'], 'a closed line is not the same as an applied one');
});

test('a line that cannot be applied stays open for the owner and the rest go on', async () => {
  const w = world(['t1']);
  const failed: string[] = [];
  const accepted = await autoAcceptLedgerLines([line('t1'), line('t2')], [], w.deps, (item) => failed.push(item.id));
  assert.deepStrictEqual(failed, ['t1']);
  assert.deepStrictEqual(accepted.map((row) => [row.id, row.sessionId]), [['t2', 'session-1']]);
  assert.strictEqual(w.rows.has('t1'), false);
});

test('POST /ingest/orchestrator/retro stores the draft, hands the stored lines to the automatic accept, and answers even when it fails', async (t) => {
  class TokenService extends OrchestratorService {
    override async authenticateMachine(token: string) { return token === 'dock_ing_good' ? 'workspace' : null; }
  }
  const stored = [line('t1'), line('j1', { source: 'judge' })];
  const handed: Array<{ sprint: string; ids: string[] }> = [];
  let fail = false;
  const retroStore = { replaceRetroDraft: async () => stored } as never;
  const retroAuto = async (sprint: string, created: RetroLine[]) => {
    handed.push({ sprint, ids: created.map((item) => item.id) });
    if (fail) throw new Error('boom');
  };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(
    new TokenService(), new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, retroStore,
    undefined, undefined, undefined, undefined, undefined, undefined, retroAuto,
  ));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = () => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/retro`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dock_ing_good' },
    body: JSON.stringify({ sprint: 'S-1', items: [{ kind: 'try', text: 'x', evidence: ['QRD-1'], dest: 'kit' }] }),
  });
  const ok = await post();
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual((await ok.json()).result, { sprint: 'S-1', items: 2 });
  assert.deepStrictEqual(handed, [{ sprint: 'S-1', ids: ['t1', 'j1'] }]);
  fail = true;
  assert.strictEqual((await post()).status, 200, 'a failed automatic accept leaves the lines open and the draft stored');
});
