import assert from 'node:assert';
import test from 'node:test';
import { csvRows, hasSource, viewKind } from '../chat/interactions/attachmentView';

const file = (name: string, mime: string, state = 'sent') => ({ name, mime, state });

test('each stored file type opens in its own view', () => {
  assert.strictEqual(viewKind(file('shot.png', 'image/png')), 'image');
  assert.strictEqual(viewKind(file('report.pdf', 'application/pdf')), 'pdf');
  assert.strictEqual(viewKind(file('proposal.html', 'text/plain')), 'html');
  assert.strictEqual(viewKind(file('NOW.md', 'text/markdown')), 'markdown');
  assert.strictEqual(viewKind(file('counts.csv', 'text/csv')), 'csv');
  assert.strictEqual(viewKind(file('vitest.log', 'text/plain')), 'text');
  assert.strictEqual(viewKind(file('data.json', 'application/json')), 'text');
  assert.strictEqual(viewKind(file('diff.patch', 'application/octet-stream')), 'text');
});

test('a deleted or unknown file has no view', () => {
  assert.strictEqual(viewKind(file('shot.png', 'image/png', 'deleted')), null);
  assert.strictEqual(viewKind(file('archive.zip', 'application/octet-stream')), null);
});

test('only html, markdown and csv offer a source toggle', () => {
  assert.ok(hasSource('html') && hasSource('markdown') && hasSource('csv'));
  assert.ok(!hasSource('pdf') && !hasSource('text') && !hasSource('image'));
});

test('csv rows keep quoted commas and quotes', () => {
  assert.deepStrictEqual(csvRows('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepStrictEqual(csvRows('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});
