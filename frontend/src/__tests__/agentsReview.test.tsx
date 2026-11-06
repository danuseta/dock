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

test('LgtmButton shows LGTM for an approve verdict, Approved once approved, and nothing for request-change', async () => {
  const { LgtmButton } = await import('../agents/lgtm');
  const render = (run: Record<string, unknown>) => renderToStaticMarkup(<LgtmButton run={{ key: 'QRD-1', kind: 'review', ...run } as never} busy={false} onLgtm={() => undefined} />);
  assert.match(render({ verdict: 'approve', blockers: 0 }), />LGTM</);
  assert.match(render({ verdict: 'approve', blockers: 0, approved: true }), />Approved</);
  assert.equal(render({ verdict: 'request-change', blockers: 2 }), '');
});

test('lgtmResult reports success and the failed steps', async () => {
  const { lgtmResult } = await import('../agents/lgtmCopy');
  assert.deepEqual(lgtmResult('QRD-1', [{ name: 'label', ok: true, detail: '' }]), { message: 'LGTM sent for QRD-1: Jira Pass label added and the pull requests approved.', type: 'success' });
  const partial = lgtmResult('QRD-1', [{ name: 'label', ok: true, detail: '' }, { name: 'approve', ok: false, detail: 'no token' }]);
  assert.equal(partial.type, 'error');
  assert.equal(partial.message, '1 of 2 steps failed: approve (no token)');
});

test('the session inspector runs APPROVE_REVIEW and shows the verdict badge, hidden on the monitor-only DOCK', async () => {
  const { readFileSync } = await import('node:fs');
  const inspector = readFileSync(new URL('../chat/SessionInspector.tsx', import.meta.url), 'utf8');
  assert.match(inspector, /useMutation\(APPROVE_REVIEW/);
  assert.match(inspector, /<VerdictBadge run=\{run\} \/>/);
  assert.match(inspector, /!monitorsOnly\(mode\)/);
  assert.match(readFileSync(new URL('../pages/AgentsPage.tsx', import.meta.url), 'utf8'), /from '\.\.\/agents\/lgtm'/);
});
