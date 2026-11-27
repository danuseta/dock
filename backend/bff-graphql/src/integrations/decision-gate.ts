import { GitHubAPI } from '../datasources/GitHubAPI';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { autoBroadcast } from './broadcast';
import { liveLedgerConfirm, writeConfirmations, type ConfirmedDecision } from './ledger-confirm';
import { DEFAULT_MACHINE, STALE_ACTIVE_MS, orchestratorService, type Orchestration } from './orchestrator';
import { ticketGuessesHold } from './sous-flow-live';

/** Decisions sous took on the owner's behalf: the owner confirms or changes each one before the pull requests are reviewed. */
const GUESSED = new Set(['GUESS', 'USULAN']);
const GATE_CACHE = 'decision-gate';
const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

type GateRun = Pick<Orchestration, 'key' | 'kind' | 'prBe' | 'prFe' | 'issues' | 'decisions'> & Partial<Pick<Orchestration, 'activity' | 'activityDetail' | 'eventIdleSeconds' | 'machine'>>;

/** A run sous is still working on: an owner's answer just reopened it, or a turn is under way. Its pull requests are not released. */
export const stillWorking = (run: Partial<Pick<Orchestration, 'activity' | 'activityDetail' | 'eventIdleSeconds'>>) =>
  (run.activity === 'ACTIVE' || (run.activity === 'WAITING' && run.activityDetail !== 'gate'))
  && (run.eventIdleSeconds == null || run.eventIdleSeconds < STALE_ACTIVE_MS / 1000);
/** `auto` holds the confirmed guesses DOCK kept on its own, not the owner. */
interface GateRecord { confirmed: number[]; ready: string[]; auto: number[] }

/** Why DOCK keeps a guess on its own: the ticket is done or merged, so there is nothing left to change. */
export const AUTO_KEEP_REASON = 'ticket done';

export interface OwnerPending { issues: number[]; decisions: number[] }

/** What still waits on the owner before a build goes up for review: open issues and guessed decisions not confirmed yet. */
export function ownerPending(run: Pick<Orchestration, 'issues' | 'decisions'>, confirmed: number[]): OwnerPending {
  return {
    issues: run.issues.filter((issue) => issue.status === 'open').map((issue) => issue.n),
    decisions: run.decisions.filter((decision) => GUESSED.has(decision.status) && !confirmed.includes(decision.n)).map((decision) => decision.n),
  };
}

export interface GateDeps {
  getCache(namespace: string, key: string): Promise<unknown>;
  upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): PromiseLike<unknown>;
  markReady(owner: string, repo: string, pullNumber: number): Promise<boolean>;
  event(key: string, kind: string, detail: string | null): Promise<unknown>;
  /** Runs once a pull request went up for review, so the automatic broadcast sees it. */
  afterReady(run: GateRun): Promise<unknown>;
  /** Writes confirmations into the ticket's ledger where it lives; 'skipped' when the ledger is on another machine. */
  writeLedger?(key: string, machine: string, decisions: ConfirmedDecision[], auto?: string | null): Promise<'written' | 'skipped'>;
  /** Whether the ticket's guesses hold its pull requests until confirmed (Sous flow › Decisions ask first); held when absent or unreadable. */
  guessesHold?(key: string): Promise<boolean>;
}

const numbers = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : []);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const reason = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status ? String(status) : error instanceof Error ? error.message : 'unknown error';
};

/**
 * The owner's confirmations of guessed decisions, and the gate that marks a build's draft pull requests ready once
* every issue is answered and every guessed decision confirmed, and only while sous is not working on the build. A
 * confirmation is recorded here and written into the ticket's ledger as an owner decision, so the session reads it; no
 * session runs.
 */
export class DecisionGate {
  constructor(private readonly deps: GateDeps) {}

  private async record(key: string): Promise<GateRecord> {
    const saved = await this.deps.getCache(GATE_CACHE, key);
    const value = typeof saved === 'object' && saved !== null ? saved as Record<string, unknown> : {};
    return { confirmed: numbers(value.confirmed), ready: strings(value.ready), auto: numbers(value.auto) };
  }

  async confirmed(key: string): Promise<number[]> {
    return (await this.record(key)).confirmed;
  }

  /** The confirmed guesses DOCK kept on its own because the ticket was done. */
  async autoConfirmed(key: string): Promise<number[]> {
    return (await this.record(key)).auto;
  }

  /**
   * Records the owner's confirmation of guessed decisions; refuses a number that is not a guessed decision in force.
   * With `auto`, DOCK keeps them on its own for that reason, through the same record and ledger write.
   */
  async confirm(run: GateRun, ns: number[], auto: string | null = null): Promise<number[]> {
    const guessed = new Set(run.decisions.filter((decision) => GUESSED.has(decision.status)).map((decision) => decision.n));
    const wrong = ns.filter((n) => !guessed.has(n));
    if (wrong.length) throw new Error(`${wrong.map((n) => `D-${n}`).join(', ')} is not a decision sous took on your behalf`);
    const record = await this.record(run.key);
    const confirmed = [...new Set([...record.confirmed, ...ns])].sort((a, b) => a - b);
    const kept = auto ? [...new Set([...record.auto, ...ns])].sort((a, b) => a - b) : record.auto;
    await this.deps.upsertCache(GATE_CACHE, run.key, { ...record, confirmed, auto: kept }, 0);
    const listed = ns.map((n) => `D-${n}`).join(', ');
    await this.deps.event(run.key, auto ? 'AUTO_CONFIRMED' : 'OWNER_CONFIRMED', auto ? `${listed} (${auto})` : listed).catch(() => undefined);
    if (this.deps.writeLedger) {
      const decisions = run.decisions.filter((decision) => ns.includes(decision.n)).map((decision) => ({ n: decision.n, text: decision.text }));
      await this.deps.writeLedger(run.key, run.machine ?? DEFAULT_MACHINE, decisions, auto)
        .catch((error) => this.deps.event(run.key, 'LEDGER_WRITE_FAILED', `${decisions.map((decision) => `D-${decision.n}`).join(', ')}: ${reason(error)}`).catch(() => undefined));
    }
    return confirmed;
  }

  /** Marks the build's draft pull requests ready when nothing waits on the owner. Returns the pull requests it marked. */
  async settle(run: GateRun): Promise<string[]> {
    if (run.kind !== 'build' || stillWorking(run)) return [];
    const record = await this.record(run.key);
    const urls = [run.prBe, run.prFe].filter((url): url is string => Boolean(url) && !record.ready.includes(url!));
    if (!urls.length) return [];
    const pending = ownerPending(run, record.confirmed);
    if (pending.issues.length) return [];
    if (pending.decisions.length && (!this.deps.guessesHold || await this.deps.guessesHold(run.key).catch(() => true))) return [];
    const checked: string[] = [];
    const marked: string[] = [];
    for (const url of urls) {
      const match = PR_URL.exec(url);
      if (!match) continue;
      try {
        if (await this.deps.markReady(match[1], match[2], Number(match[3]))) marked.push(url);
        checked.push(url);
      } catch (error) {
        await this.deps.event(run.key, 'PR_READY_FAILED', `${url}: ${reason(error)}`).catch(() => undefined);
      }
    }
    if (checked.length) await this.deps.upsertCache(GATE_CACHE, run.key, { ...record, ready: [...record.ready, ...checked] }, 0);
    if (marked.length) {
      await this.deps.event(run.key, 'PR_READY', marked.join(' ')).catch(() => undefined);
      await this.deps.afterReady(run).catch(() => undefined);
    }
    return marked;
  }
}

type SweepRun = GateRun & Pick<Orchestration, 'stage' | 'pullRequests'>;

/**
 * The gate and the broadcast for every build at its pull request stage, on a timer: a run that went quiet without a
 * last hook event or ledger push is released and posted all the same.
 */
export async function sweepReleases(deps: { list: () => Promise<SweepRun[]>; gate: Pick<DecisionGate, 'settle'>; broadcast: (run: SweepRun) => Promise<unknown> }) {
  for (const run of await deps.list()) {
    if (run.kind !== 'build' || run.stage !== 'pr' || stillWorking(run)) continue;
    await deps.gate.settle(run).catch(() => undefined);
    if (run.pullRequests.some((pr) => pr.status === 'open')) await deps.broadcast(run).catch(() => undefined);
  }
}

type KeepRun = GateRun & Pick<Orchestration, 'finished'>;

/**
 * Sous's guesses on a build that is done or merged are kept as built, on a timer, the way the owner's "Keep what sous
 * built" would: there is nothing left to change. Open issues, which sous asked rather than guessed, still wait on the
 * owner. Answers the guesses it kept, per ticket.
 */
export async function keepFinishedGuesses(deps: { list: () => Promise<KeepRun[]>; gate: Pick<DecisionGate, 'confirmed' | 'confirm'> }) {
  const kept: Array<{ key: string; decisions: number[] }> = [];
  for (const run of await deps.list()) {
    if (run.kind !== 'build' || !run.finished) continue;
    const pending = ownerPending(run, await deps.gate.confirmed(run.key).catch(() => [])).decisions;
    if (!pending.length) continue;
    await deps.gate.confirm(run, pending, AUTO_KEEP_REASON).then(() => kept.push({ key: run.key, decisions: pending })).catch(() => undefined);
  }
  return kept;
}

const storage = new StorageService();
const githubAPI = new GitHubAPI();

export const decisionGate = new DecisionGate({
  getCache: (namespace, key) => storage.getCache(namespace, key),
  upsertCache: (namespace, key, value, ttl) => storage.upsertCache(namespace, key, value, ttl),
  markReady: (owner, repo, pullNumber) => githubAPI.markReadyForReview(owner, repo, pullNumber),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
  afterReady: (run) => (dockMode() === 'workspace' ? autoBroadcast.afterLedger(run) : Promise.resolve()),
  writeLedger: (key, machine, decisions, auto) => writeConfirmations(liveLedgerConfirm((ledger, from) => orchestratorService.ingestLedger(ledger, new Date(), from)), key, machine, decisions, auto ?? null),
  guessesHold: (key) => ticketGuessesHold(key),
});
