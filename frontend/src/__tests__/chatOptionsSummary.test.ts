import assert from 'node:assert';
import test from 'node:test';
import type { MachineOptions, TurnOptions } from '../chat/composer/composerLogic';
import { hasChangedChoice, optionsSummary, parseOpen, readOpen, summaryText, writeOpen } from '../chat/composer/optionsSummary';

const none: TurnOptions = { model: null, effort: null, permissionMode: null, fast: null };
const machine: MachineOptions = {
  models: [{ value: 'haiku', label: 'Haiku 5.5', efforts: ['low', 'high'], fast: false }],
  modes: ['default', 'acceptEdits', 'plan'],
  fastAvailable: true,
};
const all = { model: true, effort: true, mode: true, fast: true };

test('an untouched bar reads as defaults and flags nothing', () => {
  const parts = optionsSummary(none, machine, all);
  assert.strictEqual(summaryText(parts), 'Default model · Default effort · Default mode');
  assert.strictEqual(hasChangedChoice(parts), false);
});

test('the chosen model label, effort and Plan mode show up and are flagged', () => {
  const parts = optionsSummary({ model: 'haiku', effort: 'high', permissionMode: 'plan', fast: true }, machine, all);
  assert.strictEqual(summaryText(parts), 'Haiku 5.5 · high effort · Plan mode · Fast');
  assert.deepStrictEqual(parts.map((part) => part.changed), [true, true, true, true]);
});

test('an explicit default mode is not flagged, accept edits is', () => {
  assert.strictEqual(hasChangedChoice(optionsSummary({ ...none, permissionMode: 'default' }, machine, all)), false);
  assert.strictEqual(summaryText(optionsSummary({ ...none, permissionMode: 'acceptEdits' }, machine, all)), 'Default model · Default effort · Accept edits mode');
});

test('only the controls the machine offers are summarised', () => {
  const parts = optionsSummary(none, machine, { model: true, effort: false, mode: false, fast: false });
  assert.strictEqual(summaryText(parts), 'Default model');
});

test('the stored open flag defaults to collapsed and survives missing storage', () => {
  assert.strictEqual(parseOpen(null), false);
  assert.strictEqual(parseOpen('0'), false);
  assert.strictEqual(parseOpen('1'), true);
  assert.strictEqual(readOpen(), false);
  assert.doesNotThrow(() => writeOpen(true));
});
