import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { MAX_VISUAL_BYTES, PlanningVisualService, visualSprintSegment, type VisualRow, type VisualStore } from '../integrations/planning-visual';
import { planningIngest, PLANNING_ROUTES, type PlanningIngestDeps } from '../integrations/planning-ingest';
import { OrchestratorInputError } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import { PLANNING_VISUAL_CSP, createPlanningVisualRouter } from '../routes/planning-visual';

class MemoryVisuals implements VisualStore {
  rows = new Map<string, VisualRow>();
  changedAt: Date | null = new Date('2026-11-18T08:00:00Z');
  async sprintDraftChangedAt() { return this.changedAt; }
  async listSprintDraftVisuals(sprint: string) { return [...this.rows.values()].filter((row) => row.sprint === sprint); }
  async getSprintDraftVisual(id: string) { return this.rows.get(id) ?? null; }
  async putSprintDraftVisual(data: Omit<VisualRow, 'saved'>) { this.rows.set(data.id, { ...data, saved: this.rows.get(data.id)?.saved ?? false }); }
  async setSprintDraftVisualSaved(id: string, saved: boolean) { this.rows.set(id, { ...this.rows.get(id)!, saved }); }
  async deleteSprintDraftVisual(id: string) { this.rows.delete(id); }
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dock-visual-'));
  const store = new MemoryVisuals();
  let now = new Date('2026-11-18T09:00:00Z');
  const service = new PlanningVisualService(store, () => root, () => now);
  return { root, store, service, tick: (ms: number) => { now = new Date(now.getTime() + ms); }, done: () => fs.rm(root, { recursive: true, force: true }) };
}

const PAGE = '<!doctype html><title>SP</title><p>Danu 8</p>';

test('a visual is written under <root>/<sprint>/visuals/<id>.html and listed with its url', async () => {
  const { root, service, done } = await setup();
  try {
    const put = await service.put('QRD Sprint 27', { id: 'sp-per-dev', title: ' SP per dev ', html: PAGE, sessionId: 's1' });
    assert.deepEqual(put, { id: 'sp-per-dev', url: '/api/planning-visual/qrd-sprint-27/sp-per-dev.html' });
    assert.equal(await fs.readFile(path.join(root, '.planning-visuals', 'qrd-sprint-27', 'sp-per-dev.html'), 'utf8'), PAGE);
    const [view] = await service.list('QRD Sprint 27');
    assert.deepEqual([view.id, view.title, view.saved, view.stale, view.sessionId], ['sp-per-dev', 'SP per dev', false, false, 's1']);
    assert.match((await service.put('QRD Sprint 27', { title: 'Timeline', html: PAGE })).id, /^v-[0-9a-f]{12}$/, 'an id is made when missing');
  } finally { await done(); }
});

test('a visual turns stale once the draft changes after it was made, and a replace takes a new snapshot', async () => {
  const { store, service, tick, done } = await setup();
  try {
    await service.put('QRD Sprint 27', { id: 'a', title: 'A', html: PAGE });
    assert.equal((await service.list('QRD Sprint 27'))[0].stale, false);
    store.changedAt = new Date('2026-11-18T08:00:00.001Z');
    assert.equal((await service.list('QRD Sprint 27'))[0].stale, true);
    await service.save('QRD Sprint 27', 'a');
    tick(1000);
    await service.put('QRD Sprint 27', { id: 'a', title: 'A again', html: PAGE });
    const [view] = await service.list('QRD Sprint 27');
    assert.deepEqual([view.stale, view.saved, view.title, view.createdAt], [false, true, 'A again', '2026-11-18T09:00:01.000Z']);
  } finally { await done(); }
});

test('put refuses a bad id, a path in the sprint, a missing draft, a bad title, a non-string or oversize html', async () => {
  const { root, store, service, done } = await setup();
  try {
    for (const id of ['../x', 'A', 'a b', 'a.html', 'x'.repeat(41), 7, 'con', 'nul', 'aux', 'prn', 'com1', 'lpt9']) {
      await assert.rejects(service.put('QRD Sprint 27', { id, title: 'T', html: PAGE }), /id must be/, String(id));
    }
    for (const sprint of ['../../etc', 'a/b', 'a\\b', '..', '', '   ', '---', 'x'.repeat(121)]) {
      await assert.rejects(service.put(sprint, { title: 'T', html: PAGE }), /sprint is not a sprint name/, sprint);
    }
    await assert.rejects(service.put(7 as never, { title: 'T', html: PAGE }), /sprint must be a string/);
    await assert.rejects(service.put('QRD Sprint 27', { title: '', html: PAGE }), /title is required/);
    await assert.rejects(service.put('QRD Sprint 27', { title: 'x'.repeat(61), html: PAGE }), /title is required/);
    await assert.rejects(service.put('QRD Sprint 27', { title: 'T', html: 5 }), /html must be a string/);
    await assert.rejects(service.put('QRD Sprint 27', { title: 'T', html: 'x'.repeat(MAX_VISUAL_BYTES + 1) }), /over 2 MB/);
    await service.put('QRD Sprint 27', { title: 'T', html: 'x'.repeat(MAX_VISUAL_BYTES) });
    store.changedAt = null;
    await assert.rejects(service.put('QRD Sprint 99', { title: 'T', html: PAGE }), /No draft for QRD Sprint 99/);
    assert.deepEqual(await fs.readdir(root), ['.planning-visuals'], 'a refused put writes nothing outside the sprint folder');
    assert.equal(visualSprintSegment('QRD Sprint 27'), 'qrd-sprint-27');
  } finally { await done(); }
});

test('an id of another sprint is refused, and a sprint holds at most 30 visuals', async () => {
  const { service, done } = await setup();
  try {
    await service.put('Sprint 1', { id: 'shared', title: 'T', html: PAGE });
    await assert.rejects(service.put('Sprint 2', { id: 'shared', title: 'T', html: PAGE }), /belongs to another sprint/);
    await assert.rejects(service.remove('Sprint 2', 'shared'), /No visual shared in Sprint 2/);
    await assert.rejects(service.save('Sprint 2', 'shared'), /No visual shared in Sprint 2/);
    for (let index = 0; index < 29; index += 1) await service.put('Sprint 1', { id: `v${index}`, title: 'T', html: PAGE });
    await assert.rejects(service.put('Sprint 1', { id: 'one-more', title: 'T', html: PAGE }), /at most 30 visuals/);
    await service.put('Sprint 1', { id: 'v1', title: 'replace is fine', html: PAGE });
  } finally { await done(); }
});

test('rm deletes the file and the row, and saved visuals survive the publish cleanup', async () => {
  const { root, service, done } = await setup();
  try {
    await service.put('QRD Sprint 27', { id: 'keep', title: 'Keep', html: PAGE });
    await service.put('QRD Sprint 27', { id: 'toss', title: 'Toss', html: PAGE });
    await service.put('QRD Sprint 27', { id: 'gone', title: 'Gone', html: PAGE });
    await service.save('QRD Sprint 27', 'keep');
    assert.deepEqual(await service.remove('QRD Sprint 27', 'gone'), { id: 'gone' });
    await service.remove('QRD Sprint 27', 'gone');
    assert.equal(await service.dropUnsaved('QRD Sprint 27'), 1);
    assert.deepEqual((await service.list('QRD Sprint 27')).map((view) => view.id), ['keep']);
    assert.deepEqual(await fs.readdir(path.join(root, '.planning-visuals', 'qrd-sprint-27')), ['keep.html']);
    assert.deepEqual((await service.drop('QRD Sprint 27', 'keep')), []);
  } finally { await done(); }
});

test('the ingest route puts and removes visuals and refuses a bad action', async () => {
  const { service, done } = await setup();
  try {
    assert.ok((PLANNING_ROUTES as readonly string[]).includes('sprint-draft/visual'));
    const deps = { visuals: service } as unknown as PlanningIngestDeps;
    const put = await planningIngest(deps, 'sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', id: 'a', title: 'A', html: PAGE }) as { id: string };
    assert.equal(put.id, 'a');
    await assert.rejects(planningIngest(deps, 'sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', id: '../a', title: 'A', html: PAGE }), (error: unknown) => error instanceof Error && /id must be/.test(error.message));
    await assert.rejects(planningIngest(deps, 'sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'zap' }), /action must be/);
    await assert.rejects(planningIngest(deps, 'sprint-draft/visual', { sprint: '../..', action: 'rm', id: 'a' }), /sprint is not a sprint name/);
    assert.deepEqual(await planningIngest(deps, 'sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'rm', id: 'a' }), { id: 'a' });
    await assert.rejects(planningIngest({} as PlanningIngestDeps, 'sprint-draft/visual', { sprint: 'S', action: 'rm', id: 'a' }), OrchestratorInputError);
  } finally { await done(); }
});

test('the ingest endpoint takes a 2 MB visual while the other planning routes keep their small limit', async () => {
  const { service, done } = await setup();
  const deps = { drafts: { view: async () => null }, visuals: service } as unknown as PlanningIngestDeps;
  const ingest = { authenticateMachine: async (token: string) => (token === 'dock_ing_token' ? 'workspace' : null) };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(ingest as never, new PinRateLimiter(50, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, undefined, undefined, deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ingest/orchestrator`;
  const post = (route: string, body: unknown) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dock_ing_token' }, body: JSON.stringify(body) });
  try {
    const big = 'x'.repeat(1_000_000);
    const ok = await post('sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', id: 'big', title: 'Big', html: big });
    assert.equal(ok.status, 200);
    const quotes = await post('sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', id: 'quotes', title: 'Quotes', html: '"'.repeat(1_200_000) });
    assert.equal(quotes.status, 200, 'JSON escaping of a large page does not hit the parser limit');
    assert.equal((await post('sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', title: 'Over', html: 'x'.repeat(MAX_VISUAL_BYTES + 10) })).status, 400, 'over 2 MB of html is refused by the service');
    assert.equal((await post('sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', title: 'Huge', html: 'x'.repeat(3 * 1024 * 1024 + 10) })).status, 413);
    assert.equal((await post('sprint-draft/get', { sprint: 'QRD Sprint 27', pad: big })).status, 413);
    const bad = await post('sprint-draft/visual', { sprint: 'QRD Sprint 27', action: 'put', id: '../x', title: 'T', html: PAGE });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await done();
  }
});

test('route: serves a visual behind the unlock check with the storyboard CSP, refuses writes, traversal and odd names', async () => {
  const { service, done } = await setup();
  await service.put('QRD Sprint 27', { id: 'sp-per-dev', title: 'SP', html: PAGE });
  let unlocked = true;
  const app = express();
  app.use('/api/planning-visual', createPlanningVisualRouter({ reader: service, authorize: async () => unlocked }));
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/planning-visual`;
  const raw = (target: string) => new Promise<number>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/planning-visual${target}` }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }).on('error', reject);
  });
  try {
    const page = await fetch(`${base}/qrd-sprint-27/sp-per-dev.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(page.headers.get('content-security-policy'), PLANNING_VISUAL_CSP);
    assert.match(PLANNING_VISUAL_CSP, /connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'$/);
    assert.doesNotMatch(PLANNING_VISUAL_CSP, /fonts\.g/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await page.text(), PAGE);
    assert.equal((await fetch(`${base}/qrd-sprint-27/sp-per-dev.html`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/qrd-sprint-27/sp-per-dev.html`, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(`${base}/qrd-sprint-27/nope.html`)).status, 404);
    assert.equal((await fetch(`${base}/qrd-sprint-27/sp-per-dev.txt`)).status, 400);
    assert.equal((await fetch(`${base}/QRD-Sprint-27/sp-per-dev.html`)).status, 400);
    assert.equal(await raw('/..%2f..%2fetc/sp-per-dev.html'), 400);
    assert.equal(await raw('/qrd-sprint-27/..%2fsp-per-dev.html'), 400);
    unlocked = false;
    assert.equal((await fetch(`${base}/qrd-sprint-27/sp-per-dev.html`)).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await done();
  }
});

test('a failed row write removes the file of a new id, and files in the folder count toward the cap', async () => {
  const { root, store, service, done } = await setup();
  try {
    const write = store.putSprintDraftVisual.bind(store);
    store.putSprintDraftVisual = async () => { throw new Error('db down'); };
    await assert.rejects(service.put('Sprint 1', { id: 'new-one', title: 'T', html: PAGE }), /db down/);
    assert.deepEqual(await fs.readdir(path.join(root, '.planning-visuals', 'sprint-1')), []);
    store.putSprintDraftVisual = write;
    await fs.mkdir(path.join(root, '.planning-visuals', 'sprint-1'), { recursive: true });
    for (let index = 0; index < 30; index += 1) await fs.writeFile(path.join(root, '.planning-visuals', 'sprint-1', `orphan-${index}.html`), PAGE);
    await assert.rejects(service.put('Sprint 1', { id: 'late', title: 'T', html: PAGE }), /at most 30 visuals/);
  } finally { await done(); }
});
