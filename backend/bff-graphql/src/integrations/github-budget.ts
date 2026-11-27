/** Below this many requests left, only priority work reaches GitHub until the window resets. */
export const LOW_REMAINING = 500;
/** Background requests that may be out at once per credential, so a reset is not spent in one burst. */
export const BACKGROUND_CONCURRENCY = 4;
const BLOCK_WITHOUT_RESET_MS = 60_000;

export class GitHubRateLimitError extends Error {
  constructor(readonly resetAt: number, readonly reason: 'exhausted' | 'low') {
    super(reason === 'exhausted'
      ? `GitHub rate limit used up until ${new Date(resetAt).toISOString()}`
      : `GitHub rate limit low; background request deferred until ${new Date(resetAt).toISOString()}`);
    this.name = 'GitHubRateLimitError';
  }
}

export const isRateLimitError = (error: unknown): error is GitHubRateLimitError => error instanceof GitHubRateLimitError;

export interface GitHubQuotaState {
  limited: boolean;
  remaining: number | null;
  resetAt: string | null;
}

interface CredentialState {
  remaining: number;
  resetAt: number;
  blockedUntil: number;
  active: number;
  waiting: Array<() => void>;
}

type Headers = Record<string, unknown>;

const headerNumber = (headers: Headers, name: string): number | null => {
  const value = headers[name];
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The GitHub quota shared by every client of one token: what the last response said is left, and whether requests
 * wait for the reset. A used-up quota rejects every request without a network call; a low one lets only priority
 * work through; background requests go out a few at a time.
 */
export class GitHubBudget {
  private readonly states = new Map<string, CredentialState>();

  constructor(private readonly now: () => number = Date.now, private readonly concurrency = BACKGROUND_CONCURRENCY) {}

  private stateOf(key: string): CredentialState {
    let state = this.states.get(key);
    if (!state) {
      state = { remaining: -1, resetAt: 0, blockedUntil: 0, active: 0, waiting: [] };
      this.states.set(key, state);
    }
    return state;
  }

  /** Waits for a slot and returns its release; rejects with GitHubRateLimitError when the request may not go out. */
  async acquire(key: string, priority: boolean): Promise<() => void> {
    const state = this.stateOf(key);
    const now = this.now();
    if (state.blockedUntil > now) throw new GitHubRateLimitError(state.blockedUntil, 'exhausted');
    if (!priority && state.remaining >= 0 && state.remaining < LOW_REMAINING && state.resetAt > now) {
      throw new GitHubRateLimitError(state.resetAt, 'low');
    }
    if (priority) return () => undefined;
    if (state.active >= this.concurrency) {
      await new Promise<void>((resolve) => { state.waiting.push(resolve); });
      const later = this.now();
      if (state.blockedUntil > later) {
        this.wakeNext(state);
        throw new GitHubRateLimitError(state.blockedUntil, 'exhausted');
      }
    }
    state.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active -= 1;
      this.wakeNext(state);
    };
  }

  private wakeNext(state: CredentialState) {
    if (state.active < this.concurrency) state.waiting.shift()?.();
  }

  /** Reads the rate limit headers of a response; a 403 or 429 that says the quota is used up blocks until the reset. */
  record(key: string, status: number | undefined, headers: Headers = {}, message = '') {
    // Search and GraphQL count against their own quotas (search: 30 a minute); reading them as the core quota made
    // every background request after a search look like the last few of the hour.
    const resource = String(headers['x-ratelimit-resource'] ?? 'core').toLowerCase();
    if (resource !== 'core') return;
    const state = this.stateOf(key);
    const remaining = headerNumber(headers, 'x-ratelimit-remaining');
    const reset = headerNumber(headers, 'x-ratelimit-reset');
    if (remaining !== null) state.remaining = remaining;
    if (reset !== null) state.resetAt = reset * 1000;
    if (status !== 403 && status !== 429) return;
    if (remaining !== 0 && !/rate limit/i.test(message)) return;
    const retryAfter = headerNumber(headers, 'retry-after');
    const now = this.now();
    const until = retryAfter !== null ? now + retryAfter * 1000 : state.resetAt > now ? state.resetAt : now + BLOCK_WITHOUT_RESET_MS;
    state.blockedUntil = Math.max(state.blockedUntil, until);
    state.remaining = 0;
    if (state.resetAt < state.blockedUntil) state.resetAt = state.blockedUntil;
  }

  /** The quota as the Home badge shows it; nothing known reads as not limited. */
  state(key: string): GitHubQuotaState {
    const state = this.states.get(key);
    const now = this.now();
    if (!state) return { limited: false, remaining: null, resetAt: null };
    if (state.blockedUntil > now) return { limited: true, remaining: 0, resetAt: new Date(state.blockedUntil).toISOString() };
    if (state.remaining < 0 || state.resetAt <= now) return { limited: false, remaining: null, resetAt: null };
    return { limited: false, remaining: state.remaining, resetAt: new Date(state.resetAt).toISOString() };
  }
}

export const githubBudget = new GitHubBudget();
