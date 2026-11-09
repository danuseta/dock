import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { planningIngest, type PlanningIngestDeps } from '../integrations/planning-ingest';
import { SprintInputError } from '../integrations/sprint-dashboard';
import type { DraftView } from '../integrations/sprint-draft';
import { StoryboardMissing } from '../integrations/storyboard';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';

function fakes() {
  const calls: unknown[][] = [];
  const view = { sprint: 'QRD Sprint 27', tickets: [], questions: [] } as unknown as DraftView;
  const deps: PlanningIngestDeps = {
    drafts: {
      view: async (sprint) => (sprint === 'QRD Sprint 27' ? view : null),
      updateTicket: async (sprint, key, change) => {
        calls.push(['update', sprint, key, change]);
        if (key === 'QRD-404') throw new SprintInputError('QRD-404 is not in the QRD Sprint 27 draft');
        return view;
      },
      ask: async (sprint, text, key) => { calls.push(['ask', sprint, text, key]); return view; },
      setTcs: async (sprint, key, tcs) => { calls.push(['tc', sprint, key, tcs]); return view; },
      applyStoryboard: async (result) => { calls.push(['apply', result.epic, result.version]); return ['QRD Sprint 27']; },
    },
    storyboards: {
      sync: async (epic) => {
        if (epic === 'QRD-1') throw new StoryboardMissing('No Confluence page titled "Storyboard" for QRD-1.');
        return { epic, version: 8, previous: 7, path: '/b/v8.html', page: '11', frames: [{ id: 'F7.3', text: 'Stop serving' }], changed: ['F7.3'] };
      },
    },
  };
  return { deps, calls, view };
}

test('the planning routes read and change the draft and turn the planner errors into 400s', async () => {
  const { deps, calls, view } = fakes();
  assert.equal(await planningIngest(deps, 'sprint-draft/get', { sprint: 'QRD Sprint 27' }), view);
  await assert.rejects(planningIngest(deps, 'sprint-draft/get', { sprint: 'QRD Sprint 9' }), /No draft for QRD Sprint 9/);
  await planningIngest(deps, 'sprint-draft/update', { sprint: 'QRD Sprint 27', key: 'qrd-1312', dev: 'Aken', wave: 2, sp: 3, ac: ['One', 'Two'] });
  assert.deepEqual(calls.at(-1), ['update', 'QRD Sprint 27', 'QRD-1312', { dev: 'Aken', wave: 2, sp: 3, ac: ['One', 'Two'] }]);
  await planningIngest(deps, 'sprint-draft/update', { sprint: 'QRD Sprint 27', key: 'QRD-1312', dev: null });
  assert.deepEqual(calls.at(-1), ['update', 'QRD Sprint 27', 'QRD-1312', { dev: null }]);
  await assert.rejects(planningIngest(deps, 'sprint-draft/update', { sprint: 'QRD Sprint 27', key: 'QRD-1312', ac: 'One' }), /ac must be an array of strings/);
  await assert.rejects(planningIngest(deps, 'sprint-draft/update', { sprint: 'QRD Sprint 27', key: 'QRD-404' }), /not in the QRD Sprint 27 draft/);
  await planningIngest(deps, 'sprint-draft/question', { sprint: 'QRD Sprint 27', text: 'Both tabs or the last?', key: 'QRD-1312' });
  assert.deepEqual(calls.at(-1), ['ask', 'QRD Sprint 27', 'Both tabs or the last?', 'QRD-1312']);
  assert.deepEqual(await planningIngest(deps, 'storyboard', { epic: 'QRD-1233' }), { version: 8, path: '/b/v8.html', frames: [{ id: 'F7.3', text: 'Stop serving' }], changed: ['F7.3'] });
  assert.deepEqual(calls.at(-1), ['apply', 'QRD-1233', 8]);
  await assert.rejects(planningIngest(deps, 'storyboard', { epic: 'QRD-1' }), /No Confluence page titled "Storyboard"/);
});

test('the routes sit behind the ingest token and answer {result}', async () => {
  const { deps } = fakes();
  const service = { authenticateMachine: async (token: string) => (token === 'dock_ing_token' ? 'workspace' : null) };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service as never, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, undefined, undefined, deps));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (route: string, body: unknown, token = 'dock_ing_token') => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    const ok = await post('sprint-draft/get', { sprint: 'QRD Sprint 27' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.sprint, 'QRD Sprint 27');
    const missing = await post('storyboard', { epic: 'QRD-1' });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /Storyboard/);
    assert.equal((await post('sprint-draft/get', { sprint: 'QRD Sprint 27' }, 'wrong')).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
