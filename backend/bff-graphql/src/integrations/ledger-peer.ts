import { fetch, ProxyAgent } from 'undici';
import type { Orchestration } from './orchestrator';

const TIMEOUT_MS = 3000;

export type PeerRun = Orchestration & { events?: Array<{ id: string; kind: string; detail: string | null; at: string }> };

/**
 * The workspace DOCK -> the laptop DOCK on the VPS, with the workspace ingest token.
 * Writes copy this DOCK's runs there; reads bring the laptop's runs here. A peer
 * that is down never fails the local work: writes are logged, reads come back empty.
 * The proxy (tailscaled, to reach the tailnet) is used for the peer only, never for Jira or GitHub.
 */
export class LedgerPeer {
  private readonly dispatcher: ProxyAgent | undefined;
  private recent: { at: number; runs: Promise<PeerRun[]> } | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = TIMEOUT_MS,
    proxy?: string,
  ) {
    this.dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  }

  private async post(route: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.url.replace(/\/+$/, '')}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
      dispatcher: this.dispatcher,
    });
    if (!response.ok) throw new Error(`${route || '/'} answered ${response.status}`);
    return ((await response.json()) as { result?: unknown }).result ?? null;
  }

  /** Not awaited by callers: the copy must not hold up the hook that triggered it. */
  forward(route: string, body: unknown): Promise<void> {
    return this.post(route, body).then(() => undefined, (error) => {
      console.warn('[LedgerPeer] copy failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }

  async runs(): Promise<PeerRun[]> {
    try {
      const result = await this.post('/runs', {});
      return Array.isArray(result) ? result as PeerRun[] : [];
    } catch {
      return [];
    }
  }

  /** The runs read at most once per window: ticket cards ask for one run each, many times per page. */
  recentRuns(maxAgeMs = 5000, clock: () => number = Date.now): Promise<PeerRun[]> {
    if (!this.recent || clock() - this.recent.at > maxAgeMs) this.recent = { at: clock(), runs: this.runs() };
    return this.recent.runs;
  }

  async get(key: string): Promise<PeerRun | null> {
    try {
      return (await this.post('/runs/get', { key })) as PeerRun | null;
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

/** This DOCK's runs, then the peer's runs of other machines that this DOCK does not keep itself. */
export function withPeerRuns<T extends { key: string }>(local: T[], peerRuns: PeerRun[], self: string): Array<T | (PeerRun & { peer: true })> {
  const keys = new Set(local.map((run) => run.key));
  return [...local, ...peerRuns.filter((run) => run.machine !== self && !keys.has(run.key)).map((run) => ({ ...run, peer: true as const }))];
}
