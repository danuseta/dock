import assert from 'node:assert';
import test from 'node:test';
import { paginate } from '../lib/pagination';

const items = Array.from({ length: 45 }, (_, index) => index + 1);

test('a page holds its slice of the list, and the count of pages rounds up', () => {
  assert.deepStrictEqual(paginate(items, 1, 20), { items: items.slice(0, 20), page: 1, pages: 3 });
  assert.deepStrictEqual(paginate(items, 3, 20).items, [41, 42, 43, 44, 45]);
});

test('a page past the end clamps to the last page, so a delete never leaves an empty page', () => {
  assert.strictEqual(paginate(items.slice(0, 40), 3, 20).page, 2);
  assert.deepStrictEqual(paginate(items.slice(0, 40), 3, 20).items, items.slice(20, 40));
});

test('an empty list is one empty page, and a bad page number reads as the first', () => {
  assert.deepStrictEqual(paginate([], 4, 20), { items: [], page: 1, pages: 1 });
  assert.strictEqual(paginate(items, 0, 20).page, 1);
  assert.strictEqual(paginate(items, Number.NaN, 20).page, 1);
});
