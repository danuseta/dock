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
  /** The FE ticket a BE ticket follows (verdict FOLLOWS_FE): its result is this ticket's, so nothing was tested here. */
  followsFe: QaFollowsFe | null;
  passed: number;
  failed: number;
  blocked: number;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}
export interface QaFollowsFe { key: string; status: string | null }
/** `round` counts the fix rounds already used (0 at the first run); `fixFor` is the run a fix message went out for; `heads` maps each pull request to its head SHA at that moment. */
export interface QaTrigger { prs: string[]; sessionId: string | null; at: string; error: string | null; round: number; fixFor: string | null; heads: Record<string, string> }
/** The most fix rounds a ticket gets; a REVISION after that waits for the owner. */
export const MAX_FIX_ROUNDS = 2;

/** A cached trigger; one saved before fix rounds existed has none of the fix fields. */
export function readTrigger(value: unknown): QaTrigger | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const heads: Record<string, string> = {};
  for (const [url, sha] of Object.entries(record(raw.heads))) if (typeof sha === 'string') heads[url] = sha;
  return {
    prs: Array.isArray(raw.prs) ? raw.prs.filter((url): url is string => typeof url === 'string') : [],
    sessionId: str(raw.sessionId),
    at: typeof raw.at === 'string' ? raw.at : '',
    error: str(raw.error),
    round: typeof raw.round === 'number' && Number.isFinite(raw.round) ? raw.round : 0,
    fixFor: str(raw.fixFor),
    heads,
  };
}

export const RUN_ID = /^\d{8}T\d{6}Z$/;
/** How old a ledger with pull requests may be and still start QA. */
export const QA_WINDOW_MS = 6 * 60 * 60 * 1000;
const TC_STATES = new Set<QaTcState>(['pending', 'running', 'passed', 'failed', 'skipped', 'blocked']);
const STEP_LABELS: Array<[string, string]> = [['stack', 'Stack'], ['login', 'Login'], ['tests', 'Tests'], ['judge', 'Verdict']];

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

/** The FE pair a triage stop names; null without a ticket key. */
function followsFeOf(value: unknown): QaFollowsFe | null {
  const raw = record(value);
  const key = (str(raw.key) ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9]*-\d+$/.test(key) ? { key, status: str(raw.status)?.trim() || null } : null;
}

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
    followsFe: followsFeOf(raw.followsFe),
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
    followsFe: followsFeOf(raw.followsFe),
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
  `1. Kalau ~/qa-local/tests/${key}/ belum ada atau ac.json-nya lebih tua dari tiket, jalankan "Agent step" v2 di ~/.claude/kit/qa-local/README.md: baca tiket lewat Atlassian MCP (hanya baca), tulis ac.json, TC.md dan *.spec.ts di folder itu saja.`,
  `2. Jalankan: qonflo-qa-local ${key} (worktree wt-<nomor>-be dan -fe dipilih otomatis; pakai --be dan --fe kalau ada lebih dari satu).`,
  '3. Setelah run, hapus data tes buatan spec dari MongoDB lokal (hanya dokumen yang dibuat run ini).',
  '4. Laporkan per TC: id, AC, PASS/FAIL/BLOCKED, path video, path summary.md, dan prediksi verdict beserta aturan judge.md yang dipakai.',
  `5. Jalankan: node ~/.claude/kit/deploy-gate.cjs ${key} dan laporkan hasilnya. Tiket baru boleh dipindah ke UAT CHECK setelah QA lokal lolos DAN deploy-gate menjawab ready (semua PR yang merge sudah ter-deploy ke UAT).`,
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
  /** The newest local QA run of a ticket. */
  latest(key: string): QaRun | null;
  /** The folder of a run, where summary.md and the videos are. */
  runDir(key: string, runId: string): string;
  /** The head SHA of a pull request now, or null when GitHub cannot say. */
  head(prUrl: string): Promise<string | null>;
  /** A message for the ticket's Task session. */
  message(key: string, prompt: string): Promise<unknown>;
  /** The tickets that were built here and may have a REVISION waiting. */
  tickets(): Promise<string[]>;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The message that sends a REVISION run's failed test cases back to the ticket's Task session. */
export function revisionPrompt(key: string, round: number, run: Pick<QaRun, 'runId' | 'tcs'>, dir: string): string {
  const failed = run.tcs.filter((tc) => tc.state === 'failed');
  return [
    `QA lokal REVISION ${key} round ${round}`,
    `Folder run: ${dir}`,
    `summary.md: ${dir}/summary.md`,
    'TC yang gagal:',
    ...failed.map((tc) => `- ${tc.id} | AC ${tc.ac.length ? tc.ac.join(', ') : '-'} | ${oneLine(tc.title)} | catatan: ${tc.note ? oneLine(tc.note) : '-'} | video: ${tc.video ? `${dir}/${tc.video}` : '-'}`),
    'Pakai skill sous: perbaiki temuan QA lokal ini lewat light runner di PR yang sama, push ke branch PR, lalu selesai. Jangan buka PR baru.',
  ].join('\n');
}

/** Pull request links of a build run, sorted, so the same set compares equal. */
export const runPullRequests = (run: Pick<Orchestration, 'pullRequests'>) => [...new Set(run.pullRequests.map((pr) => pr.url).filter((url) => /\/pull\/\d+/.test(url)))].sort();

/**
 * Starts one QA session on this workspace when a ticket built here gets its pull requests, once per set of pull requests.
 * Off unless the owner turned it on and `qonflo-qa-local` is installed. A REVISION run goes back to the ticket's Task
 * session (at most twice); when a pull request head moves after that, QA starts again.
 */
export class QaAuto {
  private readonly opening = new Set<string>();
  private readonly sending = new Set<string>();

  constructor(private readonly deps: QaAutoDeps) {}

  async ledger(run: Pick<Orchestration, 'key' | 'kind' | 'machine' | 'pullRequests' | 'updatedAt'>): Promise<boolean> {
    if (run.kind !== 'build' || !isTicketKey(run.key) || !this.deps.available()) return false;
    // A ledger written long ago is an old ticket synced again, not a pull request that just went up.
    if (!(this.deps.now().getTime() - Date.parse(run.updatedAt) <= QA_WINDOW_MS)) return false;
    if (this.opening.has(run.key)) return false;
    if (!(await this.deps.enabled())) return false;
    if (run.machine !== (await this.deps.machine())) return false;
    const last = readTrigger(await this.deps.last(run.key));
    if (last?.fixFor) return this.afterFix(run.key, last);
    const prs = runPullRequests(run);
    if (!prs.length) return false;
    if (last && last.prs.join(' ') === prs.join(' ')) return false;
    return this.start(run.key, prs);
  }

  /** QA again, one round on, once a pull request of the ticket has a head other than the one the fix message saw. */
  private async afterFix(key: string, last: QaTrigger): Promise<boolean> {
    for (const url of Object.keys(last.heads)) {
      const head = await this.deps.head(url).catch(() => null);
      if (head && head !== last.heads[url]) return this.start(key, last.prs, last.round + 1);
    }
    return false;
  }

  /** Sends the failed test cases of a finished REVISION run to the Task session, once per run and while fix rounds are left. */
  async revision(key: string): Promise<boolean> {
    if (!isTicketKey(key) || !this.deps.available() || this.sending.has(key) || this.opening.has(key)) return false;
    const run = this.deps.latest(key);
    if (!run || run.state !== 'done' || run.verdict !== 'REVISION') return false;
    const last = readTrigger(await this.deps.last(key));
    if (!last || last.round >= MAX_FIX_ROUNDS || last.fixFor === run.runId || !last.prs.length) return false;
    // A run made before the trigger belongs to an earlier set of pull requests.
    if (Date.parse(run.startedAt ?? '') < Date.parse(last.at)) return false;
    this.sending.add(key);
    try {
      const heads: Record<string, string> = {};
      for (const url of last.prs) {
        const head = await this.deps.head(url);
        if (!head) return false;
        heads[url] = head;
      }
      await this.deps.message(key, revisionPrompt(key, last.round + 1, run, this.deps.runDir(key, run.runId)));
      await this.deps.save(key, { ...last, fixFor: run.runId, heads });
      return true;
    } finally {
      this.sending.delete(key);
    }
  }

  /** Looks at every ticket built here for a finished REVISION run. */
  async tick(): Promise<void> {
    if (!this.deps.available() || !(await this.deps.enabled())) return;
    for (const key of await this.deps.tickets()) {
      await this.revision(key).catch((error) => console.warn('[QaLocal] fix message failed:', error instanceof Error ? error.message : 'unknown error'));
    }
  }

  /** A QA session for a ticket now, from the panel's button; the pull requests it records are the ones known now. */
  async start(key: string, prs: string[], round = 0): Promise<boolean> {
    if (this.opening.has(key)) return false;
    this.opening.add(key);
    try {
      const at = this.deps.now().toISOString();
      const fresh = { prs, at, round, fixFor: null, heads: {} };
      try {
        const sessionId = await this.deps.open(key, qaPrompt(key, prs));
        await this.deps.save(key, { ...fresh, sessionId, error: null });
        return true;
      } catch (error) {
        await this.deps.save(key, { ...fresh, sessionId: null, error: error instanceof Error ? error.message.slice(0, 300) : 'the session did not start' });
        return false;
      }
    } finally {
      this.opening.delete(key);
    }
  }
}
