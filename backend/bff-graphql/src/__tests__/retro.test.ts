import assert from 'node:assert';
import test from 'node:test';
import { labelCauses, median, parseRetroDraft, qaEscalations, retroApplyPrompt, retroNumbers, retroProblems, retroTickets, runsInWindow, triageSuggestions } from '../integrations/retro';
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
  assert.deepStrictEqual(retroNumbers(runs), { tickets: 2, medianHours: 7, fixRounds: 2, replans: 0.5, ownerIssues: 3, medianOwnerWaitHours: 4, ownerWaitHours: 8, reviews: 2, requestChanges: 1, blockedWaits: 0, mergeConflicts: 0, stackedRebases: 0 });
  const stacked = [run('QRD-5', { stackedOn: { key: 'QRD-1', be: { retargetedAt: '2026-10-28T00:00:00Z' }, fe: { retargetedAt: null } } }), run('QRD-6', { stackedOn: { key: 'QRD-1', be: null, fe: { retargetedAt: '2026-10-29T00:00:00Z' } } })];
  assert.deepStrictEqual(retroNumbers(stacked, { blockedWaits: 3, mergeConflicts: 2 }), { ...retroNumbers([]), tickets: 2, fixRounds: 0, replans: 0, blockedWaits: 3, mergeConflicts: 2, stackedRebases: 2 });
  assert.strictEqual(median([]), null);
});

test('problems count what recurs, with the tickets it hit, most frequent first', () => {
  const runs = [
    run('QRD-1', { failures: [{ type: 'GUARD', at: '', what: null, evidence: '', attempt: 1 }, { type: 'GUARD', at: '', what: null, evidence: '', attempt: 2 }] }),
    run('QRD-2', { failures: [{ type: 'GUARD', at: '', what: null, evidence: '', attempt: 1 }], findings: [{ at: '', severity: 'blocker', text: 'x', resolvedAt: null, resolvedWhy: null }] }),
  ];
  assert.deepStrictEqual(retroProblems(runs)[0], { label: 'Failure: GUARD', count: 3, tickets: ['QRD-1', 'QRD-2'] });
  assert.deepStrictEqual(retroTickets(runs).map((row) => [row.key, row.findings]), [['QRD-1', 0], ['QRD-2', 1]]);
});

test('a draft keeps only lines with a known kind and evidence; an unknown destination becomes a note', () => {
  const draft = parseRetroDraft({ sprint: ' QRD Sprint 26 ', items: [
    { kind: 'TRY', text: 'Intake looks for the epic copy of an artifact', evidence: ['QRD-1268: I-4'], dest: 'kit' },
    { kind: 'problem', text: 'No evidence', evidence: [] },
    { kind: 'keep', text: 'One review per ticket', evidence: ['QRD-1498'], dest: 'somewhere' },
    { kind: 'wish', text: 'x', evidence: ['y'] },
  ] });
  assert.deepStrictEqual(draft, { sprint: 'QRD Sprint 26', items: [
    { kind: 'try', text: 'Intake looks for the epic copy of an artifact', evidence: ['QRD-1268: I-4'], dest: 'kit', source: 'ledger' },
    { kind: 'keep', text: 'One review per ticket', evidence: ['QRD-1498'], dest: 'note', source: 'ledger' },
  ], sources: ['ledger'] });
  assert.throws(() => parseRetroDraft({ items: [] }), OrchestratorInputError);
  const judged = parseRetroDraft({ sprint: 'S', items: [{ kind: 'problem', text: 'Guard refusal goes to the owner', evidence: ['QA-QRD-1516'], dest: 'kit', source: 'judge' }, { kind: 'try', text: 'x', evidence: ['e'], source: 'elsewhere' }] });
  assert.deepStrictEqual(judged.items.map((item) => item.source), ['judge', 'ledger'], 'an unknown source is the ledger');
  assert.deepStrictEqual(judged.sources, ['judge', 'ledger']);
  assert.deepStrictEqual(parseRetroDraft({ sprint: 'S', source: 'judge', items: [] }).sources, ['judge'], 'an empty Judge draft clears only the open Judge lines');
  assert.strictEqual(retroApplyPrompt({ id: 'abc', text: 'T', dest: 'kit', evidence: ['QRD-1'] }), 'Pakai skill sous: retro apply abc\nDest: kit\nText: T\nEvidence: QRD-1');
});

test('QA escalations count the team by cause from labels, and the ones Planning missed become triage rules for the QA bot', () => {
  const issues = [
    { key: 'QRD-1286', summary: 'Two accounts', labels: ['QA-MANUAL'], events: [] },
    { key: 'QRD-1511', summary: 'Edit client', labels: [], events: [{ field: 'labels', to: 'QA-BLOCKED-DEPENDENCY QA-ESCALATED' }] },
    { key: 'QRD-1498', summary: 'Published tool', labels: ['qa-blocked-data'], events: [] },
    { key: 'QRD-1500', summary: 'Mixed', labels: ['QA-ESCALATED'], events: [] },
    { key: 'QRD-1600', summary: 'Clean', labels: ['QA-PASSED'], events: [] },
  ];
  const predictions = new Map<string, string | null>([['QRD-1286', 'ESCALATED'], ['QRD-1511', 'LOLOS'], ['QRD-1498', null]]);
  const escalations = qaEscalations(issues, predictions);
  assert.strictEqual(escalations.tickets, 4);
  assert.deepStrictEqual(escalations.causes.map((row) => [row.cause, row.count]), [['dependency', 1], ['access', 1], ['data', 1], ['unspecified', 1]]);
  assert.deepStrictEqual(escalations.unpredicted.map((item) => [item.key, item.causes, item.prediction]), [
    ['QRD-1498', ['data'], null], ['QRD-1500', ['unspecified'], null], ['QRD-1511', ['dependency'], 'LOLOS'],
  ]);
  const rules = triageSuggestions(escalations);
  assert.deepStrictEqual(rules.map((rule) => [rule.dest, rule.kind]), [['qa-agent', 'try'], ['qa-agent', 'try'], ['qa-agent', 'try']]);
  assert.match(rules[0].text, /blockedReason dependency/);
  assert.deepStrictEqual(rules[0].evidence, ['QRD-1511 escalated (dependency); Planning predicted LOLOS']);
  assert.deepStrictEqual(qaEscalations(issues, null).unpredicted, [], 'no Planning draft, nothing to compare');
  assert.deepStrictEqual(labelCauses('QA-BLOCKED-ENV'), ['environment']);
  const window = { from: new Date('2026-11-12T09:16:00Z'), to: new Date('2026-11-26T09:16:00Z') };
  const dated = [
    { key: 'QRD-1287', labels: ['QA-ESCALATED'], events: [{ field: 'labels', at: '2026-11-13T10:00:00.000+0800', from: 'QRD26', to: 'QRD26 QA-ESCALATED' }] },
    { key: 'QRD-1271', labels: ['QA-ESCALATED'], events: [{ field: 'labels', at: '2026-11-05T10:00:00.000+0800', from: '', to: 'QA-ESCALATED' }, { field: 'labels', at: '2026-11-13T10:00:00.000+0800', from: 'QA-ESCALATED', to: 'QA-ESCALATED QRD27' }] },
  ];
  assert.deepStrictEqual(qaEscalations(dated, null, window).causes.map((row) => row.tickets), [['QRD-1287']], 'with the sprint dates only a label added inside them counts');
  assert.deepStrictEqual(parseRetroDraft({ sprint: 'S', items: [{ kind: 'try', text: 'x', evidence: ['e'], dest: 'qa-agent' }] }).items[0].dest, 'qa-agent');
});

test('a sprint holds only the runs that worked inside its dates, with the failures, findings, issues and retargets of those dates', () => {
  const window = { from: new Date('2026-11-12T09:16:00Z'), to: new Date('2026-11-26T09:16:00Z') };
  const before = '2026-11-05T00:00:00Z';
  const inside = '2026-11-13T00:00:00Z';
  const runs = [
    run('QRD-1268', { updatedAt: before, failures: [{ type: 'env', at: before, what: null, evidence: '', attempt: 1 }] }),
    run('QRD-1305', { kind: 'review', updatedAt: inside, findings: [{ at: before, severity: 'nit', text: 'old', resolvedAt: null, resolvedWhy: null }, { at: inside, severity: 'nit', text: 'new', resolvedAt: null, resolvedWhy: null }] }),
    run('QRD-1516', { updatedAt: before, issues: [ownerIssue(inside, null)], stackedOn: { key: 'QRD-1', be: { retargetedAt: before }, fe: { retargetedAt: inside } } }),
  ] as Array<never>;
  const kept = runsInWindow(runs, window) as Array<{ key: string; findings: unknown[]; issues: unknown[]; stackedOn: { be: { retargetedAt: string | null } } | null }>;
  assert.deepStrictEqual(kept.map((item) => item.key), ['QRD-1305', 'QRD-1516'], 'a run whose work all came before the sprint is left out');
  assert.strictEqual(kept[0].findings.length, 1);
  assert.strictEqual(kept[1].issues.length, 1);
  assert.strictEqual(retroNumbers(kept as never).stackedRebases, 1, 'a retarget before the sprint is not counted');
});
