import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleSearch } from '../components/GoogleSearch';

test('Google search uses the native query contract and receives initial focus', () => {
  const markup = renderToStaticMarkup(<GoogleSearch />);

  assert.match(markup, /action="https:\/\/www\.google\.com\/search"/);
  assert.match(markup, /role="search"/);
  assert.match(markup, /name="q"/);
  assert.match(markup, /type="search"/);
  assert.match(markup, /autoFocus=""|autofocus=""/i);
  assert.match(markup, /required=""/);
});
