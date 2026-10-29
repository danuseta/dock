import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatActivity } from '../chat/activity/activity';
import { WorkerTray } from '../chat/activity/WorkerTray';

let nextId = 1;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 21, 8, 0, seconds)).toISOString();
const agent = (name: string, overrides: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 10, eventId: `e${id}`, parentId: null, kind: 'agent', agent: 'main', name, label: `Agent ${name}: task ${id}`, summary: '',
    status: 'running', hasDetail: false, seq: id, startedAt: at(id), endedAt: null, ...overrides,
  };
};

test('the tray renders nothing while the session has no subagent', () => {
  assert.strictEqual(renderToStaticMarkup(<WorkerTray events={[]} />), '');
});

test('the tray shows three workers as rows and the rest as chips', () => {
  const events = ['executor', 'verifier', 'explore', 'designer', 'writer'].map((name) => agent(name));
  const html = renderToStaticMarkup(<WorkerTray events={events} activeId={events[1].eventId} onSelect={() => undefined} />);
  assert.match(html, /5 running/);
  assert.strictEqual((html.match(/rounded-xs border/g) ?? []).length, 3);
  assert.strictEqual((html.match(/rounded-pill/g) ?? []).length, 2);
  assert.strictEqual((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('without onSelect the tray only shows the workers, a finished one reads as done', () => {
  const html = renderToStaticMarkup(<WorkerTray events={[agent('executor'), agent('explore', { status: 'ok', endedAt: at(90) })]} />);
  assert.match(html, /1 running · 1 finished/);
  assert.match(html, /done · 0 steps/);
  assert.doesNotMatch(html, /aria-pressed/);
});

test('the tray shows ten workers at most, running and newest first, and folds the rest into one chip', () => {
  const done = Array.from({ length: 30 }, (_, index) => agent(`done-${index}`, { status: 'ok', endedAt: at(500 + index) }));
  const live = ['sous-video', 'browser-verifier', 'sous-reviewer'].map((name) => agent(name));
  const html = renderToStaticMarkup(<WorkerTray events={[...done, ...live]} onSelect={() => undefined} />);
  assert.match(html, /3 running · 30 finished/);
  assert.strictEqual((html.match(/rounded-xs border/g) ?? []).length, 3, 'three rows');
  assert.strictEqual((html.match(/rounded-pill border border-border/g) ?? []).length, 7, 'seven chips');
  assert.match(html, /\+23 more/);
  const rows = html.slice(0, html.indexOf('rounded-pill'));
  assert.ok(['sous-video', 'browser-verifier', 'sous-reviewer'].every((name) => rows.includes(name)), 'the running ones are the rows');
  assert.ok(html.includes('done-29') && !html.includes('done-0<'), 'the newest finished ones come before the oldest');
});
