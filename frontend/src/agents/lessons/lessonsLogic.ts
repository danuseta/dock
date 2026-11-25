import type { BadgeVariant } from '../../components/ui';

export const LESSON_TARGETS = ['skill', 'agent', 'flow', 'repo', 'fact', 'code'] as const;
export type LessonTarget = typeof LESSON_TARGETS[number];
export type LessonFilter = 'all' | LessonTarget;

export interface LessonSource { id: string; kind: string; ref: string; sessionId: string | null; messageId: number | null; ticketKey: string | null; text: string; cause: string; status: string; createdAt: string }
export interface Lesson {
  id: string; targetKind: string; targetName: string; text: string; cause: string; count: number; ignored: number; ticketKeys: string[]; sessionIds: string[];
  status: string; cardKey: string | null; cardState: string | null; cardSessionId: string | null; writtenTo: string; createdAt: string; updatedAt: string; sources: LessonSource[];
}
export interface LessonsData {
  unprocessed: number;
  sources: number;
  byStatus: Array<{ status: string; count: number }>;
  environment: Array<{ id: string; kind: string; ticketKey: string | null; text: string; createdAt: string }>;
  failed: Array<{ id: string; text: string; error: string | null }>;
  lessons: Lesson[];
}

export const TARGET_LABELS: Record<LessonTarget, string> = { skill: 'Skill', agent: 'Agent', flow: 'Sous flow', repo: 'Repo', fact: 'Fact', code: 'Code' };
export const SOURCE_STATUS_LABELS: Record<string, string> = { pending: 'Not processed', lesson: 'Lesson', merged: 'Merged', code: 'Code card', environment: 'Environment' };
const SOURCE_KIND_LABELS: Record<string, string> = { 'judge-session': 'Judge', 'judge-sprint': 'Judge sprint', ledger: 'Ledger', 'owner-correction': 'Owner correction' };

export const filterLessons = (lessons: Lesson[], filter: LessonFilter) => (filter === 'all' ? lessons : lessons.filter((lesson) => lesson.targetKind === filter));

export function lessonCounts(lessons: Lesson[]): Record<LessonFilter, number> {
  const counts = { all: lessons.length } as Record<LessonFilter, number>;
  for (const kind of LESSON_TARGETS) counts[kind] = lessons.filter((lesson) => lesson.targetKind === kind).length;
  return counts;
}

export const targetLabel = (lesson: Pick<Lesson, 'targetKind' | 'targetName'>) => (lesson.targetKind === 'flow' ? 'Sous flow' : `${TARGET_LABELS[lesson.targetKind as LessonTarget] ?? lesson.targetKind} · ${lesson.targetName}`);

/** The chips a lesson card shows: its state and, when broken after it was read, how often. */
export function statusChips(lesson: Pick<Lesson, 'status' | 'cardState' | 'cardKey' | 'ignored'>): Array<{ label: string; variant: BadgeVariant }> {
  const chips: Array<{ label: string; variant: BadgeVariant }> = [];
  if (lesson.status === 'coded') chips.push({ label: 'Guarded by code', variant: 'success' });
  else if (lesson.cardState === 'started') chips.push({ label: `${lesson.cardKey ?? 'Card'} running`, variant: 'accent' });
  else if (lesson.cardState === 'pending') chips.push({ label: 'Make it code? Waiting for you', variant: 'warn' });
  else chips.push({ label: 'Active', variant: 'neutral' });
  if (lesson.ignored > 0) chips.push({ label: `Broken ${lesson.ignored}× after reading`, variant: 'danger' });
  return chips;
}

/** "Jadikan aturan di kode" is offered until the card runs or the lesson is guarded by code. */
export const canMakeCode = (lesson: Pick<Lesson, 'status' | 'cardState'>) => lesson.status !== 'coded' && lesson.status !== 'deleted' && lesson.cardState !== 'started' && lesson.cardState !== 'done';

/** One source as the card names it: Judge 4e75771b, Ledger QRD-1646, Owner correction QRD-1700. */
export function sourceLabel(source: Pick<LessonSource, 'kind' | 'sessionId' | 'ticketKey' | 'ref'>): string {
  const kind = SOURCE_KIND_LABELS[source.kind] ?? source.kind;
  if (source.kind === 'judge-session' && source.sessionId) return `${kind} ${source.sessionId.slice(0, 8)}${source.ticketKey ? ` (${source.ticketKey})` : ''}`;
  if (source.kind === 'judge-sprint') return `${kind} ${source.ref.split(':')[1] ?? ''}`.trim();
  return `${kind}${source.ticketKey ? ` ${source.ticketKey}` : ''}`;
}

/** Why a target change cannot be sent, or null. */
export function targetProblem(kind: string, name: string): string | null {
  if (!(LESSON_TARGETS as readonly string[]).includes(kind)) return 'Pick a target kind';
  if (['skill', 'agent', 'repo'].includes(kind) && !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(name.trim().toLowerCase())) return 'A skill, agent or repo is a plain name such as demo-video';
  return null;
}
