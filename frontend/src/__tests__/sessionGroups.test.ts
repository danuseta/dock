import assert from 'node:assert';
import test from 'node:test';
import type { ChatSession } from '../chat/messages';
import { groupSessions, sessionGroupKey, sidebarDot } from '../chat/sessionGroups';

const make = (id: string, status: string, waiting = false): ChatSession =>
  ({ id, source: 'dock', title: id, status, waiting, messageCount: 0, startedAt: '', lastMessageAt: '' });

test('a waiting session lands in Needs you even while running', () => {
  assert.strictEqual(sessionGroupKey(make('a', 'running', true)), 'needs-you');
});

test('queued and running go to Running, idle and error to Done', () => {
  assert.strictEqual(sessionGroupKey(make('a', 'queued')), 'running');
  assert.strictEqual(sessionGroupKey(make('b', 'running')), 'running');
  assert.strictEqual(sessionGroupKey(make('c', 'idle')), 'done');
  assert.strictEqual(sessionGroupKey(make('d', 'error')), 'done');
});

test('groups are ordered Needs you, Running, Done and keep input order', () => {
  const groups = groupSessions([make('d', 'idle'), make('r1', 'running'), make('w', 'idle', true), make('r2', 'queued')]);
  assert.deepStrictEqual(groups.map((g) => g.label), ['Needs you', 'Running', 'Done']);
  assert.deepStrictEqual(groups[1].sessions.map((s) => s.id), ['r1', 'r2']);
});

test('empty groups are omitted', () => {
  assert.deepStrictEqual(groupSessions([make('a', 'idle')]).map((g) => g.key), ['done']);
  assert.deepStrictEqual(groupSessions([]), []);
});

test('sidebar dot: delayed ring only while busy, done stays grey when the bridge is down', () => {
  assert.strictEqual(sidebarDot(make('a', 'running'), { bridgeUp: true, stale: true }), 'delayed');
  assert.strictEqual(sidebarDot(make('a', 'running'), { bridgeUp: true, stale: false }), 'running');
  assert.strictEqual(sidebarDot(make('a', 'idle', true), { bridgeUp: true, stale: true }), 'needs');
  assert.strictEqual(sidebarDot(make('a', 'running'), { bridgeUp: false, stale: false }), 'disconnected');
  assert.strictEqual(sidebarDot(make('a', 'idle'), { bridgeUp: false, stale: false }), 'done');
});
