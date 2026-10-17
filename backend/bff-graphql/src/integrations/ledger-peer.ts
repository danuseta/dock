import { fetch, ProxyAgent } from 'undici';
import type { Orchestration } from './orchestrator';

const TIMEOUT_MS = 3000;
// The peer asks GitHub about pull requests while it lists, which can take a few seconds.
const READ_TIMEOUT_MS = 10_000;
const LAST_RUNS_MAX_AGE_MS = 5 * 60 * 1000;

export type PeerRun = Orchestration & { events?: Array<{ id: string; kind: string; detail: string | null; at: string }> };

/**
 * The workspace DOCK -> the laptop DOCK on the VPS, with the workspace ingest token.
 * Writes copy this DOCK's runs there; reads bring the laptop's runs here. A peer
 * that is down never fails the local work: writes are logged, a failed read answers the
 * last runs it read for five minutes, then nothing.
 * The proxy (tailscaled, to reach the tailnet) is used for the peer only, never for Jira or GitHub.
 */
export class LedgerPeer {
  private readonly dispatcher: ProxyAgent | undefined;
  private recent: { at: number; runs: Promise<PeerRun[]> } | null = null;
  private last: { at: number; runs: PeerRun[] } | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = TIMEOUT_MS,
    proxy?: string,
    private readonly readTimeoutMs = READ_TIMEOUT_MS,
  ) {
    this.dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  }

  private async post(route: string, body: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const response = await fetch(`${this.url.replace(/\/+$/, '')}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: this.dispatcher,
    });
    if (!response.ok) {
      const answer = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof answer?.error === 'string' ? answer.error : `${route || '/'} answered ${response.status}`);
    }
    return ((await response.json()) as { result?: unknown }).result ?? null;
  }

  /** A call whose answer the caller needs: a failure throws. */
  call(route: string, body: unknown): Promise<unknown> {
    return this.post(route, body, this.readTimeoutMs);
  }

  /** Not awaited by callers: the copy must not hold up the hook that triggered it. */
  forward(route: string, body: unknown): Promise<void> {
    return this.post(route, body).then(() => undefined, (error) => {
      console.warn('[LedgerPeer] copy failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }

  async runs(): Promise<PeerRun[]> {
    try {
      const result = await this.post('/runs', {}, this.readTimeoutMs);
      const runs = Array.isArray(result) ? result as PeerRun[] : [];
      this.last = { at: Date.now(), runs };
      return runs;
    } catch {
      return this.last && Date.now() - this.last.at < LAST_RUNS_MAX_AGE_MS ? this.last.runs : [];
    }
  }

  /** The runs read at most once per window: ticket cards ask for one run each, many times per page. */
  recentRuns(maxAgeMs = 5000, clock: () => number = Date.now): Promise<PeerRun[]> {
    if (!this.recent || clock() - this.recent.at > maxAgeMs) this.recent = { at: clock(), runs: this.runs() };
    return this.recent.runs;
  }

  async get(key: string): Promise<PeerRun | null> {
    try {
      return (await this.post('/runs/get', { key }, this.readTimeoutMs)) as PeerRun | null;
    } catch {
      return null;
    }
  }
}

export function ledgerPeerFromEnv(env: NodeJS.ProcessEnv = process.env): LedgerPeer | null {
  const url = env.DOCK_LEDGER_PEER_URL?.trim();
  const token = env.DOCK_LEDGER_PEER_TOKEN?.trim();
  return url && token ? new LedgerPeer(url, token, TIMEOUT_MS, env.DOCK_LEDGER_PEER_PROXY?.trim() || undefined) : null;
}

export const ledgerPeer = ledgerPeerFromEnv();

/**
 * This DOCK's runs, then the peer's runs of other machines. The peer decides who owns a ticket:
 * when it gives one to another machine, its run replaces the one this DOCK keeps.
 */
export function withPeerRuns<T extends { key: string }>(local: T[], peerRuns: PeerRun[], self: string): Array<T | (PeerRun & { peer: true })> {
  const theirs = peerRuns.filter((run) => run.machine !== self);
  const keys = new Set(theirs.map((run) => run.key));
  return [...local.filter((run) => !keys.has(run.key)), ...theirs.map((run) => ({ ...run, peer: true as const }))];
}
