import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PluginsSection } from '../settings/sections/PluginsSection';

const noop = () => undefined;
const render = (storagePlugin: string, voicePlugin: string) => renderToStaticMarkup(
  <PluginsSection values={{ storagePlugin, voicePlugin, storageLocalDir: '' }} set={noop} s3Fields={<p>S3 fields</p>} voiceKeys={<p>Voice keys</p>} />,
);

test('none shows the notes and hides the S3 fields and the ElevenLabs keys', () => {
  const html = render('none', 'none');
  assert.match(html, /Demo video upload is hidden; videos stay in the evidence folder\./);
  assert.match(html, /recorded without narration/);
  assert.match(html, /Claude Code, not a plugin/);
  assert.doesNotMatch(html, /S3 fields|Voice keys/);
});

test('S3 and ElevenLabs show their own fields, Local folder shows its path field', () => {
  assert.match(render('s3', 'elevenlabs'), /S3 fields.*Voice keys|Voice keys.*S3 fields/);
  assert.match(render('local', 'none'), /aria-label="Local folder"/);
  assert.doesNotMatch(render('local', 'none'), /S3 fields/);
});
