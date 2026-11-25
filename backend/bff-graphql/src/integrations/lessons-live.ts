// Agents › Lessons wired to the workspace: the Judge result and sprint summary, closed ledgers and owner corrections feed the
// queue; lessons go to the kit bridge, the Sous flow rules and .evidence/lessons; every ticket session gets its lessons file.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JiraAPI } from '../datasources/JiraAPI';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { agentBridge } from './agents-live';
import { defaultBlackboardRoot } from './blackboard';
import { CHAT_MACHINE, chatService } from './chat';
import { judgeQueue } from './judge-live';
import { lessonHooks } from './lessons-hook';
import { LessonService } from './lesson-service';
import {
  LESSON_KEY, SOUS_FLOW_RULES_KEY, judgeSessionSources, judgeSprintSources, ledgerSources, lessonsDir, ownerCorrectionSource, ticketRepos,
  type LessonRow, type SourceRow,
} from './lessons';
import { orchestratorService } from './orchestrator';
import { eventPush } from './push';

const storage = new StorageService();
const jira = new JiraAPI();
const LABELS_MS = 10 * 60 * 1000;
const labelCache = new Map<string, { at: number; labels: string[] }>();

/** The workspace's .evidence root: DOCK_EVIDENCE_DIR, else the folder that holds the blackboard. */
export const evidenceRoot = () => process.env.DOCK_EVIDENCE_DIR || path.dirname(defaultBlackboardRoot());

async function labelsOf(key: string): Promise<string[]> {
  const cached = labelCache.get(key);
  if (cached && Date.now() - cached.at < LABELS_MS) return cached.labels;
  const labels = (await jira.getTicket(key).catch(() => null))?.labels ?? cached?.labels ?? [];
  labelCache.set(key, { at: Date.now(), labels });
  return labels;
}

async function writeIfChanged(file: string, text: string): Promise<boolean> {
  const before = await readFile(file, 'utf8').catch(() => null);
  if (before === text) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return true;
}

export const lessonService = new LessonService({
  store: {
    addLessonSource: (input) => storage.addLessonSource(input) as Promise<SourceRow | null>,
    getLessonSources: (where) => storage.getLessonSources(where) as Promise<SourceRow[]>,
    updateLessonSource: (id, data) => storage.updateLessonSource(id, data),
    getLessons: (where) => storage.getLessons(where) as Promise<LessonRow[]>,
    getLesson: (id) => storage.getLesson(id) as Promise<LessonRow | null>,
    createLesson: (data) => storage.createLesson(data) as Promise<LessonRow>,
    updateLesson: (id, data) => storage.updateLesson(id, data) as Promise<LessonRow>,
    getCache: (namespace, key) => storage.getCache(namespace, key),
    upsertCache: (namespace, key, value, ttl) => storage.upsertCache(namespace, key, value, ttl),
  },
  now: () => new Date(),
  evidenceRoot,
  writeKitFile: async (kind, name, text) => {
    const result = await agentBridge.putLessonsFile(CHAT_MACHINE, kind, name, text);
    if (!result.ok) throw new Error(result.error ?? 'The kit refused the lessons file');
  },
  writeFlowRules: async (lines) => { await storage.upsertSetting(SOUS_FLOW_RULES_KEY, JSON.stringify(lines), 'Sous flow rules written from Agents › Lessons'); },
  writeFile: writeIfChanged,
  ticketFiles: async () => (await readdir(lessonsDir(evidenceRoot())).catch(() => [] as string[])).filter((name) => name.endsWith('.md') && LESSON_KEY.test(name.slice(0, -3))).map((name) => name.slice(0, -3)),
  ticketRepos: async (key) => ticketRepos(await orchestratorService.get(key).catch(() => null), await labelsOf(key)),
  notify: (notice) => eventPush.send('needsYou', notice),
  startCard: async (cardKey, prompt) => {
    const machines = await orchestratorService.machines();
    const session = await chatService.createSession({ title: cardKey, ticketKey: cardKey, machine: CHAT_MACHINE });
    await chatService.sendMessage(session.id, prompt, machines);
    return session.id;
  },
});

const failed = (what: string) => (error: unknown) => console.warn(`[Lessons] ${what}:`, error instanceof Error ? error.message : 'unknown error');

/** Only the workspace DOCK runs chat sessions and Judge, so only it keeps lessons. */
export function startLessons(): void {
  if (dockMode() !== 'workspace') return;
  lessonHooks.file = (key) => lessonService.prepareTicket(key);
  chatService.lessonsFile = (key) => lessonService.prepareTicket(key);
  lessonHooks.retroDraft = (sprint, items) => lessonService.ingest(judgeSprintSources(sprint, items));
  lessonHooks.ownerChanged = async (key, changes) => {
    const guesses = changes.filter((change) => change.status === 'GUESS');
    if (!guesses.length) return;
    const run = await orchestratorService.get(key);
    const sources = guesses.flatMap((change) => {
      const decision = run?.decisions.find((item) => item.n === change.n);
      return decision ? [ownerCorrectionSource(key, decision, change.choice)] : [];
    });
    await lessonService.ingest(sources);
  };
  judgeQueue.onResult = (result, ticketKey) => {
    void lessonService.ingest(judgeSessionSources(result.sessionId, ticketKey, result.findings)).catch(failed('Judge findings not ingested'));
  };
  const previousLedger = orchestratorService.onLedger;
  orchestratorService.onLedger = (run) => {
    previousLedger(run);
    if (!run.finished && run.stage !== 'done') return;
    void lessonService.ingest(ledgerSources(run)).then(() => lessonService.cardFinished(run)).catch(failed(`ledger ${run.key} not ingested`));
  };
}

/** The periodic pass: a write the bridge missed is retried, a source left pending is processed, and pending cards are told daily. */
export async function lessonsTick(): Promise<void> {
  if (dockMode() !== 'workspace') return;
  await lessonService.process().catch(failed('processing failed'));
  await lessonService.writeOut().catch(failed('writing failed'));
  await lessonService.remind().catch(failed('reminder failed'));
}
