import { fetch, ProxyAgent } from 'undici';
import type { Orchestration } from './orchestrator';

const TIMEOUT_MS = 3000;
// The peer asks GitHub about pull requests while it lists, which can take a few seconds.
const READ_TIMEOUT_MS = 10_000;
const LAST_RUNS_MAX_AGE_MS = 5 * 60 * 1000;

export type PeerRun = Orchestration;

/**
 * The workspace DOCK -> the laptop DOCK on the VPS, with the workspace ingest token.
 * Writes copy shared settings there; reads bring the laptop's runs here for the cron only. A peer
 * that is down never fails the local work: writes are logged, a failed read answers the
 * last runs it read for five minutes, then nothing.
 * The proxy (tailscaled, to reach the tailnet) is used for the peer only, never for Jira or GitHub.
 */
export class LedgerPeer {
  private readonly dispatcher: ProxyAgent | undefined;
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
}

export function ledgerPeerFromEnv(env: NodeJS.ProcessEnv = process.env): LedgerPeer | null {
  const url = env.DOCK_LEDGER_PEER_URL?.trim();
  const token = env.DOCK_LEDGER_PEER_TOKEN?.trim();
  return url && token ? new LedgerPeer(url, token, TIMEOUT_MS, env.DOCK_LEDGER_PEER_PROXY?.trim() || undefined) : null;
}

export const ledgerPeer = ledgerPeerFromEnv();
