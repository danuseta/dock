import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveBar } from '../settings/SettingsParts';

const noop = () => undefined;
const render = (props: Partial<React.ComponentProps<typeof SaveBar>> = {}) => renderToStaticMarkup(
  <SaveBar section="General" changes={0} errors={[]} saving={false} outcome={null} onSave={noop} onDiscard={noop} {...props} />,
);

test('a clean section shows no buttons', () => {
  assert.doesNotMatch(render(), /<button/);
});

test('a changed section shows Discard and Save with the section name', () => {
  const markup = render({ changes: 2 });
  assert.match(markup, />Discard</);
  assert.match(markup, />Save General</);
  assert.match(markup, /2 changes/);
});

test('a field error disables Save', () => {
  assert.match(render({ changes: 1, errors: ['bad'] }), /disabled=""[^>]*>.*Save General/);
});

test('saving hides Discard and disables Save', () => {
  const markup = render({ changes: 1, saving: true });
  assert.doesNotMatch(markup, />Discard</);
  assert.match(markup, /disabled=""/);
});

test('the outcome message shows after a save', () => {
  assert.match(render({ outcome: { ok: true, message: 'Saved.' } }), />Saved\.</);
});
