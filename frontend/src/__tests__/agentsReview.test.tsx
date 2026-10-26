import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerdictBadge } from '../agents/VerdictBadge';
import { reviewFindings } from '../agents/runs';

test('a review run shows its blockers, LGTM once approved, and nothing before a verdict', () => {
  assert.match(renderToStaticMarkup(<VerdictBadge run={{ kind: 'review', verdict: 'request-change', blockers: 2 }} />), />2 blockers</);
  assert.match(renderToStaticMarkup(<VerdictBadge run={{ kind: 'review', verdict: 'approve', blockers: 0 }} />), />LGTM</);
  assert.equal(renderToStaticMarkup(<VerdictBadge run={{ kind: 'review', verdict: null, blockers: 0 }} />), '');
  assert.equal(renderToStaticMarkup(<VerdictBadge run={{ kind: 'build', verdict: 'approve', blockers: 0 }} />), '', 'a build run has no verdict badge');
});

test('findings list blockers first, then non-blocking, then nits, each in the order written', () => {
  const ordered = reviewFindings([
    { severity: 'nit', text: 'a' }, { severity: 'blocker', text: 'b' }, { severity: 'non-blocking', text: 'c' }, { severity: 'blocker', text: 'd' },
  ]);
  assert.deepEqual(ordered.map((item) => item.text), ['b', 'd', 'c', 'a']);
});

test('a resolved finding is struck through with its reason and labelled resolved instead of its severity', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../pages/AgentsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /finding\.resolvedAt && 'text-muted-foreground line-through'/);
  assert.match(page, /Resolved: \{finding\.resolvedWhy\}/);
  assert.match(page, /finding\.resolvedAt \? 'resolved' : finding\.severity/);
  assert.match(readFileSync(new URL('../graphql/queries.ts', import.meta.url), 'utf8'), /findings \{ at severity text resolvedAt resolvedWhy \}/);
});
