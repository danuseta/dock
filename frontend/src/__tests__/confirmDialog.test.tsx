import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

const noop = () => undefined;

test('the confirm dialog names its title and description for screen readers', () => {
  const markup = renderToStaticMarkup(<ConfirmDialog open title="Stop all dev servers?" description="Every main app stops." confirmLabel="Stop all" onConfirm={noop} onCancel={noop} />);
  const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
  const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
  assert.ok(labelledBy && describedBy);
  assert.match(markup, new RegExp(`id="${labelledBy}"[^>]*>Stop all dev servers\\?<`));
  assert.match(markup, new RegExp(`id="${describedBy}"[^>]*>Every main app stops.<`));
  assert.match(markup, />Cancel</);
  assert.match(markup, />Stop all</);
});

test('while the action runs, both buttons are disabled and the busy label shows', () => {
  const markup = renderToStaticMarkup(<ConfirmDialog open busy title="Delete?" description="Gone." confirmLabel="Delete" busyLabel="Deleting..." onConfirm={noop} onCancel={noop} />);
  assert.match(markup, />Deleting\.\.\.</);
  assert.strictEqual(markup.match(/disabled=""/g)?.length, 2);
});
