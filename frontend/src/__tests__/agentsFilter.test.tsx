import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KindBadge } from '../agents/KindBadge';
import { kindLabel, matchesRunFilter, runFilterFromSearch, runFilterSearch } from '../agents/runs';
import { AgentRunStrip } from '../components/AgentRunStrip';

test('agents filter: read from and written to the URL, unknown values mean all', () => {
  assert.deepStrictEqual(runFilterFromSearch(''), { machine: null, kind: null });
  assert.deepStrictEqual(runFilterFromSearch('?machine=laptop&kind=review'), { machine: 'laptop', kind: 'review' });
  assert.deepStrictEqual(runFilterFromSearch('?machine=desktop&kind=build'), { machine: null, kind: null });

  assert.strictEqual(runFilterSearch('', { machine: 'workspace', kind: 'task' }), '?machine=workspace&kind=task');
  assert.strictEqual(runFilterSearch('?machine=laptop&kind=review', { machine: null, kind: null }), '');
  assert.strictEqual(runFilterSearch('?other=1&machine=laptop', { machine: null, kind: 'review' }), '?other=1&kind=review', 'other parameters stay');
});

test('agents filter: machine and type, a run without either is a laptop task', () => {
  const laptopReview = { machine: 'laptop', kind: 'review' };
  const workspaceBuild = { machine: 'workspace', kind: 'build' };
  const old = { machine: null, kind: undefined };
  const all = [laptopReview, workspaceBuild, old];
  const keep = (machine: 'laptop' | 'workspace' | null, kind: 'review' | 'task' | null) => all.filter((run) => matchesRunFilter(run, { machine, kind }));

  assert.deepStrictEqual(keep(null, null), all);
  assert.deepStrictEqual(keep('laptop', null), [laptopReview, old]);
  assert.deepStrictEqual(keep('workspace', null), [workspaceBuild]);
  assert.deepStrictEqual(keep(null, 'review'), [laptopReview]);
  assert.deepStrictEqual(keep(null, 'task'), [workspaceBuild, old]);
  assert.deepStrictEqual(keep('workspace', 'review'), []);
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
