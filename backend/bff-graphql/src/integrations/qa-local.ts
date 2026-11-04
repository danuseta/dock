import type { Orchestration } from './orchestrator';

export type QaTcState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked';
export type QaRunState = 'running' | 'done' | 'failed';

export interface QaStep { id: string; label: string; state: string }
export interface QaTc { id: string; title: string; ac: number[]; state: QaTcState; seconds: number | null; video: string | null; note: string | null }
export interface QaRun {
  key: string;
  runId: string;
  state: QaRunState;
  step: string;
  steps: QaStep[];
  tcs: QaTc[];
  verdict: string | null;
  rule: string | null;
  passed: number;
  failed: number;
  blocked: number;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}
export interface QaTrigger { prs: string[]; sessionId: string | null; at: string; error: string | null }

export const RUN_ID = /^\d{8}T\d{6}Z$/;
/** How old a ledger with pull requests may be and still start QA. */
export const QA_WINDOW_MS = 6 * 60 * 60 * 1000;
const TC_STATES = new Set<QaTcState>(['pending', 'running', 'passed', 'failed', 'skipped', 'blocked']);
const STEP_LABELS: Array<[string, string]> = [['stack', 'Stack'], ['login', 'Login'], ['tests', 'Tests'], ['judge', 'Verdict']];

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function counted(tcs: QaTc[]) {
  return {
    passed: tcs.filter((tc) => tc.state === 'passed').length,
    failed: tcs.filter((tc) => tc.state === 'failed').length,
    blocked: tcs.filter((tc) => tc.state === 'blocked' || tc.state === 'skipped').length,
  };
}

/**
 * `progress.json` that `qonflo-qa-local` keeps while it runs. A run still marked running whose process is gone ended
 * without writing its result, so it shows as failed.
 */
export function parseProgress(text: string, alive: (pid: number) => boolean): QaRun | null {
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(text));
  } catch {
    return null;
  }
  const key = str(raw.key);
  const runId = str(raw.runId);
  if (!key || !runId) return null;
  const tcs: QaTc[] = (Array.isArray(raw.tcs) ? raw.tcs : []).map((item) => {
    const tc = record(item);
    const state = String(tc.state) as QaTcState;
    return {
      id: String(tc.id ?? ''),
      title: String(tc.title ?? ''),
      ac: Array.isArray(tc.ac) ? tc.ac.filter((n): n is number => typeof n === 'number') : [],
      state: TC_STATES.has(state) ? state : 'pending',
      seconds: num(tc.seconds),
      video: str(tc.video),
      note: str(tc.note),
    };
  });
  const steps: QaStep[] = (Array.isArray(raw.steps) ? raw.steps : []).map((item) => {
    const step = record(item);
    return { id: String(step.id ?? ''), label: String(step.label ?? step.id ?? ''), state: String(step.state ?? 'pending') };
  });
  let state: QaRunState = raw.state === 'done' ? 'done' : raw.state === 'failed' ? 'failed' : 'running';
  let error = str(raw.error);
  const pid = num(raw.pid);
  if (state === 'running' && pid !== null && !alive(pid)) {
    state = 'failed';
    error = error ?? 'The run stopped before it wrote a result';
  }
  return {
    key,
    runId,
    state,
    step: String(raw.step ?? ''),
    steps,
    tcs,
    verdict: str(raw.verdict),
    rule: str(raw.rule),
    ...counted(tcs),
    error,
    startedAt: str(raw.startedAt),
    updatedAt: str(raw.updatedAt),
    finishedAt: str(raw.finishedAt),
  };
}

/** A run from before `progress.json` existed, read from its `results.json`. */
export function parseResults(text: string): QaRun | null {
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(text));
  } catch {
    return null;
  }
  const key = str(raw.key);
  const runId = str(raw.runId);
  if (!key || !runId) return null;
  const tcs: QaTc[] = (Array.isArray(raw.tcs) ? raw.tcs : []).map((item) => {
    const tc = record(item);
    const status = String(tc.qaStatus ?? '');
    const note = str(tc.notes) ?? str(tc.finding) ?? str(tc.error);
    return {
      id: String(tc.id ?? ''),
      title: String(tc.title ?? ''),
      ac: Array.isArray(tc.ac) ? tc.ac.filter((n): n is number => typeof n === 'number') : [],
      state: status.startsWith('Passed') ? 'passed' : status === 'Failed' ? 'failed' : 'blocked',
      seconds: num(tc.durationMs) === null ? null : (tc.durationMs as number) / 1000,
      video: str(tc.video),
      note: note ? note.split('\n')[0].slice(0, 300) : null,
    };
  });
  const verdict = record(raw.verdict);
  const infraError = str(raw.infraError);
  return {
    key,
    runId,
    state: infraError ? 'failed' : 'done',
    step: 'judge',
    steps: STEP_LABELS.map(([id, label]) => ({ id, label, state: infraError ? 'failed' : 'done' })),
    tcs,
    verdict: str(verdict.prediction),
    rule: str(verdict.rule),
    ...counted(tcs),
    error: infraError,
    startedAt: str(raw.startedAt),
    updatedAt: str(raw.finishedAt),
    finishedAt: str(raw.finishedAt),
  };
}

/** The newest run folder name, or null. Run folders are UTC stamps, so the newest sorts last. */
export function newestRun(names: string[]): string | null {
  const runs = names.filter((name) => RUN_ID.test(name)).sort();
  return runs.length ? runs[runs.length - 1] : null;
}

/** A file inside a run folder the panel may link to: a video from `videos/`, nothing else. */
export const isRunVideo = (file: string) => /^videos\/[A-Za-z0-9][A-Za-z0-9._-]*\.webm$/.test(file);

const TICKET = /^[A-Z][A-Z0-9]+-\d+$/;
export const isTicketKey = (key: string) => TICKET.test(key) && !key.startsWith('CARD-');

/** The prompt of a QA session: the agent step that writes the tests, then the command, all inside the rules of `~/qa-local`. */
export const qaPrompt = (key: string, prs: string[]) => [
  `QA lokal ${key}${prs.length ? ` setelah PR ${prs.join(' ')}` : ''}.`,
  `1. Kalau ~/qa-local/tests/${key}/ belum ada atau ac.json-nya lebih tua dari tiket, jalankan "Agent step" di ~/qa-local/README.md: baca tiket lewat Atlassian MCP (hanya baca), tulis ac.json, TC.md dan *.spec.ts di folder itu saja.`,
  `2. Jalankan: qonflo-qa-local ${key} (worktree wt-<nomor>-be dan -fe dipilih otomatis; pakai --be dan --fe kalau ada lebih dari satu).`,
  '3. Setelah run, hapus data tes buatan spec dari MongoDB lokal (hanya dokumen yang dibuat run ini).',
  '4. Laporkan per TC: id, AC, PASS/FAIL/BLOCKED, path video, path summary.md, dan prediksi verdict beserta aturan judge.md yang dipakai.',
  'Dilarang: menulis ke ~/qa, UAT, Jira (label, transisi, komentar), Confluence, Drive, apt, sudo, docker, dan commit ke repo aplikasi. Jangan sentuh port 3000, 3001, 5173, 5174, 5000, 3100, 13337, 13339, 8099, 27017, 6379, 1055.',
].join('\n');

export interface QaAutoDeps {
  available(): boolean;
  enabled(): Promise<boolean>;
  machine(): Promise<string>;
  last(key: string): Promise<QaTrigger | null>;
  save(key: string, trigger: QaTrigger): Promise<void>;
  open(key: string, prompt: string): Promise<string>;
  now(): Date;
}

/** Pull request links of a build run, sorted, so the same set compares equal. */
export const runPullRequests = (run: Pick<Orchestration, 'pullRequests'>) => [...new Set(run.pullRequests.map((pr) => pr.url).filter((url) => /\/pull\/\d+/.test(url)))].sort();

/**
 * Starts one QA session on this workspace when a ticket built here gets its pull requests, once per set of pull requests.
 * Off unless the owner turned it on and `qonflo-qa-local` is installed.
 */
export class QaAuto {
  private readonly opening = new Set<string>();

  constructor(private readonly deps: QaAutoDeps) {}

  async ledger(run: Pick<Orchestration, 'key' | 'kind' | 'machine' | 'pullRequests' | 'updatedAt'>): Promise<boolean> {
    if (run.kind !== 'build' || !isTicketKey(run.key) || !this.deps.available()) return false;
    // A ledger written long ago is an old ticket synced again, not a pull request that just went up.
    if (!(this.deps.now().getTime() - Date.parse(run.updatedAt) <= QA_WINDOW_MS)) return false;
    const prs = runPullRequests(run);
    if (!prs.length || this.opening.has(run.key)) return false;
    if (!(await this.deps.enabled())) return false;
    if (run.machine !== (await this.deps.machine())) return false;
    const last = await this.deps.last(run.key);
    if (last && last.prs.join(' ') === prs.join(' ')) return false;
    return this.start(run.key, prs);
  }

  /** A QA session for a ticket now, from the panel's button; the pull requests it records are the ones known now. */
  async start(key: string, prs: string[]): Promise<boolean> {
    if (this.opening.has(key)) return false;
    this.opening.add(key);
    try {
      const at = this.deps.now().toISOString();
      try {
        const sessionId = await this.deps.open(key, qaPrompt(key, prs));
        await this.deps.save(key, { prs, sessionId, at, error: null });
        return true;
      } catch (error) {
        await this.deps.save(key, { prs, sessionId: null, at, error: error instanceof Error ? error.message.slice(0, 300) : 'the session did not start' });
        return false;
      }
    } finally {
      this.opening.delete(key);
    }
  }
}
