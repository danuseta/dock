import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopyButton } from '../chat/CopyButton';

test('the Copy button writes the raw markdown to the clipboard', async () => {
  const markdown = '## Result\n\n- **one**\n- `two`';
  const written: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { written.push(text); } } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 0, clearTimeout: () => undefined } });
  let click: () => void = () => undefined;
  const Probe: React.FC = () => {
    const button = (CopyButton as unknown as (props: { text: string }) => React.ReactElement<{ onClick: () => void }>)({ text: markdown });
    click = button.props.onClick;
    return button;
  };
  const html = renderToStaticMarkup(<Probe />);
  assert.match(html, />Copy</);
  click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(written, [markdown]);
});
