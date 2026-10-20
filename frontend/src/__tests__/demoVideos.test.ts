import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';
import { demoLinkExample, formatSize, isPlayableVideo, videoSource, viewVideos } from '../lib/demoVideos';

test('the demo videos page is on the workspace DOCK only', () => {
  assert.equal(hasPage('workspace', '/demo-videos'), true);
  assert.equal(hasPage('laptop', '/demo-videos'), false);
});

test('an MP4 link plays on the ticket page, a Loom link stays a link', () => {
  assert.equal(isPlayableVideo('https://kencana.basic.box.cloudeka.id/porto-rzwbgw/demo-qonflo/QRD-1363.mp4'), true);
  assert.equal(isPlayableVideo('https://loom.com/share/abc'), false);
  assert.equal(isPlayableVideo('https://drive.google.com/file/d/abc/view'), false);
  assert.equal(isPlayableVideo(null), false);
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatSize(300), '1 KB');
});

test('the Settings card shows the link a video gets', () => {
  assert.equal(demoLinkExample({ publicBaseUrl: 'https://www.danuseta.my.id/assets/', folder: 'demo-qonflo' }), 'https://www.danuseta.my.id/assets/demo-qonflo/QRD-1234.mp4');
  assert.match(demoLinkExample(null), /<folder>/);
});

test('a video in the bucket reads as S3, an outside link as its host', () => {
  assert.equal(videoSource({ url: 'https://cdn.example.com/demo-qonflo/QRD-1.mp4', size: 1024 }), 'S3');
  assert.equal(videoSource({ url: 'https://www.loom.com/share/abc', size: null }), 'loom.com');
  assert.equal(videoSource({ url: 'not a url', size: null }), 'link');
});

test('the table filters on key or title and sorts with missing values last', () => {
  const videos = [
    { ticketKey: 'QRD-9', url: 'a', size: 10, updatedAt: '2026-10-19T00:00:00Z', title: 'Folder tags' },
    { ticketKey: 'QRD-10', url: 'b', size: null, updatedAt: '2026-10-20T00:00:00Z', title: null },
    { ticketKey: 'QRD-2', url: 'c', size: 30, updatedAt: null, title: 'Inbox socket' },
  ];
  const keys = (list: typeof videos) => list.map((video) => video.ticketKey);
  assert.deepEqual(keys(viewVideos(videos, '', { column: 'uploaded', dir: 'desc' })), ['QRD-10', 'QRD-9', 'QRD-2']);
  assert.deepEqual(keys(viewVideos(videos, '', { column: 'ticket', dir: 'asc' })), ['QRD-2', 'QRD-9', 'QRD-10']);
  assert.deepEqual(keys(viewVideos(videos, '', { column: 'size', dir: 'desc' })), ['QRD-2', 'QRD-9', 'QRD-10']);
  assert.deepEqual(keys(viewVideos(videos, 'folder', { column: 'ticket', dir: 'asc' })), ['QRD-9']);
  assert.deepEqual(keys(viewVideos(videos, 'qrd-1', { column: 'ticket', dir: 'asc' })), ['QRD-10']);
});
