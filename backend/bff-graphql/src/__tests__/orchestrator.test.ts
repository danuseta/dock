import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { bearerToken, generateIngestToken, hashIngestToken } from '../auth/ingest-token';
import { PinRateLimiter } from '../auth/session';
import {
  DEFAULT_MACHINE,
  OrchestratorInputError,
  OrchestratorService,
  attentionItems,
  parseLedger,
  normalizeMachine,
  parseTranscript,
  reduceHookEvent,
  throttledPullRequestLookup,
  toOrchestration,
} from '../integrations/orchestrator';
import type { ChatService } from '../integrations/chat';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import { DoctorReports } from '../integrations/doctor';
import type { StorageService } from '../storage/service';

const withoutLedger = (row: any) => {
  if (!row) return null;
  const { ledgerRaw: _ledgerRaw, ...rest } = row;
  return rest;
};

function memoryStorage() {
  const runs = new Map<string, any>();
  const events: any[] = [];
  const resets = new Map<string, any>();
  const tokens: any[] = [];
  let sequence = 0;
  const storage = {
    getOrchestratorRuns: async () => [...runs.values()].map(withoutLedger),
    getOrchestratorRun: async (key: string) => withoutLedger(runs.get(key)),
    getOrchestratorRunWithLedger: async (key: string) => runs.get(key) ?? null,
    countLiveOrchestratorRuns: async (machine: string) => [...runs.values()].filter((row) => row.machine === machine && !row.dismissedAt).length,
    upsertOrchestratorRun: async (key: string, data: any) => {
      const existing = runs.get(key);
      if (existing && existing.machine !== data.machine) return existing;
      const row = {
        activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null,
        ...existing, key, ...data, dismissedAt: null,
      };
      runs.set(key, row);
      return row;
    },
    takeDismissedOrchestratorRun: async (key: string, data: any) => {
      const existing = runs.get(key);
      if (existing?.dismissedAt) runs.set(key, { ...existing, ...data, dismissedAt: null, activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null });
      return runs.get(key);
    },
    updateOrchestratorRun: async (key: string, data: any) => {
      const row = { ...runs.get(key), ...data };
      runs.set(key, row);
      return row;
    },
    addOrchestratorToolEvents: async () => undefined,
    resetOrchestratorRun: async (key: string, machine: string, resetAt: Date) => {
      runs.delete(key);
      for (let index = events.length - 1; index >= 0; index -= 1) if (events[index].ticketKey === key) events.splice(index, 1);
      resets.set(key, { key, machine, resetAt });
    },
    getOrchestratorReset: async (key: string) => resets.get(key) ?? null,
    getOrchestratorResets: async (machine: string) => [...resets.values()].filter((reset) => reset.machine === machine),
    getOrchestratorEvents: async (ticketKey: string, take: number) => events
      .filter((event) => event.ticketKey === ticketKey).reverse().slice(0, take),
    addOrchestratorEvent: async (ticketKey: string, kind: string, detail: string | null) => {
      const event = { id: String(sequence += 1), ticketKey, kind, detail, createdAt: new Date() };
      events.push(event);
      return event;
    },
    getIngestTokens: async () => tokens.filter((token) => !token.revokedAt),
    countIngestTokens: async () => tokens.filter((token) => !token.revokedAt).length,
    createIngestToken: async (data: any) => {
      const token = { id: String(sequence += 1), machine: 'laptop', ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
      tokens.push(token);
      return token;
    },
    findIngestToken: async (tokenHash: string) => tokens.find((token) => token.tokenHash === tokenHash && !token.revokedAt) ?? null,
    touchIngestToken: async (id: string, lastUsedAt: Date) => {
      const token = tokens.find((item) => item.id === id);
      if (token) token.lastUsedAt = lastUsedAt;
      return token;
    },
    revokeIngestToken: async (id: string) => {
      const token = tokens.find((item) => item.id === id && !item.revokedAt);
      if (token) token.revokedAt = new Date();
      return { count: token ? 1 : 0 };
    },
  };
  return { storage: storage as unknown as StorageService, runs, events, tokens };
}

const ledger = {
  key: 'qrd-1387',
  title: 'Assign panel: remove an assignment from an agent',
  stage: 'verify',
  waiting: 'Confirm the contract before opening the PR',
  gate: 'ASK FIRST',
  ac: [
    { n: 1, state: 'PASS', text: 'Each row has a remove action', evidence: 'E:/local/ac-1.png' },
    { n: 2, state: 'fail', text: 'Removal is scoped to this agent' },
    { n: 3, state: 'something else', text: 'Persists after reload' },
  ],
  tests: { be: '54 suites / 535 tests passed', fe: '50 files / 684 tests passed' },
  pr: { be: 'https://github.com/example/be/pull/1', fe: 'javascript:alert(1)' },
  ports: { be: 3187, fe: 5287 },
  dirs: { be: 'E:/local/wt-1387-be' },
  updatedAt: '2026-10-04T08:15:33.256Z',
};

test('orchestrator ledger parsing keeps only what DOCK shows', () => {
  const parsed = parseLedger(ledger, new Date('2026-10-05T00:00:00.000Z'));
  assert.strictEqual(parsed.key, 'QRD-1387');
  assert.strictEqual(parsed.kind, 'build');
  assert.strictEqual(parseLedger({ ...ledger, kind: 'review' }).kind, 'review');
  assert.strictEqual(parseLedger({ ...ledger, kind: 'anything' }).kind, 'build');
  assert.deepStrictEqual(parsed.ac.map((item) => item.state), ['PASS', 'FAIL', 'TODO']);
  assert.strictEqual(parsed.prBe, 'https://github.com/example/be/pull/1');
  assert.strictEqual(parsed.prFe, null, 'non-HTTP PR links are dropped');
  assert.strictEqual(parsed.updatedAt, '2026-10-04T08:15:33.256Z');
  assert.strictEqual(parsed.brief, null);
  assert.deepStrictEqual(parsed.decisions, []);
  const withBrief = parseLedger({ ...ledger, brief: 'line 1\nline 2', decisions: [{ at: '2026-10-04T08:00:00.000Z', text: 'use X' }, 'bad', { at: 'x' }, null] });
  assert.strictEqual(withBrief.brief, 'line 1\nline 2');
  assert.deepStrictEqual(withBrief.decisions, [{ n: 1, at: '2026-10-04T08:00:00.000Z', text: 'use X', status: 'DECIDED', by: null, issue: null, cancelNote: null }], 'an old decision reads as D-1 with no author');
  assert.deepStrictEqual(parsed.assumptions, []);
  assert.deepStrictEqual(parsed.failures, []);
  assert.strictEqual(parsed.closing, null);
  const withRisk = parseLedger({
    ...ledger,
    assumptions: [{ n: 1, text: 'BE returns hold', falsifier: 'the room has no such field', state: 'refuted', evidence: 'curl output' }, { text: 'no state' }, { falsifier: 'no text' }, 'bad'],
    failures: [{ at: '2026-10-04T08:00:00.000Z', type: 'transient', what: 'be tests', evidence: 'ETIMEDOUT', attempt: 2 }, { type: 'unknown', evidence: 'x' }, null],
    closing: { hours: 6.5, fixRounds: 2, replans: 1, failures: { transient: 2 } },
  });
  assert.deepStrictEqual(withRisk.assumptions, [
    { n: 1, text: 'BE returns hold', falsifier: 'the room has no such field', state: 'refuted', evidence: 'curl output' },
    { n: 2, text: 'no state', falsifier: '', state: 'open', evidence: null },
  ]);
  assert.deepStrictEqual(withRisk.failures, [{ at: '2026-10-04T08:00:00.000Z', type: 'transient', what: 'be tests', evidence: 'ETIMEDOUT', attempt: 2 }]);
  assert.deepStrictEqual(withRisk.closing, { hours: 6.5, fixRounds: 2, replans: 1 });
  assert.ok(!('dirs' in parsed) && !('ports' in parsed), 'local paths and ports stay on the laptop');

  assert.throws(() => parseLedger({ ...ledger, key: '../etc' }), OrchestratorInputError);
  assert.throws(() => parseLedger({ ...ledger, stage: 'shipping' }), OrchestratorInputError);
  assert.throws(() => parseLedger({ ...ledger, ac: Array.from({ length: 51 }, () => ({})) }), OrchestratorInputError);
  assert.strictEqual(
    parseLedger({ ...ledger, updatedAt: '2999-01-01T00:00:00.000Z' }, new Date('2026-10-05T00:00:00.000Z')).updatedAt,
    '2026-10-05T00:00:00.000Z',
    'a clock ahead of the server is clamped',
  );
});

test('hook events follow the Idle / Active / Waiting rules', () => {
  const idle = { activity: 'IDLE' as const, activityDetail: null, activityEndedAt: null };
  const now = new Date('2026-10-05T00:00:00.000Z');

  const active = reduceHookEvent(idle, 'PreToolUse', 'Edit', now);
  assert.deepStrictEqual(active, { activity: 'ACTIVE', activityDetail: 'Edit', activityEndedAt: null });

  const ended = reduceHookEvent(active, 'PostToolUse', null, now);
  assert.strictEqual(ended.activity, 'ACTIVE', 'the tool ending starts the grace window, it does not flip the state');
  assert.strictEqual(ended.activityEndedAt, now);

  assert.strictEqual(reduceHookEvent(active, 'PermissionRequest', null, now).activityDetail, 'permission');
  assert.strictEqual(reduceHookEvent(active, 'Notification', null, now).activity, 'WAITING');
  assert.deepStrictEqual(reduceHookEvent(idle, 'Stop', null, now), idle);
});

test('read model applies the grace window, the owner gate and staleness', () => {
  const base = {
    key: 'QRD-1', title: 'Ticket', stage: 'code', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'ACTIVE', activityDetail: 'Edit', activityEndedAt: null as Date | null,
    lastEventAt: new Date('2026-10-05T00:00:00.000Z'), ledgerUpdatedAt: new Date('2026-10-04T00:00:00.000Z'),
    transcriptAt: null, dismissedAt: null,
  };
  const at = (seconds: number) => new Date(base.lastEventAt.getTime() + seconds * 1000);

  assert.strictEqual(toOrchestration(base, at(5)).activity, 'ACTIVE');
  assert.strictEqual(toOrchestration({ ...base, activityEndedAt: at(0) }, at(1)).activity, 'ACTIVE', 'inside the 1.5 s grace window');
  assert.strictEqual(toOrchestration({ ...base, activityEndedAt: at(0) }, at(2)).activity, 'IDLE');

  const gated = toOrchestration({ ...base, waiting: 'Approve the plan' }, at(5));
  assert.strictEqual(gated.activity, 'WAITING', 'the ledger gate wins over the hook state');
  assert.strictEqual(gated.stalled, false);

  assert.strictEqual(toOrchestration(base, at(9 * 60)).stalled, false);
  assert.strictEqual(toOrchestration(base, at(11 * 60)).stalled, true, 'an active agent is stale after 10 minutes');
  assert.strictEqual(toOrchestration({ ...base, activity: 'IDLE' }, at(11 * 60)).stalled, false);
  assert.strictEqual(toOrchestration({ ...base, activity: 'IDLE' }, at(31 * 60)).stalled, true, 'an idle agent is stale after 30 minutes');
  assert.strictEqual(toOrchestration({ ...base, stage: 'done' }, at(99 * 60)).stalled, false);
  assert.strictEqual(toOrchestration(base, at(42)).idleSeconds, 42);
});

test('sous ledger fields: engine, card kind, rounds, draft, numbered decisions and issues; old ledgers keep working', () => {
  const sous = parseLedger({
    ...ledger,
    engine: 'sous',
    rounds: { used: 2, max: 4 },
    productionData: true,
    draft: true,
    blackboard: 'E:/qonflo/.evidence/blackboard/QRD-1387',
    decisions: [
      { n: 3, at: '2026-10-20T01:00:00.000Z', text: 'Keep the old export', status: 'shov', by: 'arbiter', issue: 2 },
      { n: 4, at: '2026-10-20T02:00:00.000Z', text: 'Drop the cache', status: 'CANCELLED', by: 'sous', cancelNote: 'needed by QRD-9' },
      { n: 5, text: 'Odd one', status: 'MAYBE', by: 'robot' },
    ],
    issues: [
      { n: 2, at: '2026-10-20T00:30:00.000Z', type: 'DISPUTE', text: 'BE and FE disagree on the field', level: 'owner', status: 'open', options: ['A', 'B', ''] },
      { n: 1, type: 'weird', text: 'Old question', status: 'resolved', resolvedBy: 3, resolvedAt: '2026-10-20T01:00:00.000Z' },
      { n: 6, text: '' },
    ],
  }, new Date('2026-10-21T00:00:00.000Z'));
  assert.deepStrictEqual([sous.engine, sous.rounds, sous.productionData, sous.draft], ['sous', { used: 2, max: 4 }, true, true]);
  assert.ok(!('blackboard' in sous), 'the local blackboard path stays on the machine');
  assert.deepStrictEqual(sous.decisions.map((item) => [item.n, item.status, item.by, item.issue, item.cancelNote]), [
    [3, 'SHOV', 'arbiter', 2, null], [4, 'CANCELLED', 'sous', null, 'needed by QRD-9'], [5, 'DECIDED', null, null, null],
  ]);
  assert.deepStrictEqual(sous.issues, [
    { n: 2, at: '2026-10-20T00:30:00.000Z', type: 'DISPUTE', text: 'BE and FE disagree on the field', level: 'owner', status: 'open', resolvedBy: null, resolvedAt: null, options: ['A', 'B'] },
    { n: 1, at: '', type: 'QUESTION', text: 'Old question', level: 'arbiter', status: 'resolved', resolvedBy: 3, resolvedAt: '2026-10-20T01:00:00.000Z', options: [] },
  ]);
  const review = parseLedger({ ...ledger, kind: 'review', verdict: { value: 'approve', ticket: 'qrd-77', prs: ['https://github.com/o/be/pull/4', 'javascript:x'] } });
  assert.deepStrictEqual([review.verdict, review.reviewTicket, review.reviewPrs], ['approve', 'QRD-77', ['https://github.com/o/be/pull/4']]);
  const old = parseLedger(ledger);
  assert.deepStrictEqual([old.reviewTicket, old.reviewPrs], [null, []]);
  assert.strictEqual(old.stackedOn, null, 'a ledger without stackedOn is unchanged');
  const stacked = parseLedger({ ...ledger, stackedOn: {
    key: 'qrd-1345',
    be: { pr: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1281', branch: 'feat/QRD-1345-flows', base: 'develop' },
    fe: { pr: 'javascript:alert(1)', branch: 'x' },
    retargeted: { be: '2026-10-21T01:00:00.000Z' },
  } });
  assert.deepStrictEqual(stacked.stackedOn, {
    key: 'QRD-1345',
    be: { pr: 'https://github.com/qonekid/ms-admin-worker-backend/pull/1281', branch: 'feat/QRD-1345-flows', base: 'develop', retargetedAt: '2026-10-21T01:00:00.000Z' },
    fe: null,
  }, 'a repo without a real PR link gets no entry');
  assert.strictEqual(parseLedger({ ...ledger, stackedOn: { key: 'not a key' } }).stackedOn, null);
  assert.strictEqual(parseLedger({ ...ledger, stackedOn: { key: 'QRD-1', be: { pr: 'https://github.com/o/be/pull/1', branch: '-rf ..' } } }).stackedOn?.be?.branch, null, 'an unsafe branch name is dropped');
  assert.deepStrictEqual([old.engine, old.rounds, old.productionData, old.draft, old.issues], [null, null, false, false, []]);

  assert.strictEqual(parseLedger({ ...ledger, key: 'card-Fix-Login', kind: 'card' }).key, 'CARD-fix-login', 'a card keeps its slug lower case');
  assert.strictEqual(parseLedger({ ...ledger, key: 'CARD-weekly-report' }).kind, 'card', 'a CARD key is a card without a kind');
  assert.strictEqual(parseLedger({ ...ledger, kind: 'ticket' }).kind, 'build');
  assert.throws(() => parseLedger({ ...ledger, key: 'CARD-' }), OrchestratorInputError);
  assert.throws(() => parseLedger({ ...ledger, key: 'CARD-bad slug' }), OrchestratorInputError);

  const row = {
    key: 'QRD-1387', title: 'Ticket', stage: 'code', waiting: 'I-2: BE and FE disagree on the field [A|B]', activity: 'IDLE', activityDetail: null, activityEndedAt: null,
    lastEventAt: null, ledgerUpdatedAt: new Date('2026-10-20T03:00:00.000Z'), transcriptAt: null, dismissedAt: null,
    payload: JSON.stringify({ ...sous, issues: [...sous.issues, { ...sous.issues[0], n: 7, text: 'Production data is touched' }] }),
  };
  const run = toOrchestration(row, new Date('2026-10-20T03:01:00.000Z'));
  assert.deepStrictEqual([run.engine, run.kind, run.draft, run.issues.length], ['sous', 'build', true, 3]);
  assert.deepStrictEqual(attentionItems([run]).filter((item) => item.type !== 'AGENT_AC_FAILED').map((item) => [item.type, item.message]), [
    ['AGENT_WAITING', 'Waiting on you: I-2: BE and FE disagree on the field [A|B]'],
    ['AGENT_ISSUE', 'Waiting on you: I-7: Production data is touched'],
  ], 'an owner issue the waiting text does not name gets its own item');
  const stored = toOrchestration({ ...row, waiting: '', payload: JSON.stringify({ decisions: [{ at: 'x', text: 'old' }] }) }, new Date('2026-10-20T03:01:00.000Z'));
  assert.deepStrictEqual([stored.decisions[0].n, stored.decisions[0].status, stored.issues, stored.engine], [1, 'DECIDED', [], null], 'a payload stored before the sous fields still reads');
});

test('a run whose lead ended its turn with subagents still running is stalled at once, with that reason', async () => {
  const base = {
    key: 'QRD-1456', title: 'Ticket', stage: 'code', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null as Date | null,
    lastEventAt: new Date('2026-10-17T00:00:00.000Z'), ledgerUpdatedAt: new Date('2026-10-17T00:00:00.000Z'),
    transcriptAt: null, dismissedAt: null, stalledDetail: 'Lead ended its turn while 2 subagents were still running',
  };
  const soon = new Date(base.lastEventAt.getTime() + 5000);
  const run = toOrchestration(base, soon);
  assert.deepStrictEqual([run.stalled, run.stalledDetail], [true, base.stalledDetail]);
  assert.deepStrictEqual(attentionItems([run]).map((item) => [item.type, item.message]), [['AGENT_STALLED', base.stalledDetail]]);
  assert.strictEqual(toOrchestration({ ...base, waiting: 'Which endpoint?' }, soon).stalled, false, 'the owner gate wins');
  assert.strictEqual(toOrchestration({ ...base, stage: 'done' }, soon).stalled, false);
  assert.deepStrictEqual([toOrchestration({ ...base, stalledDetail: null }, soon).stalled, toOrchestration({ ...base, stalledDetail: null }, soon).stalledDetail], [false, null]);

  const { storage, events } = memoryStorage();
  const service = new OrchestratorService(storage, await mkdtemp(path.join(os.tmpdir(), 'dock-transcripts-')));
  await service.ingestLedger({ ...ledger, waiting: '', pr: {} }, soon, 'laptop');
  await service.setStalledDetail('QRD-1387', base.stalledDetail);
  await service.setStalledDetail('QRD-1387', base.stalledDetail);
  assert.deepStrictEqual((await service.get('QRD-1387', soon))?.stalledDetail, base.stalledDetail);
  assert.strictEqual(events.filter((event) => event.kind === 'STALLED').length, 1, 'the same reason is logged once');
  await service.setStalledDetail('QRD-1387', null);
  assert.strictEqual((await service.get('QRD-1387', soon))?.stalledDetail, null, 'the next turn clears it');
  await service.setStalledDetail('QRD-404', base.stalledDetail);

  const setAt = new Date('2026-10-17T01:00:00.000Z');
  const stall = () => service.setStalledDetail('QRD-1387', base.stalledDetail, setAt);
  const detail = async () => (await storage.getOrchestratorRun('QRD-1387'))?.stalledDetail ?? null;
  await stall();
  await service.ingestEventBatch({ key: 'QRD-1387', events: [{ event: 'PreToolUse', tool: 'Bash', at: '2026-10-17T00:59:00.000Z' }] }, setAt, 'laptop');
  assert.strictEqual(await detail(), base.stalledDetail, 'a late event from the ended turn keeps it');
  await service.ingestEventBatch({ key: 'QRD-1387', events: [{ event: 'PreToolUse', tool: 'Bash', at: '2026-10-17T01:01:00.000Z' }] }, new Date('2026-10-17T01:05:00.000Z'), 'laptop');
  assert.strictEqual(await detail(), null, 'an event after the stall clears it');
  await stall();
  await service.ingestLedger({ ...ledger, waiting: '', pr: {}, updatedAt: '2026-10-17T00:30:00.000Z' }, setAt, 'laptop');
  assert.strictEqual(await detail(), base.stalledDetail, 'an older ledger keeps it');
  await service.ingestLedger({ ...ledger, waiting: '', pr: {}, updatedAt: '2026-10-17T01:02:00.000Z' }, new Date('2026-10-17T01:05:00.000Z'), 'laptop');
  assert.strictEqual(await detail(), null, 'a ledger written after the stall clears it');
  await stall();
  await service.dismiss('QRD-1387', 'laptop');
  await service.ingestLedger({ ...ledger, waiting: '', pr: {}, updatedAt: '2026-10-17T00:10:00.000Z' }, setAt, 'laptop');
  assert.strictEqual(await detail(), null, 'a revived run starts unstalled');
});

test('orchestrator service ingests ledgers, events and builds attention items', async () => {
  const { storage, events } = memoryStorage();
  const transcripts = await mkdtemp(path.join(os.tmpdir(), 'dock-transcripts-'));
  const service = new OrchestratorService(storage, transcripts);
  const now = new Date('2026-10-05T00:00:00.000Z');

  try {
    assert.strictEqual(await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse' }, now, 'laptop'), null, 'unknown tickets are not created by hooks');

    const run = await service.ingestLedger(ledger, now, 'laptop');
    assert.strictEqual(run.activity, 'WAITING');
    assert.deepStrictEqual([run.acPassed, run.acFailed, run.acTotal], [1, 1, 3]);
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING']);

    assert.deepStrictEqual(attentionItems(await service.list(now)).map((item) => item.type), ['AGENT_WAITING', 'AGENT_AC_FAILED']);

    await service.ingestLedger({ ...ledger, waiting: '', stage: 'pr', ac: [], pr: {} }, now, 'laptop');
    assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'WAITING', 'STAGE', 'RESUMED']);

    const working = await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Bash' }, now, 'laptop');
    assert.strictEqual(working?.activity, 'ACTIVE');
    await service.ingestHookEvent({ key: 'QRD-1387', event: 'PreToolUse', detail: 'Read' }, now, 'laptop');
    assert.strictEqual(events.filter((event) => event.kind === 'AGENT_ACTIVE').length, 1, 'repeated tool calls do not grow the event log');

    const later = new Date(now.getTime() + 45 * 60 * 1000);
    assert.deepStrictEqual(attentionItems(await service.list(later)).map((item) => item.type), ['AGENT_STALLED']);

    assert.strictEqual(await service.readTranscript('QRD-1387'), null);
    const stats = await service.saveTranscript({
      key: 'QRD-1387', files: [{ path: 'abc.jsonl', text: '{"type":"user"}\n' }], stats: { masked: 3 },
    }, now, 'laptop');
    assert.deepStrictEqual(stats, { files: 1, bytes: 16, masked: 3 });
    assert.deepStrictEqual(JSON.parse(await service.readTranscript('QRD-1387') || '{}').files[0].path, 'abc.jsonl');
    assert.strictEqual((await service.get('QRD-1387', now))?.hasTranscript, true);
    assert.throws(() => parseTranscript({ key: 'QRD-1', files: [{ path: '../../etc/passwd', text: '' }] }), OrchestratorInputError);
    assert.strictEqual(await service.readTranscript('../QRD-1387'), null);

    assert.strictEqual(await service.dismiss('QRD-1387', 'laptop'), true);
    assert.deepStrictEqual(await service.list(now), []);
    await service.ingestLedger(ledger, now, 'laptop');
    assert.strictEqual((await service.list(now)).length, 1, 'a new ledger push brings a dismissed run back');
  } finally {
    await rm(transcripts, { recursive: true, force: true });
  }
});

test('ingest tokens are shown once, stored hashed and revocable', async () => {
  const { storage, tokens } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());

  const created = await service.createToken('  laptop  ');
  assert.match(created.token, /^dock_ing_[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(created.record.name, 'laptop');
  assert.strictEqual(tokens[0].tokenHash, hashIngestToken(created.token));
  assert.ok(!JSON.stringify(tokens).includes(created.token), 'the secret itself is never stored');
  assert.ok(!JSON.stringify(await service.tokens()).includes(tokens[0].tokenHash));

  assert.strictEqual(await service.authenticateMachine(created.token), 'laptop');
  assert.strictEqual(await service.authenticateMachine(generateIngestToken().token), null);
  assert.strictEqual(await service.revokeToken(created.record.id), true);
  assert.strictEqual(await service.authenticateMachine(created.token), null);
  await assert.rejects(service.createToken(' '), OrchestratorInputError);

  const header = (authorization?: string) => bearerToken({ headers: { authorization } } as any);
  assert.strictEqual(header(`Bearer ${created.token}`), created.token);
  assert.strictEqual(header('Bearer some-other-secret'), null);
  assert.strictEqual(header(undefined), null);
});

test('ingest routes require a token and throttle only failures', async (t) => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const { token } = await service.createToken('laptop');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/ingest/orchestrator`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (route: string, body: unknown, bearer?: string) => fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  assert.strictEqual((await post('', ledger)).status, 401);

  const accepted = await post('', ledger, token);
  assert.strictEqual(accepted.status, 200);
  assert.deepStrictEqual(await accepted.json(), { ok: true, result: { key: 'QRD-1387', stage: 'verify' } });

  assert.strictEqual((await post('', { ...ledger, stage: 'nope' }, token)).status, 400);
  assert.strictEqual((await post('', '{not json', token)).status, 400);
  assert.strictEqual((await post('/event', { key: 'QRD-9', event: 'PreToolUse' }, token)).status, 404);
  assert.strictEqual((await post('/event', { key: 'QRD-1387', event: 'PreToolUse', detail: 'Edit' }, token)).status, 200);

  assert.strictEqual((await post('', ledger, 'dock_ing_wrong')).status, 401);
  assert.strictEqual((await post('', ledger, 'dock_ing_wrong')).status, 429, 'failures are throttled');
  assert.strictEqual((await post('', ledger, token)).status, 200, 'a valid token is not locked out by failed attempts');
});

test('a run with a pull request is waiting for review, not stalled', async () => {
  const lastEventAt = new Date('2026-10-05T00:00:00.000Z');
  const row = (stage: string, ledger: object = {}) => ({
    key: 'QRD-1387', title: 'Ticket', stage, waiting: '', payload: JSON.stringify({ ac: [], ...ledger }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null as Date | null,
    lastEventAt, ledgerUpdatedAt: lastEventAt, transcriptAt: null, dismissedAt: null,
  });
  const later = new Date(lastEventAt.getTime() + 45 * 60 * 1000);
  const pr = (status: 'open' | 'draft' | 'merged' | 'closed', number = 7) => ({ url: `https://github.com/example/be/pull/${number}`, number, repo: 'example/be', status });

  const none = toOrchestration(row('pr'), later);
  assert.deepStrictEqual([none.stalled, none.review, none.pullRequests], [true, null, []], 'no pull request: unchanged');
  assert.deepStrictEqual(toOrchestration(row('pr'), later, [pr('closed')]).review, null);

  const open = toOrchestration(row('pr'), later, [pr('merged', 6), pr('open')]);
  assert.deepStrictEqual([open.stalled, open.review], [false, 'open']);
  assert.strictEqual(toOrchestration(row('pr'), later, [pr('draft')]).review, 'open');
  assert.deepStrictEqual(attentionItems([open]), [], 'no AGENT_STALLED item for a run in review');

  const merged = toOrchestration(row('pr'), later, [pr('merged', 6), pr('merged')]);
  assert.deepStrictEqual([merged.stalled, merged.review], [false, 'merged']);

  const fromLedger = toOrchestration(row('pr', { prBe: 'https://github.com/example/be/pull/9' }), later);
  assert.deepStrictEqual([fromLedger.stalled, fromLedger.review], [false, 'open']);
  assert.deepStrictEqual(fromLedger.pullRequests, [{ url: 'https://github.com/example/be/pull/9', number: 9, repo: 'example/be', status: 'open' }]);

  const done = toOrchestration(row('done'), later, [pr('open')]);
  assert.deepStrictEqual([done.stalled, done.review], [false, null]);

  const finished = (stage: string, prs: Array<ReturnType<typeof pr>>) => toOrchestration(row(stage), later, prs).finished;
  assert.deepStrictEqual(
    [finished('done', []), finished('pr', [pr('merged', 1), pr('merged', 2)]), finished('pr', [pr('merged', 1), pr('open', 2)]), finished('pr', [pr('closed')]), finished('pr', [pr('merged', 1), pr('closed', 2)]), finished('pr', [])],
    [true, true, false, false, false, false],
    'done stage or every pull request merged; closed-only, mixed and no PR are not finished',
  );
  const mergedRun = toOrchestration({ ...row('pr'), waiting: 'Approve?', payload: JSON.stringify({ ac: [{ n: 1, state: 'FAIL', text: 'x' }] }) }, later, [pr('merged')]);
  assert.deepStrictEqual(attentionItems([mergedRun]), [], 'a merged run produces no attention item');

  const active = { ...row('pr'), activity: 'ACTIVE', activityDetail: 'Bash' };
  const at = (minutes: number) => new Date(lastEventAt.getTime() + minutes * 60 * 1000);
  const silent = toOrchestration(active, at(11), [pr('open')]);
  assert.deepStrictEqual([silent.activity, silent.activityDetail, silent.endedSeconds, silent.stalled, silent.review], ['IDLE', null, null, false, 'open']);
  assert.strictEqual(toOrchestration(active, at(2), [pr('open')]).activity, 'ACTIVE', 'a recent event still reads Working');
  const noPr = toOrchestration(active, at(11));
  assert.deepStrictEqual([noPr.activity, noPr.stalled], ['ACTIVE', true], 'without a pull request a stale ACTIVE run is stalled');
  assert.strictEqual(toOrchestration({ ...active, waiting: 'Approve' }, at(11), [pr('open')]).activity, 'WAITING');
});

test('the service looks up GitHub only for runs that can be in review', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir(), async (key) => {
    calls.push(key);
    if (key === 'QRD-3') throw new Error('GitHub down');
    return [{ url: 'https://github.com/example/be/pull/1', number: 1, repo: 'example/be', status: 'open' }];
  });
  const calls: string[] = [];
  const now = new Date('2026-10-05T00:00:00.000Z');
  const ledger = (key: string, stage: string) => ({ key, title: key, stage, ac: [] });
  for (const [key, stage] of [['QRD-1', 'code'], ['QRD-2', 'pr'], ['QRD-3', 'commit'], ['QRD-4', 'done']]) {
    await service.ingestLedger(ledger(key, stage), now, 'laptop');
  }

  const runs = await service.list(now);
  assert.deepStrictEqual(calls.sort(), ['QRD-2', 'QRD-3'], 'only pr/commit/evidence runs, never code or done');
  assert.deepStrictEqual(runs.map((run) => run.review), [null, 'open', null, null], 'a failing lookup does not fail the list');

  calls.length = 0;
  const stale = new Date(now.getTime() + 45 * 60 * 1000);
  await service.list(stale);
  assert.deepStrictEqual(calls.sort(), ['QRD-1', 'QRD-2', 'QRD-3'], 'a run that would be stalled is looked up too');
});

test('the pull request lookup asks GitHub at most once per ticket per window', async () => {
  let clock = 1_000;
  let searches = 0;
  const lookup = throttledPullRequestLookup(async () => {
    searches += 1;
    return [{ url: 'https://github.com/example/be/pull/1', number: 1, repo: 'example/be', status: 'open' as const }];
  }, 5 * 60 * 1000, () => clock);

  await Promise.all([lookup('QRD-1'), lookup('QRD-1')]);
  assert.strictEqual(searches, 1);
  clock += 4 * 60 * 1000;
  assert.strictEqual((await lookup('QRD-1')).length, 1);
  assert.strictEqual(searches, 1, 'still inside the window');
  await lookup('QRD-2');
  assert.strictEqual(searches, 2, 'the window is per ticket');
  clock += 2 * 60 * 1000;
  await lookup('QRD-1');
  assert.strictEqual(searches, 3);
});

test('a hook-level waiting ends when an agent acts or stops, and does not outlive a quiet spell', async () => {
  const { storage } = memoryStorage();
  Object.assign(storage, { addOrchestratorToolEvents: async () => undefined });
  const service = new OrchestratorService(storage, os.tmpdir());
  const start = new Date('2026-10-05T00:00:00.000Z');
  const after = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  await service.ingestLedger({ key: 'QRD-5', title: 'Ticket', stage: 'pr', ac: [] }, start, 'laptop');
  const batch = async (events: object[], now: Date) => service.ingestEventBatch({ key: 'QRD-5', events: events.map((event) => ({ at: now.toISOString(), ...event })) }, now, 'laptop');
  const notification = { event: 'Notification', detail: 'Claude needs your permission', agentId: 'sub-1', agentType: 'test-runner' };

  assert.strictEqual((await batch([notification], after(10)))?.activity, 'WAITING', 'a pending prompt still shows');
  assert.strictEqual((await batch([{ event: 'SubagentStop', agentId: 'sub-1', agentType: 'test-runner' }], after(20)))?.activity, 'IDLE', 'the agent stopping ends it');

  await batch([notification], after(30));
  assert.strictEqual((await batch([{ event: 'Stop', agentId: 'sub-1', agentType: 'test-runner' }], after(40)))?.activity, 'IDLE', 'a subagent turn ending ends it');

  await batch([notification], after(50));
  assert.strictEqual((await batch([{ event: 'Stop' }], after(60)))?.activity, 'IDLE', 'the main session stopping ends it');

  await batch([notification], after(70));
  assert.strictEqual((await batch([{ event: 'PreToolUse', tool: 'Read' }], after(80)))?.activity, 'ACTIVE', 'acting again ends it');

  await batch([notification], after(90));
  const quietSpell = 31 * 60;
  assert.strictEqual((await service.get('QRD-5', after(90 + 29 * 60)))?.activity, 'WAITING', 'still inside the quiet window');
  const quiet = await service.get('QRD-5', after(90 + quietSpell));
  assert.deepStrictEqual([quiet?.activity, quiet?.activityDetail], ['IDLE', null], 'no event for 30 minutes: nobody is blocked on it');

  await service.ingestLedger({ key: 'QRD-5', title: 'Ticket', stage: 'pr', ac: [], waiting: 'Approve the merge?' }, after(90), 'laptop');
  assert.deepStrictEqual([(await service.get('QRD-5', after(90 + 3 * 3600)))?.activity, (await service.get('QRD-5', after(90 + 3 * 3600)))?.activityDetail], ['WAITING', 'gate'], 'the ledger gate never expires');
});

test('review signals reach the run and Needs Attention, and only for open pull requests', () => {
  const lastEventAt = new Date('2026-10-05T00:00:00.000Z');
  const row = {
    key: 'QRD-1387', title: 'Ticket', stage: 'pr', waiting: '', payload: JSON.stringify({ ac: [] }),
    activity: 'IDLE', activityDetail: null, activityEndedAt: null as Date | null,
    lastEventAt, ledgerUpdatedAt: lastEventAt, transcriptAt: null, dismissedAt: null,
  };
  const now = new Date(lastEventAt.getTime() + 60 * 1000);
  const pr = (number: number, status: 'open' | 'merged' | 'closed', reviewDecision: 'changes_requested' | 'approved' | 'none', checks: 'failing' | 'pending' | 'passing' | 'none') => (
    { url: `https://github.com/example/be/pull/${number}`, number, repo: 'example/be', status, reviewDecision, checks }
  );
  const types = (prs: ReturnType<typeof pr>[]) => attentionItems([toOrchestration(row, now, prs)]).map((item) => item.type);

  const both = toOrchestration(row, now, [pr(7, 'open', 'changes_requested', 'failing'), pr(8, 'open', 'approved', 'failing')]);
  assert.deepStrictEqual([both.review, both.reviewSignal], ['open', 'changes_requested']);
  assert.deepStrictEqual(attentionItems([both]).map((item) => [item.type, item.message]), [
    ['AGENT_CHANGES_REQUESTED', 'Changes requested on example/be#7'],
    ['AGENT_CHECKS_FAILING', 'Checks failing on example/be#7, example/be#8'],
  ]);
  assert.deepStrictEqual(types([pr(7, 'open', 'none', 'failing')]), ['AGENT_CHECKS_FAILING']);
  assert.deepStrictEqual(types([pr(7, 'open', 'approved', 'pending')]), [], 'running checks and approvals need no attention');
  assert.strictEqual(toOrchestration(row, now, [pr(7, 'open', 'approved', 'pending')]).reviewSignal, 'checks_pending');
  assert.strictEqual(toOrchestration(row, now, [pr(7, 'open', 'approved', 'passing')]).reviewSignal, 'approved');
  assert.deepStrictEqual(types([pr(7, 'merged', 'changes_requested', 'failing')]), [], 'a merged run produces none');
  assert.deepStrictEqual(types([pr(7, 'merged', 'changes_requested', 'failing'), pr(8, 'open', 'none', 'none')]), [], 'a merged pull request is not blamed while another is open');
  assert.deepStrictEqual(types([pr(7, 'closed', 'changes_requested', 'failing')]), [], 'a closed one does not count');
  assert.deepStrictEqual(attentionItems([toOrchestration({ ...row, stage: 'done' }, now, [pr(7, 'open', 'changes_requested', 'failing')])]), [], 'a finished run produces none');

  const unknown = toOrchestration(row, now, [{ url: 'https://github.com/example/be/pull/9', number: 9, repo: 'example/be', status: 'open' }]);
  assert.deepStrictEqual([unknown.review, unknown.reviewSignal, attentionItems([unknown])], ['open', null, []], 'without facts from GitHub the run reads as before');
});

test('a token carries a machine name; the legacy token is the laptop', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());

  const unnamed = await service.createToken('  Laptop 2 ');
  assert.strictEqual(unnamed.record.machine, 'laptop', 'a missing machine is the laptop, never derived from the token name');
  assert.strictEqual((await service.createToken('Third', '   ')).record.machine, 'laptop', 'a blank machine is the laptop too');
  assert.strictEqual((await service.createToken('Fourth', null)).record.machine, 'laptop');
  const named = await service.createToken('Second', 'Workspace');
  assert.strictEqual(named.record.machine, 'workspace');
  await assert.rejects(service.createToken('x', '9bad name'), OrchestratorInputError);
  assert.throws(() => normalizeMachine('a'.repeat(25)), OrchestratorInputError);
  assert.strictEqual(DEFAULT_MACHINE, 'laptop');

  assert.strictEqual(await service.authenticateMachine(named.token), 'workspace');
  assert.strictEqual(await service.authenticateMachine(generateIngestToken().token), null);
  assert.deepStrictEqual((await service.tokens()).map((token) => token.machine), ['laptop', 'laptop', 'laptop', 'workspace']);
  assert.deepStrictEqual(await service.machines(), ['laptop', 'workspace']);

  const generated = generateIngestToken();
  await storage.createIngestToken({ name: 'kit', prefix: generated.prefix, tokenHash: generated.tokenHash } as Parameters<StorageService['createIngestToken']>[0]);
  assert.strictEqual(await service.authenticateMachine(generated.token), 'laptop', 'a token created before machines existed is the laptop');

  assert.strictEqual(await service.revokeToken(named.record.id), true);
  assert.strictEqual(await service.authenticateMachine(named.token), null);
  assert.deepStrictEqual(await service.machines(), ['laptop']);
});

test('a ticket belongs to one machine; a ledger or an event from another is ignored', async () => {
  const { storage, events, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const start = new Date('2026-10-05T00:00:00.000Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60 * 1000);
  const base = { ...ledger, key: 'ZED-201', waiting: '', stage: 'code', ac: [], pr: {}, history: [{ at: 'x', to: 'code' }], handoffs: [{ who: 'be', proven: true }] };
  const push = (machine: string, minutes: number, updatedAt: number, extra: object = {}) => service.ingestLedger({ ...base, ...extra, updatedAt: at(updatedAt).toISOString() }, at(minutes), machine);

  const created = await push('laptop', 0, 0);
  assert.deepStrictEqual([created.machine, created.ignored], ['laptop', false]);
  const raw = JSON.parse(runs.get('ZED-201').ledgerRaw);
  assert.deepStrictEqual([raw.history, raw.handoffs.length, 'dirs' in raw, 'ports' in raw], [base.history, 1, false, false]);
  await service.ingestHookEvent({ key: 'ZED-201', event: 'PreToolUse', detail: 'Bash' }, at(1), 'laptop');

  await service.ingestHookEvent({ key: 'ZED-201', event: 'Stop' }, at(2), 'workspace');
  assert.strictEqual((await service.ingestHookEvent({ key: 'ZED-201', event: 'PreToolUse', detail: 'Edit' }, at(2), 'workspace'))?.machine, 'laptop');
  await service.ingestEventBatch({ key: 'ZED-201', events: [{ event: 'Notification', at: at(2).toISOString() }] }, at(2), 'workspace');
  assert.notStrictEqual(await service.saveTranscript({ key: 'ZED-201', files: [{ path: 'a.jsonl', text: '{}' }] }, at(2), 'workspace'), null);
  assert.strictEqual(await service.readTranscript('ZED-201'), null, 'a transcript from another machine is not stored');
  const owned = await service.get('ZED-201', at(2));
  assert.deepStrictEqual([owned?.activity, owned?.activityDetail, owned?.machine], ['ACTIVE', 'Bash', 'laptop']);

  const before = { ...runs.get('ZED-201') };
  for (const [minutes, updatedAt] of [[5, 4], [120, 119], [180, -1]]) {
    const other = await push('workspace', minutes, updatedAt, { stage: 'test' });
    assert.deepStrictEqual([other.ignored, other.machine, other.stage], [true, 'laptop', 'code'], 'a newer ledger never takes the ticket, however long the owner was quiet');
  }
  assert.deepStrictEqual(runs.get('ZED-201'), before, 'the stored row did not change');
  assert.deepStrictEqual(events.map((event) => event.kind), ['STAGE', 'AGENT_ACTIVE']);
});

test('a machine lists and reads only the tickets it owns', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const at = new Date('2026-10-05T00:00:00.000Z');
  const base = { ...ledger, key: 'ZED-201', waiting: '', stage: 'code', ac: [], pr: {}, history: [{ at: 'x', to: 'code' }] };
  const push = (machine: string, extra: object = {}) => service.ingestLedger({ ...base, ...extra, updatedAt: at.toISOString() }, at, machine);

  await push('laptop');
  await push('laptop', { key: 'ZED-102' });
  assert.deepStrictEqual((await service.ledgerList('workspace')).runs, [], 'a machine lists only what it owns');
  assert.deepStrictEqual((await service.ledgerList('laptop')).runs.map((run) => run.mine), [true, true]);
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-201' }, 'workspace'), null, 'a ticket of another machine answers like a missing one');
  const read = await service.ledgerGet({ key: 'ZED-201' }, 'laptop');
  assert.deepStrictEqual([read?.machine, (read?.ledger as { history: unknown }).history], ['laptop', base.history]);
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-999' }, 'laptop'), null);
  const ignored = await push('workspace', { stage: 'pr' });
  assert.deepStrictEqual([ignored.ignored, ignored.machine], [true, 'laptop'], 'another machine never takes the ticket');
});

test('the machine comes from the token, never from the request body', async (t) => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const laptop = await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (route: string, body: unknown, bearer: string) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  const now = new Date();
  const zed = { ...ledger, key: 'ZED-102', waiting: '', updatedAt: new Date(now.getTime() - 60_000).toISOString() };

  const first = await post('', { ...zed, machine: 'workspace' }, laptop.token);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(runs.get('ZED-102').machine, 'laptop', 'a body naming another machine is ignored');
  assert.strictEqual((await post('/event', { key: 'ZED-102', event: 'PreToolUse', detail: 'Edit' }, laptop.token)).status, 200);
  assert.strictEqual(runs.get('ZED-102').activity, 'ACTIVE');

  const other = await post('', { ...zed, stage: 'pr', machine: 'laptop', updatedAt: now.toISOString() }, workspace.token);
  assert.deepStrictEqual(await other.json(), { ok: true, result: { key: 'ZED-102', ignored: true, owner: 'laptop' } });

  const event = await post('/event', { key: 'ZED-102', event: 'Notification', machine: 'laptop' }, workspace.token);
  assert.strictEqual(event.status, 200);
  assert.strictEqual(runs.get('ZED-102').activity, 'ACTIVE', 'activity from the other machine is dropped');
});

async function serveIngest(t: { after: (fn: () => Promise<void>) => void }, service: OrchestratorService, chat?: ChatService) {
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(2, 60_000), chat));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return async (route: string, body: unknown, bearer: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
}

test('every ticket route acts as the machine of the token', async (t) => {
  const { storage, runs } = memoryStorage();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dock-routes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new OrchestratorService(storage, directory);
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  const zed = { ...ledger, key: 'ZED-301', waiting: '', updatedAt: new Date(Date.now() - 60_000).toISOString() };

  assert.strictEqual((await post('', zed, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').machine, 'workspace', '/ creates the ticket for the token machine');
  assert.strictEqual((await post('/event', { key: 'ZED-301', event: 'PreToolUse', detail: 'Edit' }, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').activityDetail, 'Edit', '/event is applied');
  assert.strictEqual((await post('/events', { key: 'ZED-301', events: [{ event: 'PreToolUse', tool: 'Bash' }] }, workspace.token)).body.result.ignored, undefined);
  assert.strictEqual(runs.get('ZED-301').activityDetail, 'Bash', '/events is applied');
  assert.deepStrictEqual((await post('/transcript', { key: 'ZED-301', files: [{ path: 'a.jsonl', text: '{}' }] }, workspace.token)).body.result.files, 1);
  assert.notStrictEqual(await service.readTranscript('ZED-301'), null, '/transcript is stored');
  assert.deepStrictEqual((await post('/ledger/list', {}, workspace.token)).body.result.runs.map((run: { key: string; mine: boolean }) => [run.key, run.mine]), [['ZED-301', true]]);
  assert.strictEqual((await post('/ledger/get', { key: 'ZED-301' }, workspace.token)).body.result.machine, 'workspace');
});

test('a push from a machine that does not own the ticket says so', async (t) => {
  const { storage, runs } = memoryStorage();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dock-ignored-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new OrchestratorService(storage, directory);
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  await service.ingestLedger({ ...ledger, key: 'ZED-303', waiting: '' }, new Date(), 'laptop');

  const event = await post('/event', { key: 'ZED-303', event: 'PreToolUse' }, workspace.token);
  const events = await post('/events', { key: 'ZED-303', events: [{ event: 'PreToolUse', tool: 'Bash' }] }, workspace.token);
  const transcript = await post('/transcript', { key: 'ZED-303', files: [{ path: 'a.jsonl', text: '{}' }] }, workspace.token);
  for (const response of [event, events, transcript]) {
    assert.strictEqual(response.status, 200, 'the deployed kit keeps working');
    assert.strictEqual(response.body.result.ignored, true);
    assert.strictEqual(response.body.result.owner, 'laptop');
  }
  assert.strictEqual(runs.get('ZED-303').activity, 'IDLE');
  assert.strictEqual(await service.readTranscript('ZED-303'), null);
});

test('a machine reads only the tickets it owns', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  await service.ingestLedger({ ...ledger, key: 'ZED-310', waiting: '', secret: 'only for the laptop' }, now, 'laptop');
  assert.strictEqual(await service.ledgerGet({ key: 'ZED-310' }, 'workspace'), await service.ledgerGet({ key: 'ZED-404' }, 'workspace'), 'a hidden ticket answers exactly like a missing one');
  assert.deepStrictEqual((await service.ledgerList('workspace')).runs, []);
});

test('a dismissed ticket is taken only when its machine has no live token', async () => {
  const { storage, runs, events } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const push = (key: string, machine: string, title = 'Zed') => service.ingestLedger({ ...ledger, key, title, waiting: '', updatedAt: now.toISOString() }, now, machine);

  await push('ZED-320', 'laptop');
  await service.ingestHookEvent({ key: 'ZED-320', event: 'PreToolUse', detail: 'Bash' }, now, 'laptop');
  await service.dismiss('ZED-320', 'laptop');
  assert.strictEqual((await push('ZED-320', 'laptop')).ignored, false, 'the owner revives its own dismissed ticket');
  assert.strictEqual(runs.get('ZED-320').activity, 'ACTIVE', 'a revival by the owner keeps its history');

  await service.dismiss('ZED-320', 'laptop');
  const refused = await push('ZED-320', 'workspace', 'Pusher title');
  assert.deepStrictEqual([refused.ignored, refused.machine], [true, 'laptop'], 'another machine cannot take a ticket whose owner still has a token');
  assert.deepStrictEqual([runs.get('ZED-320').machine, runs.get('ZED-320').title, runs.get('ZED-320').dismissedAt === null], ['laptop', 'Zed', false], 'the row stays dismissed');
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 0);

  runs.set('ZED-320', { ...runs.get('ZED-320'), machine: 'workspace', dismissedAt: null });
  await service.ingestHookEvent({ key: 'ZED-320', event: 'PreToolUse', detail: 'Edit' }, now, 'workspace');
  runs.set('ZED-320', { ...runs.get('ZED-320'), lastEventAt: now, transcriptAt: now });
  await service.dismiss('ZED-320', 'workspace');
  assert.strictEqual((await push('ZED-320', 'laptop')).ignored, true, 'the same rule holds for the new owner');

  await service.revokeToken(workspace.record.id);
  const taken = await push('ZED-320', 'laptop', 'Taken');
  assert.deepStrictEqual([taken.ignored, taken.machine, runs.get('ZED-320').dismissedAt], [false, 'laptop', null], 'a machine without a live token loses a dismissed ticket');
  assert.deepStrictEqual(
    [runs.get('ZED-320').activity, runs.get('ZED-320').activityDetail, runs.get('ZED-320').activityEndedAt, runs.get('ZED-320').lastEventAt, runs.get('ZED-320').transcriptAt],
    ['IDLE', null, null, null, null],
    'the old machine history is not shown as the new owner',
  );
  assert.strictEqual(events.filter((event) => event.kind === 'MACHINE').length, 1, 'the take is logged');
});

test('the cap of live tickets applies to creating and reviving', async () => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  await service.createToken('laptop');
  await service.createToken('workspace', 'workspace');
  const now = new Date('2026-10-05T00:00:00.000Z');
  const push = (key: string, machine: string) => service.ingestLedger({ ...ledger, key, waiting: '', updatedAt: now.toISOString() }, now, machine);

  await push('ZED-321', 'laptop');
  await push('ZED-322', 'laptop');
  for (let n = 1; n <= 300; n += 1) runs.set(`CAP-${n}`, { key: `CAP-${n}`, machine: 'workspace', dismissedAt: null });

  await assert.rejects(push('ZED-323', 'workspace'), /maximum of 300 live tickets.*Dismiss finished tickets on the Agents page/);
  assert.strictEqual((await push('CAP-1', 'workspace')).ignored, false, 'a ticket the machine already has keeps updating');
  assert.strictEqual((await push('ZED-323', 'laptop')).ignored, false, 'the cap is per machine');

  await service.dismiss('ZED-322', 'laptop');
  runs.set('ZED-322', { ...runs.get('ZED-322'), machine: 'workspace' });
  await assert.rejects(push('ZED-322', 'workspace'), /maximum of 300 live tickets/, 'reviving a dismissed ticket counts');
});

test('the runs route lists every machine for the workspace cron, and dismiss acts only on the token machine', async (t) => {
  const { storage, runs } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const laptop = await service.createToken('laptop');
  const workspace = await service.createToken('workspace', 'workspace');
  const post = await serveIngest(t, service);
  const now = new Date();
  await service.ingestLedger({ ...ledger, key: 'ZED-401', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');
  await service.ingestLedger({ ...ledger, key: 'ZED-402', waiting: '', updatedAt: now.toISOString() }, now, 'workspace');

  for (const token of [laptop.token, workspace.token]) {
    assert.deepStrictEqual((await post('/runs', {}, token)).body.result.map((run: { key: string; machine: string }) => [run.key, run.machine]), [['ZED-401', 'laptop'], ['ZED-402', 'workspace']]);
  }
  const refused = await post('/dismiss', { key: 'ZED-401' }, workspace.token);
  assert.deepStrictEqual([refused.status, refused.body.error], [400, 'This run belongs to laptop. Hide it on that DOCK.']);
  assert.strictEqual(runs.get('ZED-401').dismissedAt, null);
  assert.strictEqual((await post('/dismiss', { key: 'ZED-402' }, workspace.token)).body.result, true);
  assert.ok(runs.get('ZED-402').dismissedAt, 'the owner dismisses its own run');
});

test('a Jira status moves the run on, never back, and a ticket moved back to To Do removes it', async () => {
  const { storage, runs, events } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const now = new Date();
  const push = (key: string, stage: string, extra: Record<string, unknown> = {}) => service.ingestLedger({ ...ledger, key, stage, waiting: '', updatedAt: now.toISOString(), ...extra }, now, 'workspace');
  await push('ZED-460', 'code');
  await push('ZED-461', 'code');
  await push('ZED-462', 'code', { kind: 'review' });
  await service.ingestLedger({ ...ledger, key: 'ZED-463', stage: 'code', waiting: '', updatedAt: now.toISOString() }, now, 'laptop');

  // The cron starts a ticket while it is still To Do: the first status is only recorded.
  assert.strictEqual(await service.syncJira('workspace', [{ key: 'ZED-460', status: 'To Do' }, { key: 'ZED-461', status: 'In Progress' }, { key: 'ZED-462', status: 'To Do' }, { key: 'ZED-463', status: 'PR Review' }], now), 2);
  assert.ok(runs.get('ZED-460'), 'a run first seen in To Do stays');
  assert.strictEqual(runs.get('ZED-462').jiraStatus, undefined, 'a review run is not followed');
  assert.strictEqual(runs.get('ZED-463').jiraStatus, undefined, 'a run of another machine is not touched');
  assert.strictEqual(await service.syncJira('workspace', [{ key: 'ZED-461', status: 'In Progress' }], now), 0, 'an unchanged status does nothing');

  await service.syncJira('workspace', [{ key: 'ZED-460', status: 'In Progress' }, { key: 'ZED-461', status: 'PR Review' }], now);
  assert.strictEqual(runs.get('ZED-461').stage, 'pr');
  assert.strictEqual((await push('ZED-461', 'code')).stage, 'pr', 'a ledger push never takes the run back behind Jira');
  await service.syncJira('workspace', [{ key: 'ZED-461', status: 'Done / MERGED' }], now);
  assert.strictEqual(runs.get('ZED-461').stage, 'done');
  assert.deepStrictEqual(events.filter((event) => event.ticketKey === 'ZED-461' && event.kind === 'JIRA').map((event) => event.detail), ['In Progress', 'PR Review', 'Done / MERGED']);

  await service.syncJira('workspace', [{ key: 'ZED-460', status: 'To Do' }], now);
  assert.strictEqual(runs.get('ZED-460'), undefined, 'moved back to To Do: the run is gone');
  assert.deepStrictEqual((await service.ledgerList('workspace')).resets.map((reset) => reset.key), ['ZED-460']);

  await assert.rejects(push('ZED-460', 'code', { createdAt: new Date(now.getTime() - 60_000).toISOString() }), /went back to To Do/, 'a leftover ledger does not bring it back');
  await assert.rejects(push('ZED-460', 'code'), /went back to To Do/, 'nor one without a creation time');
  const fresh = await push('ZED-460', 'gate', { createdAt: new Date(now.getTime() + 1000).toISOString() });
  assert.strictEqual(fresh.ignored, false, 'a ledger made after the reset starts the ticket again');
});

test('a review ledger brings its findings with severities, the lgtm parts and the verdict', async () => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const now = new Date();
  const run = await service.ingestLedger({
    ...ledger, key: 'ZED-450', kind: 'review', waiting: '', updatedAt: now.toISOString(),
    findings: [{ at: now.toISOString(), text: 'written before severities' }, { at: now.toISOString(), severity: 'blocker', text: 'drops the retry' }, { severity: 'major', text: 'unknown severity' }, { severity: 'nit', text: '' }],
    lgtm: [{ at: now.toISOString(), text: 'the migration' }],
    verdict: { at: now.toISOString(), value: 'request-change' },
  }, now, 'laptop');
  assert.deepStrictEqual(run.findings.map((item: { severity: string; text: string }) => [item.severity, item.text]), [['non-blocking', 'written before severities'], ['blocker', 'drops the retry'], ['non-blocking', 'unknown severity']]);
  assert.deepStrictEqual(run.lgtm.map((item: { text: string }) => item.text), ['the migration']);
  assert.deepStrictEqual([run.verdict, run.blockers], ['request-change', 1]);

  const plain = await service.ingestLedger({ ...ledger, key: 'ZED-451', waiting: '', updatedAt: now.toISOString(), verdict: { value: 'maybe' } }, now, 'laptop');
  assert.deepStrictEqual([plain.findings, plain.lgtm, plain.verdict, plain.blockers], [[], [], null, 0]);
});

test('the owner LGTM moves a review ledger to done and keeps the rest of it', async () => {
  const { storage, events } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const now = new Date();
  await service.ingestLedger({
    ...ledger, key: 'ZED-452', kind: 'review', stage: 'verify', waiting: 'LGTM from the owner', updatedAt: now.toISOString(),
    verdict: { at: now.toISOString(), value: 'approve' },
  }, now, 'workspace');
  const later = new Date(now.getTime() + 60_000);
  const done = await service.finishReview('zed-452', later);
  assert.ok(done);
  assert.deepStrictEqual([done.stage, done.waiting, done.kind, done.verdict, done.machine], ['done', null, 'review', 'approve', 'workspace']);
  assert.deepStrictEqual(events.filter((event) => event.ticketKey === 'ZED-452').map((event) => [event.kind, event.detail]).slice(-2), [['STAGE', 'done'], ['RESUMED', null]]);
  assert.strictEqual(await service.finishReview('ZED-999', later), null, 'no run, nothing to finish');
});

test('the doctor route keeps the report under the machine of its token; a ledger with a pull request asks for the automatic broadcast', async (t) => {
  const { storage } = memoryStorage();
  const service = new OrchestratorService(storage, os.tmpdir());
  const { token } = await service.createToken('laptop', 'workspace');
  const cache = new Map<string, unknown>();
  const doctor = new DoctorReports({
    getCache: async (namespace: string, key: string) => cache.get(`${namespace}:${key}`) ?? null,
    upsertCache: async (namespace: string, key: string, value: unknown) => { cache.set(`${namespace}:${key}`, value); },
  });
  const asked: string[] = [];
  const broadcast = { afterDemoVideo: async () => 'waiting' as const, afterLedger: async (run: { key: string; prBe?: string | null }) => { asked.push(`${run.key} ${run.prBe}`); return 'waiting' as const; } };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(service, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, doctor, broadcast));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (route: string, body: unknown, bearer?: string) => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body),
  });

  const report = { machine: 'coder-ws', os: 'linux', at: '2026-10-20T02:00:00.000Z', checks: [{ name: 'ffmpeg', ok: true, detail: '6.1' }] };
  assert.strictEqual((await post('/doctor', report)).status, 401, 'same token auth as every ingest route');
  const accepted = await post('/doctor', report, token);
  assert.deepStrictEqual(await accepted.json(), { ok: true, result: { machine: 'workspace', checks: 1, failing: 0 } });
  assert.strictEqual((await post('/doctor', { checks: 'none' }, token)).status, 400);
  assert.deepStrictEqual((await doctor.list()).map((item) => [item.machine, item.host]), [['workspace', 'coder-ws']]);

  assert.strictEqual((await post('', ledger, token)).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(asked, ['QRD-1387 https://github.com/example/be/pull/1']);
});
