import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KitConflictList } from '../agents/library/KitConflictList';
import { conflictName, mergeProblem, mergeStart, openConflicts, type KitMergeReport } from '../agents/library/kitConflictLogic';

const report = (machine: string, paths: string[]): KitMergeReport => ({
  machine, at: '2026-11-24T09:00:00.000Z', receivedAt: '2026-11-24T09:00:01.000Z', merged: [], kept: [],
  conflicts: paths.map((path) => ({ path, kitNew: `${path}.kit-new`, reason: 'both changed the same lines', at: 'x' })),
});

test('conflicts: the chat machine comes first and only its rows can be settled here', () => {
  const rows = openConflicts([report('laptop', ['skills/a/SKILL.md']), report('workspace', ['skills/review-message/SKILL.md', 'agents/sous-verifier.md'])], 'workspace');
  assert.deepEqual(rows.map((row) => [row.machine, row.path, row.actionable]), [
    ['workspace', 'skills/review-message/SKILL.md', true],
    ['workspace', 'agents/sous-verifier.md', true],
    ['laptop', 'skills/a/SKILL.md', false],
  ]);
  assert.equal(conflictName('skills/review-message/SKILL.md'), 'review-message');
  assert.equal(conflictName('agents/sous-verifier.md'), 'agent sous-verifier');
  assert.equal(conflictName('skills/review-message/lexicon.json'), 'review-message/lexicon.json');
});

test('conflicts: the list shows use local, use kit and edit merged for each settleable conflict', () => {
  const rows = openConflicts([report('workspace', ['skills/review-message/SKILL.md']), report('laptop', ['skills/a/SKILL.md'])], 'workspace');
  const html = renderToStaticMarkup(<KitConflictList rows={rows} busy={null} onAction={() => undefined} />);
  assert.match(html, /bentrok di review-message/);
  assert.equal(html.match(/>Use local</g)?.length, 1);
  assert.equal(html.match(/>Use kit</g)?.length, 1);
  assert.match(html, /Edit merged/);
  assert.match(html, /Settle it on laptop/);
});

test('the merge editor starts from the merge with markers and saves only once every marker is gone', () => {
  const file = { path: 'skills/a/SKILL.md', local: 'local', kit: 'kit', base: 'base', merged: '<<<<<<< local\nx\n=======\ny\n>>>>>>> kit\n', clean: false };
  assert.equal(mergeStart(file), file.merged);
  assert.equal(mergeStart({ ...file, merged: null }), 'local');
  assert.match(mergeProblem(file.merged) ?? '', /<<<<<<</);
  assert.match(mergeProblem('  ') ?? '', /empty/);
  assert.equal(mergeProblem('x\ny\n'), null);
});
