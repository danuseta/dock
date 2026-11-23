import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MAX_KAMUS_ROWS, cellIssue, editorDoc, isUpperKey, issueAt, kamusChanged, kamusInput, kamusIssues, kamusTable, spokenLine, type KamusSection } from '../lib/kamus';

const table = (rows: Array<[string, string]>) => new Map(rows);
const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('Python isupper: a key is upper case when it has letters and no lower case one', () => {
  assert.equal(isUpperKey('DOCK'), true);
  assert.equal(isUpperKey('AC-1'), true);
  assert.equal(isUpperKey('Dock'), false);
  assert.equal(isUpperKey('1234'), false);
  assert.equal(isUpperKey('qonflo'), false);
});

test('Try a line replaces whole words only, case-insensitive unless the key is all upper case', () => {
  const t = table([['Qonflo', 'konflo'], ['DOCK', 'dok'], ['PR', 'pi ar']]);
  assert.equal(spokenLine('QONFLO and qonflo and Qonflo', t), 'konflo and konflo and konflo');
  assert.equal(spokenLine('DOCK ships; dock stays; DOCKS too', t), 'dok ships; dock stays; DOCKS too');
  assert.equal(spokenLine('open the PR, not the pr or PRs', t), 'open the pi ar, not the pr or PRs');
  assert.equal(spokenLine('(DOCK) "PR"-review', t), '(dok) "pi ar"-review', 'punctuation and hyphens are word breaks');
  assert.equal(spokenLine('QRD_PR PR_1 xPR', t), 'QRD_PR PR_1 xPR', 'letters, digits and underscore are word characters');
});

test('the longest key goes first, and each key runs over the text the earlier ones left, as tts.py does', () => {
  assert.equal(spokenLine('open pull request now', table([['pull', 'tarik'], ['pull request', 'pi ar']])), 'open pi ar now');
  assert.equal(spokenLine('AC1', table([['AC1', 'a ce satu'], ['AC', 'a ce']])), 'a ce satu');
  assert.equal(spokenLine('foo', table([['foo', 'bar'], ['bar', 'baz']])), 'baz', 'a replacement can be replaced by a shorter key after it');
  assert.equal(spokenLine('a $1 b', table([['a', '$&']])), '$& $1 b', 'the spoken form is plain text, never a regex replacement');
  assert.equal(spokenLine('', table([['a', 'b']])), '');
  assert.equal(spokenLine('C++ and c++', table([['C++', 'si plus plus']])), 'si plus plus and c++', 'an upper case key stays case-sensitive');
});

test('the table skips rows with an empty cell and trims the rest', () => {
  const sections: KamusSection[] = [{ title: 'A', rows: [{ written: ' DOCK ', spoken: ' dok ' }, { written: 'x', spoken: '' }, { written: '', spoken: 'y' }] }];
  assert.deepEqual([...kamusTable(sections)], [['DOCK', 'dok']]);
});

test('a cell is refused when empty, over 80 characters, or holding | a newline or a backtick', () => {
  assert.equal(cellIssue('Written', '  '), 'written is empty');
  assert.equal(cellIssue('Spoken', 'a|b'), 'spoken cannot hold the | character');
  assert.equal(cellIssue('Spoken', 'a\nb'), 'spoken must be one line');
  assert.equal(cellIssue('Written', 'a`b'), 'written cannot hold backticks');
  assert.equal(cellIssue('Written', 'x'.repeat(81)), 'written is at most 80 characters');
  assert.equal(cellIssue('Written', 'x'.repeat(80)), null);
});

test('row issues point at the section, row and field; duplicates are found across sections, ignoring case', () => {
  const sections: KamusSection[] = [
    { title: 'A', rows: [{ written: 'DOCK', spoken: 'dok' }, { written: '', spoken: 'x' }] },
    { title: 'B', rows: [{ written: 'dock', spoken: 'dok' }, { written: 'Tulisan', spoken: 'x' }] },
  ];
  const issues = kamusIssues(sections);
  assert.equal(issueAt(issues, 0, 1, 'written'), 'written is empty');
  assert.equal(issueAt(issues, 1, 0, 'written'), '"dock" is already in the list (A, row 1)');
  assert.match(issueAt(issues, 1, 1, 'written') ?? '', /reads as a table header/);
  assert.equal(issueAt(issues, 0, 0, 'written'), null);
  assert.deepEqual(kamusIssues([{ title: 'A', rows: [{ written: 'a', spoken: 'b' }] }]), []);
});

test('sections need a title once there are several, and the list stops at 500 rows', () => {
  assert.deepEqual(kamusIssues([{ title: '', rows: [] }]), []);
  assert.deepEqual(kamusIssues([{ title: 'A', rows: [] }, { title: ' ', rows: [] }]).map((item) => [item.section, item.field]), [[1, 'title']]);
  const rows = Array.from({ length: MAX_KAMUS_ROWS + 1 }, (_, index) => ({ written: `w${index}`, spoken: 's' }));
  assert.match(kamusIssues([{ title: 'A', rows }]).find((item) => item.field === 'list')?.message ?? '', /at most 500 rows; it has 501/);
  assert.equal(kamusIssues([{ title: 'A', rows: rows.slice(0, MAX_KAMUS_ROWS) }]).length, 0);
});

test('the editor starts from a copy, with one empty section when the list has none, and knows when it changed', () => {
  const doc = { intro: 'Hi', sections: [{ title: 'A', rows: [{ written: 'a', spoken: 'b' }] }] };
  const edit = editorDoc(doc);
  assert.deepEqual(edit, doc);
  edit.sections[0].rows[0].spoken = 'changed';
  assert.equal(doc.sections[0].rows[0].spoken, 'b', 'the loaded list is not touched');
  assert.equal(kamusChanged(doc, edit), true);
  assert.equal(kamusChanged(doc, editorDoc(doc)), false);
  assert.deepEqual(editorDoc({ intro: '', sections: [] }).sections, [{ title: '', rows: [] }]);
  assert.deepEqual(kamusInput({ intro: ' x ', sections: [{ title: ' A ', rows: [{ written: ' a ', spoken: ' b ' }] }] }), { intro: 'x', sections: [{ title: 'A', rows: [{ written: 'a', spoken: 'b' }] }] });
});

test('the kamus entry of Blackboard offers Edit, Save, Cancel with a guard, Add row, Add section and Try a line', () => {
  const view = source('../pages/blackboard/KamusView.tsx');
  for (const text of ['Edit</Button>', 'Add row', 'Add section', 'Try a line', 'Discard your changes?', 'Keep editing', "{loading ? 'Saving...' : 'Save'}", 'Cancel']) assert.ok(view.includes(text), text);
  assert.match(view, /max-\[760px\]:grid-cols-\[minmax\(0,1fr\)_2\.75rem\]/, 'on a phone the cells stack');
  assert.match(source('../pages/BlackboardPage.tsx'), /<KamusView text=\{kamus\}/);
  assert.match(source('../graphql/queries.ts'), /saveKamus\(sections: \$sections, intro: \$intro\)/);
});
