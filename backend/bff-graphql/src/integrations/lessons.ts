// Agents › Lessons: every finding from Judge, a closed ticket ledger or an owner correction becomes a LessonSource, and every
// source ends in a final status: a lesson, merged into a similar lesson, a "make it code" card, or environment (a notice only).
// A lesson is written where sessions read it (a skill or agent lessons file through the kit bridge, the Sous flow rules, a repo or
// facts file under .evidence/lessons) and gathered per ticket into .evidence/lessons/<KEY>.md, which the prompt names on one
// `Pelajaran:` line and the kit guard makes the session read before it edits or commits.
import { createHash } from 'node:crypto';
import path from 'node:path';

/** A lesson edit DOCK refuses; the resolver answers it as bad input. */
export class LessonInputError extends Error {}

export const LESSON_TARGETS = ['skill', 'agent', 'flow', 'repo', 'fact', 'code'] as const;
export type LessonTarget = typeof LESSON_TARGETS[number];
export const SOURCE_KINDS = ['judge-session', 'judge-sprint', 'ledger', 'owner-correction'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export const SOURCE_STATUSES = ['pending', 'lesson', 'merged', 'code', 'environment'] as const;
export const LESSON_STATUSES = ['active', 'code-card', 'coded', 'deleted'] as const;
/** Lessons that are written out and read by sessions; a coded lesson is guarded by code and stays out. */
export const LIVE_STATUSES = ['active', 'code-card'];
/** A lesson seen this often asks the owner to make it a rule in code. */
export const CARD_AT_COUNT = 2;
export const LESSONS_CACHE = 'lessons';
export const SOUS_FLOW_RULES_KEY = 'sousFlowRules';
export const FLOW_NAME = 'sous';
export const FACTS_NAME = 'facts';
const MAX_TEXT = 1500;
const SIMILAR = 0.8;

export interface SourceInput {
  kind: SourceKind;
  ref: string;
  sessionId?: string | null;
  messageId?: number | null;
  sprint?: string | null;
  ticketKey?: string | null;
  text: string;
  cause: string;
  shouldHave?: string;
  targetKind?: LessonTarget | null;
  targetName?: string | null;
  lesson?: string | null;
}

export interface SourceRow {
  id: string; kind: string; ref: string; sessionId: string | null; messageId: number | null; sprint: string | null; ticketKey: string | null;
  text: string; cause: string; shouldHave: string; targetKind: string | null; targetName: string | null; lesson: string | null;
  status: string; lessonId: string | null; error: string | null; createdAt: Date; processedAt: Date | null;
}

export interface LessonRow {
  id: string; targetKind: string; targetName: string; text: string; cause: string; count: number; ignored: number;
  ticketKeys: string; sessionIds: string; status: string; cardKey: string | null; cardState: string | null; cardSessionId: string | null;
  noticeAt: Date | null; createdAt: Date; updatedAt: Date;
}

export type LessonData = Partial<Omit<LessonRow, 'id' | 'createdAt' | 'updatedAt'>>;

const oneLine = (value: unknown, max = MAX_TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sha = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16);
export const jsonList = (raw: string | null | undefined): string[] => {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

/** A target name as files and prompts use it: lower case for everything but code and facts topics stay readable. */
export function targetName(kind: string, name: string | null | undefined): string {
  const value = oneLine(name, 120);
  if (kind === 'flow') return FLOW_NAME;
  if (kind === 'fact') return value ? value.toLowerCase() : 'workspace';
  if (kind === 'code') return value || 'code';
  return value.toLowerCase();
}

export function parseTarget(kind: unknown, name: unknown): { kind: LessonTarget; name: string } {
  if (!(LESSON_TARGETS as readonly string[]).includes(String(kind))) throw new LessonInputError(`The target kind must be one of ${LESSON_TARGETS.join(', ')}`);
  const clean = targetName(String(kind), typeof name === 'string' ? name : '');
  if (['skill', 'agent', 'repo'].includes(String(kind)) && !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(clean)) throw new LessonInputError('A skill, agent or repo target is a plain name such as demo-video');
  return { kind: kind as LessonTarget, name: clean };
}

// ---- Similar lessons ----------------------------------------------------------------------------------------------

export const normalizeText = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordsOf = (text: string) => new Set(normalizeText(text).split(' ').filter((word) => word.length > 2 || /\d/.test(word)));

/** The same text after normalizing, or word sets that overlap by 80% or more (Jaccard). Deterministic, no model. */
export function similarText(a: string, b: string): boolean {
  if (normalizeText(a) === normalizeText(b)) return true;
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (!left.size || !right.size) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= SIMILAR;
}

/** The live lesson a derived lesson merges into: same target, same cause (any cause for lesson-ignored), similar text. */
export function findSimilar(lessons: LessonRow[], target: { kind: string; name: string }, cause: string, text: string): LessonRow | null {
  return lessons.find((lesson) => LIVE_STATUSES.includes(lesson.status)
    && lesson.targetKind === target.kind && lesson.targetName.toLowerCase() === target.name.toLowerCase()
    && (cause === 'lesson-ignored' || lesson.cause === cause)
    && similarText(lesson.text, text)) ?? null;
}

// ---- Sources ------------------------------------------------------------------------------------------------------

export interface JudgeFindingLike {
  messageId: number | null; cause: string; text: string; shouldHave: string; call: string;
  target?: { kind: string; name: string } | null; lesson?: string | null;
}

/** The findings of one Judge session result Judge called a mistake; a finding Judge called not a mistake teaches nothing. */
export function judgeSessionSources(sessionId: string, ticketKey: string | null, findings: JudgeFindingLike[]): SourceInput[] {
  return findings.filter((finding) => finding.call === 'mistake').map((finding) => {
    const target = finding.cause !== 'environment' && finding.target && (LESSON_TARGETS as readonly string[]).includes(finding.target.kind) ? finding.target : null;
    return {
      kind: 'judge-session' as const,
      ref: `judge:${sessionId}:${sha(`${finding.cause}|${normalizeText(finding.text)}`)}`,
      sessionId,
      messageId: finding.messageId,
      ticketKey,
      text: oneLine(finding.text),
      cause: finding.cause,
      shouldHave: oneLine(finding.shouldHave),
      targetKind: target ? target.kind as LessonTarget : null,
      targetName: target ? targetName(target.kind, target.name) : null,
      lesson: target && finding.lesson ? oneLine(finding.lesson) : null,
    };
  });
}

const KEY_IN_TEXT = /\b[A-Z][A-Z0-9]+-\d+\b/;
const RETRO_TARGET: Record<string, { kind: LessonTarget; name: string }> = {
  memory: { kind: 'fact', name: 'workspace' },
  kit: { kind: 'flow', name: FLOW_NAME },
  dock: { kind: 'code', name: 'dock' },
  note: { kind: 'flow', name: FLOW_NAME },
  'qa-agent': { kind: 'fact', name: 'qa-agent' },
};

/** Every Problem and Try line of the Judge sprint summary. A Try names where it goes (dest); a Problem is a sous flow lesson. */
export function judgeSprintSources(sprint: string, items: Array<{ kind: string; text: string; evidence: string[]; dest: string; source: string }>): SourceInput[] {
  return items.filter((item) => item.source === 'judge' && (item.kind === 'problem' || item.kind === 'try')).map((item) => {
    const target = item.kind === 'try' ? RETRO_TARGET[item.dest] ?? RETRO_TARGET.note : RETRO_TARGET.note;
    const ticketKey = item.evidence.map((line) => KEY_IN_TEXT.exec(line)?.[0]).find(Boolean) ?? null;
    return {
      kind: 'judge-sprint' as const,
      ref: `judge-sprint:${sprint}:${item.kind}:${sha(normalizeText(item.text))}`,
      sprint,
      ticketKey,
      text: oneLine(`${item.kind === 'try' ? 'Try' : 'Problem'}: ${item.text} (${item.evidence.slice(0, 3).join('; ')})`),
      cause: `sprint-${item.kind}`,
      shouldHave: '',
      targetKind: target.kind,
      targetName: target.name,
      lesson: oneLine(item.text),
    };
  });
}

export interface LedgerLike {
  key: string; kind: string; stage: string; finished?: boolean;
  prBe?: string | null; prFe?: string | null; pullRequests?: Array<{ url: string; repo?: string }>;
  failures: Array<{ at: string; type: string; what: string | null; evidence: string; attempt: number }>;
  findings: Array<{ at: string; severity: string; text: string; resolvedAt: string | null }>;
  issues: Array<{ n: number; type: string; text: string; level: string }>;
  decisions: Array<{ n: number; text: string; status: string; supersededBy: number | null; by?: string | null }>;
  rounds: { used: number; max: number } | null;
  closing: { fixRounds: number } | null;
}

/** The repos of a ticket: from its pull request links (owner/repo/pull/n) and its owner-fe / owner-be labels. */
export function ticketRepos(run: Pick<LedgerLike, 'prBe' | 'prFe' | 'pullRequests'> | null, labels: string[] = [], repoOf: { be: string; fe: string } = DEFAULT_REPOS): string[] {
  const repos = new Set<string>();
  const urls = [run?.prBe, run?.prFe, ...(run?.pullRequests ?? []).map((pr) => pr.url)].filter((url): url is string => typeof url === 'string');
  for (const url of urls) {
    const match = /github\.com\/[^/]+\/([^/]+)\/pull\//i.exec(url);
    if (match) repos.add(match[1].toLowerCase());
  }
  for (const label of labels.map((item) => item.toLowerCase())) {
    if (label === 'owner-be' || label === 'owner-fe-be' || label === 'owner-be-fe') repos.add(repoOf.be);
    if (label === 'owner-fe' || label === 'owner-fe-be' || label === 'owner-be-fe') repos.add(repoOf.fe);
  }
  return [...repos].sort();
}

export const DEFAULT_REPOS = { be: 'ms-admin-worker-backend', fe: 'ms-client-dashboard-frontend' };
const ENV_FAILURES = new Set(['env', 'permission', 'transient']);

/**
 * What a closed ticket run teaches, from the data `retro.cjs data` reads: failures, review findings that still stand, issues that
 * went up to the owner, superseded decisions, and more than one review round. A review run's findings are about a teammate's code
 * and stay out. A superseded decision shares its ref with the owner correction of the same decision, so it is kept once.
 */
export function ledgerSources(run: LedgerLike): SourceInput[] {
  const key = run.key;
  const repos = ticketRepos(run);
  const where = repos.length === 1 ? { targetKind: 'repo' as const, targetName: repos[0] } : { targetKind: 'flow' as const, targetName: FLOW_NAME };
  const out: SourceInput[] = [];
  for (const failure of run.failures) {
    const what = oneLine(failure.what || failure.evidence, 600);
    const env = ENV_FAILURES.has(failure.type);
    out.push({
      kind: 'ledger', ref: `ledger:${key}:failure:${failure.at}:${failure.attempt}`, ticketKey: key,
      text: `${key} ${failure.type} failure (attempt ${failure.attempt}): ${what}`,
      cause: env ? 'environment' : failure.type === 'spec' ? 'misread-ac-scope' : 'wrong-code',
      ...(env ? {} : { ...where, lesson: `Before verify, check for the ${failure.type} failure ${key} hit: ${what}` }),
    });
  }
  if (run.kind !== 'review') {
    for (const finding of run.findings.filter((item) => !item.resolvedAt)) {
      const text = oneLine(finding.text, 600);
      out.push({
        kind: 'ledger', ref: `ledger:${key}:finding:${finding.at}:${sha(text)}`, ticketKey: key,
        text: `${key} reviewer finding (${finding.severity}): ${text}`,
        cause: finding.severity === 'blocker' ? 'wrong-code' : 'self-inflicted-rework',
        ...where, lesson: `Check before the final review, a reviewer found it on ${key}: ${text}`,
      });
    }
  }
  for (const issue of run.issues.filter((item) => item.level === 'owner')) {
    const text = oneLine(issue.text, 600);
    out.push({
      kind: 'ledger', ref: `ledger:${key}:issue:${issue.n}`, ticketKey: key,
      text: `${key} ${issue.type} I-${issue.n} went to the owner: ${text}`,
      cause: 'stopped-with-way-out', targetKind: 'flow', targetName: FLOW_NAME,
      lesson: `Settle a question like ${key} I-${issue.n} from the ticket, contract and code before it goes to the owner: ${text}`,
    });
  }
  for (const decision of run.decisions.filter((item) => item.status === 'SUPERSEDED')) {
    const next = run.decisions.find((item) => item.n === decision.supersededBy);
    const text = oneLine(decision.text, 400);
    out.push({
      kind: 'ledger', ref: `decision:${key}:D-${decision.n}`, ticketKey: key,
      text: `${key} D-${decision.n} "${text}" was superseded${next ? ` by D-${next.n} "${oneLine(next.text, 400)}"` : ''}`,
      cause: 'misread-ac-scope', targetKind: 'flow', targetName: FLOW_NAME,
      lesson: `On ${key} the decision "${text}" was replaced${next ? ` by "${oneLine(next.text, 400)}"` : ''}; read the ticket, contract and owner decisions again before deciding a question like it.`,
    });
  }
  const rounds = Math.max(run.closing?.fixRounds ?? 0, run.rounds?.used ?? 0);
  if (run.kind !== 'review' && rounds > 1) {
    out.push({
      kind: 'ledger', ref: `ledger:${key}:rounds`, ticketKey: key,
      text: `${key} needed ${rounds} review rounds`,
      cause: 'self-inflicted-rework', targetKind: 'flow', targetName: FLOW_NAME,
      lesson: `${key} needed ${rounds} review rounds: run the reviewer's checks (every AC line to path:line, blast radius) on each task before FINAL.`,
    });
  }
  return out;
}

/** The owner changed a GUESS decision in DOCK: the agent's guess was wrong. Its ref is the decision's, like the ledger's superseded line. */
export function ownerCorrectionSource(key: string, decision: { n: number; text: string }, choice: string): SourceInput {
  const guess = oneLine(decision.text, 400);
  const answer = oneLine(choice, 400);
  return {
    kind: 'owner-correction', ref: `decision:${key}:D-${decision.n}`, ticketKey: key,
    text: `The owner rejected GUESS D-${decision.n} on ${key}: "${guess}"; the owner chose "${answer}"`,
    cause: 'misread-ac-scope', targetKind: 'flow', targetName: FLOW_NAME,
    lesson: `On ${key} the owner rejected the guess "${guess}" and chose "${answer}"; when ticket, contract and code do not settle a question like it, escalate instead of guessing.`,
  };
}

/** The target and text a source becomes, or environment when it teaches the agent nothing. */
export function deriveLesson(source: Pick<SourceRow, 'kind' | 'cause' | 'text' | 'shouldHave' | 'targetKind' | 'targetName' | 'lesson'>): { environment: true } | { environment: false; kind: LessonTarget; name: string; text: string } {
  if (source.cause === 'environment') return { environment: true };
  if (source.targetKind && (LESSON_TARGETS as readonly string[]).includes(source.targetKind) && source.lesson) {
    return { environment: false, kind: source.targetKind as LessonTarget, name: targetName(source.targetKind, source.targetName), text: oneLine(source.lesson) };
  }
  return { environment: false, kind: 'flow', name: FLOW_NAME, text: oneLine(source.shouldHave || source.text) };
}

// ---- Files --------------------------------------------------------------------------------------------------------

export const groupOf = (lesson: Pick<LessonRow, 'targetKind' | 'targetName'>) => (lesson.targetKind === 'flow' ? 'flow' : lesson.targetKind === 'fact' ? 'fact' : `${lesson.targetKind}:${lesson.targetName}`);

export function lessonLine(lesson: LessonRow): string {
  const keys = jsonList(lesson.ticketKeys);
  const tags = [`${lesson.count}×`, ...keys, ...(lesson.ignored ? [`dilanggar ${lesson.ignored}×`] : [])];
  return `- (${tags.join(', ')}) ${lesson.text}`;
}

const byCount = (a: LessonRow, b: LessonRow) => b.count - a.count || a.createdAt.getTime() - b.createdAt.getTime();
const live = (lessons: LessonRow[]) => lessons.filter((lesson) => LIVE_STATUSES.includes(lesson.status) && lesson.targetKind !== 'code');

const TARGET_TITLE: Record<string, (name: string) => string> = {
  skill: (name) => `Skill ${name}`,
  agent: (name) => `Agent ${name}`,
  flow: () => 'Sous flow',
  repo: (name) => `Repo ${name}`,
  fact: () => 'Fakta lingkungan',
};

/** One target's file: skills/<name>/lessons.md, kit/lessons/agents/<name>.md, .evidence/lessons/<repo>.md or facts.md. */
export function targetFile(kind: string, name: string, lessons: LessonRow[]): string {
  const rows = live(lessons).filter((lesson) => lesson.targetKind === kind && (kind === 'fact' || lesson.targetName === name)).sort(byCount);
  return [
    `# Pelajaran ${kind === 'fact' ? 'fakta lingkungan' : name}`,
    '',
    'Dibaca sebelum langkah pertama. Ditulis DOCK dari Judge dan ledger tiket; diedit di DOCK › Agents › Lessons.',
    '',
    ...(rows.length ? rows.map(lessonLine) : ['- Belum ada pelajaran.']),
    '',
  ].join('\n');
}

/**
 * The per-ticket file: every live lesson of every skill and agent, the sous flow and the facts, and the repo lessons of the
 * ticket's repos (all repos when none is known yet). Nothing is cut.
 */
export function ticketFile(key: string, repos: string[], lessons: LessonRow[]): string {
  const rows = live(lessons).filter((lesson) => lesson.targetKind !== 'repo' || !repos.length || repos.includes(lesson.targetName)).sort(byCount);
  const order = ['skill', 'agent', 'flow', 'repo', 'fact'];
  const groups = new Map<string, LessonRow[]>();
  for (const lesson of [...rows].sort((a, b) => order.indexOf(a.targetKind) - order.indexOf(b.targetKind) || a.targetName.localeCompare(b.targetName))) {
    const title = TARGET_TITLE[lesson.targetKind]?.(lesson.targetName) ?? lesson.targetKind;
    groups.set(title, [...(groups.get(title) ?? []), lesson]);
  }
  const body = [...groups.entries()].flatMap(([title, list]) => ['', `## ${title}`, '', ...list.sort(byCount).map(lessonLine)]);
  return [
    `# Pelajaran ${key}`,
    '',
    'Ditulis DOCK (Agents › Lessons) dari Judge, ledger tiket dan koreksi owner. Baca semuanya sebelum langkah pertama: guard menolak Edit, Write dan git commit sampai file ini dibaca, dan lagi setiap kali DOCK menambah pelajaran.',
    ...(repos.length ? ['', `Repo tiket: ${repos.join(', ')}`] : []),
    ...(body.length ? body : ['', 'Belum ada pelajaran.']),
    '',
  ].join('\n');
}

export const lessonsDir = (evidenceRoot: string) => path.join(evidenceRoot, 'lessons');
export const ticketLessonsPath = (evidenceRoot: string, key: string) => path.join(lessonsDir(evidenceRoot), `${key}.md`).replace(/\\/g, '/');
export const LESSON_KEY = /^(?:[A-Z][A-Z0-9]+-\d+|CARD-[a-z0-9][a-z0-9-]{0,63})$/;

/** The one prompt line that names the ticket's lessons file. */
export const lessonsLine = (file: string) => `Pelajaran: ${file} — baca file ini sebelum mulai; guard menolak Edit, Write dan git commit sampai file ini dibaca.`;
/** A prompt's lessons line, or nothing when there is no file. */
export const lessonsLines = (file: string | null | undefined) => (file ? [lessonsLine(file)] : []);

// ---- Code cards ---------------------------------------------------------------------------------------------------

export const cardKeyOf = (lesson: Pick<LessonRow, 'id' | 'targetName'>) => {
  const slug = lesson.targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'rule';
  return `CARD-lesson-${slug}-${lesson.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
};

/** The free-form sous work an approved card starts. */
export function cardPrompt(lesson: LessonRow, cardKey: string, file: string | null): string {
  const keys = jsonList(lesson.ticketKeys);
  return [
    `Pakai skill sous: kerjakan ${cardKey}.`,
    ...lessonsLines(file),
    'Free-form work the owner approved in DOCK › Agents › Lessons ("Jadikan aturan di kode"): turn the lesson below into a rule in code, such as a guard, a script, a test or a DOCK check, so a machine refuses the mistake instead of a sentence asking for care.',
    `Lesson (${lesson.targetKind} ${lesson.targetName}, ${lesson.cause}, ${lesson.count}×${lesson.ignored ? `, broken ${lesson.ignored}× after it was read` : ''}${keys.length ? `, ${keys.join(', ')}` : ''}): ${lesson.text}`,
    'Make the smallest change in the repo the rule belongs to (claude-config for the kit, dock for DOCK), with a test, and open a draft pull request; never merge.',
  ].join('\n');
}

// ---- Notices ------------------------------------------------------------------------------------------------------

export interface Notice { title: string; body: string; url: string; tag: string }
export const LESSONS_URL = '/agents?tab=lessons';
export const environmentNotice = (source: Pick<SourceRow, 'id' | 'ticketKey' | 'kind' | 'text'>): Notice => ({
  title: `Environment${source.ticketKey ? ` on ${source.ticketKey}` : ''}`,
  body: source.text.slice(0, 180),
  url: LESSONS_URL,
  tag: `lesson-env-${source.id}`,
});
export const cardNotice = (lesson: Pick<LessonRow, 'id' | 'targetKind' | 'targetName' | 'text' | 'count' | 'ignored'>): Notice => ({
  title: `Make it code? ${lesson.targetKind} ${lesson.targetName}`,
  body: `${lesson.ignored ? `Broken ${lesson.ignored}× after it was read` : `Seen ${lesson.count}×`}: ${lesson.text}`.slice(0, 180),
  url: LESSONS_URL,
  tag: `lesson-card-${lesson.id}`,
});
