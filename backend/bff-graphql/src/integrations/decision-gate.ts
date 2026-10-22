import { GitHubAPI } from '../datasources/GitHubAPI';
import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { autoBroadcast } from './broadcast';
import { orchestratorService, type Orchestration } from './orchestrator';

/** Decisions sous took on the owner's behalf: the owner confirms or changes each one before the pull requests are reviewed. */
const GUESSED = new Set(['SHOV', 'USULAN']);
const GATE_CACHE = 'decision-gate';
const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

type GateRun = Pick<Orchestration, 'key' | 'kind' | 'productionData' | 'prBe' | 'prFe' | 'issues' | 'decisions'>;
interface GateRecord { confirmed: number[]; ready: string[] }

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
}

const numbers = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : []);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const reason = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status ? String(status) : error instanceof Error ? error.message : 'unknown error';
};

/**
 * The owner's confirmations of guessed decisions, and the gate that marks a build's draft pull requests ready once
 * every issue is answered and every guessed decision confirmed. A confirmation is only recorded: no session runs.
 */
export class DecisionGate {
  constructor(private readonly deps: GateDeps) {}

  private async record(key: string): Promise<GateRecord> {
    const saved = await this.deps.getCache(GATE_CACHE, key);
    const value = typeof saved === 'object' && saved !== null ? saved as Record<string, unknown> : {};
    return { confirmed: numbers(value.confirmed), ready: strings(value.ready) };
  }

  async confirmed(key: string): Promise<number[]> {
    return (await this.record(key)).confirmed;
  }

  /** Records the owner's confirmation of guessed decisions; refuses a number that is not a guessed decision in force. */
  async confirm(run: GateRun, ns: number[]): Promise<number[]> {
    const guessed = new Set(run.decisions.filter((decision) => GUESSED.has(decision.status)).map((decision) => decision.n));
    const wrong = ns.filter((n) => !guessed.has(n));
    if (wrong.length) throw new Error(`${wrong.map((n) => `D-${n}`).join(', ')} is not a decision sous took on your behalf`);
    const record = await this.record(run.key);
    const confirmed = [...new Set([...record.confirmed, ...ns])].sort((a, b) => a - b);
    await this.deps.upsertCache(GATE_CACHE, run.key, { ...record, confirmed }, 0);
    await this.deps.event(run.key, 'OWNER_CONFIRMED', ns.map((n) => `D-${n}`).join(', ')).catch(() => undefined);
    return confirmed;
  }

  /** Marks the build's draft pull requests ready when nothing waits on the owner. Returns the pull requests it marked. */
  async settle(run: GateRun): Promise<string[]> {
    if (run.kind !== 'build' || run.productionData) return [];
    const record = await this.record(run.key);
    const urls = [run.prBe, run.prFe].filter((url): url is string => Boolean(url) && !record.ready.includes(url!));
    if (!urls.length) return [];
    const pending = ownerPending(run, record.confirmed);
    if (pending.issues.length || pending.decisions.length) return [];
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

const storage = new StorageService();
const githubAPI = new GitHubAPI();

export const decisionGate = new DecisionGate({
  getCache: (namespace, key) => storage.getCache(namespace, key),
  upsertCache: (namespace, key, value, ttl) => storage.upsertCache(namespace, key, value, ttl),
  markReady: (owner, repo, pullNumber) => githubAPI.markReadyForReview(owner, repo, pullNumber),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
  afterReady: (run) => (dockMode() === 'workspace' ? autoBroadcast.afterLedger(run) : Promise.resolve()),
});
