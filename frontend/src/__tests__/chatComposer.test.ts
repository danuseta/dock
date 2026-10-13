import assert from 'node:assert';
import test from 'node:test';
import {
  MAX_TEXT, MAX_ATTACHMENTS, acceptAttribute, buildPayload, attachmentLimitText, canSend, checkFile, chooseModel, composerFeatures, effortChoices, formatSize, insertCommand, isSendKey, moveHighlight, sanitizeOptions, slashQuery,
  type MachineOptions, type TurnOptions,
} from '../chat/composer/composerLogic';
import { isOptimistic, optimisticMessage } from '../chat/messages';

const none: TurnOptions = { model: null, effort: null, permissionMode: null, fast: null };
const machineOptions: MachineOptions = {
  models: [
    { value: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high', 'max'], fast: true },
    { value: 'haiku', label: 'Haiku', efforts: ['low', 'medium'], fast: false },
  ],
  modes: ['default', 'acceptEdits', 'plan'],
  fastAvailable: true,
};
const all = ['interactive', 'questions', 'plan', 'stop', 'attachments', 'commands', 'model', 'effort', 'fast'];

test('an old bridge reports nothing, so every control is hidden', () => {
  const features = composerFeatures([]);
  assert.deepStrictEqual(Object.values(features), [false, false, false, false, false, false, false]);
});

test('each control follows its own capability', () => {
  assert.strictEqual(composerFeatures(['commands']).picker, true);
  assert.strictEqual(composerFeatures(['commands']).attachments, false);
  assert.strictEqual(composerFeatures(['attachments']).attachments, true);
  assert.strictEqual(composerFeatures(['stop']).stop, true);
  assert.strictEqual(composerFeatures(['model']).model, true);
  assert.strictEqual(composerFeatures(['effort']).effort, true);
  assert.strictEqual(composerFeatures(['fast']).fast, true);
  assert.strictEqual(composerFeatures(['interactive']).mode, true);
  assert.strictEqual(composerFeatures(['questions', 'plan']).mode, false, 'the mode selector needs the interactive feature');
  assert.strictEqual(Object.values(composerFeatures(all)).every(Boolean), true);
});

test('the picker opens only for a slash command name at the start of the text', () => {
  assert.strictEqual(slashQuery('/'), '');
  assert.strictEqual(slashQuery('/rev'), 'rev');
  assert.strictEqual(slashQuery('/review '), null, 'a space ends the command name');
  assert.strictEqual(slashQuery('/review the diff'), null);
  assert.strictEqual(slashQuery(' /rev'), null);
  assert.strictEqual(slashQuery('hello /rev'), null);
  assert.strictEqual(slashQuery('/a\nb'), null);
  assert.strictEqual(slashQuery(''), null);
  assert.strictEqual(slashQuery('/ab/cd'), 'ab/cd', 'namespaced skills keep their slash');
});

test('choosing a command writes its name and a trailing space', () => {
  assert.strictEqual(insertCommand('review'), '/review ');
  assert.strictEqual(insertCommand('/review'), '/review ');
});

test('highlight wraps in both directions and survives an empty list', () => {
  assert.strictEqual(moveHighlight(0, 1, 3), 1);
  assert.strictEqual(moveHighlight(2, 1, 3), 0);
  assert.strictEqual(moveHighlight(0, -1, 3), 2);
  assert.strictEqual(moveHighlight(5, 1, 3), 0);
  assert.strictEqual(moveHighlight(0, 1, 0), 0);
});

test('the effort list follows the model; with no model only levels every model has are offered', () => {
  assert.deepStrictEqual(effortChoices(machineOptions.models, 'opus'), ['low', 'medium', 'high', 'max']);
  assert.deepStrictEqual(effortChoices(machineOptions.models, 'haiku'), ['low', 'medium']);
  assert.deepStrictEqual(effortChoices(machineOptions.models, null), ['low', 'medium']);
  assert.deepStrictEqual(effortChoices(machineOptions.models, 'gone'), []);
  assert.deepStrictEqual(effortChoices([], null), []);
});

test('changing the model drops an effort the new model does not list', () => {
  const high: TurnOptions = { ...none, model: 'opus', effort: 'high' };
  assert.deepStrictEqual(chooseModel(high, 'haiku', machineOptions.models), { ...none, model: 'haiku', effort: null });
  assert.deepStrictEqual(chooseModel(high, null, machineOptions.models), { ...none, effort: null });
  assert.deepStrictEqual(chooseModel({ ...none, model: 'opus', effort: 'low' }, 'haiku', machineOptions.models), { ...none, model: 'haiku', effort: 'low' });
});

test('options are cut down to what the machine reports before sending', () => {
  const chosen: TurnOptions = { model: 'opus', effort: 'max', permissionMode: 'plan', fast: true };
  assert.deepStrictEqual(sanitizeOptions(chosen, composerFeatures(all), machineOptions), chosen);
  assert.strictEqual(sanitizeOptions(chosen, composerFeatures([]), machineOptions), null);
  assert.deepStrictEqual(sanitizeOptions(chosen, composerFeatures(['model']), machineOptions), { ...none, model: 'opus' });
  assert.deepStrictEqual(sanitizeOptions(chosen, composerFeatures(['effort']), machineOptions), null, 'an effort only one model lists is not sent without that model');
  assert.deepStrictEqual(sanitizeOptions({ ...chosen, effort: 'low' }, composerFeatures(['effort']), machineOptions), { ...none, effort: 'low' });
  assert.deepStrictEqual(sanitizeOptions(chosen, composerFeatures(['interactive']), machineOptions), { ...none, permissionMode: 'plan' });
  assert.deepStrictEqual(sanitizeOptions({ ...chosen, model: 'unknown', effort: 'max' }, composerFeatures(all), machineOptions), { ...none, permissionMode: 'plan', fast: true });
  assert.deepStrictEqual(sanitizeOptions(chosen, composerFeatures(all), { ...machineOptions, fastAvailable: false }), { ...chosen, fast: null });
  assert.strictEqual(sanitizeOptions({ ...chosen, permissionMode: 'bypassPermissions' }, composerFeatures(all), machineOptions)?.permissionMode, null);
  assert.strictEqual(sanitizeOptions(none, composerFeatures(all), machineOptions), null);
  assert.strictEqual(sanitizeOptions(chosen, composerFeatures(all), undefined)?.model, null, 'without a catalogue no model or effort is sent');
});

test('the payload trims the text and carries ids and options', () => {
  const payload = buildPayload({ text: '  hello  ', attachmentIds: ['a', 'b'], options: { ...none, model: 'haiku' }, features: composerFeatures(all), machineOptions });
  assert.deepStrictEqual(payload, { text: 'hello', attachmentIds: ['a', 'b'], attachments: [], options: { ...none, model: 'haiku' } });
  const old = buildPayload({ text: 'hi', attachmentIds: [], options: { ...none, model: 'haiku' }, features: composerFeatures([]), machineOptions: undefined });
  assert.deepStrictEqual(old, { text: 'hi', attachmentIds: [], attachments: [], options: null });
  const ignored = buildPayload({ text: 'hi', attachmentIds: ['x'], options: null, features: composerFeatures([]), machineOptions: undefined });
  assert.deepStrictEqual(ignored.attachmentIds, [], 'ids are dropped when the machine has no attachments capability');
});

test('file rules: type, size, count', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });
  assert.strictEqual(checkFile(file('a.png', 'image/png', 5 * 1024 * 1024), 0), null);
  assert.match(checkFile(file('a.png', 'image/png', 5 * 1024 * 1024 + 1), 0) ?? '', /5 MB/);
  assert.strictEqual(checkFile(file('a.pdf', 'application/pdf', 8 * 1024 * 1024), 0), null);
  assert.match(checkFile(file('a.pdf', 'application/pdf', 8 * 1024 * 1024 + 1), 0) ?? '', /8 MB/);
  assert.strictEqual(checkFile(file('notes.txt', 'text/plain', 10), 0), null);
  assert.strictEqual(checkFile(file('data.json', 'application/json', 10), 0), null);
  assert.strictEqual(checkFile(file('main.ts', 'application/octet-stream', 10), 0), null);
  assert.strictEqual(checkFile(file('main.TSX', '', 10), 0), null, 'extension match ignores case and an empty type');
  assert.match(checkFile(file('a.exe', 'application/octet-stream', 10), 0) ?? '', /not supported/);
  assert.match(checkFile(file('a.svg', 'image/svg+xml', 10), 0) ?? '', /not supported/);
  assert.match(checkFile(file('a.zip', 'application/zip', 10), 0) ?? '', /not supported/);
  assert.match(checkFile(file('a.png', 'image/png', 0), 0) ?? '', /empty/);
  assert.match(checkFile(file('a.png', 'image/png', 10), MAX_ATTACHMENTS) ?? '', /4 files/);
});

test('the accept attribute lists images, pdf, text and the text extensions', () => {
  const accept = acceptAttribute();
  for (const part of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/*', 'application/json', '.md', '.tsx', '.patch']) assert.ok(accept.split(',').includes(part), part);
  assert.ok(!accept.includes('svg'));
});

test('sizes read as KB or MB', () => {
  assert.strictEqual(formatSize(512), '512 B');
  assert.strictEqual(formatSize(2048), '2 KB');
  assert.strictEqual(formatSize(1536 * 1024), '1.5 MB');
});

test('sending needs text or a file, finished uploads, no blocker and no send in flight', () => {
  const base = { text: 'hi', attachments: 0, uploading: false, blocker: null, sending: false, attachmentsEnabled: true };
  assert.strictEqual(canSend(base), true);
  assert.strictEqual(canSend({ ...base, text: '   ' }), false);
  assert.strictEqual(canSend({ ...base, text: '', attachments: 1 }), true);
  assert.strictEqual(canSend({ ...base, text: '', attachments: 1, attachmentsEnabled: false }), false);
  assert.strictEqual(canSend({ ...base, uploading: true }), false);
  assert.strictEqual(canSend({ ...base, blocker: 'Claude is still working on your last message.' }), false);
  assert.strictEqual(canSend({ ...base, sending: true }), false);
  assert.strictEqual(canSend({ ...base, text: 'x'.repeat(MAX_TEXT + 1) }), false);
});

test('Enter sends, Shift+Enter and composition do not', () => {
  assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: false, isComposing: false }), true);
  assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: true, isComposing: false }), false);
  assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true }), false);
  assert.strictEqual(isSendKey({ key: 'a', shiftKey: false, isComposing: false }), false);
});

test('the payload carries the sent files for the optimistic message, and only when the machine takes attachments', () => {
  const file = { id: 'a', name: 'shot.png', mime: 'image/png', size: 10, state: 'attached' };
  const payload = buildPayload({ text: '', attachmentIds: ['a'], attachments: [file], options: null, features: composerFeatures(all), machineOptions });
  assert.deepStrictEqual(payload.attachments, [file]);
  assert.deepStrictEqual(buildPayload({ text: '', attachmentIds: ['a'], attachments: [file], options: null, features: composerFeatures([]), machineOptions }).attachments, []);
});

test('an attachment-only send shows its files in the optimistic message, not an empty bubble', () => {
  const file = { id: 'a', name: 'shot.png', mime: 'image/png', size: 10, state: 'attached' };
  const only = optimisticMessage('s1', { text: '', attachments: [file] }, -5, '2026-10-12T00:00:00.000Z');
  assert.deepStrictEqual([only.id, only.text, only.role, only.state, only.attachments], [-5, '', 'user', 'queued', [file]]);
  assert.strictEqual(isOptimistic(only), true);
  const plain = optimisticMessage('s1', { text: 'hi', attachments: [] }, -6, '2026-10-12T00:00:00.000Z');
  assert.strictEqual(plain.attachments, undefined);
});

test('the attachment limit is explained once it is reached', () => {
  assert.strictEqual(attachmentLimitText(MAX_ATTACHMENTS - 1), '');
  assert.strictEqual(attachmentLimitText(MAX_ATTACHMENTS), 'At most 4 files per message');
});
