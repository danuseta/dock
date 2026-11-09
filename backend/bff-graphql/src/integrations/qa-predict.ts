// The QA bot's triage, run on draft AC before publish. The rules live in the qonflo-qa skill (predict.mjs, installed by
// its install.sh); DOCK only feeds it the tickets and reads the verdicts. When the script is missing, slow or answers
// garbage, there is no prediction and the reason says why, so Planning shows that instead of guessing.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type QaVerdict = 'LOLOS' | 'ESCALATED' | 'REVISION-RISK';
export interface QaPrediction { prediction: QaVerdict; reasons: string[]; fix: string | null }
export interface QaInputTicket { key: string; summary: string; ac: string[]; waitsOn: Array<{ key: string; endDay: number | null }>; endDay: number | null }
export interface QaRun { predictions: Map<string, QaPrediction> | null; reason: string | null }
export interface RunnerResult { code: number | null; stdout: string; stderr: string }
export type QaRunner = (script: string, stdin: string, timeoutMs: number) => Promise<RunnerResult>;

export const NOT_INSTALLED = 'QA prediction not installed';
const VERDICTS: QaVerdict[] = ['LOLOS', 'ESCALATED', 'REVISION-RISK'];
const TIMEOUT_MS = 60000;
const MAX_OUTPUT = 2 * 1024 * 1024;

export const predictScriptPath = () => join(homedir(), '.claude', 'skills', 'skill-qonflo-qa', 'scripts', 'predict.mjs');

/** Runs `node <script>` with the JSON on stdin; a timeout kills it. */
export const nodeRunner: QaRunner = (script, stdin, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`predict.mjs gave no answer in ${Math.round(timeoutMs / 1000)}s`));
  }, timeoutMs);
  child.stdout.on('data', (chunk) => { if (stdout.length < MAX_OUTPUT) stdout += chunk; });
  child.stderr.on('data', (chunk) => { if (stderr.length < MAX_OUTPUT) stderr += chunk; });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  child.stdin.on('error', () => undefined);
  child.stdin.end(stdin);
});

function parsePrediction(item: unknown): [string, QaPrediction] | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const key = typeof row.key === 'string' ? row.key.trim().toUpperCase() : '';
  const prediction = VERDICTS.find((verdict) => verdict === row.prediction);
  if (!key || !prediction) return null;
  const reasons = Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === 'string').map((reason) => reason.slice(0, 1000)) : [];
  return [key, { prediction, reasons, fix: typeof row.fix === 'string' && row.fix.trim() ? row.fix.slice(0, 2000) : null }];
}

/** The verdict of each ticket, or no predictions and the reason. */
export async function predictQa(
  tickets: QaInputTicket[],
  deps: { script?: string; exists?: (path: string) => boolean; runner?: QaRunner; timeoutMs?: number } = {},
): Promise<QaRun> {
  const script = deps.script ?? predictScriptPath();
  if (!(deps.exists ?? existsSync)(script)) return { predictions: null, reason: NOT_INSTALLED };
  let result: RunnerResult;
  try {
    result = await (deps.runner ?? nodeRunner)(script, JSON.stringify({ tickets }), deps.timeoutMs ?? TIMEOUT_MS);
  } catch (error) {
    return { predictions: null, reason: `QA prediction failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).pop() || `exit code ${result.code}`;
    return { predictions: null, reason: `QA prediction failed: ${detail.slice(0, 300)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { predictions: null, reason: 'QA prediction answered something other than JSON' };
  }
  const results = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(results)) return { predictions: null, reason: 'QA prediction answered without a results list' };
  return { predictions: new Map(results.map(parsePrediction).filter((row): row is [string, QaPrediction] => row !== null)), reason: null };
}
