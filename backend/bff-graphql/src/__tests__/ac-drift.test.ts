import test from 'node:test';
import assert from 'node:assert/strict';
import { AcDriftService, sprintDay, type DriftJira } from '../integrations/ac-drift';
import type { PlanningIssue } from '../integrations/jira-sprint';
import type { DraftView } from '../integrations/sprint-draft';

const ticket = (key: string, dev: string, start: number, end: number, over: Record<string, unknown> = {}) => ({
  key, summary: key, dev, jiraDev: dev, sp: 2, wave: 1, waveSet: false, status: 'To Do', ac: [], dependsOn: [], start, dur: end - start, end, inSprint: true, split: null,
  prediction: null, qaDecision: null, ...over,
});

const VIEW = {
  sprint: 'QRD Sprint 27', sprintId: 27, status: 'published', sprintDays: 10, startDate: '2026-11-02T01:00:00.000Z', spPerDay: 2, createdBy: 'Alvin',
  loadedAt: '2026-11-01T00:00:00.000Z', publishedAt: '2026-11-01T05:00:00.000Z', qaReason: null, devs: ['Aken', 'Danu'], blockers: [], canPublish: true, landed: 0,
  tickets: [ticket('QRD-1511', 'Danu', 4, 7), ticket('QRD-1489', 'Aken', 0, 3), ticket('QRD-1520', 'Danu', 7, 9), ticket('QRD-1530', 'Danu', 0, 2)],
  findings: [],
} as unknown as DraftView;

const issue = (key: string, assignee: string, ac: string[]): PlanningIssue => ({ key, summary: key, type: 'Story', status: 'In Progress', assignee, sp: 2, acRaw: ac.map((line) => `- ${line}`).join('\n'), links: [] });

function setup() {
  const jiraAc: Record<string, string[]> = {
    'QRD-1511': ['Cursor shows', 'An Edit client sees the cursor (QRD-1489)', 'Owner sees QRD-1520 badge'],
    'QRD-1520': ['Badge shows'],
    'QRD-1530': ['Done after QRD-1489'],
  };
  const row: any = {
    sprint: VIEW.sprint, status: 'published', drift: '{}',
    tickets: Object.entries(jiraAc).map(([key, ac]) => ({ key, jiraAc: JSON.stringify(ac) })),
  };
  const store = {
    getSprintDraft: async () => row,
    updateSprintDraftTicket: async (_sprint: string, key: string, data: { jiraAc?: string[] }) => { row.tickets.find((item: any) => item.key === key).jiraAc = JSON.stringify(data.jiraAc); },
    updateSprintDraftDrift: async (_sprint: string, drift: string) => { row.drift = drift; },
  };
  const writes: Array<[string, string, unknown]> = [];
  const issues = new Map<string, PlanningIssue>([
    ['QRD-1511', issue('QRD-1511', 'Danu', jiraAc['QRD-1511'])],
    ['QRD-1520', issue('QRD-1520', 'Danu', jiraAc['QRD-1520'])],
    ['QRD-1489', issue('QRD-1489', 'Aken', ['Edit share'])],
  ]);
  const statuses = new Map([['QRD-1511', 'In Progress'], ['QRD-1489', 'To Do'], ['QRD-1520', 'To Do'], ['QRD-1530', 'UAT CHECK']]);
  const jira: DriftJira = {
    statusesOf: async (keys) => new Map(keys.filter((key) => statuses.has(key)).map((key) => [key, statuses.get(key)!])),
    issueNow: async (key) => issues.get(key) ?? null,
    setAc: async (key, value) => { writes.push(['ac', key, value]); },
    myself: async () => 'Danu',
    comment: async (key, lines) => { writes.push(['comment', key, lines.join('\n')]); },
    addLabel: async (key, label) => { writes.push(['label', key, label]); },
  };
  // Day 6 of the sprint: QRD-1489 was planned to land on day 3.
  const service = new AcDriftService(store, async () => VIEW, async () => jira, () => new Date('2026-11-09T09:00:00Z'));
  return { service, writes, row, issues, owner: ['QRD-1511', 'QRD-1520', 'QRD-1530'] };
}

test('the sprint day counts working days from the start', () => {
  assert.equal(sprintDay('2026-11-02T01:00:00.000Z', new Date('2026-11-09T09:00:00Z')), 6);
  assert.equal(sprintDay(null, new Date()), null);
});

test('held rows: a slipped ticket and one landing after it, not lines of a ticket past merge', async () => {
  const { service, owner } = setup();
  const drift = (await service.drift('QRD Sprint 27', owner))!;
  assert.equal(drift.today, 6);
  assert.deepEqual(drift.rows.map((row) => [row.key, row.line, row.refKey, row.reason, row.state]), [
    ['QRD-1511', 2, 'QRD-1489', 'slipped', 'held'],
    ['QRD-1511', 3, 'QRD-1520', 'after-it', 'held'],
  ]);
});

test('move to a teammate: label and a comment on both tickets, the line stays', async () => {
  const { service, writes, owner } = setup();
  const drift = (await service.drift('QRD Sprint 27', owner))!;
  const after = await service.act('QRD Sprint 27', owner, drift.rows[0].id, 'move', null, 'Danu');
  assert.deepEqual(writes.map(([kind, key]) => [kind, key]), [['label', 'QRD-1489'], ['comment', 'QRD-1489'], ['comment', 'QRD-1511']]);
  assert.equal(writes[0][2], 'ac-move-pending');
  assert.equal(after.rows[0].state, 'move-pending');
});

test('move to an own ticket writes both AC fields and comments on both', async () => {
  const { service, writes, owner, row } = setup();
  const drift = (await service.drift('QRD Sprint 27', owner))!;
  const after = await service.act('QRD Sprint 27', owner, drift.rows[1].id, 'move', null, 'Danu');
  assert.deepEqual(writes.map(([kind, key]) => [kind, key]), [['ac', 'QRD-1511'], ['ac', 'QRD-1520'], ['comment', 'QRD-1511'], ['comment', 'QRD-1520']]);
  assert.equal(writes[0][2], '- Cursor shows\n- An Edit client sees the cursor (QRD-1489)');
  assert.equal(writes[1][2], '- Badge shows\n- Owner sees QRD-1520 badge');
  assert.deepEqual(JSON.parse(row.tickets.find((item: any) => item.key === 'QRD-1520').jiraAc), ['Badge shows', 'Owner sees QRD-1520 badge']);
  assert.equal(after.rows.length, 1);
});

test('not tested here rewrites the line once; a changed AC or a ticket of someone else is refused', async () => {
  const { service, writes, owner, issues } = setup();
  const drift = (await service.drift('QRD Sprint 27', owner))!;
  issues.set('QRD-1511', issue('QRD-1511', 'Danu', ['Someone edited this']));
  await assert.rejects(service.act('QRD Sprint 27', owner, drift.rows[0].id, 'not-tested', null, 'Danu'), /changed in Jira since publish/);
  issues.set('QRD-1511', issue('QRD-1511', 'Aken', ['Cursor shows', 'An Edit client sees the cursor (QRD-1489)', 'Owner sees QRD-1520 badge']));
  await assert.rejects(service.act('QRD Sprint 27', owner, drift.rows[0].id, 'not-tested', null, 'Danu'), /not assigned to you/);
  assert.deepEqual(writes, []);
  issues.set('QRD-1511', issue('QRD-1511', 'Danu', ['Cursor shows', 'An Edit client sees the cursor (QRD-1489)', 'Owner sees QRD-1520 badge']));
  const after = await service.act('QRD Sprint 27', owner, drift.rows[0].id, 'not-tested', 'QA covers it on QRD-1489', 'Danu');
  assert.match(String(writes[0][2]), /An Edit client sees the cursor \(QRD-1489\) \(not tested here: needs QRD-1489\)/);
  assert.equal(after.rows.find((item) => item.refKey === 'QRD-1489')!.state, 'not-tested');
});

test('wait writes nothing; needs PO comments on the own ticket only', async () => {
  const { service, writes, owner } = setup();
  const drift = (await service.drift('QRD Sprint 27', owner))!;
  await service.act('QRD Sprint 27', owner, drift.rows[0].id, 'wait', null, 'Danu');
  assert.deepEqual(writes, []);
  const after = await service.act('QRD Sprint 27', owner, drift.rows[1].id, 'needs-po', null, 'Danu');
  assert.deepEqual(writes.map(([kind, key]) => [kind, key]), [['comment', 'QRD-1511']]);
  assert.match(String(writes[0][2]), /Needs PO.*Planner: Alvin/s);
  assert.deepEqual(after.rows.map((item) => item.state), ['wait', 'needs-po']);
});
