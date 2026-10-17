import assert from 'node:assert';
import test from 'node:test';
import { moveToReview } from '../integrations/broadcast-review';

test('a broadcast moves the tickets before review to PR Review and never moves one back', async () => {
  const moves: Array<[string, string]> = [];
  const notMoved = await moveToReview(
    [
      { key: 'ZED-1', status: 'To Do' },
      { key: 'ZED-2', status: 'In Progress' },
      { key: 'ZED-3', status: 'PR Review' },
      { key: 'ZED-4', status: 'UAT MERGED' },
      { key: 'ZED-5', status: 'Done / MERGED' },
      { key: 'ZED-6', status: ' in progress ' },
    ],
    async (key, status) => { moves.push([key, status]); return key !== 'ZED-6'; },
  );
  assert.deepStrictEqual(moves, [['ZED-1', 'PR Review'], ['ZED-2', 'PR Review'], ['ZED-6', 'PR Review']]);
  assert.deepStrictEqual(notMoved, ['ZED-6'], 'a ticket Jira would not move is reported, the rest still move');
});
