import assert from 'node:assert';
import test from 'node:test';
import type { ChatSession } from '../chat/messages';
import { groupSessions, sessionGroupKey, sidebarDot } from '../chat/sessionGroups';

const make = (id: string, status: string, waiting = false, lastMessageAt = ''): ChatSession =>
  ({ id, source: 'dock', title: id, status, waiting, messageCount: 0, startedAt: '', lastMessageAt });

// Local time, so the test holds in any time zone.
const NOW = new Date(2026, 9, 21, 9, 30).getTime();
const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 21 - daysAgo, hour).toISOString();

test('a waiting session lands in Needs you even while running and whatever its date', () => {
  assert.strictEqual(sessionGroupKey(make('a', 'running', true, at(30)), NOW), 'needs-you');
});

test('the rest goes by the local day of the last message: Today, Yesterday, This week, Earlier', () => {
  assert.strictEqual(sessionGroupKey(make('a', 'running', false, at(0, 0)), NOW), 'today');
  assert.strictEqual(sessionGroupKey(make('b', 'idle', false, at(1, 23)), NOW), 'yesterday');
  assert.strictEqual(sessionGroupKey(make('c', 'idle', false, at(2)), NOW), 'week');
  assert.strictEqual(sessionGroupKey(make('d', 'error', false, at(6, 0)), NOW), 'week');
  assert.strictEqual(sessionGroupKey(make('e', 'idle', false, at(7, 23)), NOW), 'earlier');
  assert.strictEqual(sessionGroupKey(make('f', 'idle'), NOW), 'earlier', 'a missing date falls to Earlier');
});

test('groups are ordered Needs you, Today, Yesterday, This week, Earlier and keep input order', () => {
  const groups = groupSessions([
    make('old', 'idle', false, at(40)), make('t1', 'running', false, at(0)), make('w', 'idle', true, at(3)),
    make('y', 'idle', false, at(1)), make('t2', 'queued', false, at(0)), make('wk', 'idle', false, at(4)),
  ], NOW);
  assert.deepStrictEqual(groups.map((g) => g.label), ['Needs you', 'Today', 'Yesterday', 'This week', 'Earlier']);
  assert.deepStrictEqual(groups[1].sessions.map((s) => s.id), ['t1', 't2']);
});

test('empty groups are omitted', () => {
  assert.deepStrictEqual(groupSessions([make('a', 'idle', false, at(1))], NOW).map((g) => g.key), ['yesterday']);
  assert.deepStrictEqual(groupSessions([], NOW), []);
});

test('sidebar dot: a long turn stays running, done stays grey when the bridge is down', () => {
  assert.strictEqual(sidebarDot(make('a', 'running'), { bridgeUp: true }), 'running');
  assert.strictEqual(sidebarDot(make('a', 'idle', true), { bridgeUp: true }), 'needs');
  assert.strictEqual(sidebarDot(make('a', 'running'), { bridgeUp: false }), 'disconnected');
  assert.strictEqual(sidebarDot(make('a', 'idle'), { bridgeUp: false }), 'done');
});
