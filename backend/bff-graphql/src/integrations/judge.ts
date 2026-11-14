// Retro Judge: a separate agent reads the transcripts of the sprint's sessions and records what the agent did wrong.
// This file holds the pure rules: the causes, the grade, the result the kit posts, the settings and the WIB windows.
import { OrchestratorInputError } from './orchestrator';

export const JUDGE_CAUSES = [
  'stopped-with-way-out', 'self-inflicted-rework', 'misread-ac-scope', 'skipped-step', 'asked-instead-of-looking', 'wrong-code', 'environment',
] as const;
export type JudgeCause = typeof JUDGE_CAUSES[number];
export const JUDGE_CALLS = ['mistake', 'not'] as const;
export type JudgeCall = typeof JUDGE_CALLS[number];
export type JudgeGrade = 'A' | 'B' | 'C' | 'D';
export const JUDGE_GRADES: JudgeGrade[] = ['A', 'B', 'C', 'D'];

export const CAUSE_LABELS: Record<JudgeCause, string> = {
  'stopped-with-way-out': 'Stopped with a way out',
  'self-inflicted-rework': 'Self-inflicted rework',
  'misread-ac-scope': 'Misread AC / scope',
  'skipped-step': 'Skipped step',
  'asked-instead-of-looking': 'Asked instead of looking',
  'wrong-code': 'Wrong code',
  environment: 'Environment (not graded)',
};

/** Findings Judge keeps per session; a longer list is cut. */
export const MAX_FINDINGS = 40;
/** A session that failed this many runs is marked failed and left for the owner. */
export const MAX_JUDGE_ATTEMPTS = 3;
/** The negative examples every Judge prompt carries. */
export const EXAMPLES_TAKEN = 30;
export const JUDGE_TITLE_PREFIX = 'Judge-';
const WIB_OFFSET_MS = 7 * 3600 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export interface JudgeFindingInput { messageId: number | null; threadUrl: string | null; cause: JudgeCause; text: string; quote: string; shouldHave: string; call: JudgeCall }
export interface JudgeResult { sessionId: string; untilMessageId: number | null; findings: JudgeFindingInput[]; ownerWaitMinutes: number }

function messageIdOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = typeof value === 'number' ? value : Number(String(value).replace(/^#/, ''));
  if (!Number.isInteger(id) || id <= 0) throw new OrchestratorInputError('messageId must be a message id');
  return id;
}

function httpUrl(value: unknown): string | null {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The result the kit posts: `{ sessionId, untilMessageId, findings: [...], ownerWaitMinutes }`. The grade is never taken from it. */
export function parseJudgeResult(input: unknown): JudgeResult {
  if (!isRecord(input)) throw new OrchestratorInputError('A Judge result must be an object');
  const sessionId = text(input.sessionId, 64);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(sessionId)) throw new OrchestratorInputError('sessionId must be a session id');
  const findings = (Array.isArray(input.findings) ? input.findings : []).slice(0, MAX_FINDINGS).map((item, index) => {
    if (!isRecord(item)) throw new OrchestratorInputError(`findings[${index}] must be an object`);
    const cause = String(item.cause ?? '').trim().toLowerCase();
    if (!(JUDGE_CAUSES as readonly string[]).includes(cause)) throw new OrchestratorInputError(`findings[${index}].cause must be one of ${JUDGE_CAUSES.join(', ')}`);
    const call = String(item.call ?? 'mistake').trim().toLowerCase();
    if (!(JUDGE_CALLS as readonly string[]).includes(call)) throw new OrchestratorInputError(`findings[${index}].call must be mistake or not`);
    const body = text(item.text, 1500);
    if (!body) throw new OrchestratorInputError(`findings[${index}].text is required`);
    return { messageId: messageIdOf(item.messageId), threadUrl: httpUrl(item.threadUrl), cause: cause as JudgeCause, text: body, quote: text(item.quote, 1500), shouldHave: text(item.shouldHave, 1000), call: call as JudgeCall };
  });
  const wait = Number(input.ownerWaitMinutes ?? 0);
  return {
    sessionId,
    untilMessageId: input.untilMessageId === '-' ? null : messageIdOf(input.untilMessageId),
    findings,
    ownerWaitMinutes: Number.isFinite(wait) && wait > 0 ? Math.min(Math.round(wait), 7 * 24 * 60) : 0,
  };
}

export interface GradedFinding { cause: string; threadUrl: string | null; judgeCall: string; ownerCall: string | null }

/** The owner's answer when there is one, else Judge's call: a day not confirmed keeps Judge's call. */
export const effectiveCall = (finding: Pick<GradedFinding, 'judgeCall' | 'ownerCall'>): JudgeCall => (finding.ownerCall === 'not' || finding.ownerCall === 'mistake' ? finding.ownerCall : finding.judgeCall === 'not' ? 'not' : 'mistake');

/** Findings that count: called a mistake and not Environment, which is never graded. */
export const gradedFindings = <T extends GradedFinding>(findings: T[]) => findings.filter((finding) => effectiveCall(finding) === 'mistake' && finding.cause !== 'environment');

const OWNER_CAUSES = new Set(['stopped-with-way-out', 'self-inflicted-rework', 'misread-ac-scope', 'asked-instead-of-looking']);

/**
 * A no finding · B minor, the owner not involved · C the owner waited or work was redone · D wrong code reached a
 * reviewer or QA. Environment findings and the ones called not a mistake are left out.
 */
export function gradeOf(findings: GradedFinding[], ownerWaitMinutes: number): JudgeGrade {
  const counted = gradedFindings(findings);
  if (counted.length === 0) return 'A';
  if (counted.some((finding) => finding.cause === 'wrong-code' || (finding.cause === 'misread-ac-scope' && finding.threadUrl))) return 'D';
  if (ownerWaitMinutes > 0 || counted.some((finding) => OWNER_CAUSES.has(finding.cause))) return 'C';
  return 'B';
}

export const worstGrade = (grades: Array<string | null | undefined>): JudgeGrade => grades.reduce<JudgeGrade>((worst, grade) => (grade && JUDGE_GRADES.indexOf(grade as JudgeGrade) > JUDGE_GRADES.indexOf(worst) ? grade as JudgeGrade : worst), 'A');

/** The sprint's grade: the rounded average of its judged sessions, A when none was judged. */
export function sprintGrade(grades: Array<string | null | undefined>): JudgeGrade {
  const known = grades.map((grade) => JUDGE_GRADES.indexOf(grade as JudgeGrade)).filter((index) => index >= 0);
  if (!known.length) return 'A';
  return JUDGE_GRADES[Math.round(known.reduce((sum, index) => sum + index, 0) / known.length)];
}

// ---- Scope ---------------------------------------------------------------------------------------------------------

const WORK_TITLE = /^(Task|Review|QA)-/;
const EXCLUDED_TITLE = /^(Plan|Planning|Retro|Judge)\b/i;
const TICKET_IN_TEXT = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** Sessions that work on a ticket: Task, Review, QA, and a chat whose first message names a ticket key. Never Plan, Planning, Retro or Judge. */
export function inJudgeScope(session: { title: string; firstText: string | null }): boolean {
  const title = session.title.trim();
  if (EXCLUDED_TITLE.test(title)) return false;
  if (WORK_TITLE.test(title)) return true;
  const key = TICKET_IN_TEXT.exec(session.firstText ?? '')?.[0];
  return Boolean(key && !key.startsWith('CARD-'));
}

// ---- Settings ------------------------------------------------------------------------------------------------------

export const JUDGE_SETTINGS_KEY = 'judgeSettings';
export interface JudgeWindow { from: string; to: string }
export interface JudgeSettings { on: boolean; account: string; windows: JudgeWindow[]; idleMinutes: number; noonCutoff: string }
export const DEFAULT_JUDGE_SETTINGS: JudgeSettings = {
  on: false,
  account: '',
  windows: [{ from: '21:00', to: '23:30' }, { from: '08:00', to: '09:00' }],
  idleMinutes: 30,
  noonCutoff: '12:00',
};

export class JudgeSettingsError extends Error {}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (clock: string) => {
  const match = CLOCK.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

/** Settings › Judge as saved; throws JudgeSettingsError on a value the queue cannot use. */
export function parseJudgeSettings(raw: string): JudgeSettings {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new JudgeSettingsError('Judge settings must be JSON'); }
  if (!isRecord(input)) throw new JudgeSettingsError('Judge settings must be an object');
  const merged = { ...DEFAULT_JUDGE_SETTINGS, ...input };
  if (typeof merged.on !== 'boolean') throw new JudgeSettingsError('on must be true or false');
  const account = typeof merged.account === 'string' ? merged.account.trim() : '';
  if (account && !/^[A-Za-z0-9_-]{1,30}$/.test(account)) throw new JudgeSettingsError('The account is a name of up to 30 letters, digits, dashes or underscores');
  const windows = Array.isArray(merged.windows) ? merged.windows : [];
  if (windows.length > 4) throw new JudgeSettingsError('At most four windows');
  const parsedWindows = windows.map((window, index) => {
    if (!isRecord(window) || typeof window.from !== 'string' || typeof window.to !== 'string') throw new JudgeSettingsError(`Window ${index + 1} needs a from and a to`);
    const from = minutesOf(window.from);
    const to = minutesOf(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new JudgeSettingsError(`Window ${index + 1} uses HH:MM`);
    if (to <= from) throw new JudgeSettingsError(`Window ${index + 1} must end after it starts`);
    return { from: window.from, to: window.to };
  });
  const idle = Number(merged.idleMinutes);
  if (!Number.isInteger(idle) || idle < 5 || idle > 24 * 60) throw new JudgeSettingsError('Idle minutes must be a whole number from 5 to 1440');
  if (typeof merged.noonCutoff !== 'string' || !Number.isFinite(minutesOf(merged.noonCutoff))) throw new JudgeSettingsError('The cutoff uses HH:MM');
  return { on: merged.on, account, windows: parsedWindows, idleMinutes: idle, noonCutoff: merged.noonCutoff };
}

/** The saved settings, or the defaults (Judge off) when nothing or nothing readable is saved. */
export function storedJudgeSettings(raw: string | null | undefined): JudgeSettings {
  if (!raw) return DEFAULT_JUDGE_SETTINGS;
  try { return parseJudgeSettings(raw); } catch { return DEFAULT_JUDGE_SETTINGS; }
}

// ---- WIB time ------------------------------------------------------------------------------------------------------

/** The WIB date of a moment, YYYY-MM-DD. */
export const wibDay = (date: Date) => new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
const wibMinutes = (date: Date) => {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};
/** The moment a WIB clock time is reached on a WIB date. */
export const wibAt = (day: string, clock: string) => new Date(Date.parse(`${day}T00:00:00Z`) - WIB_OFFSET_MS + minutesOf(clock) * 60000);
export const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);

/** The window the moment is in: from inclusive, to exclusive. Null outside every window. */
export function activeWindow(now: Date, windows: JudgeWindow[]): JudgeWindow | null {
  const minute = wibMinutes(now);
  return windows.find((window) => minute >= minutesOf(window.from) && minute < minutesOf(window.to)) ?? null;
}

// ---- Days ----------------------------------------------------------------------------------------------------------

export type DayStatus = 'waiting' | 'confirmed' | 'nothing' | 'stood';

/** Until when the owner answers a day: the cutoff on the next day. Later, Judge's call stands, still open to change. */
export const dayCutoff = (day: string, noonCutoff: string) => wibAt(nextDay(day), noonCutoff);

export function dayStatus(input: { findings: number; confirmedAt: Date | null; day: string; noonCutoff: string; now: Date; latestFindingAt?: Date | null }): DayStatus {
  if (input.confirmedAt && !(input.latestFindingAt && input.latestFindingAt > input.confirmedAt)) return 'confirmed';
  if (input.confirmedAt) return 'waiting';
  if (input.findings === 0) return 'nothing';
  return input.now >= dayCutoff(input.day, input.noonCutoff) ? 'stood' : 'waiting';
}

/** Every WIB date from the sprint's start to its end, or to today when it ends later. */
export function sprintDays(startDate: string, endDate: string, now: Date): string[] {
  const first = wibDay(new Date(startDate));
  const last = [wibDay(new Date(endDate)), wibDay(now)].sort()[0];
  const days: string[] = [];
  for (let day = first; day <= last && days.length < 60; day = nextDay(day)) days.push(day);
  return days;
}

// ---- Prompts -------------------------------------------------------------------------------------------------------

export const judgeSessionPrompt = (sessionId: string, inputPath: string, untilMessageId: number | null) => `Pakai skill judge: session ${sessionId} input ${inputPath} until ${untilMessageId ?? '-'}`;
export const judgeSprintPrompt = (sprint: string, inputPath: string) => `Pakai skill judge: sprint "${sprint.replace(/"/g, "'")}" input ${inputPath}`;
export const judgeTitle = (sessionId: string) => `${JUDGE_TITLE_PREFIX}${sessionId.slice(0, 8)}`;
export const judgeSprintTitle = (sprint: string) => `${JUDGE_TITLE_PREFIX}${sprint}`.slice(0, 120);
