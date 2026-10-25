import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetPinScreen } from '../components/SetPinScreen';
import { needsSetPin, pinStepOutcome } from '../lib/setPin';

test('only a workspace DOCK without a master PIN asks for one', () => {
  assert.strictEqual(needsSetPin('workspace', false), true);
  assert.strictEqual(needsSetPin('workspace', true), false);
  assert.strictEqual(needsSetPin('laptop', false), false);
  assert.strictEqual(needsSetPin('laptop', true), false);
});

test('the PIN needs 4 digits, a confirmation, and a match before it saves', () => {
  assert.strictEqual(pinStepOutcome('', '123'), 'short');
  assert.strictEqual(pinStepOutcome('', '1234'), 'confirm');
  assert.strictEqual(pinStepOutcome('1234', '1234'), 'save');
  assert.strictEqual(pinStepOutcome('1234', '4321'), 'mismatch');
});

test('the Set PIN screen shows its title and the first step', () => {
  const markup = renderToStaticMarkup(<SetPinScreen onSave={async () => true} />);
  assert.match(markup, />Set PIN</);
  assert.match(markup, />Next</);
});
