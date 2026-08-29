import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

const SESSION_COOKIE = 'jidis_session';
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_ATTEMPTS = 5;

interface Session {
  expiresAt: number;
}

interface AttemptWindow {
  count: number;
  resetAt: number;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs = DEFAULT_SESSION_TTL_MS) {}

  create(response: Response, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { expiresAt: now + this.ttlMs });
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: this.ttlMs,
      path: '/',
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });
    return token;
  }

  isAuthenticated(request: Request, now = Date.now()): boolean {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return false;

    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  clear(request: Request, response: Response): void {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) this.sessions.delete(token);
    response.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict' });
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export class PinRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(
    private readonly maxAttempts = DEFAULT_RATE_LIMIT_ATTEMPTS,
    private readonly windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  ) {}

  retryAfterSeconds(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      if (attempt) this.attempts.delete(key);
      return 0;
    }
    return attempt.count >= this.maxAttempts
      ? Math.max(1, Math.ceil((attempt.resetAt - now) / 1000))
      : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    attempt.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export interface AuthContext {
  request: Request;
  response: Response;
  authenticated: boolean;
  clientKey: string;
  sessions: SessionManager;
  pinRateLimiter: PinRateLimiter;
}

export const sessionManager = new SessionManager();
export const pinRateLimiter = new PinRateLimiter();
