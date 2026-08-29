import assert from 'node:assert';
import test from 'node:test';
import type { Request, Response } from 'express';
import { PinRateLimiter, SessionManager } from '../auth/session';

function responseStub() {
  const cookies: string[] = [];
  const cleared: string[] = [];
  const response = {
    cookie(name: string, value: string) {
      cookies.push(`${name}=${value}`);
      return response;
    },
    clearCookie(name: string) {
      cleared.push(name);
      return response;
    },
  } as unknown as Response;
  return { response, cookies, cleared };
}

function requestWithCookie(cookie?: string): Request {
  return { headers: { cookie } } as Request;
}

test('server-side PIN sessions use opaque cookies and expire', () => {
  const sessions = new SessionManager(1_000);
  const { response, cookies, cleared } = responseStub();
  const token = sessions.create(response, 10_000);

  assert.ok(token.length >= 40);
  assert.match(cookies[0], /^jidis_session=/);
  assert.strictEqual(sessions.isAuthenticated(requestWithCookie(cookies[0]), 10_999), true);
  assert.strictEqual(sessions.isAuthenticated(requestWithCookie(cookies[0]), 11_000), false);

  const activeToken = sessions.create(response, 20_000);
  const request = requestWithCookie(`jidis_session=${activeToken}`);
  sessions.clear(request, response);
  assert.strictEqual(sessions.isAuthenticated(request, 20_001), false);
  assert.deepStrictEqual(cleared, ['jidis_session']);
});

test('PIN limiter blocks only after the configured failed-attempt budget', () => {
  const limiter = new PinRateLimiter(2, 1_000);
  limiter.recordFailure('client', 5_000);
  assert.strictEqual(limiter.retryAfterSeconds('client', 5_100), 0);

  limiter.recordFailure('client', 5_200);
  assert.strictEqual(limiter.retryAfterSeconds('client', 5_200), 1);
  assert.strictEqual(limiter.retryAfterSeconds('client', 6_000), 0);

  limiter.recordFailure('client', 7_000);
  limiter.reset('client');
  assert.strictEqual(limiter.retryAfterSeconds('client', 7_100), 0);
});
