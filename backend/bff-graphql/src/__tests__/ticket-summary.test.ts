import test from 'node:test';
import assert from 'node:assert/strict';
import { acHash } from '../integrations/ac-scope';
import type { DraftView } from '../integrations/sprint-draft';
import { SprintInputError } from '../integrations/sprint-dashboard';
import { TicketSummaryService, acChangedFrom, parseSummary } from '../integrations/ticket-summary';

const AC = ['Owner sees the rule', 'Allow is grey on the consent page (QRD-1307)'];

function draft(sprint: string, loadedAt: string, ac: string[]): DraftView {
  return {
    sprint, loadedAt,
    tickets: [
      { key: 'QRD-1510', ac, acHash: acHash(ac), tcApproved: true },
      { key: 'QRD-1498', ac: ['Tab Playbook'], acHash: acHash(['Tab Playbook']), tcApproved: false },
    ],
    findings: [
      { id: 'ac|QRD-1510|QRD-1307|x', key: 'QRD-1510', refKey: 'QRD-1307', decision: { action: 'wait', note: null, by: 'Danu', at: '' } },
      { id: 'ac|QRD-1498|QRD-1289|y', key: 'QRD-1498', refKey: 'QRD-1289', decision: null },
    ],
  } as unknown as DraftView;
}

function setup() {
  const cache = new Map<string, unknown>();
  const statusCalls: string[][] = [];
  const views: Record<string, DraftView> = { 'QRD Sprint 26': draft('QRD Sprint 26', '2026-10-01T00:00:00.000Z', ['Old line']), 'QRD Sprint 27': draft('QRD Sprint 27', '2026-11-10T00:00:00.000Z', AC) };
  const service = new TicketSummaryService({
    store: {
      getCache: async (namespace, key) => cache.get(`${namespace}:${key}`) ?? null,
      upsertCache: async (namespace, key, value) => { cache.set(`${namespace}:${key}`, JSON.parse(JSON.stringify(value))); },
    },
    view: async (sprint) => views[sprint] ?? null,
    draftsWith: async (keys) => Object.keys(views).filter((sprint) => views[sprint].tickets.some((ticket) => keys.includes(ticket.key))),
    statusesOf: async (keys) => { statusCalls.push(keys); return new Map(keys.map((key) => [key, key === 'QRD-1307' ? 'In Progress' : 'UAT CHECK'])); },
    acChangedAt: async () => '2026-11-04T03:00:00.000Z',
    now: () => new Date('2026-11-13T02:00:00.000Z'),
  });
  return { service, cache, statusCalls, views };
}

const body = (over: Record<string, unknown> = {}) => ({
  key: 'qrd-1510', acHash: acHash(AC), made: 'Izin baru Expose Playbook folders', checked: 'Izinnya muncul', notHere: 'Drawer MCP (QRD-1312)', waitsOn: ['QRD-1307'],
  before: 'Semua member bisa', after: 'Cuma yang punya izin', line: 'Izin buat buka folder Playbook ke luar.', testData: 'member tanpa rule', ui: true,
  acId: ['Owner lihat rule-nya', 'Allow abu-abu di consent page'], titleId: 'Izin expose folder Playbook', ...over,
});

test('a summary is parsed whole: required text, ticket keys in waitsOn, ui a boolean', () => {
  const summary = parseSummary(body(), new Date('2026-11-13T02:00:00.000Z'));
  assert.equal(summary.key, 'QRD-1510');
  assert.equal(summary.writtenAt, '2026-11-13T02:00:00.000Z');
  assert.throws(() => parseSummary(body({ made: '  ' }), new Date()), /made is required/);
  assert.throws(() => parseSummary(body({ waitsOn: ['soon'] }), new Date()), /waitsOn must list ticket keys/);
  assert.throws(() => parseSummary(body({ ui: 'yes' }), new Date()), /ui must be true or false/);
  assert.equal(parseSummary(body({ testData: null }), new Date()).testData, null);
});

test('the summary route stores a summary for the AC in the draft and refuses one written for other AC lines', async () => {
  const { service, cache } = setup();
  await assert.rejects(service.write('QRD Sprint 27', body({ acHash: acHash(['Old line']) })), (error: unknown) => error instanceof SprintInputError && /changed since this summary was written/.test(error.message));
  await assert.rejects(service.write('QRD Sprint 27', body({ acId: ['one'] })), /one line per AC line \(2\)/);
  await assert.rejects(service.write('QRD Sprint 27', body({ key: 'QRD-1' })), /not in the QRD Sprint 27 draft/);
  await assert.rejects(service.write('QRD Sprint 9', body()), /No draft for QRD Sprint 9/);
  assert.equal(cache.size, 0);
  const stored = await service.write('QRD Sprint 27', body());
  assert.deepEqual(cache.get('ticket-summary:QRD-1510'), stored);
  assert.deepEqual(await service.hashes(['QRD-1510', 'QRD-1498']), { 'QRD-1510': acHash(AC) });
});

test('ticketSummary reads the summary with whether it is current and when the AC last changed; none written is null', async () => {
  const { service, views } = setup();
  assert.equal(await service.summary('QRD-1510'), null);
  await service.write('QRD Sprint 27', body());
  const summary = (await service.summary('qrd-1510'))!;
  assert.deepEqual([summary.made, summary.current, summary.acChangedAt], ['Izin baru Expose Playbook folders', true, '2026-11-04T03:00:00.000Z']);
  views['QRD Sprint 27'] = draft('QRD Sprint 27', '2026-11-12T00:00:00.000Z', [...AC, 'A new line']);
  assert.equal((await service.summary('QRD-1510'))!.current, false, 'the newest draft has other AC lines');
});

test('readiness facts come for every board card in one call: summary, test case approval, AC decisions and ref statuses', async () => {
  const { service, statusCalls } = setup();
  await service.write('QRD Sprint 27', body());
  const facts = await service.readiness(['QRD-1510', 'QRD-1498', 'QRD-404', 'nope'], ['QRD-1307', 'QRD-1289']);
  assert.deepEqual(facts.tickets.map((ticket) => [ticket.key, ticket.sprint, !!ticket.summary, ticket.tcApproved]), [
    ['QRD-1510', 'QRD Sprint 27', true, true], ['QRD-1498', 'QRD Sprint 27', false, false], ['QRD-404', null, false, false],
  ]);
  assert.deepEqual(facts.tickets[0].decisions, [{ refKey: 'QRD-1307', action: 'dependency' }], 'an older wait reads as dependency');
  assert.deepEqual(facts.statuses, [{ key: 'QRD-1307', status: 'In Progress' }, { key: 'QRD-1289', status: 'UAT CHECK' }]);
  await service.readiness(['QRD-1510'], ['QRD-1307']);
  assert.equal(statusCalls.length, 1, 'statuses are kept a few minutes');
});

test('the AC last changed at the newest changelog entry of the Acceptance Criteria field', () => {
  assert.equal(acChangedFrom([
    { created: '2026-11-01', items: [{ field: 'Acceptance Criteria', fieldId: 'customfield_10332' }] },
    { created: '2026-11-04', items: [{ fieldId: 'customfield_10332' }] },
    { created: '2026-11-05', items: [{ field: 'status' }] },
  ]), '2026-11-04');
  assert.equal(acChangedFrom([]), null);
});
