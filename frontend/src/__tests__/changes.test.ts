import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERAL, anchorFindings, tokensOf, type ChangesFinding } from '../changes/findings';
import { gapBefore, hideWhitespace, parsePatch, splitRows } from '../changes/patch';
import { isViewed, patchHash, readView, readViewed } from '../changes/prefs';

const PATCH = [
  '@@ -1716,10 +1716,14 @@ async executeFillColumnFormula(',
  '   const rows = await this.rows.findByTable(tableId);',
  '-  await this.storage.bulkInsertRows(next);',
  '+  const rotated = await this.storage.bulkInsertRows(next);',
  '+  await this.storage.retireRowsByIds(previous);',
  '   } finally {',
  '\\ No newline at end of file',
  '@@ -2166 +2170,2 @@',
  '-a',
  '+a  ',
  '+b',
].join('\n');

test('a patch reads as hunks with old and new line numbers', () => {
  const hunks = parsePatch(PATCH);
  assert.deepStrictEqual(hunks.map((hunk) => [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount, hunk.section]), [[1716, 10, 1716, 14, 'async executeFillColumnFormula('], [2166, 1, 2170, 2, '']]);
  assert.deepStrictEqual(hunks[0].lines.map((line) => [line.kind, line.oldLine, line.newLine]), [['context', 1716, 1716], ['del', 1717, null], ['add', null, 1717], ['add', null, 1718], ['context', 1718, 1719]]);
  assert.deepStrictEqual([gapBefore(hunks, 0), gapBefore(hunks, 1)], [1715, 2170 - 1730]);
  assert.deepStrictEqual(parsePatch(null), []);
});

test('split view pairs a run of deletions with the additions after it', () => {
  const rows = splitRows(parsePatch(PATCH)[0].lines);
  assert.deepStrictEqual(rows.map((row) => [row.left?.kind ?? null, row.right?.kind ?? null]), [['context', 'context'], ['del', 'add'], [null, 'add'], ['context', 'context']]);
});

test('hide whitespace folds a run that changed only spaces and keeps any other run', () => {
  const [, spaces] = parsePatch(PATCH);
  assert.deepStrictEqual(hideWhitespace(spaces.lines).map((line) => line.kind), ['del', 'add', 'add'], 'two additions for one deletion is a real change');
  const only = parsePatch('@@ -1,2 +1,2 @@\n-  a\n-b\n+a\n+ b ');
  assert.deepStrictEqual(hideWhitespace(only[0].lines).map((line) => [line.kind, line.oldLine, line.newLine]), [['context', 1, 1], ['context', 2, 2]]);
});

test('path:line tokens come from the text, a bare :line takes the path before it', () => {
  assert.deepStrictEqual(tokensOf('mode collapsed (data-sidebar.tsx:322-361), SS 07'), [{ path: 'data-sidebar.tsx', line: 322 }]);
  assert.deepStrictEqual(tokensOf('T4: bootstrap.sh:19 passes on SKIP; :17 node may be off PATH; :7 clone'), [{ path: 'bootstrap.sh', line: 19 }, { path: 'bootstrap.sh', line: 17 }, { path: 'bootstrap.sh', line: 7 }]);
  assert.deepStrictEqual(tokensOf('kit/brain.py:442 falls back'), [{ path: 'kit/brain.py', line: 442 }]);
  assert.deepStrictEqual(tokensOf('ccfg:121 doctor acl-probe'), [], 'a name without an extension is not a path');
});

const finding = (text: string, resolved = false): ChangesFinding => ({ at: '2026-10-26T09:00:00.000Z', severity: 'blocker', text, resolvedAt: resolved ? '2026-10-27T09:00:00.000Z' : null, resolvedWhy: resolved ? 'fixed' : null });

test('findings sit on their line, at the top of a file, or under General', () => {
  const files = [
    { path: 'src/services/data-table-formula.service.ts', hunks: parsePatch(PATCH) },
    { path: 'docs/features/datapoints/contacts-data.md', hunks: parsePatch('@@ -0,0 +58,1 @@\n+| field | meaning |') },
  ];
  const { anchors, counts } = anchorFindings(files, [
    finding('data-table-formula.service.ts:1718 misses the projector call; also :2171', true),
    finding('contacts-data.md:58 omits closedAt'),
    finding('data-table-formula.service.ts:40 not in the diff'),
    finding('AC6 evidence comes from in-memory MongoDB'),
    finding('other/file.ts:3 is not in this PR'),
  ]);
  assert.deepStrictEqual(anchors.map((anchor) => [anchor.finding, anchor.path?.split('/').pop() ?? GENERAL, anchor.line, `${anchor.part}/${anchor.parts}`]), [
    [3, GENERAL, null, '1/1'],
    [4, GENERAL, null, '1/1'],
    [2, 'data-table-formula.service.ts', null, '1/1'],
    [0, 'data-table-formula.service.ts', 1718, '1/2'],
    [0, 'data-table-formula.service.ts', 2171, '2/2'],
    [1, 'contacts-data.md', 58, '1/1'],
  ]);
  assert.strictEqual(anchors[2].named, 40, 'the line outside the diff is still named');
  assert.deepStrictEqual(counts, { [GENERAL]: { open: 2, total: 2 }, 'src/services/data-table-formula.service.ts': { open: 1, total: 2 }, 'docs/features/datapoints/contacts-data.md': { open: 1, total: 1 } });
});

test('a file stays viewed only while its patch is the same; storage that throws reads as nothing', () => {
  const viewed = { 'a.ts': patchHash('@@ -1 +1 @@\n-a\n+b') };
  assert.ok(isViewed(viewed, 'a.ts', '@@ -1 +1 @@\n-a\n+b'));
  assert.ok(!isViewed(viewed, 'a.ts', '@@ -1 +1 @@\n-a\n+c'));
  const original = globalThis.window;
  Object.assign(globalThis, { window: { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } } });
  try {
    assert.deepStrictEqual([readView(), readViewed('u')], ['unified', {}]);
  } finally {
    Object.assign(globalThis, { window: original });
  }
});

test('the Changes page is a route in both modes and the phone shows unified only', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /path === '\/changes'/);
  assert.match(app, /case '\/changes': return/);
  const mode = readFileSync(new URL('../lib/dockMode.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mode, /'\/changes'/);
  const page = readFileSync(new URL('../pages/ChangesPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const view: DiffView = phone \? 'unified' : chosenView;/);
});
