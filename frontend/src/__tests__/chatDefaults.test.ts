import assert from 'node:assert';
import test from 'node:test';
import { cavemanChoices, normalizeCaveman, normalizeRtk, settingEffortChoices, settingModeChoices, settingModelChoices } from '../chat/chatDefaults';
import type { SessionMachineOptions } from '../chat/sessionOptions';

const machine: SessionMachineOptions = {
  models: [
    { value: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high'], fast: true },
    { value: 'haiku', label: 'Haiku', efforts: ['low', 'medium'], fast: false },
  ],
  modes: ['plan', 'auto', 'bypassPermissions'],
  fastAvailable: true,
  defaults: { model: 'opus', effort: 'high', permissionMode: 'plan' },
};

test('no choice is called Default; a value nobody named shows as Not set', () => {
  assert.deepStrictEqual(settingModelChoices(machine, 'opus').map((c) => c.label), ['Opus', 'Haiku']);
  assert.deepStrictEqual(settingModelChoices(machine, '')[0], { value: '', label: 'Not set' });
  assert.ok([...settingModelChoices(machine, 'opus'), ...settingEffortChoices(machine, 'opus', 'high'), ...settingModeChoices(machine, 'auto')].every((c) => !/default/i.test(c.label)));
});

test('without a catalog only Not set is offered', () => {
  assert.deepStrictEqual(settingModelChoices(undefined, ''), [{ value: '', label: 'Not set' }]);
  assert.deepStrictEqual(settingEffortChoices(undefined, '', ''), [{ value: '', label: 'Not set' }]);
  assert.deepStrictEqual(settingModeChoices(undefined, ''), [{ value: '', label: 'Not set' }]);
});

test('effort follows the chosen model, else the catalog default model', () => {
  assert.deepStrictEqual(settingEffortChoices(machine, 'haiku', '').slice(1).map((c) => c.value), ['low', 'medium']);
  assert.deepStrictEqual(settingEffortChoices(machine, '', '').slice(1).map((c) => c.value), ['low', 'medium', 'high']);
});

test('modes the picker does not know are not offered', () => {
  assert.deepStrictEqual(settingModeChoices(machine, 'auto').map((c) => c.value), ['auto', 'plan']);
});

test('a saved value the catalog lacks stays selectable', () => {
  const choices = settingModelChoices(machine, 'gone');
  assert.deepStrictEqual(choices[choices.length - 1], { value: 'gone', label: 'gone (not offered)' });
  assert.strictEqual(settingModelChoices(machine, 'haiku').length, 2);
});

test('caveman offers only the four levels and falls back to full', () => {
  assert.deepStrictEqual(cavemanChoices().map((c) => c.value), ['off', 'lite', 'full', 'ultra']);
  assert.strictEqual(normalizeCaveman('ultra'), 'ultra');
  assert.strictEqual(normalizeCaveman('wenyan'), 'full');
  assert.strictEqual(normalizeCaveman(undefined), 'full');
});

test('rtk is on unless explicitly off', () => {
  assert.strictEqual(normalizeRtk('off'), 'off');
  assert.strictEqual(normalizeRtk('on'), 'on');
  assert.strictEqual(normalizeRtk(null), 'on');
  assert.strictEqual(normalizeRtk('maybe'), 'on');
});
