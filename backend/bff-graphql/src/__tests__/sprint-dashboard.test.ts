import assert from 'node:assert';
import test from 'node:test';
import { JiraSprintClient, retryOn429, type JiraHttp } from '../integrations/jira-sprint';
import {
  SprintBusyError, SprintDashboardService, SprintInputError, parseSprintConfig,
  type SnapshotRow, type SprintStore,
} from '../integrations/sprint-dashboard';
import { nextRunAt } from '../integrations/sprint-scheduler';
import {
  DEFAULT_SPRINT_CONFIG, RULES_VERSION, buildTrend, computeSprintMetrics, detectRoster, roundHalfEven,
  type SprintConfig, type SprintEvent, type SprintIssue, type SprintResult,
} from '../integrations/sprint-metrics';

const ANN = 'Ann Alpha';
const BOB = 'Bob Beta';
const config: SprintConfig = {
  ...DEFAULT_SPRINT_CONFIG,
  roster: [
    { full: ANN, short: 'Ann', token: 'annPass' },
    { full: BOB, short: 'Bob', token: 'bobPass' },
  ],
};
const window = { id: 5, name: 'QRD Sprint 5', state: 'active' as const, start: '2026-01-05T02:00:00Z', end: '2026-01-19T02:00:00Z' };

const at = (day: number, hour = 10) => `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000+0800`;
const ev = (when: string, by: string, field: string, from: string | null, to: string | null): SprintEvent => ({ at: when, by, field, from, to });
const status = (when: string, by: string, from: string, to: string) => ev(when, by, 'status', from, to);

const issues: SprintIssue[] = [
  {
    key: 'K-1', summary: 'Carried task', created: '2025-12-15T10:00:00.000+0800', type: 'Task', status: 'UAT MERGED', assignee: ANN, sp: 3, labels: ['QRD4', 'QRD5'],
    events: [
      ev('2025-12-20T10:00:00.000+0800', ANN, 'Sprint', '', 'QRD Sprint 4'),
      ev('2026-01-03T10:00:00.000+0800', ANN, 'Sprint', 'QRD Sprint 4', 'QRD Sprint 4, QRD Sprint 5'),
      status(at(6), ANN, 'To Do', 'In Progress'),
      status(at(7), ANN, 'In Progress', 'PR Review'),
      status(at(8), BOB, 'PR Review', 'In Progress'),
      status(at(9), ANN, 'In Progress', 'PR Review'),
      status(at(12), BOB, 'PR Review', 'UAT MERGED'),
    ],
  },
  {
    key: 'K-2', summary: 'Mid-sprint bug', created: at(6, 9), type: 'Bug', status: 'UAT BUG / Improvement', assignee: ANN, sp: 2, labels: ['QRD5', 'bobPass'],
    events: [
      ev(at(6, 9), ANN, 'Story point estimate', null, '2'),
      status(at(7), ANN, 'To Do', 'In Progress'),
      status(at(8), ANN, 'In Progress', 'UAT CHECK'),
      ev(at(8, 11), BOB, 'labels', '', 'bobPass'),
      status(at(12), BOB, 'UAT CHECK', 'UAT BUG / Improvement'),
    ],
  },
  {
    key: 'K-3', summary: 'Clean task', created: '2026-01-01T10:00:00.000+0800', type: 'Task', status: 'ReadyForProduction', assignee: BOB, sp: 5, labels: ['QRD5', 'annPass'],
    events: [
      status(at(6), BOB, 'To Do', 'In Progress'),
      status(at(7), BOB, 'In Progress', 'PR Review'),
      ev(at(8, 9), ANN, 'labels', '', 'annPass'),
      status(at(8, 11), ANN, 'PR Review', 'UAT MERGED'),
      status(at(9), BOB, 'UAT MERGED', 'UAT CHECK'),
      status(at(12), ANN, 'UAT CHECK', 'ReadyForProduction'),
    ],
  },
  { key: 'K-4', summary: 'Someone else', created: at(6), type: 'Task', status: 'To Do', assignee: 'Out Sider', sp: 8, labels: ['QRD5'], events: [] },
  {
    key: 'K-5', summary: 'Pulled out mid-sprint', created: '2026-01-01T10:00:00.000+0800', type: 'Task', status: 'To Do', assignee: ANN, sp: 4, labels: ['QRD5'],
    events: [
      ev('2026-01-03T10:00:00.000+0800', ANN, 'Sprint', '', 'QRD Sprint 5'),
      ev(at(8), ANN, 'Sprint', 'QRD Sprint 5', ''),
    ],
  },
  { key: 'K-6', summary: 'Documentation: handbook', created: '2026-01-01T10:00:00.000+0800', type: 'Task', status: 'To Do', assignee: BOB, sp: 1, labels: ['QRD5'], events: [] },
  { key: 'K-7', summary: 'In the sprint but never labelled', created: '2026-01-01T10:00:00.000+0800', type: 'Task', status: 'To Do', assignee: ANN, sp: 9, labels: [], events: [] },
];

test('computeSprintMetrics applies the sprint rules to a small synthetic sprint', () => {
  const result = computeSprintMetrics(window, issues, config);

  assert.deepStrictEqual(
    { total: result.overview.totalSP, alloc: result.overview.allocated, carry: result.overview.carryover, bug: result.overview.bugSP, devs: result.overview.developers },
    { total: 11, alloc: 6, carry: 3, bug: 2, devs: 2 },
  );
  assert.deepStrictEqual(
    result.notes.excluded.map((e) => [e.key, e.reason]),
    [['K-5', 'removed-from-sprint']],
  );
  assert.strictEqual(result.notes.noSprintLabel, 1, 'K-7 has no QRD5 label, so it is not part of the sprint');

  const ann = result.pr.find((r) => r.dev === 'Ann')!;
  const bob = result.pr.find((r) => r.dev === 'Bob')!;
  assert.deepStrictEqual([ann.passed, ann.reworked, ann.rate], [0, 3, 0], 'K-1 was pushed back from PR Review');
  assert.deepStrictEqual([bob.passed, bob.reworked, bob.rate], [5, 0, 1]);

  const annQa = result.qa.find((r) => r.dev === 'Ann')!;
  assert.deepStrictEqual([annQa.reworked, annQa.rate], [2, 0], 'K-2 bounced from UAT CHECK to UAT BUG');
  assert.strictEqual(result.qa.find((r) => r.dev === 'Bob')!.rate, 1);

  const reviewerBob = result.reviewers.find((r) => r.dev === 'Bob')!;
  assert.deepStrictEqual([reviewerBob.sp, reviewerBob.failedSP, reviewerBob.failRate], [2, 2, 1], 'K-2 bounce is charged to the reviewer who passed it');
  assert.strictEqual(result.reviewers.find((r) => r.dev === 'Ann')!.sp, 5);

  assert.ok(result.flags.some((f) => f.sev === 'R' && f.dev === 'Ann' && f.metric === 'pr'));
});

test('computeSprintMetrics uses the current assignee and SP, and a carried-over bug is carryover', () => {
  const changed = issues.map((i) => i.key !== 'K-2' ? i : {
    ...i,
    assignee: BOB,
    sp: 4,
    labels: [...i.labels, 'QRD4'],
    events: [
      ev('2025-12-20T10:00:00.000+0800', ANN, 'Sprint', '', 'QRD Sprint 4'),
      ev('2026-01-03T10:00:00.000+0800', ANN, 'Sprint', 'QRD Sprint 4', 'QRD Sprint 4, QRD Sprint 5'),
      ev('2025-12-21T10:00:00.000+0800', ANN, 'assignee', null, ANN),
      ...i.events,
    ],
  });
  const result = computeSprintMetrics(window, changed, config);
  assert.deepStrictEqual(
    { carry: result.overview.carryover, bug: result.overview.bugSP },
    { carry: 7, bug: 0 },
  );
  assert.strictEqual(result.start.find((r) => r.dev === 'Bob')!.total, 10, 'K-2 now belongs to Bob at its current 4 SP');
});

test('the start snapshot is taken at the start of the sprint day, not when the sprint was started', () => {
  const early = issues.map((i) => i.key !== 'K-3' ? i : {
    ...i,
    events: [status('2026-01-05T09:00:00.000+0800', BOB, 'To Do', 'In Progress'), ...i.events.slice(1)],
  });
  const result = computeSprintMetrics(window, early, config);
  assert.strictEqual(result.start.find((r) => r.dev === 'Bob')!.buckets.Todo, 6, 'K-3 moved at 09:00 on the start day, after the snapshot');
});

test('review duration spreads the elapsed time over the working days of the span, also for a pass given after PR Review', () => {
  const late = issues.map((i) => i.key !== 'K-3' ? i : {
    ...i,
    events: i.events.map((e) => e.field === 'labels' ? { ...e, at: at(12, 10) } : e),
  });
  const reviewer = computeSprintMetrics(window, late, config).reviewers.find((r) => r.dev === 'Ann')!;
  assert.strictEqual(reviewer.avg!.toFixed(2), '3.33', 'Wed 10:00 to Mon 10:00 is 5 days of elapsed time, 4 of the 6 calendar days it touches are weekdays');
  assert.strictEqual(reviewer.breaches, 1);
});

test('stage duration includes the stage a ticket is still in, and every pending ticket is challenging', () => {
  const stuck = issues.map((i) => i.key !== 'K-3' ? i : { ...i, status: 'PR Review', events: i.events.slice(0, 2) });
  const result = computeSprintMetrics(window, stuck, config);
  const bob = result.pr.find((r) => r.dev === 'Bob')!;
  assert.deepStrictEqual([bob.pending, bob.challenging.map((c) => c.key)], [5, ['K-3']]);
  assert.ok(result.stages.find((r) => r.dev === 'Bob')!.stages['PR Review'], 'K-3 is still in PR Review at the cutoff');
  assert.ok(result.stages.find((r) => r.dev === 'Ann')!.stages['UAT Merged'], 'K-1 is still in UAT Merged at the cutoff');
});

test('detectRoster gives each pass label to the person who added it most, and names them from it', () => {
  const label = (by: string, token: string): SprintEvent => ev(at(6), by, 'labels', '', token);
  const issue = (key: string, events: SprintEvent[]): SprintIssue => ({ key, summary: key, created: at(5), type: 'Task', status: 'To Do', assignee: null, sp: 1, labels: [], events });
  const roster = detectRoster([
    issue('A-1', [label('Aken Setiawan', 'kenPass'), label('M Danu Seta W', 'danuPass')]),
    issue('A-2', [label('Aken Setiawan', 'kenPass'), label('Dwi Indra', 'kenPass')]),
    issue('A-3', [label('Muhammad Shovian Hadi Al-Baihaqy', 'shovianPass'), label('Michael Jeffry Setiawan', 'mikePass')]),
    issue('A-4', [label('Some Admin', 'QRD23'), label('Some Admin', 'TBM')]),
  ]);
  assert.deepStrictEqual(
    roster.map((m) => [m.full, m.short, m.token]).sort(),
    [
      ['Aken Setiawan', 'Aken', 'kenPass'],
      ['M Danu Seta W', 'Danu', 'danuPass'],
      ['Michael Jeffry Setiawan', 'Michael', 'mikePass'],
      ['Muhammad Shovian Hadi Al-Baihaqy', 'Shovian', 'shovianPass'],
    ],
    'Dwi Indra added kenPass once but does not own it; the admin owns no pass label',
  );
  assert.strictEqual(detectRoster([], [{ full: 'Michael Jeffry Setiawan', short: 'Mike', token: 'mikePass' }])[0].short, 'Mike');
});

test('findBoardId prefers the board of the configured project that has an active sprint', async () => {
  const http = fakeHttp((_, url, params) => {
    if (url === '/rest/agile/1.0/board') return { values: params.projectKeyOrId === 'QRD' ? [{ id: 7 }, { id: 40 }] : [] };
    return { values: url.includes('/40/') ? [{ id: 632 }] : [] };
  });
  assert.strictEqual(await new JiraSprintClient(http).findBoardId(['QRD']), '40');
  assert.strictEqual(http.calls[0][2].projectKeyOrId, 'QRD');
  const empty = fakeHttp(() => ({ values: [] }));
  assert.strictEqual(await new JiraSprintClient(empty).findBoardId([]), null);
});

test('a closed sprint is frozen at the start of the day the next sprint starts, capped at the fetch instant, or at the cutoff set for it', () => {
  const closed = { ...window, state: 'closed' as const, nextStart: '2026-01-09T04:00:00Z' };
  const context = { fetchedAt: '2026-01-20T00:00:00Z' };
  const atNext = computeSprintMetrics(closed, issues, config, context);
  assert.strictEqual(atNext.cutoff, '2026-01-08T16:00:00.000Z');
  assert.strictEqual(atNext.sprint.state, 'closed');
  assert.strictEqual(atNext.end.find((r) => r.dev === 'Bob')!.buckets.UATM, 5, 'K-3 reached UAT CHECK on 9 Jan, after the freeze');

  const frozen = computeSprintMetrics(closed, issues, { ...config, cutoffs: { QRD5: '2026-01-08T10:30:00+0800' } }, context);
  assert.strictEqual(frozen.cutoff, '2026-01-08T02:30:00.000Z');
  assert.strictEqual(frozen.end.find((r) => r.dev === 'Bob')!.buckets.PR, 5, 'at 10:30 on 8 Jan K-3 was still in PR Review');

  const early = computeSprintMetrics({ ...closed, nextStart: '2026-01-15T04:00:00Z' }, issues, config, { fetchedAt: '2026-01-10T00:00:00Z' });
  assert.strictEqual(early.cutoff, '2026-01-10T00:00:00.000Z', 'the next sprint had not started when the data was fetched');
  assert.strictEqual(early.sprint.state, 'active');
});

test('percentages round half to even, like the reference dashboard', () => {
  assert.deepStrictEqual([62.5, 63.5, 212.5, 62.4, 62.6].map(roundHalfEven), [62, 64, 212, 62, 63]);
});

test('computeSprintMetrics counts a pass label added by someone else separately', () => {
  const tampered = issues.map((i) => i.key !== 'K-3' ? i : {
    ...i,
    events: i.events.map((e) => e.field === 'labels' ? { ...e, by: BOB } : e),
  });
  const result = computeSprintMetrics(window, tampered, config);
  assert.deepStrictEqual(result.notes.nonSelfPass, [{ key: 'K-3', token: 'annPass', by: BOB }]);
  assert.strictEqual(result.reviewers.find((r) => r.dev === 'Ann'), undefined);
});

test('computeSprintMetrics puts unknown statuses in the excluded list instead of throwing', () => {
  const odd = issues.map((i) => i.key === 'K-3' ? { ...i, status: 'Mystery', events: [] } : i);
  const result = computeSprintMetrics(window, odd, config);
  assert.ok(result.notes.excluded.some((e) => e.key === 'K-3' && e.reason === 'unknown-status'));
});

test('buildTrend leaves out developers without load in the two most recent sprints', () => {
  const sprint = (label: string, start: string, rows: Array<[string, number, number | null]>) => ({
    sprint: { label, start },
    roster: config.roster,
    end: rows.map(([dev, total, velocity]) => ({ dev, total, velocity })),
  }) as unknown as SprintResult;
  const trend = buildTrend([
    sprint('QRD3', '2026-01-19T00:00:00Z', [['Ann', 10, 0.5], ['Bob', 0, null]]),
    sprint('QRD1', '2025-12-01T00:00:00Z', [['Ann', 10, 0.25], ['Bob', 8, 0.75]]),
    sprint('QRD2', '2026-01-05T00:00:00Z', [['Ann', 10, 0.4], ['Bob', 0, null]]),
  ]);
  assert.deepStrictEqual(trend.labels, ['QRD1', 'QRD2', 'QRD3']);
  assert.deepStrictEqual(trend.series.map((s) => s.dev), ['Ann']);
  assert.deepStrictEqual(trend.series[0].data, [25, 40, 50]);
});

test('a bug starts the sprint in the status it was created with, other tickets in the status at the start of the day', () => {
  const old = (type: string): SprintIssue => ({
    key: 'B-1', summary: 'Old one', created: '2026-01-01T10:00:00.000+0800', type, status: 'In Progress', assignee: ANN, sp: 3, labels: ['QRD5'],
    events: [status('2026-01-02T10:00:00.000+0800', ANN, 'To Do', 'In Progress'), ev(at(7), ANN, 'labels', 'x', 'x y')],
  });
  assert.strictEqual(computeSprintMetrics(window, [old('Bug')], config).start[0].buckets.Todo, 3);
  assert.strictEqual(computeSprintMetrics(window, [old('Task')], config).start[0].buckets.InP, 3);
});

test('a ticket sent from UAT CHECK back to UAT MERGED is out of the QA gate scope, a ticket still in UAT CHECK is pending', () => {
  const ticket = (key: string, end: string): SprintIssue => ({
    key, summary: key, created: at(1), type: 'Task', status: end, assignee: ANN, sp: 3, labels: ['QRD5'],
    events: [status(at(6), ANN, 'To Do', 'UAT CHECK'), ...(end === 'UAT CHECK' ? [] : [status(at(7), ANN, 'UAT CHECK', end)])],
  });
  const row = (list: SprintIssue[]) => computeSprintMetrics(window, list, config).qa.find((r) => r.dev === 'Ann')!;
  const back = row([ticket('G-1', 'UAT MERGED')]);
  const stuck = row([ticket('G-2', 'UAT CHECK')]);
  assert.deepStrictEqual([back.scopeSP, back.pending], [0, 0]);
  assert.deepStrictEqual([stuck.scopeSP, stuck.pending], [3, 3]);
});

test('a ticket of someone outside the roster counts in the pipeline and the Done card but not in the load', () => {
  const stranger: SprintIssue = {
    key: 'O-1', summary: 'Outside', created: at(1), type: 'Task', status: 'Done / MERGED', assignee: 'Out Sider', sp: 8, labels: ['QRD5'],
    events: [status(at(6), 'Out Sider', 'To Do', 'Done / MERGED')],
  };
  const without = computeSprintMetrics(window, issues, config);
  const withDone = computeSprintMetrics(window, [...issues, stranger], config);
  assert.strictEqual(withDone.overview.totalSP, without.overview.totalSP);
  assert.strictEqual(withDone.overview.doneSP, without.overview.doneSP + 8);
  assert.strictEqual(withDone.overview.pipeline.done, without.overview.pipeline.done + 8);
  assert.ok(!withDone.notes.excluded.some((e) => e.key === 'O-1'));
});

test('the exclusion note also lists labelled tickets outside the sprint, with their state at the fetch instant', () => {
  const pooled = (key: string, labels: string[], events: SprintEvent[]): SprintIssue => ({
    key, summary: key, created: at(1), type: 'Task', status: 'Done / MERGED', assignee: BOB, sp: 2, labels, events,
  });
  const labelPool = [
    pooled('P-1', ['QRD5'], [ev(at(6), BOB, 'Sprint', '', 'QRD Sprint 5'), ev(at(8), BOB, 'Sprint', 'QRD Sprint 5', 'QRD Sprint 6'), status(at(9), BOB, 'To Do', 'Done / MERGED')]),
    pooled('P-2', ['QRD5'], []),
    pooled('P-3', ['QRD5'], [ev(at(6), BOB, 'Sprint', '', 'QRD Sprint 5')]),
    pooled('P-4', ['QRD4'], [ev(at(8), BOB, 'Sprint', 'QRD Sprint 5', '')]),
    issues[4],
  ];
  const result = computeSprintMetrics(window, issues, config, { fetchedAt: '2026-01-12T00:00:00Z', labelPool });
  assert.deepStrictEqual(
    result.notes.excluded.map((e) => [e.key, e.status, e.sp]),
    [['K-5', 'To Do', 4], ['P-1', 'Done / MERGED', 2], ['P-2', 'Done / MERGED', 2]],
    'P-3 is still in the sprint, P-4 has another label, K-5 is listed once',
  );
  const early = computeSprintMetrics(window, issues, config, { fetchedAt: '2026-01-08T12:00:00Z', labelPool });
  assert.strictEqual(early.notes.excluded.find((e) => e.key === 'P-1')!.status, 'To Do', 'P-1 was closed only on 9 Jan');
});

test('passes are also counted on labelled tickets of the neighbouring sprints, and bounces are charged to the reviewer', () => {
  const neighbour = (key: string, labels: string[]): SprintIssue => ({
    key, summary: `Summary ${key}`, created: at(1), type: 'Task', status: 'UAT BUG / Improvement', assignee: BOB, sp: 2, labels,
    events: [
      status(at(6), BOB, 'To Do', 'PR Review'),
      ev(at(7), ANN, 'labels', '', 'annPass'),
      status(at(8), BOB, 'PR Review', 'UAT CHECK'),
      status(at(9), BOB, 'UAT CHECK', 'UAT BUG / Improvement'),
    ],
  });
  const reviewPool = [neighbour('R-1', ['QRD4']), neighbour('R-2', ['x']), issues[2]];
  const without = computeSprintMetrics(window, issues, config).reviewers.find((r) => r.dev === 'Ann')!;
  const ann = computeSprintMetrics(window, issues, config, { reviewPool }).reviewers.find((r) => r.dev === 'Ann')!;
  assert.deepStrictEqual([ann.issues, ann.sp, ann.failedSP], [without.issues + 1, without.sp + 2, without.failedSP + 2]);
  assert.deepStrictEqual(ann.bounced.map((b) => [b.key, b.summary]), [['R-1', 'Summary R-1']]);
});

test('a second pass on the same ticket adds a duration but not another ticket', () => {
  const twice: SprintIssue = {
    key: 'S-1', summary: 'S-1', created: at(1), type: 'Task', status: 'PR Review', assignee: BOB, sp: 3, labels: ['QRD5'],
    events: [
      status(at(6), BOB, 'To Do', 'PR Review'),
      ev(at(7), ANN, 'labels', '', 'annPass'),
      ev(at(7, 12), ANN, 'labels', 'annPass', ''),
      ev(at(8), ANN, 'labels', '', 'annPass'),
    ],
  };
  const ann = computeSprintMetrics(window, [twice], config).reviewers.find((r) => r.dev === 'Ann')!;
  assert.deepStrictEqual([ann.issues, ann.sp, ann.avg, ann.max], [1, 3, 1.5, 2]);
});

test('a roster member marked reviewer: false never appears as a reviewer', () => {
  const quiet = { ...config, roster: [{ ...config.roster[0], reviewer: false }, config.roster[1]] };
  const result = computeSprintMetrics(window, issues, quiet);
  assert.strictEqual(result.reviewers.find((r) => r.dev === 'Ann'), undefined);
  assert.ok(result.reviewers.find((r) => r.dev === 'Bob'));
  assert.deepStrictEqual(result.notes.nonSelfPass, []);
});

test('stage duration of a ticket already in a stage at the start counts from the start, and a zero duration is not averaged in', () => {
  const carried: SprintIssue = {
    key: 'D-1', summary: 'D-1', created: at(1), type: 'Task', status: 'In Progress', assignee: ANN, sp: 3, labels: ['QRD5'],
    events: [status(at(1), ANN, 'To Do', 'In Progress'), ev(at(7), ANN, 'labels', 'x', 'x y')],
  };
  const instant: SprintIssue = {
    key: 'D-2', summary: 'D-2', created: at(1), type: 'Task', status: 'PR Review', assignee: BOB, sp: 3, labels: ['QRD5'],
    events: [status(at(6), BOB, 'To Do', 'In Progress'), status(at(6), BOB, 'In Progress', 'PR Review')],
  };
  const result = computeSprintMetrics(window, [carried, instant], config);
  assert.strictEqual(result.stages.find((r) => r.dev === 'Ann')!.stages['In Progress']!.value, 3, 'Mon 5 Jan 00:00 to the end of Wed 7 Jan');
  assert.strictEqual(result.stages.find((r) => r.dev === 'Bob')!.stages['In Progress'], null);
});

test('the blue flag needs a QA pass rate of 80%, and flags are ordered by severity, owner key, then text', () => {
  const ticket = (key: string, sp: number, end: string): SprintIssue => ({
    key, summary: key, created: at(1), type: 'Task', status: end, assignee: BOB, sp, labels: ['QRD5'],
    events: [status(at(6), BOB, 'To Do', 'PR Review'), status(at(7), BOB, 'PR Review', 'UAT CHECK'), status(at(8), BOB, 'UAT CHECK', end)],
  });
  const clean = computeSprintMetrics(window, [ticket('H-1', 4, 'ReadyForProduction'), ticket('H-2', 1, 'UAT BUG / Improvement')], config);
  assert.ok(clean.flags.some((f) => f.sev === 'B' && f.dev === 'Bob'));
  assert.deepStrictEqual(
    computeSprintMetrics(window, issues, config).flags.map((f) => `${f.sev} ${f.dev} ${f.metric}`),
    ['R Ann completion', 'R Ann pr', 'R Ann qa', 'R Bob fail', 'A Ann PR Review', 'A Ann UAT CHECK'],
  );
});

test('buildTrend keeps one decimal of the velocity', () => {
  const sprint = { sprint: { label: 'QRD1', start: '2025-12-01T00:00:00Z' }, roster: config.roster, end: [{ dev: 'Ann', total: 10, velocity: 0.79487 }] } as unknown as SprintResult;
  assert.deepStrictEqual(buildTrend([sprint]).series[0].data, [79.5]);
});

test('fetchLabelIssues searches by the sprint label through the same paged search', async () => {
  const http = fakeHttp(() => ({ issues: [] }));
  await new JiraSprintClient(http).fetchLabelIssues('QRD5');
  assert.strictEqual(http.calls[0][2].jql, 'labels = "QRD5" ORDER BY created ASC');
});

function fakeHttp(script: (method: string, url: string, payload: any) => any): JiraHttp & { calls: Array<[string, string, any]> } {
  const calls: Array<[string, string, any]> = [];
  return {
    calls,
    get: async (url, params) => { calls.push(['GET', url, params]); return script('GET', url, params); },
    post: async (url, body) => { calls.push(['POST', url, body]); return script('POST', url, body); },
  };
}

test('listSprints pages through the board and skips sprints without dates', async () => {
  const http = fakeHttp((_, __, params) => params.startAt === 0
    ? { isLast: false, values: [{ id: 1, name: 'QRD Sprint 1', state: 'closed', startDate: 'a', endDate: 'b', completeDate: 'c' }, { id: 2, name: 'Future', state: 'future' }] }
    : { isLast: true, values: [{ id: 3, name: 'QRD Sprint 3', state: 'active', startDate: 'd', endDate: 'e' }] });
  const sprints = await new JiraSprintClient(http).listSprints('40');
  assert.deepStrictEqual(sprints.map((s) => [s.id, s.state, s.completeDate]), [[1, 'closed', 'c'], [3, 'active', null]]);
  assert.strictEqual(http.calls[0][1], '/rest/agile/1.0/board/40/sprint');
});

test('fetchSprintIssues follows nextPageToken, keeps tracked events, and reloads truncated changelogs', async () => {
  const issue = (key: string, total: number, histories: any[]) => ({
    key, fields: { summary: key, created: 'c', issuetype: { name: 'Task' }, status: { name: 'To Do' }, assignee: { displayName: ANN }, labels: ['x'], customfield_10016: 3 },
    changelog: { total, histories },
  });
  const history = (field: string, to: string) => ({ created: 't', author: { displayName: ANN }, items: [{ field, fromString: null, toString: to }] });
  const http = fakeHttp((method, url, payload) => {
    if (method === 'POST') {
      return payload.nextPageToken
        ? { issues: [issue('K-2', 1, [history('status', 'Done')])] }
        : { issues: [issue('K-1', 150, [history('status', 'In Progress'), history('summary', 'ignored')])], nextPageToken: 'p2' };
    }
    return { isLast: true, values: [history('status', 'In Progress'), history('labels', 'annPass'), history('Sprint', 'S1')] };
  });
  const result = await new JiraSprintClient(http).fetchSprintIssues(5);

  assert.deepStrictEqual(result.map((r) => r.key), ['K-1', 'K-2']);
  assert.deepStrictEqual(result[0].events.map((e) => e.field), ['status', 'labels', 'Sprint']);
  assert.deepStrictEqual(result[1].events.map((e) => e.field), ['status']);
  assert.strictEqual(result[0].sp, 3);
  assert.strictEqual(result[0].assignee, ANN);
  assert.deepStrictEqual(http.calls.filter((c) => c[0] === 'GET').map((c) => c[1]), ['/rest/api/3/issue/K-1/changelog']);
  assert.strictEqual(http.calls[0][2].jql, 'sprint = 5 ORDER BY created ASC');
  assert.strictEqual(http.calls[0][2].expand, 'changelog');
});

test('retryOn429 waits for Retry-After and gives up on other errors', async () => {
  const waits: number[] = [];
  let attempts = 0;
  const data = await retryOn429(async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('slow down'), { response: { status: 429, headers: { 'retry-after': '2' } } });
    return { data: 'ok' };
  }, async (ms) => { waits.push(ms); });
  assert.strictEqual(data, 'ok');
  assert.deepStrictEqual(waits, [2000]);

  await assert.rejects(
    retryOn429(async () => { throw Object.assign(new Error('nope'), { response: { status: 500 } }); }, async () => undefined),
    /nope/,
  );
});

test('nextRunAt picks the next 06:00 WIB', () => {
  assert.strictEqual(nextRunAt(new Date('2026-01-05T20:00:00Z'), 6).toISOString(), '2026-01-05T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T23:30:00Z'), 6).toISOString(), '2026-01-06T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T23:00:00Z'), 6).toISOString(), '2026-01-06T23:00:00.000Z');
  assert.strictEqual(nextRunAt(new Date('2026-01-05T16:59:00Z'), 0).toISOString(), '2026-01-05T17:00:00.000Z');
});

class MemoryStore implements SprintStore {
  settings = new Map<string, string>();
  snapshots = new Map<number, SnapshotRow>();
  events = new Map<number, string>();
  fetched = new Map<number, Date>();
  pools = new Map<number, string>();
  async getSettings() { return [...this.settings].map(([key, value]) => ({ key, value })); }
  async upsertSetting(key: string, value: string) { this.settings.set(key, value); }
  async getSprintSnapshots() { return [...this.snapshots.values()].sort((a, b) => b.startDate.getTime() - a.startDate.getTime()); }
  async getSprintSnapshot(id: number) { return this.snapshots.get(id) ?? null; }
  async upsertSprintSnapshot(data: Partial<SnapshotRow> & { sprintId: number }) {
    const old = this.snapshots.get(data.sprintId);
    this.snapshots.set(data.sprintId, { result: null, computedAt: null, lastError: null, ...old, ...data } as SnapshotRow);
  }
  async getSprintIssueEvents(id: number) {
    return this.events.has(id)
      ? { issues: this.events.get(id)!, fetchedAt: this.fetched.get(id) ?? new Date('2026-01-12T00:00:00Z'), labelPool: this.pools.get(id) ?? null }
      : null;
  }
  async upsertSprintIssueEvents(id: number, json: string, fetchedAt?: Date, labelPool?: string) {
    this.events.set(id, json);
    if (fetchedAt) this.fetched.set(id, fetchedAt);
    if (labelPool !== undefined) this.pools.set(id, labelPool);
  }
}

const boardSprints = [
  { id: 3, name: 'QRD Sprint 3', state: 'closed' as const, startDate: '2025-12-01T02:00:00Z', endDate: '2025-12-15T02:00:00Z', completeDate: '2025-12-15T03:00:00Z' },
  { id: 4, name: 'QRD Sprint 4', state: 'closed' as const, startDate: '2025-12-15T02:00:00Z', endDate: '2026-01-05T02:00:00Z', completeDate: '2026-01-05T03:00:00Z' },
  { id: 5, name: 'QRD Sprint 5', state: 'active' as const, startDate: window.start, endDate: window.end, completeDate: null },
];

function setup(options: { failFor?: number; delayMs?: number; board?: string | null; labelIssues?: SprintIssue[]; labelFails?: boolean } = {}) {
  const store = new MemoryStore();
  store.settings.set('sprintBoardId', '40');
  store.settings.set('sprintDashboardConfig', JSON.stringify(config));
  const fetched: number[] = [];
  const client = {
    listSprints: async () => boardSprints,
    findBoardId: async () => (options.board === undefined ? '40' : options.board),
    fetchLabelIssues: async () => {
      if (options.labelFails) throw new Error('Label search exploded');
      return options.labelIssues ?? [];
    },
    fetchSprintIssues: async (id: number) => {
      fetched.push(id);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (id === options.failFor) throw new Error('Jira exploded');
      return issues;
    },
  } as unknown as JiraSprintClient;
  const service = new SprintDashboardService(store, async () => client, () => new Date('2026-01-12T00:00:00Z'));
  return { store, service, fetched };
}

test('refresh stores a snapshot and the dashboard reads it back', async () => {
  const { service, store } = setup();
  service.startRefresh(5);
  await service.idle();

  assert.strictEqual(service.refreshState().status, 'idle');
  const dashboard = await service.getDashboard(5);
  assert.strictEqual(dashboard.summary?.computedAt, '2026-01-12T00:00:00.000Z');
  assert.strictEqual(JSON.parse(dashboard.result!).overview.totalSP, 11);
  assert.ok(store.events.has(5));
  assert.strictEqual((await service.getDashboard(null)).summary?.id, 5, 'no id picks the active sprint');
});

test('a second refresh while one is running is rejected', async () => {
  const { service } = setup({ delayMs: 20 });
  service.startRefresh(5);
  assert.throws(() => service.startRefresh(4), SprintBusyError);
  await service.idle();
  assert.doesNotThrow(() => service.startRefresh(4));
  await service.idle();
});

test('a failed refresh records lastError and keeps the previous result', async () => {
  const { service, store } = setup({ failFor: 5 });
  await store.upsertSprintSnapshot({
    sprintId: 5, name: 'QRD Sprint 5', state: 'active', startDate: new Date(window.start), endDate: new Date(window.end), result: '{"old":true}',
  });
  service.startRefresh(5);
  await service.idle();

  assert.strictEqual(service.refreshState().status, 'error');
  assert.match(service.refreshState().error!, /Jira exploded/);
  const row = store.snapshots.get(5)!;
  assert.strictEqual(row.result, '{"old":true}');
  assert.match(row.lastError!, /Jira exploded/);
});

test('the roster is detected from pass labels when none is configured', async () => {
  const { service, store } = setup();
  store.settings.set('sprintDashboardConfig', JSON.stringify({ ...config, roster: [] }));
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(service.refreshState().error, null);
  const result = JSON.parse(store.snapshots.get(5)!.result!);
  assert.deepStrictEqual(result.roster.map((m: { short: string; token: string }) => [m.short, m.token]).sort(), [['Ann', 'annPass'], ['Bob', 'bobPass']]);
  assert.strictEqual(result.overview.developers, 2);
});

test('a member who shows a pass label only in another sprint is still detected, and members without load are not listed', async () => {
  const cara = 'Cara Gamma';
  const { service, store } = setup();
  store.settings.set('sprintDashboardConfig', JSON.stringify({ ...config, roster: [] }));
  await store.upsertSprintSnapshot({ sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate) });
  await store.upsertSprintIssueEvents(4, JSON.stringify([{
    key: 'P-1', summary: 'Older work', created: '2025-12-16T10:00:00.000+0800', type: 'Task', status: 'To Do', assignee: cara, sp: 2, labels: ['QRD4'],
    events: [ev('2025-12-17T10:00:00.000+0800', cara, 'labels', '', 'caraPass')],
  }]));
  service.startRefresh(5);
  await service.idle();

  const five = JSON.parse(store.snapshots.get(5)!.result!);
  assert.ok(five.roster.some((m: { short: string }) => m.short === 'Cara'), 'Cara is known from Sprint 4');
  assert.deepStrictEqual(five.start.map((r: { dev: string }) => r.dev), ['Ann', 'Bob'], 'Cara has no load in Sprint 5, so no empty row');
  assert.deepStrictEqual(JSON.parse(store.snapshots.get(4)!.result!).start.map((r: { dev: string }) => r.dev), ['Cara']);
});

test('the board is found from the Jira projects when no board id is saved', async () => {
  const { service, store } = setup();
  store.settings.delete('sprintBoardId');
  store.settings.set('jiraProjectKeys', 'QRD, OPS');
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(service.refreshState().error, null);
  assert.strictEqual(store.settings.get('sprintBoardId'), '40');

  const none = setup({ board: null });
  none.store.settings.delete('sprintBoardId');
  none.service.startRefresh(5);
  await none.service.idle();
  assert.match(none.service.refreshState().error!, /No Scrum board/);
});

test('backfill skips closed sprints that already have a result and keeps going after a failure', async () => {
  const { service, store, fetched } = setup({ failFor: 3 });
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate), result: JSON.stringify({ rulesVersion: RULES_VERSION }),
  });
  await store.upsertSprintIssueEvents(4, '[]', new Date('2026-01-12T00:00:00Z'), '[]');
  service.startBackfill(3);
  await service.idle();

  assert.deepStrictEqual(fetched.sort(), [3, 5]);
  assert.strictEqual(service.refreshState().total, 2);
  assert.match(service.refreshState().error!, /1 sprint\(s\) failed/);
  assert.ok(store.snapshots.get(5)!.result);
});

test('backfill recomputes closed sprints that were calculated with older rules', async () => {
  const { service, store, fetched } = setup();
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate), result: JSON.stringify({ rulesVersion: RULES_VERSION - 1 }),
  });
  service.startBackfill(3);
  await service.idle();
  assert.deepStrictEqual(fetched.sort(), [3, 4, 5]);
});

test('the daily run refreshes the active sprint and finalizes sprints that closed since', async () => {
  const { service, store, fetched } = setup();
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'active', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate),
  });
  await service.runDaily();
  assert.deepStrictEqual(fetched.sort(), [4, 5]);
  assert.strictEqual(store.snapshots.get(4)!.state, 'closed');
});

test('saving settings validates input and recomputes stored sprints with the new config', async () => {
  const { service, store } = setup();
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).overview.loadTarget, 16);

  await assert.rejects(service.updateSettings('abc', JSON.stringify(config)), SprintInputError);
  await assert.rejects(service.updateSettings('40', 'not json'), SprintInputError);
  await assert.rejects(service.updateSettings('40', JSON.stringify({ roster: [{ full: 'x' }] })), SprintInputError);

  await service.updateSettings('41', JSON.stringify({ loadTarget: 20, roster: [{ full: ANN, short: 'Annie', token: 'annPass' }] }));
  assert.strictEqual(await service.boardId(), '41');
  const result = JSON.parse(store.snapshots.get(5)!.result!);
  assert.strictEqual(result.overview.loadTarget, 20);
  assert.deepStrictEqual(result.start.map((r: { dev: string }) => r.dev), ['Annie', 'Bob'], 'a roster entry overrides the detected name');
});

test('a backfill keeps the planned end, stores the label pool, and freezes a closed sprint where the next one starts', async () => {
  const outside: SprintIssue = { key: 'X-1', summary: 'Outside', created: at(1), type: 'Task', status: 'To Do', assignee: BOB, sp: 1, labels: ['QRD5'], events: [] };
  const { service, store } = setup({ labelIssues: [outside, issues[0]] });
  service.startBackfill(3);
  await service.idle();

  assert.strictEqual(service.refreshState().error, null);
  assert.strictEqual(store.snapshots.get(4)!.endDate.toISOString(), boardSprints[1].endDate.replace('Z', '.000Z'), 'the planned end is kept, not the completion');
  const closed = JSON.parse(store.snapshots.get(4)!.result!);
  assert.strictEqual(closed.cutoff, '2026-01-04T16:00:00.000Z', 'the start of the day on which Sprint 5 starts');
  assert.strictEqual(closed.sprint.end, '2026-01-05T02:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(store.pools.get(5)!).map((i: SprintIssue) => i.key), ['X-1']);
  assert.deepStrictEqual(JSON.parse(store.snapshots.get(5)!.result!).notes.excluded.map((e: { key: string }) => e.key), ['K-5', 'X-1']);
});

test('issueEvents returns the stored changelog of a sprint, or an empty list', async () => {
  const { service, store } = setup();
  assert.strictEqual(await service.issueEvents(5), '[]');
  service.startRefresh(5);
  await service.idle();
  assert.strictEqual(JSON.parse(await service.issueEvents(5)).length, issues.length);
  assert.ok(store.events.has(5));
});

test('parseSprintConfig fills defaults and rejects bad numbers', () => {
  assert.strictEqual(parseSprintConfig(null).loadTarget, 16);
  assert.strictEqual('weekendWeight' in parseSprintConfig('{}'), false);
  assert.strictEqual(parseSprintConfig('{"slaDays":3}').slaDays, 3);
  assert.throws(() => parseSprintConfig('{"dailyHour":30}'), SprintInputError);
  assert.throws(() => parseSprintConfig('{"cutoffs":{"QRD5":"soon"}}'), SprintInputError);
  assert.strictEqual(parseSprintConfig('{"cutoffs":{"QRD5":"2026-01-08T10:30:00+08:00"}}').cutoffs.QRD5, '2026-01-08T10:30:00+08:00');
  assert.throws(() => parseSprintConfig('{"loadTarget":"x"}'), SprintInputError);
});

test('reviewer flags are ordered by pass token, other flags by full name', () => {
  const swapped = {
    ...config,
    roster: [{ full: ANN, short: 'Ann', token: 'zedPass' }, { full: BOB, short: 'Bob', token: 'acePass' }],
  };
  const bounced = (key: string, owner: string, token: string, reviewer: string): SprintIssue => ({
    key, summary: key, created: at(1), type: 'Task', status: 'UAT BUG / Improvement', assignee: owner, sp: 2, labels: ['QRD5', token],
    events: [
      status(at(6), owner, 'To Do', 'UAT CHECK'),
      ev(at(6, 12), reviewer, 'labels', '', token),
      status(at(7), owner, 'UAT CHECK', 'UAT BUG / Improvement'),
    ],
  });
  const result = computeSprintMetrics(window, [bounced('F-1', BOB, 'zedPass', ANN), bounced('F-2', ANN, 'acePass', BOB)], swapped);
  assert.deepStrictEqual(result.flags.filter((f) => f.metric === 'fail').map((f) => f.dev), ['Bob', 'Ann'], 'acePass sorts before zedPass although Ann Alpha sorts before Bob Beta');
  assert.deepStrictEqual(result.flags.filter((f) => f.metric === 'qa').map((f) => f.dev), ['Ann', 'Bob']);
});

test('a stage still open at a cutoff on a Saturday is counted up to the Monday after', () => {
  const open: SprintIssue = {
    key: 'D-1', summary: 'D-1', created: at(1), type: 'Task', status: 'In Progress', assignee: ANN, sp: 3, labels: ['QRD5'],
    events: [status(at(6), ANN, 'To Do', 'In Progress'), ev(at(10), ANN, 'labels', 'x', 'x y')],
  };
  const result = computeSprintMetrics(window, [open], config);
  assert.strictEqual(Math.round(result.stages.find((r) => r.dev === 'Ann')!.stages['In Progress']!.value! * 100) / 100, 3.72, 'Tue 6 Jan 10:00 to Mon 12 Jan 00:00 gives 3.72, and 3.67 when the end stays on Sunday');
});

test('a ticket whose only time in a stage falls on a weekend leaves that stage out of the mean', () => {
  const ticket = (key: string, from: number, to: number): SprintIssue => ({
    key, summary: key, created: at(1), type: 'Task', status: 'UAT MERGED', assignee: ANN, sp: 3, labels: ['QRD5'],
    events: [status(at(from), ANN, 'To Do', 'PR Review'), status(at(to), ANN, 'PR Review', 'UAT MERGED')],
  });
  const weekend = computeSprintMetrics(window, [ticket('W-1', 5, 6), ticket('W-2', 10, 11)], config);
  assert.strictEqual(weekend.stages.find((r) => r.dev === 'Ann')!.stages['PR Review']!.value, 1, 'only W-1 counts, W-2 spent Saturday to Sunday in PR Review');
  const alone = computeSprintMetrics(window, [ticket('W-2', 10, 11)], config);
  assert.strictEqual(alone.stages.find((r) => r.dev === 'Ann')!.stages['PR Review'], null);
});

test('a roster entry with a reviewer flag that is not a boolean is rejected', () => {
  const entry = (reviewer: unknown) => JSON.stringify({ roster: [{ full: ANN, short: 'Ann', token: 'annPass', reviewer }] });
  assert.throws(() => parseSprintConfig(entry('no')), SprintInputError);
  assert.throws(() => parseSprintConfig(entry(0)), SprintInputError);
  assert.strictEqual(parseSprintConfig(entry(false)).roster[0].reviewer, false);
});

test('the next sprint is the earliest one of the same prefix that starts on a later day, whatever its number', async () => {
  const { service, store } = setup();
  const row = (sprintId: number, name: string, start: string) => store.upsertSprintSnapshot({
    sprintId, name, state: 'closed', startDate: new Date(start), endDate: new Date(start),
  });
  await row(5, 'QRD Sprint 5', window.start);
  await row(6, 'QRD Sprint 6', '2026-01-05T06:00:00Z');
  await row(7, 'OPS Sprint 7', '2026-01-06T02:00:00Z');
  for (const id of [5, 6]) await store.upsertSprintIssueEvents(id, JSON.stringify(issues), new Date('2026-01-12T00:00:00Z'), '[]');

  await service.updateSettings('40', JSON.stringify(config));
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).cutoff, '2026-01-12T00:00:00.000Z', 'a same-day neighbour and another prefix are not the next sprint');

  await row(6, 'QRD Sprint 6', '2026-01-06T02:00:00Z');
  await service.updateSettings('40', JSON.stringify(config));
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).cutoff, '2026-01-05T16:00:00.000Z', 'Sprint 6 starting on a later day freezes Sprint 5');

  await row(6, 'QRD Sprint 6', '2026-01-08T02:00:00Z');
  await row(1, 'QRD Sprint 1', '2026-01-07T02:00:00Z');
  await service.updateSettings('40', JSON.stringify(config));
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).cutoff, '2026-01-06T16:00:00.000Z', 'Sprint 1 after a numbering restart is the next sprint');
});

test('a closed sprint is fetched once more after the next one starts, and not again', async () => {
  const { service, store, fetched } = setup();
  await store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate),
    result: JSON.stringify({ rulesVersion: RULES_VERSION }),
  });
  await store.upsertSprintIssueEvents(4, JSON.stringify(issues), new Date('2026-01-02T10:00:00Z'), '[]');

  await service.runDaily();
  assert.deepStrictEqual(fetched.sort(), [4, 5], 'Sprint 4 was last fetched before Sprint 5 started');
  fetched.length = 0;
  await service.runDaily();
  assert.deepStrictEqual(fetched, [5]);
  assert.strictEqual(JSON.parse(store.snapshots.get(4)!.result!).sprint.state, 'closed');
});

test('backfill fetches a current closed row again when no label pool was ever stored, but not when the stored pool is empty', async () => {
  const closedRow = (store: MemoryStore) => store.upsertSprintSnapshot({
    sprintId: 4, name: 'QRD Sprint 4', state: 'closed', startDate: new Date(boardSprints[1].startDate), endDate: new Date(boardSprints[1].endDate),
    result: JSON.stringify({ rulesVersion: RULES_VERSION }),
  });
  const never = setup();
  await closedRow(never.store);
  await never.store.upsertSprintIssueEvents(4, '[]', new Date('2026-01-12T00:00:00Z'));
  never.service.startBackfill(3);
  await never.service.idle();
  assert.deepStrictEqual(never.fetched.sort(), [3, 4, 5]);

  const empty = setup();
  await closedRow(empty.store);
  await empty.store.upsertSprintIssueEvents(4, '[]', new Date('2026-01-12T00:00:00Z'), '[]');
  empty.service.startBackfill(3);
  await empty.service.idle();
  assert.deepStrictEqual(empty.fetched.sort(), [3, 5]);
});

test('a failed label search keeps the fetched events, the result and the previous pool', async () => {
  const { service, store } = setup({ labelFails: true });
  const previous = JSON.stringify([{ ...issues[3], key: 'X-9' }]);
  await store.upsertSprintIssueEvents(5, '[]', new Date('2026-01-10T00:00:00Z'), previous);

  service.startRefresh(5);
  await service.idle();

  assert.strictEqual(JSON.parse(store.events.get(5)!).length, issues.length);
  assert.strictEqual(store.pools.get(5), previous);
  assert.strictEqual(JSON.parse(store.snapshots.get(5)!.result!).overview.totalSP, 11);
  assert.strictEqual(store.fetched.get(5)!.toISOString(), '2026-01-12T00:00:00.000Z');
  assert.match(service.refreshState().error!, /Label search failed: Label search exploded/);
  assert.match(store.snapshots.get(5)!.lastError!, /^Label search failed: Label search exploded/);
});

test('a snapshot whose label pool was never fetched says so until a pool is stored', async () => {
  const { service, store } = setup();
  await store.upsertSprintSnapshot({ sprintId: 5, name: 'QRD Sprint 5', state: 'active', startDate: new Date(window.start), endDate: new Date(window.end) });
  await store.upsertSprintIssueEvents(5, JSON.stringify(issues), new Date('2026-01-12T00:00:00Z'));

  await service.updateSettings('40', JSON.stringify(config));
  assert.match(store.snapshots.get(5)!.lastError!, /Label pool has not been fetched/);

  await store.upsertSprintIssueEvents(5, JSON.stringify(issues), new Date('2026-01-12T00:00:00Z'), '[]');
  await service.updateSettings('40', JSON.stringify(config));
  assert.strictEqual(store.snapshots.get(5)!.lastError, null);
});

test('the label search is limited to the configured projects and fails after a fixed number of pages', async () => {
  const http = fakeHttp(() => ({ issues: [], nextPageToken: 'more' }));
  await assert.rejects(new JiraSprintClient(http).fetchLabelIssues('QRD5', ['QRD', 'OPS']), /after 10 pages/);
  assert.strictEqual(http.calls[0][2].jql, 'labels = "QRD5" AND project in ("QRD", "OPS") ORDER BY created ASC');
  assert.strictEqual(http.calls.length, 10);
});
