import assert from 'node:assert';
import test from 'node:test';
import { groupByTurn, type ChatActivity } from '../chat/activity/activity';
import { agentDetail, agentLook, descendantsOf, shortAgent, threadFiles, threadMessages, threadRoot, toolArg, toolName, toolOutcome, transcriptItems, treeStats, type TranscriptItem } from '../chat/activity/transcript';
import type { ChatMessage } from '../chat/messages';

let nextId = 1;
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 21, 7, 0, seconds)).toISOString();
const row = (overrides: Partial<ChatActivity> = {}): ChatActivity => {
  const id = nextId++;
  return {
    id, sessionId: 's1', turnId: 10, eventId: `e${id}`, parentId: null, kind: 'tool', agent: 'main', name: 'Bash', label: `Step ${id}`, summary: '',
    status: 'ok', hasDetail: false, seq: id, startedAt: at(id), endedAt: at(id + 1), ...overrides,
  };
};
const message = (id: number, role: string, seconds: number, text = role): ChatMessage => ({ id, sessionId: 's1', role, text, state: 'done', at: at(seconds) });
const shape = (items: TranscriptItem[]) => items.map((item) => {
  if (item.kind === 'user') return `user:${item.message.id}`;
  if (item.kind === 'call') return `call:${item.event.eventId}[${item.rows.map((child) => child.eventId).join(',')}]`;
  return `lead:${item.parts.map((part) => (part.kind === 'text' ? `m${part.message.id}` : part.event.eventId)).join(',')}`;
});

test('a turn reads as your message, the lead messages and one message per agent the lead called', () => {
  const messages = [message(10, 'user', 0), message(11, 'tool', 1), message(12, 'assistant', 5), message(14, 'assistant', 40)];
  const rows = [
    row({ eventId: 'bash', startedAt: at(2) }),
    row({ eventId: 'hook', kind: 'hook', startedAt: at(3) }),
    row({ eventId: 'runner', kind: 'agent', name: 'sous-ticket-runner', startedAt: at(10) }),
    row({ eventId: 'w1', kind: 'agent', name: 'sous-ticket-worker', parentId: 'runner', startedAt: at(11) }),
    row({ eventId: 'w1-step', parentId: 'w1', startedAt: at(12) }),
    row({ eventId: 'after', startedAt: at(30) }),
  ];
  assert.deepStrictEqual(shape(transcriptItems(messages, groupByTurn(rows))), [
    'user:10', 'lead:bash,m12', 'call:runner[w1,w1-step]', 'lead:after,m14',
  ]);
});

test('a pause longer than two minutes starts a new lead message', () => {
  const messages = [message(10, 'user', 0), message(12, 'assistant', 10), message(13, 'assistant', 200)];
  assert.deepStrictEqual(shape(transcriptItems(messages, new Map())), ['user:10', 'lead:m12', 'lead:m13']);
});

test('a turn without activity keeps its old tool lines; a turn with activity drops them', () => {
  const messages = [message(10, 'user', 0), message(11, 'tool', 1), message(12, 'assistant', 2), message(20, 'user', 30), message(21, 'tool', 31)];
  assert.deepStrictEqual(shape(transcriptItems(messages, groupByTurn([row({ eventId: 'x', turnId: 20, startedAt: at(32) })]))), ['user:10', 'lead:m11,m12', 'user:20', 'lead:x']);
});

test('the kit line for steps not sent stays; notes and hooks do not', () => {
  const messages = [message(10, 'user', 0)];
  const rows = [row({ eventId: 'n', kind: 'note', name: 'thinking' }), row({ eventId: 'd', kind: 'note', name: 'dropped', label: '1981 steps not shown' })];
  assert.deepStrictEqual(shape(transcriptItems(messages, groupByTurn(rows))), ['user:10', 'lead:d']);
});

test('an agent thread holds its own steps and one line per agent it called, not their steps', () => {
  const rows = [
    row({ eventId: 'runner', kind: 'agent' }),
    row({ eventId: 'r1', parentId: 'runner', startedAt: at(1) }),
    row({ eventId: 'arb', kind: 'agent', name: 'sous-arbiter', parentId: 'runner', startedAt: at(2) }),
    row({ eventId: 'arb-1', parentId: 'arb', startedAt: at(3) }),
    row({ eventId: 'r2', parentId: 'runner', startedAt: at(400) }),
  ];
  const messages = threadMessages(rows, 'runner');
  assert.deepStrictEqual(messages.map((item) => item.parts.map((part) => `${part.kind}:${part.event.eventId}`)), [['event:r1', 'call:arb'], ['event:r2']]);
  assert.deepStrictEqual(descendantsOf(rows, 'runner').map((child) => child.eventId), ['r1', 'arb', 'arb-1', 'r2']);
  assert.deepStrictEqual(treeStats(descendantsOf(rows, 'runner')), { steps: 3, failed: 0, denied: 0, workers: 1, types: ['sous-arbiter'] });
});

test('an agent detail splits into prompt, report and usage; a report sent as a message is not a report', () => {
  const kept = agentDetail('Decide I-1 and I-2.\n--- report ---\nI-1 → D-38.\nagentId: a8\n<usage>subagent_tokens: 105676\ntool_uses: 52\nduration_ms: 217961</usage>');
  assert.deepStrictEqual(kept, { prompt: 'Decide I-1 and I-2.', report: 'I-1 → D-38.', tools: 52, tokens: 105676, durationMs: 217961 });
  const handback = agentDetail('Decide.\n--- report ---\n  This agent\'s report was delivered to you as a message from "a8".\nagentId: a8\n<usage>tool_uses: 3</usage>');
  assert.deepStrictEqual([handback.report, handback.tools], [null, 3]);
  assert.deepStrictEqual(agentDetail(null), { prompt: '', report: null, tools: null, tokens: null, durationMs: null });
});

test('a step reads like Claude Code: name, the command or path in brackets, and why it failed', () => {
  assert.deepStrictEqual([toolName(row()), toolArg(row({ summary: 'node status.cjs show QRD-1346', label: 'Ledger: show QRD-1346' }))], ['Bash', 'node status.cjs show QRD-1346']);
  const failed = row({ status: 'error', summary: 'Exit code 127: rtk: No such file', label: 'Read datapoint-recycle.service.ts' });
  assert.deepStrictEqual([toolArg(failed), toolOutcome(failed)], ['Read datapoint-recycle.service.ts', 'Exit code 127: rtk: No such file']);
  assert.strictEqual(toolOutcome(row({ status: 'denied', summary: '' })), 'Blocked');
  assert.strictEqual(toolOutcome(row()), null);
  const mcp = row({ name: 'mcp__atlassian__getJiraIssue', label: 'MCP atlassian: getJiraIssue', summary: 'cloudId, issueIdOrKey' });
  assert.deepStrictEqual([toolName(mcp), toolArg(mcp)], ['MCP atlassian', 'getJiraIssue']);
  assert.deepStrictEqual([toolName(row({ kind: 'skill', name: 'sous' })), toolArg(row({ kind: 'skill', name: 'sous' }))], ['Skill', 'sous']);
});

test('each kind of agent keeps one initial and colour; the runner reads short', () => {
  assert.deepStrictEqual(agentLook('sous-ticket-runner'), { initials: 'R', color: '#8c9bf0' });
  assert.deepStrictEqual(agentLook('oh-my-claudecode:executor'), agentLook('executor'));
  assert.strictEqual(agentLook('executor').initials, 'Ex');
  assert.deepStrictEqual([shortAgent('sous-ticket-runner'), shortAgent('sous-arbiter')], ['runner', 'sous-arbiter']);
});

test('a worker belongs to the thread at the top of its chain, even through a missing or looping parent', () => {
  const workers = [{ id: 'runner', parentId: null }, { id: 'arb', parentId: 'runner' }, { id: 'deep', parentId: 'arb' }, { id: 'lost', parentId: 'gone' }, { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
  assert.deepStrictEqual([threadRoot(workers, 'deep'), threadRoot(workers, 'runner'), threadRoot(workers, 'lost'), threadRoot(workers, 'nobody')], ['runner', 'runner', 'lost', null]);
  assert.ok(['a', 'b'].includes(threadRoot(workers, 'a') ?? ''));
});

test('the files of a thread come from its read and write steps, changed ones first', () => {
  const files = threadFiles([
    row({ name: 'Read', summary: '/wt/src/a.ts (lines 1-40)' }),
    row({ name: 'Edit', summary: '/wt/src/b.ts' }),
    row({ name: 'Read', summary: '/wt/src/b.ts' }),
    row({ name: 'Bash', summary: 'cat /wt/src/c.ts' }),
  ]);
  assert.deepStrictEqual(files, [{ path: '/wt/src/b.ts', changed: true }, { path: '/wt/src/a.ts', changed: false }]);
});
