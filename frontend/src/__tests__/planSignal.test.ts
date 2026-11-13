import assert from 'node:assert/strict';
import test from 'node:test';
import { changeText, planAttention, planMetaLine, planningSprintOf, stepIndex, type PlanSignal } from '../agents/planning';
import { configFromForm, fillSummary, formFromConfig } from '../agents/cronRound';

const signal = (over: Partial<PlanSignal> = {}): PlanSignal => ({
  sprint: 'QRD Sprint 27', sprintId: 699, sprintState: 'future', activeSince: null, stage: 'draft', revision: null, publishedBy: null, publishedAt: null,
  planner: 'Alvin', me: 'Alvin', isPlanner: true, draftLoadedAt: null, draftStatus: 'draft', joined: [], acChanged: [], waitForPublish: true, planAfterPublish: true,
  myOutside: [], myOrder: [], ...over,
});
const draft = { questions: [{ id: 'q1', text: 'Keep it?', key: 'QRD-1', askedAt: '', answered: false, answeredBy: null, answeredAt: null }], blockers: ['ac|x'], tickets: [{}, {}, {}] } as never;

test('the stepper: Draft, Dipublish once a revision exists, Jalan once the sprint is active too', () => {
  assert.deepEqual([stepIndex(null), stepIndex(signal()), stepIndex(signal({ stage: 'published' })), stepIndex(signal({ stage: 'running' }))], [0, 0, 1, 2]);
});

test('status lines: the planner before publish sees the cron waiting and the chat questions', () => {
  assert.deepEqual(planAttention(signal(), draft).map((item) => item.text), ['Cron nunggu publish', '1 pertanyaan di chat']);
  assert.match(planMetaLine(signal(), { loadedAt: '2026-11-12T09:39:00Z' }), /^Draft dimuat .* · belum aktif di Jira$/);
});

test('status lines: a developer sees who published which revision, and changes waiting for the planner', () => {
  const dev = signal({ isPlanner: false, me: 'Danu', revision: 1, stage: 'running', publishedBy: 'Alvin', publishedAt: '2026-11-13T03:00:00Z', activeSince: '2026-11-13T02:00:00Z', joined: ['QRD-9001'] });
  assert.match(planMetaLine(dev, null), /^Dari Alvin · dipublish .* · r1 · aktif di Jira sejak /);
  assert.deepEqual(planAttention(dev, null).map((item) => item.text), ['Plan r1 · ada perubahan nunggu planner (QRD-9001 masuk sprint)']);
  const planner = planAttention({ ...dev, isPlanner: true, acChanged: ['QRD-1533'] }, null);
  assert.deepEqual(planner, [{ text: 'Perlu publish ulang (r2): QRD-9001 masuk sprint, QRD-1533 AC berubah', action: 'republish' }]);
  assert.equal(changeText({ joined: [], acChanged: [] }), '');
  assert.equal(changeText({ joined: ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4'], acChanged: ['QRD-5'] }), 'QRD-1 masuk sprint, QRD-2 masuk sprint, QRD-3 masuk sprint +2 lagi');
});

test('a Planning chat is recognised by its title', () => {
  assert.equal(planningSprintOf('Planning-QRD Sprint 27'), 'QRD Sprint 27');
  assert.equal(planningSprintOf('Task-QRD-1'), null);
  assert.equal(planningSprintOf(undefined), null);
});

test('the cron form keeps both publish gates, off by default', () => {
  const base = { enabled: true, parallel: 2, workStart: 9, workEnd: 17, workDays: [1], activeFrom: null, activeUntil: null, maxPerDay: 6, sprint: 'active', labels: [], todoStatuses: ['To Do'], inProgressStatus: 'In Progress', usageBrakePercent: 70, weeklyBrakePercent: 90 };
  const form = formFromConfig(JSON.stringify(base));
  assert.deepEqual([form.waitForPublish, form.planAfterPublish], [false, false]);
  assert.deepEqual([formFromConfig(JSON.stringify({ ...base, waitForPublish: true })).waitForPublish], [true]);
  const saved = JSON.parse(configFromForm({ ...form, waitForPublish: true }));
  assert.deepEqual([saved.waitForPublish, saved.planAfterPublish], [true, false]);
  const rules = JSON.parse(configFromForm(formFromConfig(JSON.stringify({ ...base, blockedManual: 'stop', stackedAllowed: false }))));
  assert.deepEqual([rules.blockedManual, rules.stackedAllowed], ['stop', false]);
  assert.match(fillSummary({ at: '2026-11-13T03:00:00Z', skipped: null, started: ['QRD-1'], dryRun: true, parked: [], deferred: [], notMoved: [], failed: [] }), /dry run, would start QRD-1/);
});
