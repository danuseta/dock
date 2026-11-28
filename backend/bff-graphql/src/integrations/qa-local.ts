import type { Orchestration } from './orchestrator';
import { lessonsLines } from './lessons';

export type QaTcState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked';
export type QaRunState = 'running' | 'done' | 'failed' | 'preparing';

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
/** `fixResult`: what the Task session's QA-FIX line said about the run in `fixFor`. */
export interface QaTrigger { prs: string[]; sessionId: string | null; at: string; error: string | null; round: number; fixFor: string | null; heads: Record<string, string>; fixResult?: { runId: string; items: Array<{ tc: string; result: QaFixResult; sha: string | null }> } }
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
    ...(readFixResult(raw.fixResult) ? { fixResult: readFixResult(raw.fixResult)! } : {}),
  };
}

function readFixResult(value: unknown): QaTrigger['fixResult'] | null {
  const raw = record(value);
  if (typeof raw.runId !== 'string' || !Array.isArray(raw.items)) return null;
  const items = raw.items.flatMap((item) => {
    const entry = record(item);
    return typeof entry.tc === 'string' && (entry.result === 'fixed' || entry.result === 'not-a-bug' || entry.result === 'out-of-scope' || entry.result === 'flaky')
      ? [{ tc: entry.tc, result: entry.result as QaFixResult, sha: str(entry.sha) }] : [];
  });
  return items.length ? { runId: raw.runId, items } : null;
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

/** What the Task session said about the previous run's failed TCs, so the QA session fixes wrong specs and marks waits. */
function priorLines(key: string, prior: QaTrigger['fixResult'] | null): string[] {
  const of = (result: QaFixResult) => (prior?.items ?? []).filter((item) => item.result === result).map((item) => item.tc);
  const wrong = of('not-a-bug');
  const waiting = of('out-of-scope');
  if (!prior || (!wrong.length && !waiting.length)) return [];
  return [
    `Ronde sebelumnya (QA-FIX ${prior.runId}) menurut Task session:${wrong.length ? ` not-a-bug ${wrong.join(', ')};` : ''}${waiting.length ? ` out-of-scope ${waiting.join(', ')};` : ''} alasannya ada di finding terbaru ledger (node ~/.claude/kit/status.cjs show ${key}).`,
    ...(wrong.length ? ['Untuk tiap TC not-a-bug, bandingkan spec dengan AC dan storyboard sebelum run: perbaiki persiapan dan helper; Then boleh diubah hanya kalau Then lama tidak berasal dari kalimat AC, dan tulis alasannya di TC.md.'] : []),
    ...(waiting.length ? ['TC out-of-scope yang menunggu tiket lain yang belum merge dinilai Blocked [DEPENDENSI] dengan nama tiketnya, bukan Failed.'] : []),
  ];
}

/** The prompt of a QA session: the agent step that writes the tests, then the command, all inside the rules of `~/qa-local`. */
export const qaPrompt = (key: string, prs: string[], lessons: string | null = null, rerun = false, prior: QaTrigger['fixResult'] | null = null) => [
  `QA lokal ${key}${prs.length ? ` setelah PR ${prs.join(' ')}` : ''}${rerun ? ' (Run again dari owner)' : ''}.`,
  ...lessonsLines(lessons),
  ...priorLines(key, prior),
  `1. Kalau ~/qa-local/tests/${key}/ belum ada atau ac.json-nya lebih tua dari tiket, jalankan "Agent step" v2 di ~/.claude/kit/qa-local/README.md: baca tiket lewat Atlassian MCP (hanya baca), tulis ac.json, TC.md dan *.spec.ts di folder itu saja.`,
  `1b. Test yang sudah ada mungkin ditulis untuk UI lama (develop bisa memindah halaman atau mengganti tombol). Bandingkan head worktree FE dan BE sekarang (git -C <worktree> rev-parse HEAD) dengan ~/qa-local/tests/${key}/written.json. ${rerun ? 'Karena ini Run again, cek setup selalu dijalankan.' : 'Kalau file itu tidak ada atau head-nya berbeda, cek setup dijalankan.'} Cek setup: naikkan stack, jalankan satu TC saja; kalau gagal sebelum assertion bagian Then (navigasi, tombol, form persiapan), lihat UI di head ini lalu perbarui helper dan langkah persiapan di spec dan cara_membuat di plan/plan.json, tanpa mengubah assertion Then, sampai TC itu lewat persiapan. Setelah itu tulis written.json berisi {"fe": "<sha>", "be": "<sha>", "at": "<waktu ISO>"}.`,
  `2. Jalankan: qonflo-qa-local ${key} (worktree wt-<nomor>-be dan -fe dipilih otomatis; pakai --be dan --fe kalau ada lebih dari satu).`,
  `2b. Run ini lama dan ikut mati kalau giliranmu selesai. Jalankan terlepas dari sesi: setsid nohup qonflo-qa-local ${key} ... > /tmp/qa-${key}.log 2>&1 &, lalu tunggu di foreground: ulangi Bash (timeout paling lama 600000 ms) yang membaca state di progress.json run terbaru (~/qa-local/runs/${key}/) sampai bukan running. Jangan memakai run_in_background atau Monitor lalu mengakhiri giliran sebelum run selesai.`,
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
  /** The ticket's pull requests still open now, from its build run. */
  openPrs(key: string): Promise<string[]>;
  /** The ticket's lessons file for the QA and REVISION prompts; left out, a prompt names none. */
  lessonsFile?(key: string): Promise<string | null>;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The message that sends a REVISION run's failed test cases back to the ticket's Task session. */
export function revisionPrompt(key: string, round: number, run: Pick<QaRun, 'runId' | 'tcs'>, dir: string, lessons: string | null = null): string {
  const failed = run.tcs.filter((tc) => tc.state === 'failed');
  return [
    `QA lokal REVISION ${key} round ${round}`,
    ...lessonsLines(lessons),
    `Folder run: ${dir}`,
    `summary.md: ${dir}/summary.md`,
    'TC yang gagal:',
    ...failed.map((tc) => `- ${tc.id} | AC ${tc.ac.length ? tc.ac.join(', ') : '-'} | ${oneLine(tc.title)} | catatan: ${tc.note ? oneLine(tc.note) : '-'} | video: ${tc.video ? `${dir}/${tc.video}` : '-'}`),
    `Sebelum mengubah kode, reproduksi tiap TC: baca ${dir}/pw-output/<TC>/error-context.md dan kodenya, tulis path:line. TC yang gagal karena persiapan test (halaman atau tombol yang dituju sudah tidak ada), data uji, atau hanya kadang-kadang, dicatat dengan buktinya dan kodenya tidak diubah.`,
    'Tiga syarat owner untuk tiap TC gagal: tetap sesuai AC tiket Jira, tidak mem-break fitur lain, dan TC lolos persis seperti Then-nya. Bug di kode, termasuk bug lama (sudah ada sebelum PR ini) dan bug di komponen bersama, diperbaiki atas nama tiket ini dengan perubahan sesempit mungkin plus test untuk perilaku lain yang lewat kode itu; batas light boleh dilewati untuk perbaikan ini; hasilnya fixed. Spec yang salah menurut AC atau storyboard: kode tidak diubah, tulis alasannya dengan kutipan AC sebagai finding, hasilnya not-a-bug (QA membetulkan spec di run berikutnya). TC yang menunggu tiket lain yang belum merge: sebut tiketnya, hasilnya out-of-scope. Jangan membuat Decision (status.cjs decide) untuk hasil ini; cukup finding di ledger.',
    'Pakai skill sous: perbaiki temuan QA lokal ini lewat light runner di PR yang sama dan push ke branch PR. Kalau PR itu sudah merged: lanjutkan di branch yang sama (merge develop dulu, tanpa rebase dan force push), push, lalu buka PR baru dari branch itu ke develop; owner mengizinkannya. Selain itu jangan buka PR baru.',
    `Baris terakhir balasanmu persis: ${QA_FIX} ${run.runId} lalu satu entri per TC gagal, dipisah spasi: <TC>=fixed:<sha pendek>, <TC>=not-a-bug, <TC>=out-of-scope, atau <TC>=flaky (contoh: ${QA_FIX} ${run.runId} ${failed[0]?.id ?? `${key}-TC001`}=fixed:1a2b3c4).`,
  ].join('\n');
}

export const QA_FIX = 'QA-FIX';
export type QaFixResult = 'fixed' | 'not-a-bug' | 'out-of-scope' | 'flaky';
export interface QaFixItem { tc: string; result: QaFixResult; sha: string | null }
export interface QaFixReport { runId: string; items: QaFixItem[] }

/** The QA-FIX line a Task session ends a QA fix with: the run it answers and what came of each failed TC; null when absent. */
export function parseQaFix(text: string | null | undefined): QaFixReport | null {
  const line = String(text ?? '').split('\n').map((item) => item.trim()).reverse().find((item) => item.startsWith(`${QA_FIX} `));
  const parts = line ? line.split(/\s+/).slice(1) : [];
  if (!parts.length || !RUN_ID.test(parts[0])) return null;
  const items: QaFixItem[] = [];
  for (const part of parts.slice(1)) {
    const match = /^([A-Z][A-Z0-9]*-\d+-TC\d+[A-Za-z]?|TC\d+[A-Za-z]?)=(fixed(?::([0-9a-f]{6,40}))?|not-a-bug|out-of-scope|flaky)$/.exec(part);
    if (match) items.push({ tc: match[1], result: match[2].startsWith('fixed') ? 'fixed' : match[2] as QaFixResult, sha: match[3] ?? null });
  }
  return items.length ? { runId: parts[0], items } : null;
}

/** "TC013 fixed 18b53dd · TC015 not a bug" for the QA queue row. */
export const qaFixText = (report: QaFixReport) => report.items.map((item) => `${item.tc.replace(/^.*-(TC\d+[A-Za-z]?)$/, '$1')} ${item.result === 'fixed' ? `fixed${item.sha ? ` ${item.sha.slice(0, 7)}` : ''}` : item.result === 'not-a-bug' ? 'not a bug' : item.result === 'out-of-scope' ? 'out of scope' : 'flaky'}`).join(' · ');

/** Pull request links of a build run, sorted, so the same set compares equal; `openOnly` leaves out merged and closed ones. */
export const runPullRequests = (run: Pick<Orchestration, 'pullRequests'>, openOnly = false) => [...new Set(run.pullRequests
  .filter((pr) => !openOnly || pr.status === 'open' || pr.status === 'draft')
  .map((pr) => pr.url).filter((url) => /\/pull\/\d+/.test(url)))].sort();

/**
 * Starts one QA session on this workspace when a ticket built here gets its pull requests, once per set of pull requests.
 * Off unless the owner turned it on and `qonflo-qa-local` is installed. A REVISION run goes back to the ticket's Task
 * session (at most twice); when a pull request head moves after that, or the fix comes as a new pull request, QA starts again.
 */
export class QaAuto {
  private readonly opening = new Set<string>();
  private readonly sending = new Set<string>();

  constructor(private readonly deps: QaAutoDeps) {}

  private lessonsOf(key: string): Promise<string | null> {
    return this.deps.lessonsFile ? this.deps.lessonsFile(key).catch(() => null) : Promise.resolve(null);
  }

  async ledger(run: Pick<Orchestration, 'key' | 'kind' | 'machine' | 'pullRequests' | 'updatedAt'>): Promise<boolean> {
    if (run.kind !== 'build' || !isTicketKey(run.key) || !this.deps.available()) return false;
    // A ledger written long ago is an old ticket synced again, not a pull request that just went up.
    if (!(this.deps.now().getTime() - Date.parse(run.updatedAt) <= QA_WINDOW_MS)) return false;
    if (this.opening.has(run.key)) return false;
    if (!(await this.deps.enabled())) return false;
    if (run.machine !== (await this.deps.machine())) return false;
    const last = readTrigger(await this.deps.last(run.key));
    if (last?.fixFor) return this.afterFix(run.key, last, runPullRequests(run, true));
    // Only pull requests still open start QA on their own; a merged one gets QA from the owner's Run again.
    const prs = runPullRequests(run, true);
    if (!prs.length) return false;
    if (last && last.prs.join(' ') === prs.join(' ')) return false;
    return this.start(run.key, prs);
  }

  /**
   * QA again, one round on, once a pull request of the ticket has a head other than the one the fix message saw, or an
   * open pull request the fix message did not see (the fix of a merged pull request goes up as a new one).
   */
  private async afterFix(key: string, last: QaTrigger, open: string[]): Promise<boolean> {
    if (this.deps.latest(key)?.state === 'running') return false;
    const prs = open.length ? open : last.prs;
    if (open.some((url) => !(url in last.heads))) return this.start(key, prs, last.round + 1, false, last.fixResult ?? null);
    for (const url of Object.keys(last.heads)) {
      const head = await this.deps.head(url).catch(() => null);
      if (head && head !== last.heads[url]) return this.start(key, prs, last.round + 1, false, last.fixResult ?? null);
    }
    return false;
  }

  /** The fix-message wait of a ticket, checked against its pull requests open now. */
  private async fixLanded(key: string): Promise<boolean> {
    const last = readTrigger(await this.deps.last(key));
    if (!last?.fixFor) return false;
    return this.afterFix(key, last, await this.deps.openPrs(key));
  }

  /** Sends the failed test cases of a finished REVISION run to the Task session, once per run and while fix rounds are left. */
  async revision(key: string): Promise<boolean> {
    return (await this.sendFix(key)) === null;
  }

  /**
   * The fix message of the newest REVISION run, to the ticket's Task session; null when it went out, else why not. `force`
   * is the owner's confirmation to send one past the fix-round limit.
   */
  async sendFix(key: string, force = false): Promise<string | null> {
    if (!isTicketKey(key)) return 'Not a ticket key';
    if (!this.deps.available()) return 'qonflo-qa-local is not installed on this DOCK';
    if (this.sending.has(key) || this.opening.has(key)) return 'A QA message for this ticket is already going out';
    const run = this.deps.latest(key);
    if (!run || run.state !== 'done' || run.verdict !== 'REVISION') return 'The newest QA run is not a finished REVISION';
    const last = readTrigger(await this.deps.last(key));
    if (!last || !last.prs.length) return 'This ticket has no QA trigger with pull requests';
    if (last.fixFor === run.runId) return 'The fix for this run was already sent';
    // A run made before the trigger belongs to an earlier set of pull requests.
    if (Date.parse(run.startedAt ?? '') < Date.parse(last.at)) return 'The newest run is older than the current pull requests';
    if (last.round >= MAX_FIX_ROUNDS && !force) return `The ${MAX_FIX_ROUNDS} fix rounds are used; confirm to send one more`;
    this.sending.add(key);
    try {
      const heads: Record<string, string> = {};
      for (const url of last.prs) {
        const head = await this.deps.head(url);
        if (!head) return 'GitHub did not give the pull request head';
        heads[url] = head;
      }
      await this.deps.message(key, revisionPrompt(key, last.round + 1, run, this.deps.runDir(key, run.runId), await this.lessonsOf(key)));
      await this.deps.save(key, { ...last, fixFor: run.runId, heads });
      return null;
    } finally {
      this.sending.delete(key);
    }
  }

  /** The Task session's QA-FIX line for the run its fix message was about: kept on the trigger for the QA queue. */
  async fixReported(key: string, text: string | null): Promise<boolean> {
    const report = parseQaFix(text);
    if (!report || !isTicketKey(key)) return false;
    const last = readTrigger(await this.deps.last(key));
    if (!last || last.fixFor !== report.runId) return false;
    await this.deps.save(key, { ...last, fixResult: report });
    if (report.items.some((item) => item.result === 'fixed') && await this.deps.enabled()) await this.fixLanded(key);
    return true;
  }

  /** QA from the start in a new QA session on the pull requests known now; the fix rounds already used stay counted. */
  async runAgain(key: string, prs: string[]): Promise<string | null> {
    if (!isTicketKey(key)) return 'Not a ticket key';
    if (this.deps.latest(key)?.state === 'running') return 'A QA run is still going for this ticket';
    const last = readTrigger(await this.deps.last(key));
    const started = await this.start(key, prs.length ? prs : last?.prs ?? [], last?.round ?? 0, true, last?.fixResult ?? null);
    if (started) return null;
    return readTrigger(await this.deps.last(key))?.error ?? 'A QA session for this ticket is already starting';
  }

  /** Looks at every ticket built here for a finished REVISION run, and for a fix that went up after its fix message. */
  async tick(): Promise<void> {
    if (!this.deps.available() || !(await this.deps.enabled())) return;
    for (const key of await this.deps.tickets()) {
      await this.revision(key).catch((error) => console.warn('[QaLocal] fix message failed:', error instanceof Error ? error.message : 'unknown error'));
      await this.fixLanded(key).catch((error) => console.warn('[QaLocal] start after fix failed:', error instanceof Error ? error.message : 'unknown error'));
    }
  }

  /** A QA session for a ticket now, from the panel's button; the pull requests it records are the ones known now. */
  async start(key: string, prs: string[], round = 0, rerun = false, prior: QaTrigger['fixResult'] | null = null): Promise<boolean> {
    if (this.opening.has(key)) return false;
    this.opening.add(key);
    try {
      const at = this.deps.now().toISOString();
      const fresh = { prs, at, round, fixFor: null, heads: {} };
      try {
        const sessionId = await this.deps.open(key, qaPrompt(key, prs, await this.lessonsOf(key), rerun, prior));
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

/** One ticket's newest local QA run for the QA queue page, with what its trigger says about fix rounds. */
export interface QaLocalRow {
  key: string;
  title: string | null;
  jiraStatus: string | null;
  run: QaRun;
  /** How many runs the ticket has. */
  runs: number;
  fixRound: number;
  /** The fix message of this run already went out. */
  fixSent: boolean;
  sessionId: string | null;
  /** What the Task session found for this run's failed TCs, from its QA-FIX line. */
  fixResult: string | null;
  /** The ticket's Jira sprint, null when Jira did not say. */
  sprint: string | null;
}

/** `sessionRunning`: the QA session of the trigger still has a turn going, so a run may be on its way. */
export interface QaLocalSource { key: string; run: QaRun | null; runs: number; trigger: QaTrigger | null; title: string | null; jiraStatus: string | null; jiraLabels?: string[]; sessionRunning?: boolean; sprint?: string | null }

/** Tickets whose work is over: they leave the table. */
export const QA_HIDDEN_STATUS = /^(?:ready ?for ?production|done(?: \/ merged)?|closed)$/i;

/** Work over, or UAT TESTED with the QA-DONE-PASSED label: QA has nothing left to run. */
export function qaHidden(status: string | null, labels: string[] = []): boolean {
  const name = (status ?? '').trim();
  if (!name) return false;
  return QA_HIDDEN_STATUS.test(name) || (/^uat ?tested$/i.test(name) && labels.some((label) => label.toLowerCase() === 'qa-done-passed'));
}

/** A QA session that started after the newest run, or before any run, and still runs: it prepares the stack and the test cases. */
export function preparingRun(source: Pick<QaLocalSource, 'run' | 'trigger' | 'sessionRunning'>): QaRun | null {
  if (!source.sessionRunning || !source.trigger?.at) return null;
  if (source.run && (source.run.state === 'running' || Date.parse(source.run.startedAt ?? '') >= Date.parse(source.trigger.at))) return null;
  return {
    key: '', runId: '', state: 'preparing', step: 'stack', steps: STEP_LABELS.map(([id, label], index) => ({ id, label, state: index === 0 ? 'running' : 'pending' })),
    tcs: [], verdict: null, rule: null, followsFe: null, passed: 0, failed: 0, blocked: 0, error: null,
    startedAt: source.trigger.at, updatedAt: source.trigger.at, finishedAt: null,
  };
}

const LIVE = new Set(['running', 'preparing']);

/** The table rows: tickets with a run or a QA session getting ready, not RFP, Done or UAT TESTED with QA-DONE-PASSED; live first, then the newest started; and how many were hidden. */
export function qaLocalRows(sources: QaLocalSource[]): { rows: QaLocalRow[]; hidden: number } {
  let hidden = 0;
  const rows: QaLocalRow[] = [];
  for (const source of sources) {
    if (!isTicketKey(source.key)) continue;
    const run = preparingRun(source) ?? source.run;
    if (!run) continue;
    if (qaHidden(source.jiraStatus, source.jiraLabels)) { hidden += 1; continue; }
    rows.push({
      key: source.key, title: source.title, jiraStatus: source.jiraStatus, run, runs: source.runs,
      fixRound: source.trigger?.round ?? 0, fixSent: Boolean(run.runId && source.trigger?.fixFor === run.runId),
      sessionId: source.trigger?.sessionId ?? null,
      fixResult: run.runId && source.trigger?.fixResult?.runId === run.runId ? qaFixText(source.trigger.fixResult) : null,
      sprint: source.sprint ?? null,
    });
  }
  const started = (row: QaLocalRow) => Date.parse(row.run.startedAt ?? '') || 0;
  rows.sort((a, b) => Number(LIVE.has(b.run.state)) - Number(LIVE.has(a.run.state)) || started(b) - started(a));
  return { rows, hidden };
}

/** A ticket of the owner that never had a QA local run. `stopped`: a QA session started and ended before the first run. `openPrs`: open or draft pull requests, the ones Run QA may test. */
export interface QaNotRunRow { key: string; title: string | null; jiraStatus: string | null; sprint: string | null; prs: number; openPrs: number; stopped: boolean }

/**
 * The owner's tickets with no row in the run table (no run, no QA session still going), leaving out the ones the table hides (RFP, Done, Closed, UAT TESTED
 * with QA-DONE-PASSED). A merged pull request does not count as one to run: QA of merged work waits for UAT CHECK.
 */
export function qaNotRunRows(
  tickets: Array<{ key: string; title?: string | null; status?: string | null; sprintName?: string | null; labels?: unknown }>,
  known: Set<string>,
  prsOf: (key: string) => { prs: number; openPrs: number },
  stopped: Set<string> = new Set(),
): QaNotRunRow[] {
  const rows: QaNotRunRow[] = [];
  const seen = new Set<string>();
  for (const ticket of tickets) {
    const key = String(ticket.key ?? '');
    if (!isTicketKey(key) || known.has(key) || seen.has(key)) continue;
    const labels = Array.isArray(ticket.labels) ? ticket.labels.map(String) : [];
    if (qaHidden(ticket.status ?? null, labels)) continue;
    seen.add(key);
    rows.push({ key, title: ticket.title ?? null, jiraStatus: ticket.status ?? null, sprint: ticket.sprintName ?? null, ...prsOf(key), stopped: stopped.has(key) });
  }
  return rows;
}
