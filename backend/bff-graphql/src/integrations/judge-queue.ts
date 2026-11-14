// The Judge queue: a session in scope is queued once it goes quiet, and judged one at a time while DOCK is quiet inside
// the Judge windows. The queue lives in the DB, so a run cut off by a shutdown stays pending and is judged again.
import type { StorageService } from '../storage/service';
import { OrchestratorInputError } from './orchestrator';
import {
  CAUSE_LABELS, EXAMPLES_TAKEN, JUDGE_CAUSES, JUDGE_TITLE_PREFIX, MAX_JUDGE_ATTEMPTS, activeWindow, dayCutoff, dayStatus, effectiveCall, gradeOf, gradedFindings,
  inJudgeScope, judgeSessionPrompt, judgeSprintPrompt, judgeSprintTitle, judgeTitle, nextDay, parseJudgeResult, sprintDays, sprintGrade, wibAt, wibDay, worstGrade,
  type JudgeCall, type JudgeSettings,
} from './judge';
import { INPUT_KEEP_MS } from './judge-input';

export const JUDGE_CACHE = 'judge';
/** Sessions asked for with Judge again: the queue tidy leaves their pending row alone even outside the active sprint. */
const ASKED_KEY = 'asked';
const ASKED_KEEP = 200;
const CLEAN_EVERY_MS = 3600 * 1000;
const SPRINT_START_CLOCK = '16:00';
const SPRINT_DEADLINE_CLOCK = '23:30';
const MOVED_STATUS = /PR Review|UAT/i;

export type JudgeStore = Pick<StorageService,
  'getJudgeCandidates' | 'getJudgeSession' | 'getJudgeSessions' | 'upsertJudgeSession' | 'updateJudgeSession' | 'saveJudgeRun' | 'getJudgeFindings' | 'getJudgeFinding'
  | 'updateJudgeFinding' | 'deleteJudgeFindings' | 'deleteJudgeSessions' | 'getJudgeExamples' | 'getJudgeDays' | 'upsertJudgeDay' | 'countBusyChatSessions' | 'countRunningAutoReviews' | 'countCronSlots'
  | 'getChatSessionsByIds' | 'getCache' | 'upsertCache'>;

export interface JudgeSprintRef { id: number; name: string; state: string; startDate: string; endDate: string }

/**
 * The sprint list with the active sprint Jira reports: a sprint started after the last dashboard refresh is added, and an
 * older sprint the snapshot still calls active is closed. No live active sprint keeps the list as it is.
 */
export function withActiveSprint(list: JudgeSprintRef[], live: { id: number; name: string; state: string; startDate: string | null; endDate: string | null } | null): JudgeSprintRef[] {
  if (!live || live.state !== 'active' || !live.startDate) return list;
  const start = Date.parse(live.startDate);
  const endDate = live.endDate ?? new Date(start + 14 * 24 * 3600 * 1000).toISOString();
  return [
    ...list.filter((item) => item.id !== live.id && item.name !== live.name).map((item) => (item.state === 'active' && Date.parse(item.startDate) < start ? { ...item, state: 'closed' } : item)),
    { id: live.id, name: live.name, state: 'active', startDate: new Date(start).toISOString(), endDate },
  ];
}

export interface SprintSpan { from: Date; until: Date | null; days: string[] }

/**
 * A sprint runs from its start instant to the next sprint's start instant; the active sprint runs to today. Its days are
 * the WIB dates in that span, so the date a sprint closes and the next starts belongs to both.
 */
export function sprintSpan(sprint: JudgeSprintRef, next: JudgeSprintRef | null, now: Date): SprintSpan {
  const from = new Date(sprint.startDate);
  const until = next ? new Date(next.startDate) : null;
  const today = wibDay(now);
  const end = until ? wibDay(until) : sprint.state === 'active' ? today : wibDay(new Date(sprint.endDate));
  const last = end < today ? end : today;
  const days: string[] = [];
  for (let day = wibDay(from); day <= last && days.length < 60; day = nextDay(day)) days.push(day);
  return { from, until, days };
}

/** On a date two sprints share, a session belongs to the sprint whose span holds its last activity. */
export const inSpan = (span: SprintSpan, at: Date) => at >= span.from && (!span.until || at < span.until);
type Row = NonNullable<Awaited<ReturnType<JudgeStore['getJudgeSession']>>>;
type FindingRow = Awaited<ReturnType<JudgeStore['getJudgeFindings']>>[number];
export type TurnState = 'running' | 'done' | 'cut' | 'failed' | 'gone';

export interface JudgeDeps {
  store: JudgeStore;
  now(): Date;
  settings(): Promise<JudgeSettings>;
  machine: string;
  online(machine: string): boolean;
  /** The Jira status of each ticket's run, for the PR Review / UAT trigger. */
  ticketStatuses(): Promise<Map<string, string>>;
  /** The condensed transcript of the session after the last judged message, with the examples at its end. */
  sessionInput(row: { sessionId: string; judgedUntilMessageId: number | null }, examples: FindingRow[]): Promise<{ text: string; untilMessageId: number | null }>;
  sprintInput(sprint: JudgeSprintRef, notJudged: number, examples: FindingRow[]): Promise<string>;
  writeInput(name: string, text: string): Promise<string>;
  cleanInputs(before: Date): Promise<unknown>;
  /** Opens a Judge session (origin cron) with its first message; resolves to the session id. */
  open(input: { title: string; prompt: string; account: string; model: 'sonnet' | 'opus' }): Promise<string>;
  turnState(chatId: string): Promise<{ state: TurnState; detail: string | null }>;
  sprints(): Promise<JudgeSprintRef[]>;
}

export interface TickResult { started: string | null; skipped: string | null }
interface SprintRun { status: 'waiting' | 'running' | 'done'; requestedAt: string; deadline: string; chatId?: string | null; notJudged?: number }

export class JudgeInputError extends Error {}

const findingView = (finding: FindingRow) => ({
  id: finding.id, sessionId: finding.sessionId, day: finding.day, messageId: finding.messageId, threadUrl: finding.threadUrl, cause: finding.cause,
  causeLabel: CAUSE_LABELS[finding.cause as keyof typeof CAUSE_LABELS] ?? finding.cause, text: finding.text, quote: finding.quote, shouldHave: finding.shouldHave,
  judgeCall: finding.judgeCall, ownerCall: finding.ownerCall, call: effectiveCall(finding), note: finding.note, createdAt: finding.createdAt.toISOString(),
});
export type JudgeFindingView = ReturnType<typeof findingView>;

export class JudgeQueue {
  private lastClean = 0;

  constructor(private readonly deps: JudgeDeps) {}

  /** Why Judge must wait: a turn on the machine, an auto review, or a cron ticket. Null when DOCK is quiet. */
  async quietReason(): Promise<string | null> {
    const { store, machine } = this.deps;
    if (!this.deps.online(machine)) return `machine ${machine} is offline`;
    if (await store.countBusyChatSessions(machine, JUDGE_TITLE_PREFIX) > 0) return 'a chat turn is running';
    if (await store.countRunningAutoReviews() > 0) return 'an auto review is running';
    const slots = await store.countCronSlots(machine);
    if (slots.busy + slots.waiting > 0) return 'a cron ticket is running';
    return null;
  }

  /** The sprint Jira calls active; the newest one when the list holds more than one. */
  async activeSprint(): Promise<JudgeSprintRef | null> {
    return [...await this.deps.sprints()].filter((item) => item.state === 'active').sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))[0] ?? null;
  }

  /**
   * A quiet session in scope gets a pending row; a judged one with newer messages goes back to pending. Only sessions
   * last active since the active sprint started are queued; an older one is judged only when asked with Judge again.
   */
  async enqueue(settings: JudgeSettings, now: Date): Promise<string[]> {
    const { store } = this.deps;
    const active = await this.activeSprint();
    if (!active) return [];
    const since = new Date(active.startDate);
    const candidates = (await store.getJudgeCandidates(this.deps.machine, since))
      .filter((session) => session.lastMessageAt >= since && inJudgeScope(session) && session.status !== 'queued' && session.status !== 'running' && session.lastMessageId !== null);
    if (!candidates.length) return [];
    const [rows, statuses] = await Promise.all([
      store.getJudgeSessions({ sessionIds: candidates.map((session) => session.id) }).then((list) => new Map(list.map((row) => [row.sessionId, row]))),
      this.deps.ticketStatuses(),
    ]);
    const queued: string[] = [];
    for (const session of candidates) {
      const idle = now.getTime() - session.lastMessageAt.getTime() >= settings.idleMinutes * 60000;
      const moved = Boolean(session.ticketKey && MOVED_STATUS.test(statuses.get(session.ticketKey) ?? ''));
      if (!idle && !moved) continue;
      const row = rows.get(session.id);
      const day = wibDay(session.lastMessageAt);
      if (!row) {
        await store.upsertJudgeSession(session.id, { day, status: 'pending' });
        queued.push(session.id);
      } else if (row.status === 'judged' && (row.judgedUntilMessageId ?? 0) < (session.lastMessageId ?? 0)) {
        await store.updateJudgeSession(session.id, { day, status: 'pending', error: null });
        queued.push(session.id);
      }
    }
    return queued;
  }

  private async asked(): Promise<Set<string>> {
    const value = await this.deps.store.getCache(JUDGE_CACHE, ASKED_KEY);
    return new Set(Array.isArray(value) ? value.map(String) : []);
  }

  /**
   * Pending rows that never ran and whose session was last active before the active sprint started are removed, so a
   * queue filled with history empties itself. Judged, failed and running rows stay, and so does a Judge again request.
   */
  async tidy(): Promise<string[]> {
    const { store } = this.deps;
    const active = await this.activeSprint();
    if (!active) return [];
    const rows = (await store.getJudgeSessions({ statuses: ['pending'] })).filter((row) => row.attempts === 0 && row.judgedUntilMessageId === null && row.judgedAt === null);
    if (!rows.length) return [];
    const start = new Date(active.startDate);
    const [chats, asked] = await Promise.all([store.getChatSessionsByIds(rows.map((row) => row.sessionId)), this.asked()]);
    const lastAt = new Map(chats.map((chat) => [chat.id, chat.lastMessageAt]));
    const stale = rows.filter((row) => {
      if (asked.has(row.sessionId)) return false;
      const at = lastAt.get(row.sessionId);
      return at ? at < start : row.day < wibDay(start);
    }).map((row) => row.sessionId);
    if (stale.length) await store.deleteJudgeSessions(stale);
    return stale;
  }

  private async fail(row: Row, error: string) {
    const attempts = row.attempts + 1;
    await this.deps.store.updateJudgeSession(row.sessionId, { status: attempts >= MAX_JUDGE_ATTEMPTS ? 'failed' : 'pending', attempts, error: error.slice(0, 500), judgeChatId: null, runUntilMessageId: null, startedAt: null });
  }

  /** A running row whose Judge turn ended without a result failed; one cut off by a shutdown goes back to pending as it was. */
  async settle(): Promise<void> {
    for (const row of await this.deps.store.getJudgeSessions({ statuses: ['running'] })) {
      const { state, detail } = row.judgeChatId ? await this.deps.turnState(row.judgeChatId) : { state: 'gone' as const, detail: null };
      if (state === 'running') continue;
      if (state === 'cut' || state === 'gone') {
        await this.deps.store.updateJudgeSession(row.sessionId, { status: 'pending', judgeChatId: null, runUntilMessageId: null, startedAt: null, error: `Cut off before the result${detail ? ` (${detail})` : ''}; judged again from the start` });
      } else {
        await this.fail(row, state === 'done' ? 'The Judge session ended without posting a result' : `The Judge session failed: ${detail ?? 'unknown error'}`);
      }
    }
  }

  /**
   * One step of the queue: queue what went quiet, settle the running row, then start at most one Judge session when the
   * window is open (or `force`, the Judge now button) and DOCK is quiet. The sprint summary goes first once it is due.
   */
  async tick(options: { force?: boolean } = {}): Promise<TickResult> {
    const settings = await this.deps.settings();
    const now = this.deps.now();
    if (!settings.on) return { started: null, skipped: 'Judge is off' };
    if (now.getTime() - this.lastClean >= CLEAN_EVERY_MS) {
      this.lastClean = now.getTime();
      await this.deps.cleanInputs(new Date(now.getTime() - INPUT_KEEP_MS)).catch(() => undefined);
    }
    await this.enqueue(settings, now);
    await this.tidy();
    await this.settle();
    if ((await this.deps.store.getJudgeSessions({ statuses: ['running'] })).length) return { started: null, skipped: 'a Judge session is running' };
    const sprint = await this.sprintTick(settings, now);
    if (sprint) return sprint;
    if (!options.force && !activeWindow(now, settings.windows)) return { started: null, skipped: 'outside the Judge windows' };
    const reason = await this.quietReason();
    if (reason) return { started: null, skipped: reason };
    const next = (await this.deps.store.getJudgeSessions({ statuses: ['pending'] }))[0];
    if (!next) return { started: null, skipped: 'nothing waiting' };
    return this.run(next, settings);
  }

  private async run(row: Row, settings: JudgeSettings): Promise<TickResult> {
    const { store } = this.deps;
    let input: { text: string; untilMessageId: number | null };
    try {
      input = await this.deps.sessionInput(row, await store.getJudgeExamples(EXAMPLES_TAKEN));
    } catch (error) {
      await this.fail(row, `The input could not be built: ${error instanceof Error ? error.message : 'unknown error'}`);
      return { started: null, skipped: 'the input could not be built' };
    }
    if (input.untilMessageId === null || (row.judgedUntilMessageId !== null && input.untilMessageId <= row.judgedUntilMessageId)) {
      await store.updateJudgeSession(row.sessionId, { status: 'judged', error: null, grade: row.grade ?? 'A', judgedAt: row.judgedAt ?? this.deps.now() });
      return { started: null, skipped: 'nothing new to judge' };
    }
    try {
      const file = await this.deps.writeInput(`${row.sessionId}-${input.untilMessageId}`, input.text);
      const chatId = await this.deps.open({ title: judgeTitle(row.sessionId), prompt: judgeSessionPrompt(row.sessionId, file, input.untilMessageId), account: settings.account, model: 'sonnet' });
      await store.updateJudgeSession(row.sessionId, { status: 'running', judgeChatId: chatId, runUntilMessageId: input.untilMessageId, startedAt: this.deps.now(), error: null });
      return { started: chatId, skipped: null };
    } catch (error) {
      await this.fail(row, `The Judge session could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`);
      return { started: null, skipped: 'the Judge session could not be opened' };
    }
  }

  // ---- Result --------------------------------------------------------------------------------------------------------

  /** The result the kit posts; the grade is computed here from the rules. */
  async receive(body: unknown): Promise<{ sessionId: string; grade: string }> {
    const result = parseJudgeResult(body);
    const { store } = this.deps;
    const row = await store.getJudgeSession(result.sessionId);
    if (!row) throw new OrchestratorInputError('This session is not in the Judge queue');
    if (row.status === 'judged' && result.untilMessageId !== null && row.judgedUntilMessageId !== null && result.untilMessageId <= row.judgedUntilMessageId) {
      throw new OrchestratorInputError(`This session is judged up to message ${row.judgedUntilMessageId} already`);
    }
    await store.saveJudgeRun(row.sessionId, result.findings.map((finding) => ({
      day: row.day, messageId: finding.messageId, threadUrl: finding.threadUrl, cause: finding.cause, text: finding.text, quote: finding.quote, shouldHave: finding.shouldHave, judgeCall: finding.call,
    })), {
      judgedUntilMessageId: result.untilMessageId ?? row.runUntilMessageId ?? row.judgedUntilMessageId,
      ownerWaitMinutes: row.ownerWaitMinutes + result.ownerWaitMinutes,
      judgedAt: this.deps.now(),
    });
    return { sessionId: row.sessionId, grade: await this.regrade(row.sessionId) };
  }

  private async regrade(sessionId: string): Promise<string> {
    const { store } = this.deps;
    const [row, findings] = await Promise.all([store.getJudgeSession(sessionId), store.getJudgeFindings({ sessionIds: [sessionId] })]);
    const grade = gradeOf(findings, row?.ownerWaitMinutes ?? 0);
    if (row) await store.updateJudgeSession(sessionId, { grade });
    return grade;
  }

  // ---- Owner answers -------------------------------------------------------------------------------------------------

  /** The owner's call on one finding; Not a mistake hides it, recounts the grade and keeps it as an example. */
  async setCall(findingId: string, call: string, note: string | null) {
    if (call !== 'mistake' && call !== 'not') throw new JudgeInputError('call must be mistake or not');
    const finding = await this.deps.store.getJudgeFinding(findingId);
    if (!finding) throw new JudgeInputError('No such finding');
    const updated = await this.deps.store.updateJudgeFinding(findingId, { ownerCall: call as JudgeCall, note: note?.trim().slice(0, 1000) || null });
    const grade = await this.regrade(finding.sessionId);
    return { ...findingView(updated), grade };
  }

  async confirmDay(day: string, note: string | null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new JudgeInputError('day must be YYYY-MM-DD');
    await this.deps.store.upsertJudgeDay(day, { confirmedAt: this.deps.now(), note: note?.trim().slice(0, 2000) || null });
    return this.day(day);
  }

  /** Judge again from the start: the session's findings go (the ones called not a mistake stay as examples). */
  async judgeAgain(sessionId: string): Promise<TickResult> {
    const { store } = this.deps;
    const row = await store.getJudgeSession(sessionId);
    if (row?.status === 'running') throw new JudgeInputError('Judge is reading this session now');
    const session = (await store.getChatSessionsByIds([sessionId]))[0];
    if (!session) throw new JudgeInputError('No such session');
    await store.deleteJudgeFindings(sessionId);
    await store.upsertCache(JUDGE_CACHE, ASKED_KEY, [...new Set([...await this.asked(), sessionId])].slice(-ASKED_KEEP), 0);
    await store.upsertJudgeSession(sessionId, { day: wibDay(session.lastMessageAt), status: 'pending', error: null });
    await store.updateJudgeSession(sessionId, { judgedUntilMessageId: null, grade: null, ownerWaitMinutes: 0, attempts: 0, judgedAt: null });
    return this.judgeNow();
  }

  async judgeNow(): Promise<TickResult> {
    if (!(await this.deps.settings()).on) throw new JudgeInputError('Judge is off. Switch it on in Settings › Judge.');
    return this.tick({ force: true });
  }

  // ---- Sprint summary ------------------------------------------------------------------------------------------------

  private sprintKey = (name: string) => `sprint:${name}`;

  /** "Judge sprint": the summary waits for an empty queue until 23:30, then runs on what was judged. */
  async requestSprint(name: string): Promise<SprintRun> {
    if (!(await this.deps.settings()).on) throw new JudgeInputError('Judge is off. Switch it on in Settings › Judge.');
    const sprint = (await this.deps.sprints()).find((item) => item.name === name);
    if (!sprint) throw new JudgeInputError(`No sprint named ${name}`);
    const now = this.deps.now();
    const deadline = wibAt(wibDay(now), SPRINT_DEADLINE_CLOCK);
    const run: SprintRun = { status: 'waiting', requestedAt: now.toISOString(), deadline: (deadline > now ? deadline : now).toISOString() };
    await this.deps.store.upsertCache(JUDGE_CACHE, this.sprintKey(name), run, 0);
    return run;
  }

  async sprintRun(name: string): Promise<SprintRun | null> {
    return (await this.deps.store.getCache(JUDGE_CACHE, this.sprintKey(name))) as SprintRun | null;
  }

  private async sprintTick(settings: JudgeSettings, now: Date): Promise<TickResult | null> {
    const sprints = await this.deps.sprints();
    const today = wibDay(now);
    for (const sprint of sprints.filter((item) => item.state === 'active' && wibDay(new Date(item.endDate)) === today && now >= wibAt(today, SPRINT_START_CLOCK))) {
      if (!(await this.sprintRun(sprint.name))) {
        await this.deps.store.upsertCache(JUDGE_CACHE, this.sprintKey(sprint.name), { status: 'waiting', requestedAt: now.toISOString(), deadline: wibAt(today, SPRINT_DEADLINE_CLOCK).toISOString() } satisfies SprintRun, 0);
      }
    }
    for (const sprint of sprints) {
      const run = await this.sprintRun(sprint.name);
      if (!run || run.status === 'done') continue;
      if (run.status === 'running') {
        const { state } = run.chatId ? await this.deps.turnState(run.chatId) : { state: 'gone' as const };
        if (state === 'running') return { started: null, skipped: 'the sprint summary is running' };
        await this.deps.store.upsertCache(JUDGE_CACHE, this.sprintKey(sprint.name), { ...run, status: state === 'done' ? 'done' : 'waiting' } satisfies SprintRun, 0);
        continue;
      }
      const days = sprintDays(sprint.startDate, sprint.endDate, now);
      const open = await this.deps.store.getJudgeSessions({ statuses: ['pending', 'running'], days });
      if (open.length && now < new Date(run.deadline)) continue;
      const examples = await this.deps.store.getJudgeExamples(EXAMPLES_TAKEN);
      const file = await this.deps.writeInput(`sprint-${sprint.name}-${today}`, await this.deps.sprintInput(sprint, open.length, examples));
      const chatId = await this.deps.open({ title: judgeSprintTitle(sprint.name), prompt: judgeSprintPrompt(sprint.name, file), account: settings.account, model: 'opus' });
      await this.deps.store.upsertCache(JUDGE_CACHE, this.sprintKey(sprint.name), { ...run, status: 'running', chatId, notJudged: open.length } satisfies SprintRun, 0);
      return { started: chatId, skipped: null };
    }
    return null;
  }

  // ---- Views ---------------------------------------------------------------------------------------------------------

  private async sprintOf(name?: string | null): Promise<{ sprint: JudgeSprintRef | null; previous: JudgeSprintRef | null; next: JudgeSprintRef | null; active: JudgeSprintRef | null }> {
    const sprints = [...await this.deps.sprints()].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
    const active = [...sprints].reverse().find((item) => item.state === 'active') ?? null;
    const sprint = name ? sprints.find((item) => item.name === name) ?? null : active ?? sprints[sprints.length - 1] ?? null;
    const index = sprint ? sprints.indexOf(sprint) : -1;
    return { sprint, previous: index > 0 ? sprints[index - 1] : null, next: index >= 0 ? sprints[index + 1] ?? null : null, active };
  }

  /** The rows and findings of the span's days; on a date shared with the sprint before or after, the session's last activity decides. */
  private async spanData(span: SprintSpan) {
    const data = await this.daysData(span.days);
    const edges = new Set([wibDay(span.from), ...(span.until ? [wibDay(span.until)] : [])]);
    const edgeIds = [...new Set([...data.rows, ...data.findings].filter((item) => edges.has(item.day)).map((item) => item.sessionId))];
    if (!edgeIds.length) return data;
    const lastAt = new Map((await this.deps.store.getChatSessionsByIds(edgeIds)).map((chat) => [chat.id, chat.lastMessageAt]));
    const keep = (item: { sessionId: string; day: string }) => {
      if (!edges.has(item.day)) return true;
      const at = lastAt.get(item.sessionId);
      return at ? inSpan(span, at) : !span.until || item.day !== wibDay(span.until);
    };
    return { ...data, rows: data.rows.filter(keep), findings: data.findings.filter(keep) };
  }

  private async daysData(days: string[]) {
    const { store } = this.deps;
    const [rows, findings, answers, settings] = await Promise.all([store.getJudgeSessions({ days }), store.getJudgeFindings({ days }), store.getJudgeDays(days), this.deps.settings()]);
    return { rows, findings, answers: new Map(answers.map((answer) => [answer.day, answer])), settings };
  }

  private dayRow(day: string, data: Awaited<ReturnType<JudgeQueue['daysData']>>, now: Date) {
    const rows = data.rows.filter((row) => row.day === day);
    const findings = data.findings.filter((finding) => finding.day === day);
    const answer = data.answers.get(day);
    const counted = findings.filter((finding) => effectiveCall(finding) === 'mistake');
    const sessionsWithFindings = new Set(counted.map((finding) => finding.sessionId));
    const judgedAt = rows.map((row) => row.judgedAt).filter((at): at is Date => !!at).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      day,
      sessions: rows.length,
      judged: rows.filter((row) => row.status === 'judged').length,
      pending: rows.filter((row) => row.status === 'pending' || row.status === 'running').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      findings: counted.length,
      totalFindings: findings.length,
      sessionsWithFindings: sessionsWithFindings.size,
      grade: rows.some((row) => row.grade) ? worstGrade(rows.map((row) => row.grade)) : null,
      status: dayStatus({ findings: findings.length, confirmedAt: answer?.confirmedAt ?? null, day, noonCutoff: data.settings.noonCutoff, now, latestFindingAt: findings.reduce<Date | null>((latest, finding) => (!latest || finding.createdAt > latest ? finding.createdAt : latest), null) }),
      confirmedAt: answer?.confirmedAt?.toISOString() ?? null,
      cutoffAt: dayCutoff(day, data.settings.noonCutoff).toISOString(),
      judgedAt: judgedAt?.toISOString() ?? null,
      ownerWaitMinutes: rows.filter((row) => gradedFindings(findings.filter((finding) => finding.sessionId === row.sessionId)).length > 0).reduce((sum, row) => sum + row.ownerWaitMinutes, 0),
    };
  }

  /** Days of the sprint, newest first, and the sprint sheet's numbers. */
  async days(name?: string | null) {
    const now = this.deps.now();
    await this.tidy();
    const { sprint, previous, next, active } = await this.sprintOf(name);
    if (!sprint) return null;
    const span = sprintSpan(sprint, next, now);
    const data = await this.spanData(span);
    const rows = span.days.map((day) => this.dayRow(day, data, now)).filter((row) => row.sessions > 0 || row.totalFindings > 0).reverse();
    const counted = data.findings.filter((finding) => effectiveCall(finding) === 'mistake');
    const before = previous ? await this.spanData(sprintSpan(previous, sprint, now)) : null;
    const causes = JUDGE_CAUSES.map((cause) => ({ cause, label: CAUSE_LABELS[cause], count: counted.filter((finding) => finding.cause === cause).length })).filter((row) => row.count > 0);
    const lastRun = data.rows.map((row) => row.judgedAt).filter((at): at is Date => !!at).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const sprintRun = await this.sprintRun(sprint.name);
    return {
      sprint: sprint.name,
      activeSprint: active?.name ?? null,
      previous: previous?.name ?? null,
      days: rows,
      sheet: {
        dayCount: rows.length,
        daysAnswered: rows.filter((row) => row.status !== 'waiting').length,
        sessions: data.rows.length,
        judged: data.rows.filter((row) => row.status === 'judged').length,
        waiting: data.rows.filter((row) => row.status === 'pending' || row.status === 'running').length,
        failed: data.rows.filter((row) => row.status === 'failed').length,
        lastRun: lastRun?.toISOString() ?? null,
        findings: counted.length,
        findingSessions: new Set(counted.map((finding) => finding.sessionId)).size,
        grade: sprintGrade(data.rows.filter((row) => row.status === 'judged').map((row) => row.grade)),
        previousGrade: before && before.rows.some((row) => row.status === 'judged') ? sprintGrade(before.rows.filter((row) => row.status === 'judged').map((row) => row.grade)) : null,
        ownerHours: Math.round((rows.reduce((sum, row) => sum + row.ownerWaitMinutes, 0) / 60) * 10) / 10,
        causes,
        waitingDays: rows.filter((row) => row.status === 'waiting').map((row) => ({ day: row.day, findings: row.findings })),
        summary: sprintRun ? { status: sprintRun.status, requestedAt: sprintRun.requestedAt, notJudged: sprintRun.notJudged ?? null } : null,
      },
    };
  }

  /** One day's sheet: the findings grouped by session, with the day before and after that have sessions. */
  async day(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new JudgeInputError('day must be YYYY-MM-DD');
    const now = this.deps.now();
    const data = await this.daysData([day]);
    const summary = this.dayRow(day, data, now);
    const ids = [...new Set([...data.rows.map((row) => row.sessionId), ...data.findings.map((finding) => finding.sessionId)])];
    const [chats, sessionRows] = await Promise.all([this.deps.store.getChatSessionsByIds(ids), this.deps.store.getJudgeSessions({ sessionIds: ids })]);
    const chatOf = new Map(chats.map((chat) => [chat.id, chat]));
    const rowOf = new Map(sessionRows.map((row) => [row.sessionId, row]));
    const sessions = ids.map((id) => {
      const chat = chatOf.get(id);
      const row = rowOf.get(id);
      return {
        sessionId: id, title: chat?.title || id.slice(0, 8), ticketKey: chat?.ticketKey ?? null, origin: chat?.origin ?? 'manual',
        startedAt: chat?.startedAt.toISOString() ?? null, lastMessageAt: chat?.lastMessageAt.toISOString() ?? null,
        status: row?.status ?? 'judged', grade: row?.grade ?? null, ownerWaitMinutes: row?.ownerWaitMinutes ?? 0, error: row?.error ?? null,
        findings: data.findings.filter((finding) => finding.sessionId === id).map(findingView),
      };
    }).sort((a, b) => b.findings.length - a.findings.length || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
    const answer = data.answers.get(day);
    return { ...summary, note: answer?.note ?? null, sessionList: sessions, previousDay: await this.neighbour(day, -1), nextDay: await this.neighbour(day, 1) };
  }

  private async neighbour(day: string, step: -1 | 1): Promise<string | null> {
    let current = day;
    for (let index = 0; index < 14; index += 1) {
      current = step === 1 ? nextDay(current) : new Date(Date.parse(`${current}T00:00:00Z`) - 24 * 3600 * 1000).toISOString().slice(0, 10);
      if (step === 1 && current > wibDay(this.deps.now())) return null;
      const [rows, findings] = await Promise.all([this.deps.store.getJudgeSessions({ days: [current] }), this.deps.store.getJudgeFindings({ days: [current] })]);
      if (rows.length || findings.length) return current;
    }
    return null;
  }

  /** The Judge block of one session: its grade and the findings that stand. */
  async session(sessionId: string) {
    const [row, findings] = await Promise.all([this.deps.store.getJudgeSession(sessionId), this.deps.store.getJudgeFindings({ sessionIds: [sessionId] })]);
    if (!row) return null;
    return { status: row.status, grade: row.grade, judgedAt: row.judgedAt?.toISOString() ?? null, ownerWaitMinutes: row.ownerWaitMinutes, error: row.error, findings: findings.map(findingView) };
  }

  /** The Judge rows of many sessions at once, for the Sessions list; the findings are read per session when asked for. */
  async grades(sessionIds: string[]) {
    if (!sessionIds.length) return new Map<string, { sessionId: string; status: string; grade: string | null; judgedAt: string | null; ownerWaitMinutes: number; error: string | null }>();
    return new Map((await this.deps.store.getJudgeSessions({ sessionIds })).map((row) => [row.sessionId, {
      sessionId: row.sessionId, status: row.status, grade: row.grade, judgedAt: row.judgedAt?.toISOString() ?? null, ownerWaitMinutes: row.ownerWaitMinutes, error: row.error,
    }]));
  }

  async findings(sessionId: string): Promise<JudgeFindingView[]> {
    return (await this.deps.store.getJudgeFindings({ sessionIds: [sessionId] })).map(findingView);
  }

  /** Days of the active sprint with findings the owner has not confirmed, before or after the cutoff, for Home's Needs you. */
  async waitingDays(): Promise<Array<{ day: string; findings: number }>> {
    if (!(await this.deps.settings()).on) return [];
    const now = this.deps.now();
    await this.tidy();
    const active = await this.activeSprint();
    if (!active) return [];
    const { sprint, next } = await this.sprintOf(active.name);
    if (!sprint) return [];
    const span = sprintSpan(sprint, next, now);
    const data = await this.spanData(span);
    return span.days.map((day) => this.dayRow(day, data, now)).filter((row) => row.status === 'waiting' || row.status === 'stood').reverse().map((row) => ({ day: row.day, findings: row.findings }));
  }
}
