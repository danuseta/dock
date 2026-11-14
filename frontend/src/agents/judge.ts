import type { RetroItem } from './retro';

export type JudgeGrade = 'A' | 'B' | 'C' | 'D';
export type JudgeCall = 'mistake' | 'not';
export type RetroView = 'ledger' | 'judge' | 'both';

export interface JudgeFinding {
  id: string; sessionId: string; day: string; messageId: number | null; threadUrl: string | null; cause: string; causeLabel: string;
  text: string; quote: string; shouldHave: string; judgeCall: string; ownerCall: string | null; call: string; note: string | null; createdAt: string;
}
export interface JudgeDayRow {
  day: string; sessions: number; judged: number; pending: number; failed: number; findings: number; totalFindings: number; sessionsWithFindings: number;
  grade: string | null; status: string; confirmedAt: string | null; cutoffAt: string; judgedAt: string | null; ownerWaitMinutes: number;
}
export interface JudgeDaySession {
  sessionId: string; title: string; ticketKey: string | null; origin: string; startedAt: string | null; lastMessageAt: string | null;
  status: string; grade: string | null; ownerWaitMinutes: number; error: string | null; findings: JudgeFinding[];
}
export interface JudgeDaySheet extends JudgeDayRow { note: string | null; previousDay: string | null; nextDay: string | null; sessionList: JudgeDaySession[] }
export interface JudgeSprintSheet {
  dayCount: number; daysAnswered: number; sessions: number; judged: number; waiting: number; failed: number; lastRun: string | null; findings: number; findingSessions: number;
  grade: string; previousGrade: string | null; ownerHours: number; causes: Array<{ cause: string; label: string; count: number }>; waitingDays: Array<{ day: string; findings: number }>;
  summary: { status: string; requestedAt: string; notJudged: number | null } | null;
}
export interface JudgeDays { sprint: string; activeSprint: string | null; previous: string | null; days: JudgeDayRow[]; sheet: JudgeSprintSheet }

/** The picker value of a sprint Judge has days for and the sprint dashboard does not list yet. */
export const JUDGE_ONLY_OPTION = 'judge:';

/** The Retro sprint picker: the dashboard's sprints, newest first, and the active sprint ahead of them when the dashboard has no retro for it yet. */
export function retroSprintOptions(list: Array<{ id: number; name: string; state: string; startDate: string }>, activeSprint: string | null): Array<{ value: string; label: string }> {
  const options = [...list].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((sprint) => ({ value: String(sprint.id), label: `${sprint.name}${sprint.state === 'active' ? ' · active' : ''}` }));
  return activeSprint && !list.some((sprint) => sprint.name === activeSprint) ? [{ value: `${JUDGE_ONLY_OPTION}${activeSprint}`, label: `${activeSprint} · active · Judge only` }, ...options] : options;
}

/**
 * The sprint the Judge view shows without a ledger retro: the one picked as Judge only, or, while no sprint was picked,
 * the active sprint when the default retro is still an older sprint. Null shows the retro's own sprint.
 */
export function judgeOnlySprint(input: { view: RetroView; picked: string | null; sprintChosen: boolean; daysSprint: string | null; retroSprint: string }): string | null {
  if (input.view === 'ledger') return null;
  if (input.picked) return input.picked;
  return !input.sprintChosen && input.daysSprint && input.daysSprint !== input.retroSprint ? input.daysSprint : null;
}
export interface SessionJudge { status: string; grade: string | null; judgedAt: string | null; ownerWaitMinutes: number; error: string | null; findings: JudgeFinding[] }

export const GRADES: JudgeGrade[] = ['A', 'B', 'C', 'D'];
const OWNER_CAUSES = new Set(['stopped-with-way-out', 'self-inflicted-rework', 'misread-ac-scope', 'asked-instead-of-looking']);

/** The owner's answer when there is one, else Judge's call. */
export const callOf = (finding: Pick<JudgeFinding, 'judgeCall' | 'ownerCall'>): JudgeCall => (finding.ownerCall === 'not' || finding.ownerCall === 'mistake' ? finding.ownerCall : finding.judgeCall === 'not' ? 'not' : 'mistake');

/** The same rules as the server, so the sheet recounts at once when a call is flipped. */
export function gradeOf(findings: Array<Pick<JudgeFinding, 'cause' | 'threadUrl' | 'judgeCall' | 'ownerCall'>>, ownerWaitMinutes: number): JudgeGrade {
  const counted = findings.filter((finding) => callOf(finding) === 'mistake' && finding.cause !== 'environment');
  if (!counted.length) return 'A';
  if (counted.some((finding) => finding.cause === 'wrong-code' || (finding.cause === 'misread-ac-scope' && finding.threadUrl))) return 'D';
  if (ownerWaitMinutes > 0 || counted.some((finding) => OWNER_CAUSES.has(finding.cause))) return 'C';
  return 'B';
}

/** The calls the owner flipped on the sheet, laid over the findings. */
export const withCalls = (findings: JudgeFinding[], calls: Record<string, JudgeCall>) => findings.map((finding) => (calls[finding.id] ? { ...finding, ownerCall: calls[finding.id], call: calls[finding.id] } : finding));

/** "Thu 13 Nov" for 2026-11-13. */
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');

export const wibTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
export const wibStamp = (iso: string) => `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })} ${wibTime(iso)}`;

export function dayStatusText(row: Pick<JudgeDayRow, 'status' | 'confirmedAt'>): string {
  if (row.status === 'confirmed') return `Confirmed ${row.confirmedAt ? wibStamp(row.confirmedAt) : ''}`.trim();
  if (row.status === 'nothing') return 'Nothing to answer';
  if (row.status === 'stood') return "Judge's call stood (not answered)";
  return 'Waiting for you';
}

export function dayCounts(row: Pick<JudgeDayRow, 'sessions' | 'findings' | 'sessionsWithFindings' | 'pending'>): string {
  const sessions = `${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}`;
  const findings = row.findings === 0 ? 'no findings' : `${row.findings} ${row.findings === 1 ? 'finding' : 'findings'} in ${row.sessionsWithFindings} ${row.sessionsWithFindings === 1 ? 'session' : 'sessions'}`;
  return [sessions, findings, ...(row.pending ? [`${row.pending} not judged yet`] : [])].join(' · ');
}

export const answeredText = (days: JudgeDayRow[]) => {
  const waiting = days.filter((day) => day.status === 'waiting').length;
  return `${waiting} to answer · ${days.length - waiting} of ${days.length} answered`;
};

// ---- Route ---------------------------------------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?day=YYYY-MM-DD` opens a day's sheet, `?sheet=sprint` the sprint sheet; neither is the days list. */
export function judgeRoute(search: string): { day: string | null; sprintSheet: boolean } {
  const params = new URLSearchParams(search);
  const day = params.get('day');
  return { day: day && DAY.test(day) ? day : null, sprintSheet: params.get('sheet') === 'sprint' };
}

/** The Retro URL with a day, the sprint sheet, or the list; the other parameters stay. */
export function judgeHref(search: string, target: { day?: string | null; sprintSheet?: boolean }): string {
  const params = new URLSearchParams(search);
  params.set('tab', 'retro');
  params.delete('day');
  params.delete('sheet');
  if (target.day) params.set('day', target.day);
  else if (target.sprintSheet) params.set('sheet', 'sprint');
  return `/planning?${params.toString()}`;
}

export const dayHref = (day: string) => `/planning?tab=retro&day=${day}`;

/** A finding in a session opens the session at its message; one from a Discord thread opens the thread at the reviewer's message. */
export function findingHref(finding: Pick<JudgeFinding, 'sessionId' | 'messageId' | 'threadUrl'>): string {
  const discord = finding.threadUrl ? discordFindingHref(finding.threadUrl) : null;
  if (discord) return discord;
  return `/sessions?session=${encodeURIComponent(finding.sessionId)}${finding.messageId ? `&message=${finding.messageId}` : ''}`;
}

/** `https://discord.com/channels/<guild>/<thread>/<message>` as the Discord page's thread at that message. */
export function discordFindingHref(url: string): string | null {
  const match = /discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?/.exec(url);
  if (!match) return null;
  return `/discord?thread=${match[1]}${match[2] ? `&message=${match[2]}` : ''}`;
}

// ---- Flags in the transcript ---------------------------------------------------------------------------------------

export interface MessageFlag { cause: string; shouldHave: string }

/** The session's messages Judge flagged, by message id; a finding called not a mistake is not flagged. */
export function flaggedMessages(findings: Array<Pick<JudgeFinding, 'messageId' | 'causeLabel' | 'shouldHave' | 'judgeCall' | 'ownerCall'>> | null | undefined): Map<number, MessageFlag> {
  const flags = new Map<number, MessageFlag>();
  for (const finding of findings ?? []) {
    if (finding.messageId && callOf(finding) === 'mistake' && !flags.has(finding.messageId)) flags.set(finding.messageId, { cause: finding.causeLabel, shouldHave: finding.shouldHave });
  }
  return flags;
}

export const flagText = (flag: MessageFlag) => `Judge: ${flag.cause}${flag.shouldHave ? ` · ${flag.shouldHave.replace(/^should have:\s*/i, '')}` : ''}`;

// ---- Retro view ----------------------------------------------------------------------------------------------------

const VIEW_KEY = 'dock.retro-view';

export function readRetroView(): RetroView {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return value === 'ledger' || value === 'judge' ? value : 'both';
  } catch {
    return 'both';
  }
}

export function writeRetroView(view: RetroView) {
  try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* the choice lasts until the page closes */ }
}

export interface MergedRetroItem { item: RetroItem; sources: string[]; others: RetroItem[] }

const sameLine = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The lines of the view; in Both a line present in both sources shows once with both source chips. */
export function mergeRetroItems(items: RetroItem[], view: RetroView): MergedRetroItem[] {
  const sourceOf = (item: RetroItem) => item.source || 'ledger';
  const shown = items.filter((item) => view === 'both' || sourceOf(item) === view);
  if (view !== 'both') return shown.map((item) => ({ item, sources: [sourceOf(item)], others: [] }));
  const merged: MergedRetroItem[] = [];
  for (const item of shown) {
    const twin = merged.find((entry) => entry.item.kind === item.kind && sameLine(entry.item.text) === sameLine(item.text) && !entry.sources.includes(sourceOf(item)));
    if (twin) {
      twin.sources.push(sourceOf(item));
      twin.others.push(item);
    } else {
      merged.push({ item, sources: [sourceOf(item)], others: [] });
    }
  }
  return merged;
}

/** The grade filter of the Sessions list: any, or one grade. */
export type GradeFilter = 'any' | JudgeGrade;
export const filterByGrade = <T extends { judge?: { grade?: string | null } | null }>(sessions: T[], grade: GradeFilter) => (grade === 'any' ? sessions : sessions.filter((session) => session.judge?.grade === grade));

export const GRADE_CLASS: Record<string, string> = {
  A: 'border-status-merged/40 text-status-merged',
  B: 'border-sky-300/40 text-sky-200',
  C: 'border-status-warn/40 text-status-warn',
  D: 'border-status-conflict/40 text-status-conflict',
};

export const ownerWaitText = (minutes: number) => (minutes <= 0 ? null : minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`);
