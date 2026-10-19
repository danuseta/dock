import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../chat/Markdown';
import { CACHED_MESSAGES, CACHED_SESSIONS, recallMessages, rememberMessages } from '../chat/messageCache';
import type { ChatMessage, ChatSession } from '../chat/messages';
import { SessionRow } from '../chat/SessionRow';
import {
  appliedOptions, appliedText, defaultLabel, effortChoicesFor, keepChoice, modeChoices, modelChoices, withChoice,
  type SessionMachineOptions,
} from '../chat/sessionOptions';

const machine: SessionMachineOptions = {
  models: [
    { value: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'max'], fast: false },
    { value: 'haiku', label: 'Haiku', efforts: ['low', 'medium'], fast: false },
  ],
  modes: ['default', 'acceptEdits', 'plan', 'auto'],
  fastAvailable: false,
  defaults: { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'default' },
};
const none = { model: null, effort: null, permissionMode: null, fast: null };

test('the Default entries name the machine default, and fall back to a plain Default', () => {
  assert.strictEqual(defaultLabel('model', machine), 'Default (Opus 5.5, high)');
  assert.strictEqual(defaultLabel('effort', machine), 'Default (high)');
  assert.strictEqual(defaultLabel('permissionMode', machine), 'Default (Default)');
  assert.strictEqual(defaultLabel('model', { ...machine, defaults: { model: 'haiku', effort: null, permissionMode: null } }), 'Default (Haiku)');
  assert.strictEqual(defaultLabel('model', { ...machine, defaults: { model: null, effort: 'high' } }), 'Default');
  for (const field of ['model', 'effort', 'permissionMode'] as const) {
    assert.strictEqual(defaultLabel(field, { ...machine, defaults: null }), 'Default');
    assert.strictEqual(defaultLabel(field, { ...machine, defaults: undefined }), 'Default');
    assert.strictEqual(defaultLabel(field, undefined), 'Default');
  }
  assert.deepStrictEqual(modelChoices(machine).map((choice) => choice.label), ['Default (Opus 5.5, high)', 'Opus 5.5', 'Haiku']);
  assert.deepStrictEqual(modeChoices({ ...machine, modes: ['plan', 'auto'] }).map((choice) => choice.value), ['', 'plan', 'auto']);
});

test('the effort list follows the chosen model, or the machine default model', () => {
  assert.deepStrictEqual(effortChoicesFor(machine, null).map((choice) => choice.value), ['', 'low', 'medium', 'high', 'max']);
  assert.deepStrictEqual(effortChoicesFor(machine, { ...none, model: 'haiku' }).map((choice) => choice.value), ['', 'low', 'medium']);
  assert.deepStrictEqual(effortChoicesFor({ ...machine, defaults: null }, null).map((choice) => choice.value), ['', 'low', 'medium']);
});

test('what applies now marks the values that come from the machine default', () => {
  const rows = appliedOptions({ ...none, permissionMode: 'auto', effort: 'low' }, machine);
  assert.deepStrictEqual(rows.map((row) => [row.field, row.value, row.fromDefault]), [
    ['permissionMode', 'Auto', false],
    ['model', 'Opus 5.5', true],
    ['effort', 'low', false],
  ]);
  assert.strictEqual(appliedText(rows), 'mode Auto · model Opus 5.5 · effort low');
  assert.deepStrictEqual(appliedOptions(null, undefined), []);
  assert.deepStrictEqual(appliedOptions(null, { ...machine, defaults: null }), []);
});

test('a value the Default entry names is not listed again, unless the session picked it', () => {
  const efforts = ['low', 'medium', 'high', 'max'];
  assert.deepStrictEqual(efforts.filter((level) => keepChoice(level, 'high', null)), ['low', 'medium', 'max']);
  assert.deepStrictEqual(efforts.filter((level) => keepChoice(level, 'high', 'high')), efforts);
  assert.deepStrictEqual(efforts.filter((level) => keepChoice(level, null, null)), efforts);
  assert.deepStrictEqual(['default', 'plan', 'auto'].filter((mode) => keepChoice(mode, 'auto', null)), ['default', 'plan']);
});

test('picking a value stores it, and a model change drops an effort the model does not list', () => {
  assert.deepStrictEqual(withChoice(null, 'permissionMode', 'plan', machine), { ...none, permissionMode: 'plan' });
  assert.deepStrictEqual(withChoice({ ...none, permissionMode: 'plan' }, 'permissionMode', '', machine), none);
  assert.deepStrictEqual(withChoice({ ...none, model: 'claude-opus-5-5', effort: 'max' }, 'model', 'haiku', machine), { ...none, model: 'haiku' });
  assert.deepStrictEqual(withChoice({ ...none, model: 'claude-opus-5-5', effort: 'low' }, 'model', 'haiku', machine), { ...none, model: 'haiku', effort: 'low' });
  assert.deepStrictEqual(withChoice({ ...none, model: 'haiku', effort: 'medium', fast: true }, 'effort', 'low', machine), { ...none, model: 'haiku', effort: 'low', fast: true });
});

const message = (id: number): ChatMessage => ({ id, sessionId: 's', role: 'assistant', text: `m${id}`, state: 'done', at: '2026-10-15T00:00:00.000Z' });

test('a reopened session is seeded from the last thread, without unsent messages, and the cache stays bounded', () => {
  assert.strictEqual(recallMessages('cache-never-opened'), undefined);
  rememberMessages('cache-a', [message(1), message(2), { ...message(-5), role: 'user', state: 'queued' }], false);
  assert.deepStrictEqual(recallMessages('cache-a'), { messages: [message(1), message(2)], hasOlder: false });
  rememberMessages('cache-empty', [], false);
  assert.strictEqual(recallMessages('cache-empty'), undefined);

  const long = Array.from({ length: CACHED_MESSAGES + 30 }, (_, index) => message(index + 1));
  rememberMessages('cache-long', long, false);
  const kept = recallMessages('cache-long');
  assert.strictEqual(kept?.messages.length, CACHED_MESSAGES);
  assert.strictEqual(kept?.messages[0].id, 31);
  assert.strictEqual(kept?.hasOlder, true, 'lines were cut off the front, so older ones exist');

  for (let n = 0; n < CACHED_SESSIONS + 3; n += 1) rememberMessages(`cache-fill-${n}`, [message(1)], false);
  assert.strictEqual(recallMessages('cache-a'), undefined, 'the least recently used session goes first');
  assert.ok(recallMessages(`cache-fill-${CACHED_SESSIONS + 2}`));
});

test('assistant text renders as markdown with tables, lists, code and safe links', () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    text: '## Review\n\n| File | Result |\n| --- | --- |\n| a.ts | pass |\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n\nUse `npm test` and see [docs](https://example.com/a).',
  }));
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>File<\/th>/);
  assert.match(html, /<td[^>]*>pass<\/td>/);
  assert.match(html, /<ul/);
  assert.match(html, /<pre/);
  assert.match(html, /<code[^>]*>npm test<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Review/);
});

test('raw HTML in a reply is never rendered', () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    text: 'Hello <script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold</b>\n\n[bad](javascript:alert(1))',
  }));
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>/);
  assert.doesNotMatch(html, /javascript:/);
});

test('a search hit row shows the same chips and markers as the session list row', () => {
  const session: ChatSession = {
    id: 's1', source: 'dock', title: 'Fix login', ticketKey: 'QRD-1', machine: 'pc', status: 'running',
    messageCount: 3, startedAt: '2026-10-15T00:00:00Z', lastMessageAt: '2026-10-15T00:00:00Z', lastText: 'last reply', waiting: true,
  };
  const now = Date.parse('2026-10-15T00:05:00Z');
  const common = { session, machine: 'pc', online: true, selected: false, now, onSelect: () => {} };
  const listRow = renderToStaticMarkup(<SessionRow {...common} />);
  const hitRow = renderToStaticMarkup(<SessionRow {...common} snippet="matched text" snippetAt="2026-10-15T00:04:00Z" />);
  for (const html of [listRow, hitRow]) {
    assert.match(html, />DOCK</);
    assert.match(html, /\(online\)/);
    assert.match(html, />waiting</);
    assert.match(html, /title="Working"/);
    assert.match(html, />QRD-1</);
    assert.match(html, />3 messages</);
  }
  assert.match(listRow, /last reply/);
  assert.match(hitRow, /matched text/);
  assert.doesNotMatch(hitRow, /last reply/);
});
