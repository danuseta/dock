import assert from 'node:assert';
import test from 'node:test';
import {
  buildTree, capRows, formatDuration, groupByTurn, maxSeq, mergeActivity, splitDetail, statusText,
  type ActivityNode, type ChatActivity,
} from '../chat/activity/activity';
import { createDetailStore } from '../chat/activity/detailStore';
import type { ChatMessage } from '../chat/messages';

let nextId = 1;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 12, 8, 0, seconds)).toISOString();

const row = (overrides: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 10, eventId: `e${id}`, parentId: null, kind: 'tool', agent: 'main', name: 'Bash', label: `Step ${id}`, summary: '',
    status: 'ok', hasDetail: false, seq: id, startedAt: at(id), endedAt: at(id + 1), ...overrides,
  };
};

const message = (id: number, role: string, seconds: number, text = role): ChatMessage => ({ id, sessionId: 's1', role, text, state: 'done', at: at(seconds) });

const flat = (nodes: ActivityNode[]): string[] => nodes.flatMap((node) => [node.event.eventId, ...flat(node.children).map((child) => `  ${child}`)]);

test('merging keeps one row per event, the newest copy wins, and a late older copy is ignored', () => {
  const running = row({ eventId: 'a', status: 'running', endedAt: null, seq: 3 });
  const done = row({ eventId: 'a', status: 'ok', seq: 5 });
  const other = row({ eventId: 'b', seq: 4 });
  const first = mergeActivity([], [other, done]);
  assert.strictEqual(first.length, 2);
  const late = mergeActivity(first, [running]);
  assert.strictEqual(late, first);
  assert.strictEqual(late.find((item) => item.eventId === 'a')?.status, 'ok');
  const upgraded = mergeActivity([running, other], [done, done]);
  assert.strictEqual(upgraded.length, 2);
  assert.strictEqual(upgraded.find((item) => item.eventId === 'a')?.status, 'ok');
});

test('merging the same rows twice returns the same array', () => {
  const rows = [row(), row()];
  assert.strictEqual(mergeActivity(rows, [{ ...rows[0] }, { ...rows[1] }]), rows);
  assert.strictEqual(mergeActivity(rows, []), rows);
});

test('the same event id in two turns stays two rows', () => {
  const merged = mergeActivity([row({ eventId: 'x', turnId: 1 })], [row({ eventId: 'x', turnId: 2 })]);
  assert.strictEqual(merged.length, 2);
});

test('the next afterSeq is the highest seq held', () => {
  assert.strictEqual(maxSeq([]), 0);
  assert.strictEqual(maxSeq([row({ seq: 7 }), row({ seq: 41 }), row({ seq: 9 })]), 41);
});

test('rows group by turn', () => {
  const byTurn = groupByTurn([row({ turnId: 1 }), row({ turnId: 2 }), row({ turnId: 1 })]);
  assert.deepStrictEqual([...byTurn.keys()], [1, 2]);
  assert.strictEqual(byTurn.get(1)?.length, 2);
});

test('the tree nests children under their agent in start order', () => {
  const agent = row({ eventId: 'ag', kind: 'agent', startedAt: at(1) });
  const late = row({ eventId: 'c2', parentId: 'ag', startedAt: at(4) });
  const early = row({ eventId: 'c1', parentId: 'ag', startedAt: at(2) });
  const after = row({ eventId: 'top2', startedAt: at(9) });
  assert.deepStrictEqual(flat(buildTree([after, late, agent, early])), ['ag', '  c1', '  c2', 'top2']);
});

test('a child that arrives before its parent is nested once the parent is held', () => {
  const agent = row({ eventId: 'ag', kind: 'agent', startedAt: at(1) });
  const child = row({ eventId: 'c1', parentId: 'ag', startedAt: at(2) });
  assert.deepStrictEqual(flat(buildTree([child])), ['c1']);
  assert.deepStrictEqual(flat(buildTree([child, agent])), ['ag', '  c1']);
});

test('an orphan whose parent is not held stands at the top level', () => {
  const orphan = row({ eventId: 'o', parentId: 'missing' });
  assert.deepStrictEqual(flat(buildTree([orphan])), ['o']);
});

test('parent cycles and self parents do not loop', () => {
  const a = row({ eventId: 'a', parentId: 'b', startedAt: at(1) });
  const b = row({ eventId: 'b', parentId: 'a', startedAt: at(2) });
  const self = row({ eventId: 's', parentId: 's', startedAt: at(3) });
  const tree = buildTree([a, b, self]);
  assert.strictEqual(flat(tree).filter((item) => !item.startsWith(' ')).length >= 2, true);
  assert.strictEqual(flat(tree).length, 3);
});

test('nesting deeper than three levels is flattened onto the third', () => {
  const l1 = row({ eventId: 'l1', startedAt: at(1) });
  const l2 = row({ eventId: 'l2', parentId: 'l1', startedAt: at(2) });
  const l3 = row({ eventId: 'l3', parentId: 'l2', startedAt: at(3) });
  const l4 = row({ eventId: 'l4', parentId: 'l3', startedAt: at(4) });
  const l5 = row({ eventId: 'l5', parentId: 'l4', startedAt: at(5) });
  assert.deepStrictEqual(flat(buildTree([l1, l2, l3, l4, l5])), ['l1', '  l2', '    l3', '    l4', '    l5']);
});

test('the mounted rows are capped and the remainder is counted', () => {
  const items = Array.from({ length: 400 }, (_, index) => index);
  const first = capRows(items, 50);
  assert.strictEqual(first.visible.length, 50);
  assert.strictEqual(first.hidden, 350);
  const more = capRows(items, 100);
  assert.strictEqual(more.visible.length, 100);
  assert.strictEqual(more.hidden, 300);
  assert.strictEqual(capRows(items.slice(0, 3), 50).hidden, 0);
});

test('durations read like the terminal', () => {
  assert.strictEqual(formatDuration(400), '0.4 s');
  assert.strictEqual(formatDuration(3400), '3.4 s');
  assert.strictEqual(formatDuration(12_000), '12 s');
  assert.strictEqual(formatDuration(59_600), '1 m 00 s');
  assert.strictEqual(formatDuration(185_000), '3 m 05 s');
  assert.strictEqual(formatDuration(3_720_000), '1 h 02 m');
  assert.strictEqual(formatDuration(-5), '');
});

test('status words', () => {
  assert.deepStrictEqual(['running', 'ok', 'error', 'denied', 'stopped'].map(statusText), ['running', 'done', 'failed', 'blocked', 'stopped']);
});

test('hidden output becomes a notice, not a code block', () => {
  assert.deepStrictEqual(splitDetail('[output hidden: sensitive command]').body, '');
  assert.strictEqual(splitDetail('[output hidden: sensitive command]').notice !== null, true);
  const mixed = splitDetail('$ printenv\n[output hidden: sensitive command]');
  assert.strictEqual(mixed.body, '$ printenv');
  assert.strictEqual(mixed.notice !== null, true);
  assert.deepStrictEqual(splitDetail('line one\nline two'), { body: 'line one\nline two', notice: null });
  assert.strictEqual(splitDetail('[hidden]').body, '');
});

test('the detail of a row is fetched once however often it is asked for', async () => {
  let calls = 0;
  const store = createDetailStore(async (id) => {
    calls += 1;
    return `detail ${id}`;
  });
  store.load(5, 'ok');
  store.load(5, 'ok');
  assert.strictEqual(store.get(5).state, 'loading');
  await new Promise((resolve) => setTimeout(resolve, 0));
  store.load(5, 'ok');
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(store.get(5), { state: 'ready', text: 'detail 5' });
  store.load(5, 'error');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(calls, 2);
});

test('a failed detail fetch is tried again when asked', async () => {
  let calls = 0;
  const store = createDetailStore(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return 'back';
  });
  store.load(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(store.get(1).state, 'failed');
  store.load(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepStrictEqual(store.get(1), { state: 'ready', text: 'back' });
});

