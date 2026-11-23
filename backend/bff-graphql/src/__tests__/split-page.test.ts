import test from 'node:test';
import assert from 'node:assert/strict';
import { pageRef, parseSplitTable, readSplitPage, splitTestLine, splitView, type SplitState } from '../integrations/split-page';
import type { ConfluenceClient } from '../integrations/confluence';

const table = (rows: string[][], header = ['Ticket', 'Week', 'Note']) => `<p>Split</p><table><tbody><tr>${header.map((cell) => `<th><p>${cell}</p></th>`).join('')}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td><p>${cell}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`;

test('the table reads Week as Week 1, W1 or 1, finds columns by name and ignores extra ones', () => {
  const html = table([['Aken', 'QRD-1', 'Week 1', 'first'], ['Danu', 'QRD-2', 'W2', ''], ['Aken', 'QRD-3', '2', 'a &amp; b']], ['Owner', 'ticket', 'WEEK', 'Note']);
  assert.deepEqual(parseSplitTable(html), { rows: [{ key: 'QRD-1', week: 1, note: 'first' }, { key: 'QRD-2', week: 2, note: null }, { key: 'QRD-3', week: 2, note: 'a & b' }], skipped: 0 });
});

test('the note column is optional and a Jira macro in the ticket cell still gives the key', () => {
  const macro = '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">QRD-7</ac:parameter></ac:structured-macro>';
  assert.deepEqual(parseSplitTable(table([[macro, 'Week 2']], ['Ticket', 'Week'])), { rows: [{ key: 'QRD-7', week: 2, note: null }], skipped: 0 });
});

test('rows with a bad key or week are skipped and counted, the first row of a key wins', () => {
  const found = parseSplitTable(table([['not a key', 'Week 1', ''], ['QRD-1', 'soon', ''], ['QRD-1', 'W1', ''], ['QRD-1', 'W2', ''], ['QRD-2', 'Week 0', '']]));
  assert.deepEqual(found, { rows: [{ key: 'QRD-1', week: 1, note: null }], skipped: 3 });
});

test('no table, or no Ticket and Week header, gives null; the first matching table wins', () => {
  assert.equal(parseSplitTable('<p>nothing</p>'), null);
  assert.equal(parseSplitTable(table([['QRD-1', 'x']], ['Name', 'Team'])), null);
  assert.deepEqual(parseSplitTable(table([['x', 'y']], ['Name', 'Team']) + table([['QRD-1', 'W1']]))?.rows, [{ key: 'QRD-1', week: 1, note: null }]);
});

test('a page reference is an id, a page URL or a title', () => {
  assert.deepEqual(pageRef(' 4747 '), { id: '4747' });
  assert.deepEqual(pageRef('https://x.atlassian.net/wiki/spaces/QRD/pages/4747/Sprint+28+split'), { id: '4747' });
  assert.deepEqual(pageRef('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=88'), { id: '88' });
  assert.deepEqual(pageRef('Sprint 28 split'), { title: 'Sprint 28 split' });
  assert.equal(pageRef(''), null);
  assert.equal(pageRef('https://example.com/other'), null);
});

const page = (id: string, title: string, version = 3) => ({ id, title, version, spaceKey: 'QRD' });
const client = (over: Record<string, unknown>) => over as unknown as ConfluenceClient;

test('a title is searched under the planning parent first', async () => {
  const cql: string[] = [];
  const found = await readSplitPage(client({
    page: async () => page('9', 'Parent'),
    search: async (query: string) => { cql.push(query); return [page('42', 'Sprint 28 split')]; },
    pageBody: async (id: string) => ({ page: page(id, 'Sprint 28 split'), storage: table([['QRD-1', 'W2', 'moved']]) }),
  }), 'Sprint 28 split', '9');
  assert.match(cql[0], /ancestor = 9 AND title = "Sprint 28 split"/);
  assert.deepEqual([found.error, found.pageId, found.version, found.weeks], [null, '42', 3, { 'QRD-1': { week: 2, note: 'moved' } }]);
  assert.equal(splitTestLine(found), 'found · v3 · 1 rows');
});

test('a missing page, a page without the table and a Confluence failure come back as a reason, not a throw', async () => {
  const missing = await readSplitPage(client({ pageBody: async () => null }), '404', null);
  assert.match(missing.error!, /was not found/);
  const noTable = await readSplitPage(client({ pageBody: async () => ({ page: page('5', 'Notes'), storage: '<p>hi</p>' }) }), '5', null);
  assert.match(noTable.error!, /no table with Ticket and Week/);
  const down = await readSplitPage(client({ pageBody: async () => { throw new Error('timeout'); } }), '5', null);
  assert.match(down.error!, /timeout/);
  assert.deepEqual([missing.weeks, noTable.weeks, down.weeks], [{}, {}, {}]);
});

test('the diff lists tickets whose week differs and leaves out the kept ones', () => {
  const state: SplitState = {
    page: 'Sprint 28 split', pageId: '1', version: 3, readAt: 'now', error: null,
    weeks: { 'QRD-1': { week: 2, note: null }, 'QRD-2': { week: 1, note: 'n' }, 'QRD-3': { week: 1, note: null } }, kept: { 'QRD-3': 1 },
  };
  const view = splitView(state, [{ key: 'QRD-1', wave: 1 }, { key: 'QRD-2', wave: 1 }, { key: 'QRD-3', wave: 2 }, { key: 'QRD-4', wave: 1 }]);
  assert.deepEqual(view.diffs, [{ key: 'QRD-1', draftWeek: 1, splitWeek: 2, note: null }]);
  assert.deepEqual([view.rows, view.kept], [3, 1]);
});
