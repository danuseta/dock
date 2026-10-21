import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KindBadge } from '../agents/KindBadge';
import { kindLabel, matchesRunFilter, runActions, runFilterFromSearch, runFilterSearch } from '../agents/runs';
import { AgentRunStrip } from '../components/AgentRunStrip';

test('agents filter: read from and written to the URL, unknown values mean all', () => {
  assert.deepStrictEqual(runFilterFromSearch(''), { kind: null });
  assert.deepStrictEqual(runFilterFromSearch('?kind=review'), { kind: 'review' });
  assert.deepStrictEqual(runFilterFromSearch('?machine=laptop&kind=build'), { kind: null });

  assert.strictEqual(runFilterSearch('', { kind: 'task' }), '?kind=task');
  assert.strictEqual(runFilterSearch('?kind=review', { kind: null }), '');
  assert.strictEqual(runFilterSearch('?other=1', { kind: 'review' }), '?other=1&kind=review', 'other parameters stay');
});

test('agents filter: by type, a run without one is a task', () => {
  const review = { kind: 'review' };
  const build = { kind: 'build' };
  const old = { kind: undefined };
  const all = [review, build, old];
  const keep = (kind: 'review' | 'task' | null) => all.filter((run) => matchesRunFilter(run, { kind }));

  assert.deepStrictEqual(keep(null), all);
  assert.deepStrictEqual(keep('review'), [review]);
  assert.deepStrictEqual(keep('task'), [build, old]);
});

test('agents badges: Review or Task with an icon, the strip in plain text', () => {
  assert.deepStrictEqual([kindLabel('review'), kindLabel('build'), kindLabel(undefined)], ['Review', 'Task', 'Task']);
  const review = renderToStaticMarkup(<KindBadge kind="review" />);
  assert.match(review, />Review</);
  assert.match(review, /<svg/);
  assert.doesNotMatch(renderToStaticMarkup(<KindBadge kind="build" icon={false} />), /<svg/);

  const strip = renderToStaticMarkup(<AgentRunStrip run={{ key: 'QRD-1', stage: 'code', acPassed: 1, acFailed: 0, acTotal: 3, activity: 'ACTIVE', stalled: false, machine: 'workspace', kind: 'review' }} />);
  assert.match(strip, />workspace</);
  assert.match(strip, />Review</);
  assert.match(renderToStaticMarkup(<AgentRunStrip run={{ key: 'QRD-2', stage: 'code', acPassed: 0, acFailed: 0, acTotal: 0, activity: 'IDLE', stalled: false }} />), />laptop<.*>Task</);
});

test('agents actions: the monitoring DOCK offers no control, a sample offers nothing', () => {
  assert.deepStrictEqual(runActions({}, false), { hide: true, confirm: true, chat: true });
  assert.deepStrictEqual(runActions({}, true), { hide: false, confirm: false, chat: false });
  assert.deepStrictEqual(runActions({ sample: true }, false), { hide: false, confirm: false, chat: false });
});
