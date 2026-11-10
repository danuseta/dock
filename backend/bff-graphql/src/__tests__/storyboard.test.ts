import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ConfluenceAttachment, ConfluencePage } from '../integrations/confluence';
import { MAX_STORYBOARD_BYTES, StoryboardMissing, StoryboardReader, StoryboardRefused, framesIn, versionsOf, type StoryboardClient } from '../integrations/storyboard';
import { STORYBOARD_CSP, createStoryboardRouter } from '../routes/storyboard';

const flow = (id: string, tickets: string, frames: string) => `{id:'${id}',kind:'major',title:'Flow ${id}',tickets:'${tickets}',info:['awal','langkah','hasil'],frames:[${frames}]}`;
const board = (flows: string[]) => `<html><body><script>
const FLOWS=[${flows.join(',\n')}];
const GROUPS=[{id:'G',title:'Share',flows:[${flows.map((item) => `'${/id:'([^']+)'/.exec(item)![1]}'`).join(',')}]}];
const SCENARIOS=[{n:1,title:'Organise',flows:FLOWS,groups:GROUPS}];
</script></body></html>`;
const V1 = board([
  flow('F7.3', 'QRD-1312', "{t:'Stop serving',s:()=>dlg({a:1}),step:'Stop serving this skill?'}"),
  flow('F10.1', '', "{t:'Share',step:'Share at Edit level'}"),
]);
const V2 = board([
  flow('F7.3', 'QRD-1312', "{t:'Stop serving',s:()=>dlg({a:1}),step:'Stop serving this skill for Acme Corp?'}"),
  flow('F7.4', 'QRD-1400 · QRD-1401', "{t:'Undo',step:'Undo stop'}"),
  flow('F10.1', '', "{t:'Share',step:'Share at Edit level'}"),
]);

test('flow ids named in a text keep their letter', () => {
  assert.deepEqual(framesIn(['Builds F7.3 and f7.4', 'See F10.1, F7.3', 'Branch F1.1b and F1.4g']), ['F1.1b', 'F1.4g', 'F7.3', 'F10.1']);
});

test('versions come from v<N>.html names, else from the attachment version of the one HTML file', () => {
  const att = (title: string, version = 1): ConfluenceAttachment => ({ id: title, title, version, mediaType: title.endsWith('.png') ? 'image/png' : 'text/html', download: `/download/${title}` });
  assert.deepEqual(versionsOf([att('v2.html'), att('notes.png'), att('storyboard-v1.html')]).map((item) => item.version), [1, 2]);
  assert.deepEqual(versionsOf([att('storyboard.html', 8)]).map((item) => item.version), [8]);
  assert.deepEqual(versionsOf([att('notes.png')]), []);
});

test('sync finds the page under the contract, saves each version under the blackboard and diffs the newest two by flow', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dock-storyboard-'));
  try {
    const page = (id: string, title: string): ConfluencePage => ({ id, title, version: 1, spaceKey: 'QRD' });
    const cql: string[] = [];
    let attachments: ConfluenceAttachment[] = [{ id: 'a1', title: 'v1.html', version: 1, mediaType: 'text/html', download: '/download/v1.html' }];
    const bodies: Record<string, string> = { '/download/v1.html': V1, '/download/v2.html': V2 };
    const downloads: string[] = [];
    const client: StoryboardClient = {
      search: async (query) => { cql.push(query); return query.includes('contract') ? [page('10', 'QRD-1233 working contract')] : []; },
      children: async () => [page('11', 'Storyboard')],
      attachments: async () => attachments,
      download: async (link) => { downloads.push(link); return bodies[link]; },
    };
    const reader = new StoryboardReader(async () => client, () => root);
    const first = await reader.sync('qrd-1233');
    assert.equal(first.version, 1);
    assert.deepEqual(first.changed, []);
    assert.deepEqual(first.frames.map((frame) => frame.id), ['F7.3/1', 'F10.1/1']);
    assert.equal(first.path, path.join(root, 'QRD-1233', 'materials', 'storyboard', 'v1.html'));
    assert.match(cql[0], /title ~ "contract" AND text ~ "QRD-1233"/);

    attachments = [...attachments, { id: 'a2', title: 'v2.html', version: 1, mediaType: 'text/html', download: '/download/v2.html' }];
    const second = await reader.sync('QRD-1233');
    assert.deepEqual([second.version, second.previous, second.changed], [2, 1, ['F7.3', 'F7.4']]);
    assert.deepEqual(second.tickets, { 'F7.3': ['QRD-1312'], 'F7.4': ['QRD-1400', 'QRD-1401'] });
    const flows = second.scenarios![0].groups[0].flows;
    assert.deepEqual(flows.map((item) => [item.id, item.changed]), [['F7.3', true], ['F7.4', true], ['F10.1', false]]);
    assert.deepEqual(flows[0].frames, [{ index: 0, title: 'Stop serving', step: 'Stop serving this skill for Acme Corp?', changed: true }]);
    assert.deepEqual(downloads, ['/download/v1.html', '/download/v2.html'], 'a saved version is not fetched again');
    assert.equal(await readFile(second.path, 'utf8'), V2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('no Storyboard page or no HTML attachment says what to add', async () => {
  const empty: StoryboardClient = { search: async () => [], children: async () => [], attachments: async () => [], download: async () => '' };
  const root = await mkdtemp(path.join(os.tmpdir(), 'dock-storyboard-'));
  try {
    const reader = new StoryboardReader(async () => empty, () => root);
    await assert.rejects(reader.sync('QRD-1233'), (error: unknown) => error instanceof StoryboardMissing && /No Confluence page titled "Storyboard" for QRD-1233/.test(error.message));
    const noHtml: StoryboardClient = { ...empty, search: async () => [{ id: '11', title: 'Storyboard', version: 1, spaceKey: 'QRD' }] };
    await assert.rejects(new StoryboardReader(async () => noHtml, () => root).sync('QRD-1233'), /has no HTML attachment/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an upload is saved as v<seconds>.html, refused without SCENARIOS or over 8 MB, and stands in when Confluence has no page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dock-storyboard-'));
  try {
    let now = new Date('2026-11-10T08:00:00Z');
    const offline = async (): Promise<StoryboardClient> => { throw new Error('Jira credentials are not configured in Settings'); };
    const reader = new StoryboardReader(offline, () => root, () => now);
    await assert.rejects(reader.sync('QRD-1233'), /Jira credentials are not configured/);
    await assert.rejects(reader.upload('QRD-1233', '<html>nothing here</html>'), (error: unknown) => error instanceof StoryboardRefused && /no SCENARIOS list/.test(error.message));
    await assert.rejects(reader.upload('QRD-1233', `SCENARIOS${' '.repeat(MAX_STORYBOARD_BYTES)}`), /larger than 8 MB/);
    await assert.rejects(reader.upload('../etc', V1), StoryboardMissing);

    const first = await reader.upload('qrd-1233', V1);
    const seconds = Math.floor(now.getTime() / 1000);
    assert.deepEqual([first.version, first.previous, first.changed, first.page], [seconds, null, [], null]);
    now = new Date(now.getTime() + 500);
    const second = await reader.upload('QRD-1233', V2);
    assert.deepEqual([second.version, second.previous, second.changed], [seconds + 1, seconds, ['F7.3', 'F7.4']], 'two uploads in one second still get their own version');
    assert.deepEqual(await readdir(reader.dir('QRD-1233')), [`v${seconds}.html`, `v${seconds + 1}.html`]);
    assert.deepEqual((await reader.sync('QRD-1233')).changed, ['F7.3', 'F7.4'], 'Confluence down: the uploaded versions are compared');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('route: serves a saved version behind the unlock check with the storyboard CSP, refuses traversal and odd names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dock-storyboard-'));
  const reader = new StoryboardReader(async () => { throw new Error('offline'); }, () => root, () => new Date('2026-11-10T08:00:00Z'));
  const saved = await reader.upload('QRD-1233', V1);
  let unlocked = true;
  const app = express();
  app.use('/api/storyboard', createStoryboardRouter({ reader, authorize: async () => unlocked }));
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/storyboard`;
  // Sent as written: fetch would resolve the dot segments before they reach the route.
  const raw = (target: string) => new Promise<number>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/storyboard${target}` }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }).on('error', reject);
  });
  try {
    const page = await fetch(`${base}/QRD-1233/v${saved.version}.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(page.headers.get('content-security-policy'), STORYBOARD_CSP);
    assert.match(STORYBOARD_CSP, /connect-src 'none'/);
    assert.match(STORYBOARD_CSP, /^sandbox allow-scripts;/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await page.text(), V1);
    assert.equal((await fetch(`${base}/QRD-1233/v1.html`)).status, 404);
    assert.equal(await raw('/QRD-1233/%2E%2E%2Fsecret.html'), 400);
    assert.equal(await raw(`/%2E%2E/v${saved.version}.html`), 400);
    assert.equal(await raw(`/QRD-1233/..%2Fv${saved.version}.html`), 400);
    assert.equal((await fetch(`${base}/QRD-1233/vlatest.html`)).status, 400);
    assert.equal((await fetch(`${base}/QRD-1233/v1.htm`)).status, 400);
    assert.equal((await fetch(`${base}/qrd-1233/v${saved.version}.html`)).status, 400);
    assert.equal((await fetch(`${base}/QRD-1233/v${saved.version}.html`, { method: 'POST' })).status, 405);
    unlocked = false;
    assert.equal((await fetch(`${base}/QRD-1233/v${saved.version}.html`)).status, 401);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
