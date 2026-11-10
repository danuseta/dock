import test from 'node:test';
import assert from 'node:assert/strict';
import { AcInService, MOVE_MARKER, moveId, parseMarkedComment, readMoves, type AcMoveJira, type JiraComment } from '../integrations/ac-move';
import type { PlanningIssue } from '../integrations/jira-sprint';

const body = (marker: string, data: unknown) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }, { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(data) }] }] });
const issue = (key: string, assignee: string, ac: string[]): PlanningIssue => ({ key, summary: key, type: 'Story', status: 'To Do', assignee, sp: 2, acRaw: ac.map((line) => `- ${line}`).join('\n'), links: [], labels: [] });

function setup() {
  const first = { id: moveId('QRD-1511', 'QRD-1489', 'Edit client sees the cursor'), from: 'QRD-1511', to: 'QRD-1489', line: 4, text: 'Edit client sees the cursor', by: 'Danu' };
  const second = { id: moveId('QRD-1511', 'QRD-1489', 'Cursors leave on unshare'), from: 'QRD-1511', to: 'QRD-1489', line: 7, text: 'Cursors leave on unshare', by: 'Danu' };
  const comments = new Map<string, JiraComment[]>([['QRD-1489', [
    { created: '2026-11-05T01:00:00.000Z', body: 'A plain comment' },
    { created: '2026-11-05T02:00:00.000Z', body: body(MOVE_MARKER, first) },
    { created: '2026-11-05T03:00:00.000Z', body: body(MOVE_MARKER, second) },
  ]]]);
  const issues = new Map([['QRD-1489', issue('QRD-1489', 'Aken', ['Edit share'])]]);
  const writes: Array<[string, string, unknown]> = [];
  const labelled = new Set(['QRD-1489']);
  const jira: AcMoveJira = {
    myself: async () => 'Aken',
    issueNow: async (key) => issues.get(key) ?? null,
    setAc: async (key, value) => { writes.push(['ac', key, value]); },
    pendingMoveKeys: async () => [...labelled],
    comments: async (key) => comments.get(key) ?? [],
    markedComment: async (key, marker, json) => {
      writes.push(['marked', key, marker]);
      comments.set(key, [...(comments.get(key) ?? []), { created: 'z', body: body(marker, JSON.parse(json)) }]);
    },
    removeLabel: async (key, label) => { writes.push(['unlabel', key, label]); labelled.delete(key); },
  };
  return { service: new AcInService(async () => jira), writes, comments, issues, first, second };
}

test('the request comment reads back from ADF or plain text; other comments are ignored', () => {
  assert.equal(parseMarkedComment('Hello'), null);
  assert.deepEqual(parseMarkedComment('QONFLO-AC-MOVE accepted\n{code:json}{"id":"a"}{code}'), { marker: 'QONFLO-AC-MOVE accepted', data: { id: 'a' } });
  assert.equal(parseMarkedComment(body('QONFLO-AC-MOVE v1', 'nope')), null);
  assert.equal(readMoves([{ created: 'a', body: body(MOVE_MARKER, { id: 'x', from: 'A-1', to: 'B-2', text: '' }) }]).requests.length, 0, 'a request without text is not one');
});

test('AC in lists the unanswered moves on the owner\'s labelled tickets', async () => {
  const { service, first, second } = setup();
  assert.deepEqual((await service.incoming()).map((row) => [row.to, row.from, row.line, row.text]), [['QRD-1489', 'QRD-1511', first.line, first.text], ['QRD-1489', 'QRD-1511', second.line, second.text]]);
});

test('accept adds the line to the AC read again, answers on both tickets, and keeps the label while another move waits', async () => {
  const { service, writes, first, second, comments } = setup();
  const left = await service.act('QRD-1489', first.id, 'accept', null, 'Aken');
  assert.deepEqual(writes.map(([kind, key, value]) => [kind, key, kind === 'ac' ? value : value]), [
    ['ac', 'QRD-1489', '- Edit share\n- Edit client sees the cursor'],
    ['marked', 'QRD-1511', 'QONFLO-AC-MOVE accepted'],
    ['marked', 'QRD-1489', 'QONFLO-AC-MOVE accepted'],
  ]);
  assert.deepEqual(parseMarkedComment(comments.get('QRD-1511')![0].body)!.data.id, first.id);
  assert.deepEqual(left.map((row) => row.id), [second.id]);
  await assert.rejects(service.act('QRD-1489', first.id, 'accept', null, 'Aken'), /already answered/);

  await assert.rejects(service.act('QRD-1489', second.id, 'decline', '  ', 'Aken'), /Say why/);
  writes.length = 0;
  assert.deepEqual(await service.act('QRD-1489', second.id, 'decline', 'Belongs to the PO', 'Aken'), []);
  assert.deepEqual(writes.map(([kind, key, value]) => [kind, key, value]), [
    ['marked', 'QRD-1511', 'QONFLO-AC-MOVE declined'], ['marked', 'QRD-1489', 'QONFLO-AC-MOVE declined'], ['unlabel', 'QRD-1489', 'ac-move-pending'],
  ]);
  assert.equal(parseMarkedComment(comments.get('QRD-1511')!.at(-1)!.body)!.data.reason, 'Belongs to the PO');
});

test('accept refuses a ticket that is not the owner\'s and does not repeat a line already in the AC', async () => {
  const { service, writes, issues, first } = setup();
  issues.set('QRD-1489', issue('QRD-1489', 'Danu', ['Edit share']));
  await assert.rejects(service.act('QRD-1489', first.id, 'accept', null, 'Aken'), /not assigned to you/);
  issues.set('QRD-1489', issue('QRD-1489', 'Aken', ['Edit share', 'Edit client sees the cursor']));
  await service.act('QRD-1489', first.id, 'accept', null, 'Aken');
  assert.equal(writes.filter(([kind]) => kind === 'ac').length, 0);
});
