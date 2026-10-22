import assert from 'node:assert';
import test from 'node:test';
import { chooseModel, EMPTY_OPTIONS } from '../chat/composer/composerLogic';
import { choiceToSave, defaultsToSave, changedFiles, dotState, filesTotal, popoverRows, stageLabel } from '../chat/headerState';
import type { SessionMachineOptions } from '../chat/sessionOptions';
import type { ChatActivity } from '../chat/activity/activity';

const machine: SessionMachineOptions = {
  models: [
    { value: 'opus', label: 'Opus 4.7', efforts: ['low', 'high', 'max'], fast: true },
    { value: 'haiku', label: 'Haiku 4.5', efforts: ['low'], fast: false },
  ],
  modes: ['plan', 'auto', 'acceptEdits'],
  fastAvailable: true,
  defaults: { model: 'opus', effort: 'high', permissionMode: 'auto' },
};

test('files changed add up to one total for the label', () => {
  assert.deepStrictEqual(filesTotal([{ path: 'a.ts', added: 10, removed: 2 }, { path: 'b.ts', added: 5, removed: 0 }]), { added: 15, removed: 2 });
  assert.deepStrictEqual(filesTotal([]), { added: 0, removed: 0 });
  assert.deepStrictEqual(changedFiles([{ path: 'a.ts', added: 1, removed: 0 }, { path: 'b.ts', added: 0, removed: 0 }, { path: 'c.ts', added: 0, removed: 3 }]).map((file) => file.path), ['a.ts', 'c.ts']);
});

test('the stage label counts the seven steps', () => {
  assert.strictEqual(stageLabel(2), 'Code · step 3 of 7');
  assert.strictEqual(stageLabel(-1), '');
});

test('the status dot follows the four states', () => {
  const base = { bridgeUp: true, waiting: false, busy: false };
  assert.strictEqual(dotState({ ...base, busy: true }), 'running');
  assert.strictEqual(dotState({ ...base, busy: true, waiting: true }), 'needs');
  assert.strictEqual(dotState({ ...base, bridgeUp: false, busy: true }), 'disconnected');
  assert.strictEqual(dotState(base), 'done');
});

test('the popover marks the values that equal the defaults', () => {
  const rows = popoverRows(EMPTY_OPTIONS, machine);
  assert.deepStrictEqual(rows.map((row) => row.field), ['model', 'effort', 'permissionMode']);
  const marked = (field: string) => rows.find((row) => row.field === field)?.options.filter((option) => option.isDefault).map((option) => option.value);
  assert.deepStrictEqual(marked('model'), ['opus']);
  assert.deepStrictEqual(marked('effort'), ['high']);
  assert.deepStrictEqual(marked('permissionMode'), ['auto']);
  assert.deepStrictEqual(rows.find((row) => row.field === 'permissionMode')?.options.map((option) => option.label), ['Auto', 'Plan', 'Accept edits']);
  assert.ok(rows.every((row) => row.isDefault));
});

test('changing the effort changes the options of the next turn', () => {
  assert.strictEqual(choiceToSave('effort', 'max', machine), 'max');
  assert.strictEqual(choiceToSave('effort', 'high', machine), null);
  const next = { ...EMPTY_OPTIONS, effort: choiceToSave('effort', 'max', machine) };
  const rows = popoverRows(next, machine);
  assert.strictEqual(rows.find((row) => row.field === 'effort')?.value, 'max');
  assert.strictEqual(rows.find((row) => row.field === 'effort')?.isDefault, false);
});

test('picking a model keeps only the efforts that model offers', () => {
  const picked = chooseModel({ ...EMPTY_OPTIONS, effort: 'max' }, 'haiku', machine.models);
  assert.strictEqual(picked.effort, 'low', 'max steps down to the highest level Haiku lists');
  const rows = popoverRows(picked, machine);
  assert.deepStrictEqual(rows.find((row) => row.field === 'effort')?.options.map((option) => option.value), ['low']);
});

test('Make default saves only the rows that differ from the default', () => {
  assert.deepStrictEqual(defaultsToSave(popoverRows(EMPTY_OPTIONS, machine)), {});
  const rows = popoverRows({ ...EMPTY_OPTIONS, effort: 'max', permissionMode: 'plan' }, machine);
  assert.deepStrictEqual(defaultsToSave(rows), { chatDefaultEffort: 'max', chatDefaultMode: 'plan' });
});

const row = (eventId: string, parentId: string | null, kind: string, turnId = 1): ChatActivity => ({
  id: Number(eventId.slice(1)), sessionId: 's', turnId, eventId, parentId, kind, agent: '', name: kind === 'agent' ? 'executor' : 'Read', label: eventId, summary: '', status: 'ok', hasDetail: false, seq: 1, startedAt: '2026-10-19T10:00:00.000Z', endedAt: null,
});

