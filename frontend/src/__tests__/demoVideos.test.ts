import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPage } from '../lib/dockMode';
import { demoLinkExample, formatSize, isPlayableVideo } from '../lib/demoVideos';

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
