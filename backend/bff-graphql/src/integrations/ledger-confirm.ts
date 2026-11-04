import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dockMode } from '../mode';

const run = promisify(execFile);

/** The kit's ledger tool on this machine, in the Claude Code config folder the bridge uses. */
export const statusScript = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'kit', 'status.cjs');

export interface ConfirmedDecision { n: number; text: string }

/** `status.cjs decide` for one confirmed guess: a DECIDED decision by the owner with the same text, which marks D-n SUPERSEDED. */
export const confirmArgs = (key: string, decision: ConfirmedDecision) => [
  'decide', key, `Owner confirmed D-${decision.n} in DOCK: ${decision.text}`, '--status', 'DECIDED', '--by', 'owner', '--replaces', String(decision.n),
];

export interface LedgerConfirmDeps {
  available(): boolean;
  status(args: string[]): Promise<string>;
  ingest(ledger: unknown, machine: string): Promise<unknown>;
}

/**
 * Writes the owner's confirmations into the ticket's ledger, so the session, `status.cjs sync` and the gate all read the
 * same thing, then hands DOCK the new ledger. Only where the ledger lives: a ticket whose ledger is on another machine is
 * skipped and keeps the confirmation in DOCK only.
 */
export async function writeConfirmations(deps: LedgerConfirmDeps, key: string, machine: string, decisions: ConfirmedDecision[]): Promise<'written' | 'skipped'> {
  if (!decisions.length || !deps.available()) return 'skipped';
  let ledger: { decisions?: Array<{ n: number; status: string }> };
  try {
    ledger = JSON.parse(await deps.status(['show', key]));
  } catch {
    return 'skipped';
  }
  const guessed = new Set((ledger.decisions ?? []).filter((item) => item.status === 'GUESS' || item.status === 'USULAN').map((item) => item.n));
  const due = decisions.filter((decision) => guessed.has(decision.n));
  for (const decision of due) await deps.status(confirmArgs(key, decision));
  if (!due.length) return 'skipped';
  await deps.ingest(JSON.parse(await deps.status(['show', key])), machine);
  return 'written';
}

export const liveLedgerConfirm = (ingest: LedgerConfirmDeps['ingest']): LedgerConfirmDeps => ({
  available: () => dockMode() === 'workspace' && fs.existsSync(statusScript()),
  status: async (args) => (await run(process.execPath, [statusScript(), ...args], { timeout: 30_000, maxBuffer: 8 << 20 })).stdout,
  ingest,
});
