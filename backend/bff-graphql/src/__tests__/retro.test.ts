import assert from 'node:assert';
import test from 'node:test';
import { median, parseRetroDraft, retroApplyPrompt, retroNumbers, retroProblems, retroTickets } from '../integrations/retro';
import { OrchestratorInputError } from '../integrations/orchestrator';

const run = (key: string, overrides: Record<string, unknown> = {}) => ({
  key, kind: 'build', title: key, stage: 'pr', closing: null, rounds: null, issues: [], failures: [], findings: [], verdict: null, ...overrides,
}) as never;
const ownerIssue = (at: string, resolvedAt: string | null) => ({ n: 1, at, type: 'QUESTION', text: 't', level: 'owner', status: resolvedAt ? 'resolved' : 'open', resolvedBy: null, resolvedAt, options: [], effects: [] });

test('numbers count builds and reviews apart, with medians of hours and of the wait on the owner', () => {
  const runs = [
    run('QRD-1', { closing: { hours: 4, fixRounds: 1, replans: 0 }, issues: [ownerIssue('2026-10-28T00:00:00Z', '2026-10-28T02:00:00Z')] }),
    run('QRD-2', { closing: { hours: 10, fixRounds: 3, replans: 1 }, issues: [ownerIssue('2026-10-28T00:00:00Z', '2026-10-28T06:00:00Z'), ownerIssue('2026-10-28T00:00:00Z', null)] }),
    run('QRD-3', { kind: 'review', verdict: 'request-change' }),
    run('QRD-4', { kind: 'review', verdict: 'approve' }),
  ];
  assert.deepStrictEqual(retroNumbers(runs), { tickets: 2, medianHours: 7, fixRounds: 2, replans: 0.5, ownerIssues: 3, medianOwnerWaitHours: 4, reviews: 2, requestChanges: 1 });
  assert.strictEqual(median([]), null);
});

test('problems count what recurs, with the tickets it hit, most frequent first', () => {
  const runs = [
    run('QRD-1', { failures: [{ type: 'GUARD', at: '', what: null, evidence: '', attempt: 1 }, { type: 'GUARD', at: '', what: null, evidence: '', attempt: 2 }] }),
    run('QRD-2', { failures: [{ type: 'GUARD', at: '', what: null, evidence: '', attempt: 1 }], findings: [{ at: '', severity: 'blocker', text: 'x', resolvedAt: null, resolvedWhy: null }] }),
  ];
  assert.deepStrictEqual(retroProblems(runs)[0], { label: 'Failure: GUARD', count: 3, tickets: ['QRD-1', 'QRD-2'] });
  assert.deepStrictEqual(retroTickets(runs).map((row) => row.key), ['QRD-1', 'QRD-2']);
});

test('a draft keeps only lines with a known kind and evidence; an unknown destination becomes a note', () => {
  const draft = parseRetroDraft({ sprint: ' QRD Sprint 26 ', items: [
    { kind: 'TRY', text: 'Intake looks for the epic copy of an artifact', evidence: ['QRD-1268: I-4'], dest: 'kit' },
    { kind: 'problem', text: 'No evidence', evidence: [] },
    { kind: 'keep', text: 'One review per ticket', evidence: ['QRD-1498'], dest: 'somewhere' },
    { kind: 'wish', text: 'x', evidence: ['y'] },
  ] });
  assert.deepStrictEqual(draft, { sprint: 'QRD Sprint 26', items: [
    { kind: 'try', text: 'Intake looks for the epic copy of an artifact', evidence: ['QRD-1268: I-4'], dest: 'kit' },
    { kind: 'keep', text: 'One review per ticket', evidence: ['QRD-1498'], dest: 'note' },
  ] });
  assert.throws(() => parseRetroDraft({ items: [] }), OrchestratorInputError);
  assert.strictEqual(retroApplyPrompt({ id: 'abc', text: 'T', dest: 'kit', evidence: ['QRD-1'] }), 'Pakai skill sous: retro apply abc\nDest: kit\nText: T\nEvidence: QRD-1');
});
