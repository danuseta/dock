import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { planningChatPrompt, planningChatTitle, planningIngest, type PlanningIngestDeps } from '../integrations/planning-ingest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SprintInputError } from '../integrations/sprint-dashboard';
import { OrchestratorInputError } from '../integrations/orchestrator';
import type { DraftView } from '../integrations/sprint-draft';
import { StoryboardMissing } from '../integrations/storyboard';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';

function fakes() {
  const calls: unknown[][] = [];
  const view = { sprint: 'QRD Sprint 27', tickets: [{ key: 'QRD-1312', merged: false }, { key: 'QRD-1300', merged: true }], questions: [], newTickets: [{ id: 'NEW-1', summary: '[BE] Export' }] } as unknown as DraftView;
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
      saveNewTicket: async (sprint, id, input) => {
        calls.push(['new', sprint, id, input]);
        if (id === 'NEW-9') throw new SprintInputError('NEW-9 is not a new ticket of the QRD Sprint 27 draft');
        return { id: id ?? 'NEW-1', view };
      },
      removeNewTicket: async (sprint, id) => { calls.push(['rm', sprint, id]); return view; },
    },
    storyboards: {
      sync: async (epic) => {
        if (epic === 'QRD-1') throw new StoryboardMissing('No Confluence page titled "Storyboard" for QRD-1.');
        return { epic, version: 8, previous: 7, path: '/b/v8.html', page: '11', frames: [{ id: 'F7.3', text: 'Stop serving' }], changed: ['F7.3'] };
      },
    },
    summaries: {
      hashes: async (keys) => Object.fromEntries(keys.map((key) => [key, 'abc'])),
      write: async (sprint, body) => {
        calls.push(['summary', sprint, (body as { key: string }).key]);
        if ((body as { acHash?: string }).acHash !== 'abc') throw new SprintInputError('The AC of QRD-1312 changed since this summary was written');
        return body as never;
      },
    },
  };
  return { deps, calls, view };
}

test('the planning routes read and change the draft and turn the planner errors into 400s', async () => {
  const { deps, calls, view } = fakes();
  assert.deepEqual(await planningIngest(deps, 'sprint-draft/get', { sprint: 'QRD Sprint 27' }), { ...view, tickets: [view.tickets[0]], summaries: { 'QRD-1312': 'abc' } }, 'the agent plans only the cards still to build, and sees which summaries it wrote');
  await planningIngest(deps, 'sprint-draft/summary', { sprint: 'QRD Sprint 27', key: 'QRD-1312', acHash: 'abc' });
  assert.deepEqual(calls.at(-1), ['summary', 'QRD Sprint 27', 'QRD-1312']);
  await assert.rejects(planningIngest(deps, 'sprint-draft/summary', { sprint: 'QRD Sprint 27', key: 'QRD-1312', acHash: 'old' }), (error: unknown) => error instanceof OrchestratorInputError && /changed since this summary/.test(error.message));
  await assert.rejects(planningIngest(deps, 'sprint-draft/get', { sprint: 'QRD Sprint 9' }), /No draft for QRD Sprint 9/);
  const visuals = { put: async () => ({ id: 'x', url: '' }), remove: async () => ({ id: 'x' }), list: async () => [{ id: 'timeline-dev', title: 'Timeline per dev', createdAt: '', saved: false, stale: true, url: '/x', sessionId: null }] };
  const listed = await planningIngest({ ...deps, visuals } as never, 'sprint-draft/get', { sprint: 'QRD Sprint 27' }) as { visuals: unknown };
  assert.deepEqual(listed.visuals, [{ id: 'timeline-dev', title: 'Timeline per dev', saved: false, stale: true }], 'get lists the visuals so the agent can check its put');
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

test('sprint-draft/new creates, updates and removes a drafted ticket, and get lists the new tickets', async () => {
  const { deps, calls } = fakes();
  const got = await planningIngest(deps, 'sprint-draft/get', { sprint: 'QRD Sprint 27' }) as DraftView;
  assert.deepEqual(got.newTickets, [{ id: 'NEW-1', summary: '[BE] Export' }]);
  assert.deepEqual(await planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', ticket: { summary: '[BE] Export', source: 'sheet row 2' } }), { id: 'NEW-1', ticket: { id: 'NEW-1', summary: '[BE] Export' } });
  assert.deepEqual(calls.at(-1), ['new', 'QRD Sprint 27', null, { summary: '[BE] Export', source: 'sheet row 2' }]);
  await planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', id: 'new-1', ticket: { sp: 3 } });
  assert.deepEqual(calls.at(-1), ['new', 'QRD Sprint 27', 'NEW-1', { sp: 3 }]);
  assert.deepEqual(await planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', id: 'NEW-1', remove: true }), { removed: 'NEW-1' });
  assert.deepEqual(calls.at(-1), ['rm', 'QRD Sprint 27', 'NEW-1']);
  await assert.rejects(planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', remove: true }), /id is required/);
  await assert.rejects(planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', ticket: 'x' }), /ticket must be an object/);
  await assert.rejects(planningIngest(deps, 'sprint-draft/new', { sprint: 'QRD Sprint 27', id: 'NEW-9', ticket: {} }), (error: unknown) => error instanceof OrchestratorInputError && /NEW-9 is not a new ticket/.test(error.message));
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
    const created = await post('sprint-draft/new', { sprint: 'QRD Sprint 27', ticket: { summary: '[BE] Export' } });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).result.id, 'NEW-1');
    const missing = await post('storyboard', { epic: 'QRD-1' });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /Storyboard/);
    assert.equal((await post('sprint-draft/get', { sprint: 'QRD Sprint 27' }, 'wrong')).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the sprint-planner prompt names the sprint and its epics, and opening the Planning chat sends no message', () => {
  assert.equal(planningChatTitle('QRD Sprint 27'), 'Planning-QRD Sprint 27');
  const prompt = planningChatPrompt('QRD Sprint 27', ['QRD-1300', 'QRD-1233', 'QRD-1233']);
  assert.equal(prompt.split('\n')[0], 'Pakai skill sprint-planner: QRD Sprint 27 epic QRD-1233, QRD-1300');
  assert.match(prompt, /^Sprint: QRD Sprint 27$/m);
  assert.match(prompt, /^Epic: QRD-1233, QRD-1300$/m);
  assert.equal(planningChatPrompt('QRD Sprint 27', []).split('\n')[0], 'Pakai skill sprint-planner: QRD Sprint 27');
  const resolvers = readFileSync(path.join(__dirname, '../resolvers/index.ts'), 'utf8');
  const opener = /openPlanningChat: async[\s\S]*?\n {4}\},/.exec(resolvers.replace(/\r\n/g, '\n'))![0];
  assert.match(opener, /openSousSession\(planningChatTitle\(name\)\)/);
  assert.doesNotMatch(opener, /sendMessage|runSousPrompt|planningChatPrompt/, 'opening the chat sends nothing');
  assert.match(resolvers, /planningChatPrompt: \(_: unknown, \{ sprint \}: \{ sprint: string \}\) => planningPrompt\(sprint\)/);
});
