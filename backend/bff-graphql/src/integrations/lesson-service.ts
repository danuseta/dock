// The lesson queue: sources in, every one processed to a final status, lessons merged and counted, written to their targets and
// gathered per ticket. A lesson broken after it was read, or seen twice, asks the owner to make it code; the card waits for the
// owner's approval and only the Approve action starts it. Storage, files, the kit bridge and notices are dependencies.
import {
  CARD_AT_COUNT, FACTS_NAME, LessonInputError, LESSONS_CACHE, LESSON_KEY, LIVE_STATUSES, cardKeyOf, cardNotice, cardPrompt, deriveLesson, environmentNotice, findSimilar,
  groupOf, jsonList, lessonsDir, parseTarget, targetFile, ticketFile, ticketLessonsPath,
  type LessonData, type LessonRow, type Notice, type SourceInput, type SourceRow,
} from './lessons';
import path from 'node:path';

const DIRTY_KEY = 'dirty';
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const MAX_TEXT = 1500;
const wibDay = (at: Date) => new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
const merge = (raw: string, add: Array<string | null | undefined>) => JSON.stringify([...new Set([...jsonList(raw), ...add.filter((item): item is string => !!item)])].slice(-50));

export interface LessonStore {
  /** Stores a source; null when a source with the same ref exists, so a finding posted twice is kept once. */
  addLessonSource(input: SourceInput): Promise<SourceRow | null>;
  getLessonSources(where?: { statuses?: string[]; lessonIds?: string[] }): Promise<SourceRow[]>;
  updateLessonSource(id: string, data: Partial<Pick<SourceRow, 'status' | 'lessonId' | 'error' | 'processedAt'>>): Promise<unknown>;
  getLessons(where?: { statuses?: string[] }): Promise<LessonRow[]>;
  getLesson(id: string): Promise<LessonRow | null>;
  createLesson(data: LessonData & Pick<LessonRow, 'targetKind' | 'targetName' | 'text' | 'cause'>): Promise<LessonRow>;
  updateLesson(id: string, data: LessonData): Promise<LessonRow>;
  getCache(namespace: string, key: string): Promise<unknown>;
  upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): Promise<unknown>;
}

export interface LessonDeps {
  store: LessonStore;
  now(): Date;
  /** The .evidence root of the workspace; lessons live in its lessons/ folder. */
  evidenceRoot(): string;
  /** skills/<name>/lessons.md or kit/lessons/agents/<name>.md through the kit bridge; throws when the bridge cannot write. */
  writeKitFile(kind: 'skill' | 'agent', name: string, text: string): Promise<void>;
  /** Writes a file when its text differs; true when it changed. */
  writeFile(file: string, text: string): Promise<boolean>;
  /** The keys that have a per-ticket lessons file. */
  ticketFiles(): Promise<string[]>;
  /** The repos of a ticket, from its pull requests and owner-fe/owner-be labels. */
  ticketRepos(key: string): Promise<string[]>;
  notify(notice: Notice): Promise<unknown>;
  /** Opens the sous session of an approved card; resolves to its session id. */
  startCard(cardKey: string, prompt: string): Promise<string>;
}

export interface LessonView {
  id: string; targetKind: string; targetName: string; text: string; textId: string | null; cause: string; count: number; ignored: number; ticketKeys: string[]; sessionIds: string[];
  status: string; cardKey: string | null; cardState: string | null; cardSessionId: string | null; writtenTo: string; createdAt: string; updatedAt: string;
  sources: Array<{ id: string; kind: string; ref: string; sessionId: string | null; messageId: number | null; ticketKey: string | null; text: string; cause: string; status: string; createdAt: string }>;
}

export const writtenTo = (lesson: Pick<LessonRow, 'targetKind' | 'targetName'>) => ({
  skill: `skills/${lesson.targetName}/lessons.md`,
  agent: `kit/lessons/agents/${lesson.targetName}.md`,
  flow: '.evidence/lessons/<KEY>.md',
  repo: `.evidence/lessons/${lesson.targetName}.md`,
  fact: `.evidence/lessons/${FACTS_NAME}.md`,
  code: 'a "make it code" card',
} as Record<string, string>)[lesson.targetKind] ?? lesson.targetKind;

export class LessonService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LessonDeps) {}

  /** One change at a time: ingests from several hooks never interleave. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Stores new sources and processes every pending one. */
  ingest(sources: SourceInput[]): Promise<{ added: number; processed: number }> {
    return this.serial(async () => {
      let added = 0;
      for (const source of sources) if (await this.deps.store.addLessonSource(source)) added += 1;
      const processed = await this.processPending();
      return { added, processed };
    });
  }

  process(): Promise<number> {
    return this.serial(() => this.processPending());
  }

  private async processPending(): Promise<number> {
    const { store } = this.deps;
    const pending = await store.getLessonSources({ statuses: ['pending'] });
    if (!pending.length) return 0;
    const dirty = new Set<string>();
    let lessons = await store.getLessons({ statuses: LIVE_STATUSES });
    let done = 0;
    for (const source of pending) {
      try {
        const derived = deriveLesson(source);
        const now = this.deps.now();
        if (derived.environment) {
          await store.updateLessonSource(source.id, { status: 'environment', processedAt: now, error: null });
          await this.deps.notify(environmentNotice(source)).catch(() => undefined);
        } else if (derived.kind === 'code') {
          const lesson = await this.requestCard(await store.createLesson({ targetKind: 'code', targetName: derived.name, text: derived.text, textId: derived.textId, cause: source.cause, ticketKeys: merge('[]', [source.ticketKey]), sessionIds: merge('[]', [source.sessionId]) }));
          lessons = [...lessons, lesson];
          await store.updateLessonSource(source.id, { status: 'code', lessonId: lesson.id, processedAt: now, error: null });
        } else {
          const ignored = source.cause === 'lesson-ignored';
          const match = findSimilar(lessons, derived, source.cause, derived.text);
          let lesson: LessonRow;
          if (match) {
            lesson = await store.updateLesson(match.id, { ...(!match.textId && derived.textId ? { textId: derived.textId } : {}), count: match.count + 1, ignored: match.ignored + (ignored ? 1 : 0), ticketKeys: merge(match.ticketKeys, [source.ticketKey]), sessionIds: merge(match.sessionIds, [source.sessionId]) });
            await store.updateLessonSource(source.id, { status: 'merged', lessonId: lesson.id, processedAt: now, error: null });
          } else {
            lesson = await store.createLesson({ targetKind: derived.kind, targetName: derived.name, text: derived.text, textId: derived.textId, cause: source.cause, ignored: ignored ? 1 : 0, ticketKeys: merge('[]', [source.ticketKey]), sessionIds: merge('[]', [source.sessionId]) });
            await store.updateLessonSource(source.id, { status: 'lesson', lessonId: lesson.id, processedAt: now, error: null });
          }
          if (lesson.status === 'active' && (ignored || lesson.count >= CARD_AT_COUNT)) lesson = await this.requestCard(lesson);
          lessons = [...lessons.filter((item) => item.id !== lesson.id), lesson];
          dirty.add(groupOf(lesson));
        }
        done += 1;
      } catch (error) {
        await store.updateLessonSource(source.id, { error: (error instanceof Error ? error.message : 'unknown error').slice(0, 500) }).catch(() => undefined);
      }
    }
    if (dirty.size) await this.writeOut([...dirty]);
    return done;
  }

  /** A "make it code" card for the lesson: pending until the owner approves it; the owner is told now and once a day after. */
  private async requestCard(lesson: LessonRow): Promise<LessonRow> {
    if (lesson.cardKey && lesson.cardState) return lesson;
    const updated = await this.deps.store.updateLesson(lesson.id, { status: 'code-card', cardKey: lesson.cardKey ?? cardKeyOf(lesson), cardState: 'pending', noticeAt: this.deps.now() });
    await this.deps.notify(cardNotice(updated)).catch(() => undefined);
    return updated;
  }

  /** Writes the targets marked dirty (and the ones a failed write left), then every per-ticket file. */
  async writeOut(groups: string[] = []): Promise<{ written: string[]; failed: string[] }> {
    const { store } = this.deps;
    const saved = await store.getCache(LESSONS_CACHE, DIRTY_KEY);
    const todo = [...new Set([...(Array.isArray(saved) ? saved.map(String) : []), ...groups])];
    const lessons = await store.getLessons();
    const written: string[] = [];
    const failed: string[] = [];
    const root = lessonsDir(this.deps.evidenceRoot());
    for (const group of todo) {
      try {
        if (group === 'fact') await this.deps.writeFile(path.join(root, `${FACTS_NAME}.md`), targetFile('fact', FACTS_NAME, lessons));
        else {
          const at = group.indexOf(':');
          const kind = group.slice(0, at);
          const name = group.slice(at + 1);
          if (kind === 'skill' || kind === 'agent') await this.deps.writeKitFile(kind, name, targetFile(kind, name, lessons));
          else if (kind === 'repo') await this.deps.writeFile(path.join(root, `${name}.md`), targetFile('repo', name, lessons));
        }
        written.push(group);
      } catch {
        failed.push(group);
      }
    }
    await store.upsertCache(LESSONS_CACHE, DIRTY_KEY, failed, 0);
    await this.refreshTicketFiles(lessons);
    return { written, failed };
  }

  /** The ticket's lessons file, written when its text changed (so a read stays valid), and its absolute path. */
  async prepareTicket(key: string, lessons?: LessonRow[]): Promise<string | null> {
    if (!LESSON_KEY.test(key)) return null;
    const file = ticketLessonsPath(this.deps.evidenceRoot(), key);
    const repos = key.startsWith('CARD-') ? [] : await this.deps.ticketRepos(key).catch(() => []);
    await this.deps.writeFile(file, ticketFile(key, repos, lessons ?? await this.deps.store.getLessons({ statuses: LIVE_STATUSES })));
    return file;
  }

  private async refreshTicketFiles(lessons: LessonRow[]) {
    for (const key of await this.deps.ticketFiles().catch(() => [])) await this.prepareTicket(key, lessons).catch(() => undefined);
  }

  // ---- Owner actions -------------------------------------------------------------------------------------------------

  private async live(id: string): Promise<LessonRow> {
    const lesson = await this.deps.store.getLesson(id);
    if (!lesson || lesson.status === 'deleted') throw new LessonInputError('No such lesson');
    return lesson;
  }

  edit(id: string, text: string, textId?: string | null): Promise<LessonView> {
    return this.serial(async () => {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!value || value.length > MAX_TEXT) throw new LessonInputError(`A lesson is one sentence of at most ${MAX_TEXT} characters`);
      const translation = textId === undefined ? undefined : String(textId ?? '').replace(/\s+/g, ' ').trim();
      if (translation && translation.length > MAX_TEXT) throw new LessonInputError(`A translation is one sentence of at most ${MAX_TEXT} characters`);
      const lesson = await this.deps.store.updateLesson((await this.live(id)).id, { text: value, ...(translation === undefined ? {} : { textId: translation || null }) });
      await this.writeOut([groupOf(lesson)]);
      return this.viewOf(lesson);
    });
  }

  retarget(id: string, kind: unknown, name: unknown): Promise<LessonView> {
    return this.serial(async () => {
      const before = await this.live(id);
      const target = parseTarget(kind, name);
      let lesson = await this.deps.store.updateLesson(id, { targetKind: target.kind, targetName: target.name });
      if (target.kind === 'code' && lesson.status === 'active') lesson = await this.requestCard(lesson);
      await this.writeOut([groupOf(before), groupOf(lesson)]);
      return this.viewOf(lesson);
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const lesson = await this.live(id);
      await this.deps.store.updateLesson(id, { status: 'deleted', cardState: lesson.cardState === 'pending' ? null : lesson.cardState });
      await this.writeOut([groupOf(lesson)]);
      return true;
    });
  }

  /** "Jadikan aturan di kode": the owner's approval starts the card's sous session. */
  approveCard(id: string): Promise<LessonView> {
    return this.serial(async () => {
      const lesson = await this.live(id);
      if (lesson.status === 'coded') throw new LessonInputError('This lesson is already guarded by code');
      if (lesson.cardState === 'started') throw new LessonInputError(`${lesson.cardKey} is running already`);
      const cardKey = lesson.cardKey ?? cardKeyOf(lesson);
      const file = await this.prepareTicket(cardKey).catch(() => null);
      const sessionId = await this.deps.startCard(cardKey, cardPrompt(lesson, cardKey, file));
      return this.viewOf(await this.deps.store.updateLesson(id, { status: 'code-card', cardKey, cardState: 'started', cardSessionId: sessionId }));
    });
  }

  /** A card's ledger reached done: its lesson is guarded by code now and leaves the files. */
  cardFinished(run: { key: string; stage: string; finished?: boolean }): Promise<boolean> {
    if (!run.key.startsWith('CARD-lesson-') || !(run.finished || run.stage === 'done')) return Promise.resolve(false);
    return this.serial(async () => {
      const lesson = (await this.deps.store.getLessons({ statuses: ['code-card'] })).find((item) => item.cardKey === run.key);
      if (!lesson || lesson.cardState === 'done') return false;
      await this.deps.store.updateLesson(lesson.id, { status: 'coded', cardState: 'done' });
      await this.writeOut([groupOf(lesson)]);
      return true;
    });
  }

  /** A pending card is told again once a WIB day until the owner answers it. */
  async remind(): Promise<number> {
    const now = this.deps.now();
    let sent = 0;
    for (const lesson of await this.deps.store.getLessons({ statuses: ['code-card'] })) {
      if (lesson.cardState !== 'pending' || (lesson.noticeAt && wibDay(lesson.noticeAt) >= wibDay(now))) continue;
      await this.deps.notify(cardNotice(lesson)).catch(() => undefined);
      await this.deps.store.updateLesson(lesson.id, { noticeAt: now });
      sent += 1;
    }
    return sent;
  }

  // ---- Views ---------------------------------------------------------------------------------------------------------

  private async viewOf(lesson: LessonRow, sources?: SourceRow[]): Promise<LessonView> {
    const own = sources ?? await this.deps.store.getLessonSources({ lessonIds: [lesson.id] });
    return {
      id: lesson.id, targetKind: lesson.targetKind, targetName: lesson.targetName, text: lesson.text, textId: lesson.textId, cause: lesson.cause, count: lesson.count, ignored: lesson.ignored,
      ticketKeys: jsonList(lesson.ticketKeys), sessionIds: jsonList(lesson.sessionIds), status: lesson.status, cardKey: lesson.cardKey, cardState: lesson.cardState,
      cardSessionId: lesson.cardSessionId, writtenTo: writtenTo(lesson), createdAt: lesson.createdAt.toISOString(), updatedAt: lesson.updatedAt.toISOString(),
      sources: own.map((source) => ({ id: source.id, kind: source.kind, ref: source.ref, sessionId: source.sessionId, messageId: source.messageId, ticketKey: source.ticketKey, text: source.text, cause: source.cause, status: source.status, createdAt: source.createdAt.toISOString() })),
    };
  }

  /** Agents › Lessons: the lessons that are not deleted, newest change first, and the source counts; unprocessed is the number to get to 0. */
  async overview() {
    const [lessons, sources] = await Promise.all([this.deps.store.getLessons({ statuses: [...LIVE_STATUSES, 'coded'] }), this.deps.store.getLessonSources()]);
    const byLesson = new Map<string, SourceRow[]>();
    for (const source of sources) if (source.lessonId) byLesson.set(source.lessonId, [...(byLesson.get(source.lessonId) ?? []), source]);
    const counts = new Map<string, number>();
    for (const source of sources) counts.set(source.status, (counts.get(source.status) ?? 0) + 1);
    return {
      unprocessed: counts.get('pending') ?? 0,
      sources: sources.length,
      byStatus: ['pending', 'lesson', 'merged', 'code', 'environment'].map((status) => ({ status, count: counts.get(status) ?? 0 })),
      environment: sources.filter((source) => source.status === 'environment').slice(-20).reverse().map((source) => ({ id: source.id, kind: source.kind, ticketKey: source.ticketKey, text: source.text, createdAt: source.createdAt.toISOString() })),
      failed: sources.filter((source) => source.status === 'pending' && source.error).map((source) => ({ id: source.id, text: source.text, error: source.error })),
      lessons: await Promise.all([...lessons].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map((lesson) => this.viewOf(lesson, byLesson.get(lesson.id) ?? []))),
    };
  }
}
