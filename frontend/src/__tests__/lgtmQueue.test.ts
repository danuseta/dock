import assert from 'node:assert';
import test from 'node:test';
import { canLgtm } from '../agents/runs';
import { queuedText, runningBeside, type ChatSession } from '../chat/messages';

test('LGTM is offered only on an approved review DOCK has not sent yet', () => {
  const review = { kind: 'review', verdict: 'approve' as const, approved: false, sample: false };
  assert.strictEqual(canLgtm(review), true);
  assert.strictEqual(canLgtm({ ...review, approved: true }), false);
  assert.strictEqual(canLgtm({ ...review, verdict: 'request-change' }), false);
  assert.strictEqual(canLgtm({ ...review, verdict: null }), false);
  assert.strictEqual(canLgtm({ ...review, kind: 'build' }), false);
  assert.strictEqual(canLgtm({ ...review, sample: true }), false);
});

const session = (id: string, status: string, machine: string, title = id) => ({ id, status, machine, title }) as ChatSession;

test('a queued message names the turns running ahead of it on the same machine', () => {
  const mine = session('a', 'queued', 'workspace');
  const all = [mine, session('b', 'running', 'workspace', 'review QRD-1465'), session('c', 'running', 'laptop'), session('d', 'idle', 'workspace'), session('e', 'running', 'workspace', 'review QRD-1347')];
  const ahead = runningBeside(mine, all);
  assert.deepStrictEqual(ahead, ['review QRD-1465', 'review QRD-1347']);
  assert.strictEqual(queuedText('workspace', ahead), 'Queued · 2 other turns are running on workspace: review QRD-1465, review QRD-1347. It starts when one ends.');
  assert.strictEqual(queuedText('workspace', ['x']), 'Queued · 1 other turn is running on workspace: x. It starts when one ends.');
  assert.strictEqual(queuedText('workspace', []), 'Queued · waiting for the workspace bridge to pick it up');
});
