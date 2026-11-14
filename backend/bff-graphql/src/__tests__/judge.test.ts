import assert from 'node:assert';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { OrchestratorService } from '../integrations/orchestrator';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';
import {
  DEFAULT_JUDGE_SETTINGS, JudgeSettingsError, activeWindow, dayStatus, effectiveCall, gradeOf, inJudgeScope, judgeSessionPrompt, judgeSprintPrompt, judgeTitle,
  parseJudgeResult, parseJudgeSettings, storedJudgeSettings, wibDay, type JudgeSettings,
} from '../integrations/judge';
import { buildSessionInput, buildSprintInput, type SessionInput } from '../integrations/judge-input';
import { JudgeQueue, sprintSpan, withActiveSprint, type JudgeDeps, type JudgeSprintRef, type JudgeStore, type TurnState } from '../integrations/judge-queue';

const at = (iso: string) => new Date(iso);
/** 21:00 WIB is 14:00 UTC. */
const wib = (day: string, clock: string) => new Date(Date.parse(`${day}T${clock}:00+07:00`));

test('scope: Task, Review and QA sessions and chats that name a ticket; never Plan, Planning, Retro or Judge', () => {
  assert.strictEqual(inJudgeScope({ title: 'Task-QRD-1292', firstText: null }), true);
  assert.strictEqual(inJudgeScope({ title: 'Review-QRD-1521 (2)', firstText: null }), true);
  assert.strictEqual(inJudgeScope({ title: 'QA-QRD-1516', firstText: null }), true);
  assert.strictEqual(inJudgeScope({ title: 'cek dulu', firstText: 'tolong lihat QRD-1300 kenapa merah' }), true, 'a manual chat whose first message names a ticket');
  assert.strictEqual(inJudgeScope({ title: 'cek dulu', firstText: 'explain this repo' }), false, 'a chat without a ticket');
  assert.strictEqual(inJudgeScope({ title: 'card', firstText: 'Pakai skill sous: CARD-dock-audit' }), false);
  for (const title of ['Plan-QRD Sprint 26', 'Planning QRD Sprint 26', 'Retro-QRD Sprint 26', 'Retro-apply-QRD Sprint 26', 'Judge-a3c23286']) {
    assert.strictEqual(inJudgeScope({ title, firstText: 'QRD-1516' }), false, title);
  }
});

test('windows: 21:00 and 08:00 open, 23:30 and 09:00 closed', () => {
  const windows = DEFAULT_JUDGE_SETTINGS.windows;
  assert.ok(activeWindow(wib('2026-11-13', '21:00'), windows));
  assert.ok(activeWindow(wib('2026-11-13', '23:29'), windows));
  assert.strictEqual(activeWindow(wib('2026-11-13', '23:30'), windows), null);
  assert.strictEqual(activeWindow(wib('2026-11-13', '20:59'), windows), null);
  assert.ok(activeWindow(wib('2026-11-14', '08:00'), windows));
  assert.strictEqual(activeWindow(wib('2026-11-14', '09:00'), windows), null);
  assert.strictEqual(activeWindow(wib('2026-11-14', '00:30'), windows), null, 'Coder sleeps 00:00-08:00');
});

const finding = (cause: string, extra: { threadUrl?: string | null; judgeCall?: string; ownerCall?: string | null } = {}) => ({ cause, threadUrl: extra.threadUrl ?? null, judgeCall: extra.judgeCall ?? 'mistake', ownerCall: extra.ownerCall ?? null });

test('grade A-D from the fixed rules; Environment and Not a mistake are not graded', () => {
  assert.strictEqual(gradeOf([], 0), 'A');
  assert.strictEqual(gradeOf([finding('environment')], 90), 'A', 'environment is not graded');
  assert.strictEqual(gradeOf([finding('skipped-step')], 0), 'B', 'minor, the owner not involved');
  assert.strictEqual(gradeOf([finding('skipped-step')], 30), 'C', 'the owner waited');
  assert.strictEqual(gradeOf([finding('stopped-with-way-out')], 0), 'C');
  assert.strictEqual(gradeOf([finding('self-inflicted-rework')], 0), 'C', 'work was redone');
  assert.strictEqual(gradeOf([finding('asked-instead-of-looking')], 0), 'C');
  assert.strictEqual(gradeOf([finding('wrong-code')], 0), 'D');
  assert.strictEqual(gradeOf([finding('misread-ac-scope', { threadUrl: 'https://discord.com/channels/1/2/3' })], 0), 'D', 'reached a reviewer');
  assert.strictEqual(gradeOf([finding('misread-ac-scope')], 0), 'C');
  // a3c23286 (QA-QRD-1516): BLOCKER I-8 to the owner, two runs lost to the PIN.
  assert.strictEqual(gradeOf([finding('stopped-with-way-out'), finding('self-inflicted-rework')], 90), 'C');
  assert.strictEqual(gradeOf([finding('wrong-code', { ownerCall: 'not' }), finding('skipped-step')], 0), 'B', 'Not a mistake recounts the grade');
  assert.strictEqual(gradeOf([finding('skipped-step', { judgeCall: 'not' })], 0), 'A', "Judge's own not");
  assert.strictEqual(gradeOf([finding('skipped-step', { judgeCall: 'not', ownerCall: 'mistake' })], 0), 'B', 'the owner overrides Judge');
});

test('an unconfirmed day keeps Judge\'s call; it stands after the noon cutoff of the next day', () => {
  assert.strictEqual(effectiveCall({ judgeCall: 'mistake', ownerCall: null }), 'mistake');
  assert.strictEqual(effectiveCall({ judgeCall: 'not', ownerCall: null }), 'not');
  assert.strictEqual(effectiveCall({ judgeCall: 'mistake', ownerCall: 'not' }), 'not');
  const base = { findings: 5, confirmedAt: null, day: '2026-11-13', noonCutoff: '12:00' };
  assert.strictEqual(dayStatus({ ...base, now: wib('2026-11-14', '11:59') }), 'waiting');
  assert.strictEqual(dayStatus({ ...base, now: wib('2026-11-14', '12:00') }), 'stood');
  assert.strictEqual(dayStatus({ ...base, confirmedAt: at('2026-11-14T01:20:00Z'), now: wib('2026-11-15', '08:00') }), 'confirmed');
  assert.strictEqual(dayStatus({ ...base, findings: 0, now: wib('2026-11-14', '08:00') }), 'nothing');
  assert.strictEqual(dayStatus({ ...base, confirmedAt: at('2026-11-14T01:20:00Z'), latestFindingAt: at('2026-11-14T01:00:00Z'), now: wib('2026-11-15', '08:00') }), 'confirmed');
  assert.strictEqual(dayStatus({ ...base, confirmedAt: at('2026-11-14T01:20:00Z'), latestFindingAt: at('2026-11-14T02:00:00Z'), now: wib('2026-11-15', '08:00') }), 'waiting');
});

test('the result the kit posts is checked; untilMessageId "-" is none and the grade is not read from it', () => {
  const result = parseJudgeResult({ sessionId: 'a3c23286-1', untilMessageId: '#40', ownerWaitMinutes: 90.4, grade: 'A', findings: [
    { messageId: 12, cause: 'stopped-with-way-out', text: 'BLOCKER I-8 to the owner', quote: 'Isu I-8 (BLOCKER) naik ke kamu.', shouldHave: 'Hand the rebase to the lead.', call: 'mistake' },
    { messageId: '7', threadUrl: 'javascript:alert(1)', cause: 'SELF-INFLICTED-REWORK', text: 'PIN not entered', call: 'not' },
  ] });
  assert.strictEqual(result.untilMessageId, 40);
  assert.strictEqual(result.ownerWaitMinutes, 90);
  assert.deepStrictEqual(result.findings.map((item) => [item.messageId, item.threadUrl, item.cause, item.call]), [[12, null, 'stopped-with-way-out', 'mistake'], [7, null, 'self-inflicted-rework', 'not']]);
  assert.ok(!('grade' in result));
  assert.strictEqual(parseJudgeResult({ sessionId: 's1', untilMessageId: '-', findings: [] }).untilMessageId, null);
  assert.throws(() => parseJudgeResult({ sessionId: 's1', findings: [{ cause: 'laziness', text: 'x' }] }), /cause must be one of/);
  assert.throws(() => parseJudgeResult({ sessionId: 's1', findings: [{ cause: 'wrong-code', text: '' }] }), /text is required/);
  assert.throws(() => parseJudgeResult({ sessionId: 'bad id!', findings: [] }), /sessionId/);
});

test('Settings › Judge is off by default; a bad value is refused and an unreadable one falls back to off', () => {
  assert.strictEqual(DEFAULT_JUDGE_SETTINGS.on, false);
  assert.deepStrictEqual(storedJudgeSettings(null), DEFAULT_JUDGE_SETTINGS);
  assert.deepStrictEqual(storedJudgeSettings('{not json'), DEFAULT_JUDGE_SETTINGS);
  assert.deepStrictEqual(DEFAULT_JUDGE_SETTINGS.windows, [{ from: '21:00', to: '23:30' }, { from: '08:00', to: '09:00' }]);
  assert.strictEqual(DEFAULT_JUDGE_SETTINGS.idleMinutes, 30);
  assert.strictEqual(DEFAULT_JUDGE_SETTINGS.noonCutoff, '12:00');
  assert.deepStrictEqual(parseJudgeSettings('{"on":true,"account":"claude4"}'), { ...DEFAULT_JUDGE_SETTINGS, on: true, account: 'claude4' });
  assert.throws(() => parseJudgeSettings('{"windows":[{"from":"23:30","to":"21:00"}]}'), JudgeSettingsError);
  assert.throws(() => parseJudgeSettings('{"idleMinutes":2}'), JudgeSettingsError);
  assert.throws(() => parseJudgeSettings('{"account":"../x"}'), JudgeSettingsError);
});

test('the prompts follow the kit contract', () => {
  assert.strictEqual(judgeSessionPrompt('a3c23286-x', 'E:/data/judge-input/a.md', 41), 'Pakai skill judge: session a3c23286-x input E:/data/judge-input/a.md until 41');
  assert.strictEqual(judgeSessionPrompt('s', '/p.md', null), 'Pakai skill judge: session s input /p.md until -');
  assert.strictEqual(judgeSprintPrompt('QRD Sprint 26', '/p.md'), 'Pakai skill judge: sprint "QRD Sprint 26" input /p.md');
  assert.strictEqual(judgeTitle('a3c23286-4f1e-9a'), 'Judge-a3c23286');
});

const inputBase = (overrides: Partial<SessionInput> = {}): SessionInput => ({
  session: { id: 's1', title: 'QA-QRD-1516', ticketKey: 'QRD-1516', origin: 'cron', startedAt: at('2026-11-12T20:35:00Z') },
  since: null,
  messages: [
    { id: 10, role: 'user', text: 'Pakai skill sous: QA QRD-1516', at: at('2026-11-12T20:35:00Z') },
    { id: 11, role: 'assistant', text: 'Merge belum jalan. Isu I-8 (BLOCKER) naik ke kamu.', at: at('2026-11-13T00:22:00Z') },
  ],
  tools: [{ name: 'Bash', label: 'git fetch origin', summary: `sous-guard refused git fetch ${'x'.repeat(400)}`, detail: null, status: 'denied', agent: 'main', startedAt: at('2026-11-13T00:20:00Z') }],
  ledger: { stage: 'qa', rounds: 2, failures: ['ESCALATED: PIN dialog (attempt 2)'], findings: [], ownerIssues: ['I-8 BLOCKER: merge conflict (open)'] },
  checkpoints: [{ at: '2026-11-13T00:10:00.000Z', step: 'verify', agent: 'qa', text: 'Run 3 passed after the PIN' }],
  execLog: ['00:05 qa-runner · run 1 · done · 40 tools'],
  coverage: { covered: 5, total: 6, missing: ['AC6 consent page'] },
  discord: [],
  jira: [{ at: '2026-11-13T01:00:00.000Z', from: 'UAT CHECK', to: 'UAT BUG' }],
  examples: [{ cause: 'stopped-with-way-out', text: 'Stopped at a deleteMany refusal', note: 'deleting data is banned' }],
  ...overrides,
});

test('the condensed transcript: owner and assistant whole, tool lines short with the refusal, the ticket context and the examples', () => {
  const { text, untilMessageId } = buildSessionInput(inputBase());
  assert.strictEqual(untilMessageId, 11);
  assert.match(text, /\[#10 03:35 owner\]\nPakai skill sous: QA QRD-1516/);
  assert.match(text, /\[#11 07:22 assistant\]\nMerge belum jalan\. Isu I-8 \(BLOCKER\) naik ke kamu\./);
  const tool = text.split('\n').find((line) => line.includes('git fetch origin'))!;
  assert.match(tool, /^· 07:20 Bash · git fetch origin → refused: sous-guard refused git fetch x+$/);
  assert.ok(tool.length < 360, 'the refusal keeps its first 300 characters');
  for (const part of ['## Ledger', 'I-8 BLOCKER', '## Checkpoints', 'Run 3 passed after the PIN', '## Log eksekusi', '## Tiket → kode', 'Coverage 5/6', '## Jira status changes since the session start', 'UAT CHECK → UAT BUG', '## Examples (not a mistake)', 'owner: deleting data is banned']) {
    assert.ok(text.includes(part), part);
  }
});

test('incremental: only the messages after judgedUntilMessageId go in; nothing new gives no until', () => {
  const later = inputBase({ since: 10 });
  const { text, untilMessageId } = buildSessionInput(later);
  assert.ok(!text.includes('[#10 '), 'the judged message stays out');
  assert.ok(text.includes('[#11 '));
  assert.match(text, /Judged before: up to message #10/);
  assert.strictEqual(untilMessageId, 11);
  assert.strictEqual(buildSessionInput(inputBase({ since: 11 })).untilMessageId, null);
});

test('over the cap the oldest tool lines go first; the owner and assistant text is never dropped', () => {
  const tools = Array.from({ length: 50 }, (_, index) => ({ name: 'Read', label: `file-${index}.ts ${'y'.repeat(150)}`, summary: '', detail: null, status: 'ok', agent: 'main', startedAt: new Date(Date.parse('2026-11-12T21:00:00Z') + index * 60000) }));
  const { text } = buildSessionInput(inputBase({ tools }), 4000);
  assert.ok(text.length <= 4000 || !text.includes('file-0.ts'));
  assert.ok(!text.includes('file-0.ts '), 'the oldest tool line went');
  assert.ok(text.includes('file-49.ts'), 'the newest tool line stayed');
  assert.ok(text.includes('Pakai skill sous: QA QRD-1516') && text.includes('Isu I-8 (BLOCKER)'));
  assert.match(text, /older tool lines left out/);
});

test('the sprint input carries the findings, the numbers, last sprint\'s TRY lines and how many were not judged', () => {
  const text = buildSprintInput({
    sprint: 'QRD Sprint 26', days: ['2026-10-28', '2026-11-11'], sessionsJudged: 91, notJudged: 2,
    findings: [{ day: '2026-11-13', sessionId: 'a3c23286-1', sessionTitle: 'QA-QRD-1516', grade: 'C', cause: 'stopped-with-way-out', text: 'BLOCKER to the owner', quote: 'Isu I-8', shouldHave: 'hand to the lead', confirmed: false }],
    numbers: { tickets: 19, medianHours: 6.5 }, lastTry: ['sous-verifier runs prettier'], previousSprint: 'QRD Sprint 25', examples: [],
  });
  assert.match(text, /2 sessions not judged yet/);
  assert.match(text, /QA-QRD-1516 \(a3c23286, grade C\) · Stopped with a way out · Judge's call, not confirmed/);
  assert.match(text, /source "judge"/);
  assert.match(text, /Accepted TRY lines of QRD Sprint 25/);
});

// ---- The queue with an in-memory store -----------------------------------------------------------------------------

interface Chat { id: string; title: string; ticketKey: string | null; status: string; origin: string; startedAt: Date; lastMessageAt: Date; firstText: string | null; lastMessageId: number | null }

const SPRINT_26: JudgeSprintRef = { id: 26, name: 'QRD Sprint 26', state: 'active', startDate: '2026-10-28T01:00:00.000Z', endDate: '2026-11-20T10:00:00.000Z' };

function harness(options: { settings?: Partial<JudgeSettings>; now?: Date; sprints?: JudgeSprintRef[] } = {}) {
  let now = options.now ?? wib('2026-11-13', '21:05');
  const chats = new Map<string, Chat>();
  const rows = new Map<string, any>();
  const findings: any[] = [];
  const days = new Map<string, any>();
  const cache = new Map<string, unknown>();
  const gate = { busy: 0, reviews: 0, slots: { busy: 0, waiting: 0 }, online: true };
  const statuses = new Map<string, string>();
  const opened: Array<{ title: string; prompt: string; account: string; model: string }> = [];
  const inputs: Array<{ sessionId: string; judgedUntilMessageId: number | null }> = [];
  const turn = new Map<string, TurnState>();
  let settings: JudgeSettings = { ...DEFAULT_JUDGE_SETTINGS, on: true, ...options.settings };
  let ids = 0;
  const store: JudgeStore = {
    getJudgeCandidates: async (_machine: string, since: Date) => [...chats.values()].filter((chat) => chat.lastMessageAt >= since),
    getJudgeSession: async (id: string) => rows.get(id) ?? null,
    getJudgeSessions: async (where: { sessionIds?: string[]; statuses?: string[]; days?: string[] } = {}) => [...rows.values()].filter((row) => (!where.sessionIds || where.sessionIds.includes(row.sessionId)) && (!where.statuses || where.statuses.includes(row.status)) && (!where.days || where.days.includes(row.day)))
      .sort((a, b) => a.updatedAt - b.updatedAt),
    upsertJudgeSession: async (sessionId: string, data: Record<string, unknown>) => {
      const row = rows.get(sessionId) ?? { sessionId, judgedUntilMessageId: null, runUntilMessageId: null, judgeChatId: null, grade: null, ownerWaitMinutes: 0, attempts: 0, startedAt: null, judgedAt: null, error: null, createdAt: now };
      rows.set(sessionId, { ...row, ...data, updatedAt: (ids += 1) });
      return rows.get(sessionId);
    },
    updateJudgeSession: async (sessionId: string, data: Record<string, unknown>) => {
      rows.set(sessionId, { ...rows.get(sessionId), ...data, updatedAt: (ids += 1) });
      return rows.get(sessionId);
    },
    saveJudgeRun: async (sessionId: string, list: Array<Record<string, unknown>>, data: Record<string, unknown>) => {
      for (const item of list) findings.push({ id: `f${(ids += 1)}`, sessionId, ownerCall: null, note: null, createdAt: now, ...item });
      rows.set(sessionId, { ...rows.get(sessionId), ...data, status: 'judged', runUntilMessageId: null, judgeChatId: null, attempts: 0, error: null });
    },
    getJudgeFindings: async (where: { sessionIds?: string[]; days?: string[] }) => findings.filter((item) => (!where.sessionIds || where.sessionIds.includes(item.sessionId)) && (!where.days || where.days.includes(item.day))),
    getJudgeFinding: async (id: string) => findings.find((item) => item.id === id) ?? null,
    updateJudgeFinding: async (id: string, data: Record<string, unknown>) => Object.assign(findings.find((item) => item.id === id), data),
    deleteJudgeFindings: async (sessionId: string) => {
      for (let index = findings.length - 1; index >= 0; index -= 1) if (findings[index].sessionId === sessionId && findings[index].ownerCall !== 'not') findings.splice(index, 1);
      return { count: 0 };
    },
    deleteJudgeSessions: async (list: string[]) => {
      for (const id of list) if (rows.get(id)?.status === 'pending') rows.delete(id);
      return { count: list.length };
    },
    getJudgeExamples: async (take: number) => findings.filter((item) => item.ownerCall === 'not').slice(0, take),
    getJudgeDays: async (list: string[]) => list.filter((day) => days.has(day)).map((day) => days.get(day)),
    upsertJudgeDay: async (day: string, data: Record<string, unknown>) => { days.set(day, { day, ...data }); return days.get(day); },
    countBusyChatSessions: async () => gate.busy,
    countRunningAutoReviews: async () => gate.reviews,
    countCronSlots: async () => gate.slots,
    getChatSessionsByIds: async (list: string[]) => list.map((id) => chats.get(id)).filter(Boolean) as any,
    getCache: async (_namespace: string, key: string) => cache.get(key) ?? null,
    upsertCache: async (_namespace: string, key: string, value: unknown) => { cache.set(key, value); return {} as any; },
  } as unknown as JudgeStore;
  const deps: JudgeDeps = {
    store,
    now: () => now,
    settings: async () => settings,
    machine: 'workspace',
    online: () => gate.online,
    ticketStatuses: async () => statuses,
    sessionInput: async (row) => {
      inputs.push({ sessionId: row.sessionId, judgedUntilMessageId: row.judgedUntilMessageId });
      const last = chats.get(row.sessionId)?.lastMessageId ?? null;
      return { text: `input ${row.sessionId}`, untilMessageId: last !== null && (row.judgedUntilMessageId === null || last > row.judgedUntilMessageId) ? last : null };
    },
    sprintInput: async (sprint, notJudged) => `sprint ${sprint.name} ${notJudged}`,
    writeInput: async (name) => `/data/judge-input/${name}.md`,
    cleanInputs: async () => 0,
    open: async (input) => {
      opened.push(input);
      const id = `judge-${opened.length}`;
      turn.set(id, 'running');
      return id;
    },
    turnState: async (chatId) => ({ state: turn.get(chatId) ?? 'gone', detail: null }),
    sprints: async () => options.sprints ?? [SPRINT_26],
  };
  const chat = (id: string, title: string, lastMessageAt: Date, extra: Partial<Chat> = {}) => chats.set(id, { id, title, ticketKey: null, status: 'idle', origin: 'cron', startedAt: lastMessageAt, lastMessageAt, firstText: null, lastMessageId: 10, ...extra });
  return {
    queue: new JudgeQueue(deps), chats, rows, findings, days, gate, statuses, opened, inputs, turn, chat,
    setNow: (next: Date) => { now = next; },
    setSettings: (next: Partial<JudgeSettings>) => { settings = { ...settings, ...next }; },
  };
}

test('Judge is off by default: a tick queues nothing and starts nothing', async () => {
  const h = harness({ settings: { on: false } });
  h.chat('s1', 'Task-QRD-1', wib('2026-11-13', '18:00'));
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'Judge is off' });
  assert.strictEqual(h.rows.size, 0);
  await assert.rejects(() => h.queue.judgeNow(), /Judge is off/);
});

test('a finished Task session goes pending after 30 idle minutes and is judged at the quiet window', async () => {
  const h = harness({ now: wib('2026-11-13', '20:00') });
  h.chat('s1', 'Task-QRD-1', wib('2026-11-13', '19:45'));
  h.chat('s2', 'Plan-QRD Sprint 26', wib('2026-11-13', '18:00'));
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'outside the Judge windows' });
  assert.strictEqual(h.rows.size, 0, '15 minutes idle is not quiet yet');
  h.setNow(wib('2026-11-13', '20:20'));
  await h.queue.tick();
  assert.deepStrictEqual([...h.rows.keys()], ['s1'], 'only the session in scope');
  assert.strictEqual(h.rows.get('s1').status, 'pending');
  assert.strictEqual(h.rows.get('s1').day, '2026-11-13');
  h.setNow(wib('2026-11-13', '21:00'));
  const started = await h.queue.tick();
  assert.strictEqual(started.started, 'judge-1');
  assert.deepStrictEqual(h.opened[0], { title: 'Judge-s1', prompt: 'Pakai skill judge: session s1 input /data/judge-input/s1-10.md until 10', account: '', model: 'sonnet' });
  assert.strictEqual(h.rows.get('s1').status, 'running');
});

test('a ticket that moves to PR Review queues its session at once', async () => {
  const h = harness();
  h.chat('s1', 'Task-QRD-7', wib('2026-11-13', '21:00'), { ticketKey: 'QRD-7' });
  h.statuses.set('QRD-7', 'PR Review');
  await h.queue.enqueue(DEFAULT_JUDGE_SETTINGS, wib('2026-11-13', '21:05'));
  assert.strictEqual(h.rows.get('s1')?.status, 'pending');
});

test('the quiet gate waits for a running turn, an auto review or a busy cron slot; Judge now skips only the window', async () => {
  const h = harness({ now: wib('2026-11-13', '22:00') });
  h.chat('s1', 'Review-QRD-1', wib('2026-11-13', '20:00'));
  h.gate.busy = 1;
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'a chat turn is running' });
  h.gate.busy = 0;
  h.gate.reviews = 1;
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'an auto review is running' }, 'on it at 22:00 starts the auto review; Judge waits');
  h.gate.reviews = 0;
  h.gate.slots = { busy: 0, waiting: 1 };
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'a cron ticket is running' });
  h.gate.slots = { busy: 0, waiting: 0 };
  h.setNow(wib('2026-11-14', '14:00'));
  assert.strictEqual((await h.queue.tick()).skipped, 'outside the Judge windows');
  assert.strictEqual((await h.queue.judgeNow()).started, 'judge-1', 'Judge now runs outside the window');
});

test('one session per tick: the next waits for the running one', async () => {
  const h = harness();
  h.chat('s1', 'Task-QRD-1', wib('2026-11-13', '19:00'));
  h.chat('s2', 'Task-QRD-2', wib('2026-11-13', '19:10'));
  assert.strictEqual((await h.queue.tick()).started, 'judge-1');
  assert.deepStrictEqual(await h.queue.tick(), { started: null, skipped: 'a Judge session is running' });
  assert.strictEqual(h.opened.length, 1);
});

test('a run cut off by the shutdown stays pending and is judged again from the start; three failures mark it failed', async () => {
  const h = harness();
  h.chat('s1', 'QA-QRD-1516', wib('2026-11-13', '19:00'));
  await h.queue.tick();
  h.turn.set('judge-1', 'cut');
  h.setNow(wib('2026-11-14', '08:00'));
  const again = await h.queue.tick();
  assert.strictEqual(again.started, 'judge-2', 'judged at 08:00');
  assert.strictEqual(h.rows.get('s1').attempts, 0, 'a cut-off is not a failure');
  assert.deepStrictEqual(h.inputs.map((input) => input.judgedUntilMessageId), [null, null], 'from the start again');
  for (const id of ['judge-2', 'judge-3']) {
    h.turn.set(id, 'done');
    await h.queue.tick();
  }
  assert.strictEqual(h.rows.get('s1').status, 'running');
  assert.strictEqual(h.rows.get('s1').attempts, 2);
  h.turn.set('judge-4', 'failed');
  await h.queue.tick();
  assert.strictEqual(h.rows.get('s1').status, 'failed');
  assert.match(h.rows.get('s1').error, /failed/);
});

test('the result is stored with a server-side grade; a re-judge sends only the messages after judgedUntilMessageId', async () => {
  const h = harness();
  h.chat('a3c23286', 'QA-QRD-1516', wib('2026-11-13', '08:51'), { lastMessageId: 40 });
  await h.queue.tick();
  const result = await h.queue.receive({ sessionId: 'a3c23286', untilMessageId: 40, ownerWaitMinutes: 90, grade: 'A', findings: [
    { messageId: 31, cause: 'stopped-with-way-out', text: 'Conflict went to the owner as BLOCKER I-8', shouldHave: 'Hand the rebase to the lead.', call: 'mistake' },
    { messageId: 12, cause: 'self-inflicted-rework', text: 'Two of three runs ESCALATED from its own setup', shouldHave: 'Enter PIN 767676 first.', call: 'mistake' },
  ] });
  assert.deepStrictEqual(result, { sessionId: 'a3c23286', grade: 'C' });
  assert.strictEqual(h.rows.get('a3c23286').status, 'judged');
  assert.strictEqual(h.rows.get('a3c23286').judgedUntilMessageId, 40);
  await assert.rejects(() => h.queue.receive({ sessionId: 'a3c23286', untilMessageId: 40, findings: [] }), /judged up to message 40/);

  const chat = h.chats.get('a3c23286')!;
  h.chats.set('a3c23286', { ...chat, lastMessageId: 55, lastMessageAt: wib('2026-11-13', '20:00') });
  await h.queue.tick();
  assert.deepStrictEqual(h.inputs.at(-1), { sessionId: 'a3c23286', judgedUntilMessageId: 40 });
  assert.match(h.opened.at(-1)!.prompt, /until 55$/);
  await h.queue.receive({ sessionId: 'a3c23286', untilMessageId: 55, ownerWaitMinutes: 0, findings: [{ cause: 'skipped-step', text: 'prettier not run', call: 'mistake' }] });
  assert.strictEqual(h.findings.length, 3, 'findings are added');
  assert.strictEqual(h.rows.get('a3c23286').ownerWaitMinutes, 90);
});

test('Not a mistake recounts the grade; the day sheet groups by session and Confirm marks the day', async () => {
  const h = harness();
  h.chat('s1', 'Task-QRD-1292', wib('2026-11-13', '10:00'), { lastMessageId: 5 });
  await h.queue.tick();
  await h.queue.receive({ sessionId: 's1', untilMessageId: 5, findings: [
    { threadUrl: 'https://discord.com/channels/1/1566728431/99', cause: 'misread-ac-scope', text: 'Two reviewer blockers', call: 'mistake' },
  ] });
  assert.strictEqual(h.rows.get('s1').grade, 'D');
  const before = await h.queue.day('2026-11-13');
  assert.strictEqual(before.status, 'waiting');
  assert.deepStrictEqual(before.sessionList.map((session) => [session.title, session.grade, session.findings.length]), [['Task-QRD-1292', 'D', 1]]);
  const flipped = await h.queue.setCall(before.sessionList[0].findings[0].id, 'not', 'Sibling ticket was not merged yet');
  assert.strictEqual(flipped.grade, 'A');
  assert.strictEqual(flipped.call, 'not');
  assert.strictEqual((await h.queue.session('s1'))?.grade, 'A', 'the sidebar reads the same grade');
  const confirmed = await h.queue.confirmDay('2026-11-13', null);
  assert.strictEqual(confirmed.status, 'confirmed');
  const list = await h.queue.days(null);
  assert.deepStrictEqual(list?.days.map((day) => [day.day, day.status]), [['2026-11-13', 'confirmed']]);
  await assert.rejects(() => h.queue.setCall('nope', 'not', null), /No such finding/);
});

test('the sprint summary waits for an empty queue until 23:30, then runs on Opus with what was judged', async () => {
  const h = harness({ now: wib('2026-11-13', '16:00') });
  h.chat('s1', 'Task-QRD-1', wib('2026-11-13', '15:00'));
  await h.queue.requestSprint('QRD Sprint 26');
  h.setNow(wib('2026-11-13', '16:05'));
  await h.queue.tick({ force: true });
  assert.strictEqual(h.opened[0].title, 'Judge-s1', 'the queue goes first');
  h.setNow(wib('2026-11-13', '23:31'));
  const summary = await h.queue.tick();
  assert.deepStrictEqual(summary, { started: null, skipped: 'a Judge session is running' });
  h.turn.set('judge-1', 'cut');
  const late = await h.queue.tick();
  assert.strictEqual(late.started, 'judge-2');
  assert.deepStrictEqual([h.opened[1].title, h.opened[1].model], ['Judge-QRD Sprint 26', 'opus']);
  assert.strictEqual(h.opened[1].prompt, 'Pakai skill judge: sprint "QRD Sprint 26" input /data/judge-input/sprint-QRD Sprint 26-2026-11-13.md');
  assert.strictEqual((await h.queue.sprintRun('QRD Sprint 26'))?.notJudged, 1, 'n sessions not judged yet');
});

// Sprint 26 closed on 12 Nov 03:47 UTC and Sprint 27 started on 12 Nov 09:16 UTC: 12 Nov is a day of both sprints.
const CLOSED_26: JudgeSprintRef = { id: 666, name: 'QRD Sprint 26', state: 'closed', startDate: '2026-10-28T02:06:29.812Z', endDate: '2026-11-11T14:00:00.000Z' };
const ACTIVE_27: JudgeSprintRef = { id: 699, name: 'QRD Sprint 27', state: 'active', startDate: '2026-11-12T09:16:00.000Z', endDate: '2026-11-20T09:16:00.000Z' };
const judgedRow = (sessionId: string, day: string, extra: Record<string, unknown> = {}) => ({
  sessionId, day, status: 'judged', judgedUntilMessageId: 10, runUntilMessageId: null, judgeChatId: null, grade: 'B', ownerWaitMinutes: 0, attempts: 0, startedAt: null, judgedAt: wib(day, '22:00'), error: null, updatedAt: 0, ...extra,
});
const findingRow = (id: string, sessionId: string, day: string) => ({ id, sessionId, day, messageId: 1, threadUrl: null, cause: 'skipped-step', text: 'prettier not run', quote: '', shouldHave: '', judgeCall: 'mistake', ownerCall: null, note: null, createdAt: wib(day, '22:00') });

test('a sprint Jira started after the last dashboard refresh joins the list as active; the older one closes', () => {
  const snapshot = [{ ...CLOSED_26, state: 'active' }];
  const live = { id: 699, name: 'QRD Sprint 27', state: 'active', startDate: '2026-11-12T09:16:00.000Z', endDate: '2026-11-20T09:16:00.000Z' };
  assert.deepStrictEqual(withActiveSprint(snapshot, live).map((sprint) => [sprint.name, sprint.state]), [['QRD Sprint 26', 'closed'], ['QRD Sprint 27', 'active']]);
  assert.deepStrictEqual(withActiveSprint(snapshot, null), snapshot, 'no live sprint keeps the snapshot');
  assert.deepStrictEqual(withActiveSprint(snapshot, { ...live, state: 'future', startDate: null }), snapshot, 'a future sprint is not active');
});

test('the active sprint lists its days from its start to today; on 12 Nov a session goes to the sprint whose start instant it follows', async () => {
  const h = harness({ now: wib('2026-11-14', '10:00'), sprints: [CLOSED_26, ACTIVE_27] });
  h.chat('before', 'Task-QRD-1', wib('2026-11-12', '09:00'));
  h.chat('after', 'Task-QRD-2', wib('2026-11-12', '17:00'));
  h.chat('next', 'Task-QRD-3', wib('2026-11-13', '10:00'));
  h.rows.set('before', judgedRow('before', '2026-11-12'));
  h.rows.set('after', judgedRow('after', '2026-11-12'));
  h.rows.set('next', judgedRow('next', '2026-11-13'));
  h.findings.push(findingRow('f1', 'before', '2026-11-12'), findingRow('f2', 'after', '2026-11-12'), findingRow('f3', 'after', '2026-11-12'), findingRow('f4', 'next', '2026-11-13'));

  const active = await h.queue.days(null);
  assert.deepStrictEqual([active?.sprint, active?.activeSprint, active?.previous], ['QRD Sprint 27', 'QRD Sprint 27', 'QRD Sprint 26']);
  assert.deepStrictEqual(active?.days.map((day) => [day.day, day.sessions, day.findings]), [['2026-11-13', 1, 1], ['2026-11-12', 1, 2]], '09:00 WIB on 12 Nov is before 27 started at 16:16 WIB');
  assert.deepStrictEqual((await h.queue.days('QRD Sprint 27'))?.days.map((day) => day.day), ['2026-11-13', '2026-11-12']);
  const closed = await h.queue.days('QRD Sprint 26');
  assert.deepStrictEqual(closed?.days.map((day) => [day.day, day.sessions, day.findings]), [['2026-11-12', 1, 1]], 'Sprint 26 runs until Sprint 27 starts');
  assert.strictEqual(closed?.activeSprint, 'QRD Sprint 27');

  assert.deepStrictEqual(await h.queue.waitingDays(), [{ day: '2026-11-13', findings: 1 }, { day: '2026-11-12', findings: 2 }], 'unconfirmed days of the active sprint, the one past its cutoff included');
  await h.queue.confirmDay('2026-11-13', null);
  assert.deepStrictEqual(await h.queue.waitingDays(), [{ day: '2026-11-12', findings: 2 }]);
  assert.strictEqual((await h.queue.day('2026-11-12')).sessionList.length, 2, 'the day sheet reads the whole date');
  h.setSettings({ on: false });
  assert.deepStrictEqual(await h.queue.waitingDays(), []);
});

test('Judge queues only sessions last active in the active sprint; older pending rows that never ran are removed on read; Judge again still judges an old session', async () => {
  const h = harness({ now: wib('2026-11-13', '21:05'), sprints: [CLOSED_26, ACTIVE_27] });
  h.chat('history', 'Task-QRD-1', wib('2026-10-30', '10:00'));
  h.chat('edge', 'Task-QRD-2', wib('2026-11-12', '15:00'));
  h.chat('current', 'Task-QRD-3', wib('2026-11-12', '17:00'));
  assert.deepStrictEqual(await h.queue.enqueue(DEFAULT_JUDGE_SETTINGS, wib('2026-11-13', '21:05')), ['current'], '15:00 WIB on 12 Nov is before Sprint 27 started');

  const pending = { status: 'pending', judgedUntilMessageId: null, grade: null, judgedAt: null };
  h.rows.set('history', judgedRow('history', '2026-10-30', pending));
  h.rows.set('edge', judgedRow('edge', '2026-11-12', pending));
  h.rows.set('retried', judgedRow('retried', '2026-10-30', { ...pending, attempts: 1, updatedAt: 1000 }));
  h.rows.set('judged', judgedRow('judged', '2026-10-30'));
  await h.queue.days('QRD Sprint 26');
  assert.deepStrictEqual([...h.rows.keys()].sort(), ['current', 'judged', 'retried'], 'pending rows that never ran outside the sprint go; judged and tried rows stay');

  const asked = await h.queue.judgeAgain('history');
  assert.strictEqual(asked.started, 'judge-1');
  assert.strictEqual(h.opened[0].title, 'Judge-current', 'the queue keeps its order');
  assert.strictEqual(h.rows.get('history').status, 'pending');
  await h.queue.days(null);
  await h.queue.tick();
  assert.strictEqual(h.rows.get('history')?.status, 'pending', 'a Judge again request survives the tidy');
  await h.queue.receive({ sessionId: 'current', untilMessageId: 10, findings: [] });
  h.turn.set('judge-1', 'done');
  assert.strictEqual((await h.queue.judgeNow()).started, 'judge-2');
  assert.strictEqual(h.opened[1].title, 'Judge-history');
});

test('no active sprint queues nothing', async () => {
  const h = harness({ sprints: [CLOSED_26] });
  h.chat('s1', 'Task-QRD-1', wib('2026-11-13', '19:00'));
  assert.deepStrictEqual(await h.queue.enqueue(DEFAULT_JUDGE_SETTINGS, wib('2026-11-13', '21:05')), []);
  assert.deepStrictEqual(sprintSpan(CLOSED_26, null, wib('2026-11-13', '21:05')).days.at(-1), '2026-11-11', 'a closed sprint with none after it ends on its end date');
});

test('the WIB day of a message late in the evening UTC is the next day', () => {
  assert.strictEqual(wibDay(at('2026-11-12T20:35:00Z')), '2026-11-13');
});

test('POST /ingest/orchestrator/judge takes the ingest token and answers the grade', async (t) => {
  class TokenService extends OrchestratorService {
    override async authenticateMachine(token: string) { return token === 'dock_ing_good' ? 'workspace' : null; }
  }
  const received: unknown[] = [];
  const judge = { receive: async (body: unknown) => { received.push(body); if ((body as { sessionId?: string }).sessionId === 'missing') throw new (await import('../integrations/orchestrator')).OrchestratorInputError('This session is not in the Judge queue'); return { sessionId: 's1', grade: 'C' }; } };
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(
    new TokenService(), new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, null, undefined, null, undefined, undefined, undefined, undefined, undefined, judge,
  ));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (body: unknown, bearer = 'dock_ing_good') => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/judge`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const ok = await post({ sessionId: 's1', untilMessageId: 4, findings: [], ownerWaitMinutes: 0 });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), { ok: true, sessionId: 's1', grade: 'C', result: { sessionId: 's1', grade: 'C' } });
  assert.strictEqual((await post({ sessionId: 's1' }, 'dock_ing_bad')).status, 401);
  assert.strictEqual((await post({ sessionId: 'missing' })).status, 400);
});
