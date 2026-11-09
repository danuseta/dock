import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ConfluenceAttachment, ConfluencePage } from '../integrations/confluence';
import { StoryboardMissing, StoryboardReader, changedFrames, extractFrames, framesIn, versionsOf, type StoryboardClient } from '../integrations/storyboard';

const V1 = `<html><head><style>.x{color:red}</style></head><body><div id="root"></div><script>
const FRAMES = [
  { id: "F5.2", title: "Presence", body: "Tooltip names the version \\"v7\\" that is open" },
  { id: "F7.3", title: "Stop serving", body: "Dialog: Stop serving this skill?" },
  { id: "F10.1", title: "Share", body: "Share at Edit level &amp; View level" },
];
</script></body></html>`;
const V2 = V1.replace('Stop serving this skill?', 'Stop serving this skill for Acme Corp?').replace('{ id: "F10.1"', '{ id: "F7.4", title: "Undo", body: "Undo stop" },\n  { id: "F10.1"');

test('frames are read from the artifact source with their text, in frame order', () => {
  const frames = extractFrames(V1);
  assert.deepEqual(frames.map((frame) => frame.id), ['F5.2', 'F7.3', 'F10.1']);
  assert.match(frames[0].text, /Tooltip names the version "v7" that is open/);
  assert.match(frames[2].text, /Share at Edit level & View level/);
  assert.doesNotMatch(frames[0].text, /color:red/);
});

test('a reworded frame and a new one are the changes between versions', () => {
  assert.deepEqual(changedFrames(extractFrames(V1), extractFrames(V2)), ['F7.3', 'F7.4']);
  assert.deepEqual(changedFrames(extractFrames(V1), extractFrames(V1)), []);
  assert.deepEqual(framesIn(['Builds F7.3 and f7.4', 'See F10.1, F7.3']), ['F7.3', 'F10.1']);
});

test('versions come from v<N>.html names, else from the attachment version of the one HTML file', () => {
  const att = (title: string, version = 1): ConfluenceAttachment => ({ id: title, title, version, mediaType: title.endsWith('.png') ? 'image/png' : 'text/html', download: `/download/${title}` });
  assert.deepEqual(versionsOf([att('v2.html'), att('notes.png'), att('storyboard-v1.html')]).map((item) => item.version), [1, 2]);
  assert.deepEqual(versionsOf([att('storyboard.html', 8)]).map((item) => item.version), [8]);
  assert.deepEqual(versionsOf([att('notes.png')]), []);
});

test('sync finds the page under the contract, saves each version under the blackboard and diffs the newest two', async () => {
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
    assert.equal(first.path, path.join(root, 'QRD-1233', 'materials', 'storyboard', 'v1.html'));
    assert.match(cql[0], /title ~ "contract" AND text ~ "QRD-1233"/);

    attachments = [...attachments, { id: 'a2', title: 'v2.html', version: 1, mediaType: 'text/html', download: '/download/v2.html' }];
    const second = await reader.sync('QRD-1233');
    assert.deepEqual([second.version, second.previous, second.changed], [2, 1, ['F7.3', 'F7.4']]);
    assert.deepEqual(downloads, ['/download/v1.html', '/download/v2.html'], 'a saved version is not fetched again');
    assert.equal(await readFile(second.path, 'utf8'), V2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('no Storyboard page or no HTML attachment says what to add', async () => {
  const empty: StoryboardClient = { search: async () => [], children: async () => [], attachments: async () => [], download: async () => '' };
  const reader = new StoryboardReader(async () => empty, () => os.tmpdir());
  await assert.rejects(reader.sync('QRD-1233'), (error: unknown) => error instanceof StoryboardMissing && /No Confluence page titled "Storyboard" for QRD-1233/.test(error.message));
  const noHtml: StoryboardClient = { ...empty, search: async () => [{ id: '11', title: 'Storyboard', version: 1, spaceKey: 'QRD' }] };
  await assert.rejects(new StoryboardReader(async () => noHtml, () => os.tmpdir()).sync('QRD-1233'), /has no HTML attachment/);
});
