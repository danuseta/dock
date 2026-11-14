import type { BadgeVariant } from '../components/ui/Badge';

export interface QaStep { id: string; label: string; state: string }
export interface QaTestCase { id: string; title: string; ac: number[]; state: string; seconds: number | null; video: string | null; note: string | null }
export interface QaRun {
  runId: string;
  state: string;
  step: string;
  steps: QaStep[];
  testCases: QaTestCase[];
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
export interface QaTrigger { at: string; sessionId: string | null; pullRequests: string[]; error: string | null }
export interface QaLocal { available: boolean; autoRun: boolean; trigger: QaTrigger | null; run: QaRun | null }

export type QaPhase = 'idle' | 'preparing' | 'running' | 'done' | 'failed' | 'not-started';

/**
 * Where a ticket's local QA stands. A QA session started after the newest run is still writing the tests (or booting the
 * run), so it shows as preparing until its run folder appears.
 */
export function qaPhase(qa: Pick<QaLocal, 'trigger' | 'run'>): QaPhase {
  const { trigger, run } = qa;
  const triggerAt = trigger ? Date.parse(trigger.at) : NaN;
  const runAt = run?.startedAt ? Date.parse(run.startedAt) : NaN;
  const newerTrigger = trigger && (!run || !(runAt >= triggerAt));
  if (newerTrigger && trigger.error) return 'not-started';
  if (newerTrigger && trigger.sessionId) return 'preparing';
  if (!run) return 'idle';
  if (run.state === 'running') return 'running';
  return run.state === 'failed' ? 'failed' : 'done';
}

export const qaBusy = (phase: QaPhase | null) => phase === 'preparing' || phase === 'running';

export const verdictVariant = (verdict: string | null): BadgeVariant => (verdict === 'LOLOS' ? 'success' : verdict === 'REVISION' ? 'danger' : verdict ? 'warn' : 'neutral');

export type UatPrediction = 'PASS' | 'ESCALATED' | 'NOT PASSED';
export const PREDICTION_LABEL = 'Prediksi di UAT';

/** What UAT will likely say, from the local run's predicted verdict (LOLOS, REVISION, ESCALATED); null when it names none. */
export function uatPrediction(verdict: string | null | undefined): UatPrediction | null {
  const value = verdict?.trim().toUpperCase();
  if (!value) return null;
  if (value === 'LOLOS' || value === 'PASS' || value === 'PASSED') return 'PASS';
  if (value === 'ESCALATED') return 'ESCALATED';
  if (value === 'REVISION' || value === 'REVISION-RISK' || value === 'NOT PASSED' || value === 'FAILED' || value === 'FAIL') return 'NOT PASSED';
  return null;
}

/** `QRD-1286-TC001` reads as `TC001` in the narrow panel. */
export const shortTc = (id: string) => /TC-?\d+[A-Za-z]?$/i.exec(id)?.[0] ?? id;

/** The line under the QA heading. */
export function qaLine(qa: Pick<QaLocal, 'trigger' | 'run'>, phase: QaPhase): string {
  const run = qa.run;
  if (phase === 'not-started') return `QA did not start: ${qa.trigger?.error ?? 'unknown error'}`;
  if (phase === 'preparing') return 'Writing the tests in the QA session';
  if (!run) return 'No QA run yet.';
  const total = run.testCases.length;
  if (phase === 'running') {
    const finished = run.testCases.filter((tc) => tc.state !== 'pending' && tc.state !== 'running').length;
    const step = run.steps.find((item) => item.id === run.step)?.label ?? run.step;
    return run.step === 'tests' ? `Tests ${finished}/${total}` : `${step}…`;
  }
  const counts = `${run.passed} passed · ${run.failed} failed · ${run.blocked} blocked`;
  return phase === 'failed' ? `Stopped: ${run.error ?? 'no result'}` : counts;
}

export const qaVideoUrl = (key: string, runId: string, video: string) => `/api/qa-local/${encodeURIComponent(key)}/${encodeURIComponent(runId)}/videos/${encodeURIComponent(video.replace(/^videos\//, ''))}`;
