import assert from 'node:assert';
import test from 'node:test';
import type { CookieOptions, Request, Response } from 'express';
import { isTailscaleRequest, missingPinWarning, PinRateLimiter, SessionManager, shouldRequirePin } from '../auth/session';

function responseStub() {
  const cookies: string[] = [];
  const cleared: string[] = [];
  const cookieOptions: CookieOptions[] = [];
  const clearOptions: CookieOptions[] = [];
  const response = {
    cookie(name: string, value: string, options: CookieOptions) {
      cookies.push(`${name}=${value}`);
      cookieOptions.push(options);
      return response;
    },
    clearCookie(name: string, options: CookieOptions) {
      cleared.push(name);
      clearOptions.push(options);
      return response;
    },
  } as unknown as Response;
  return { response, cookies, cleared, cookieOptions, clearOptions };
}

function requestWithCookie(cookie?: string, headers: Record<string, string> = {}): Request {
  return { headers: { cookie, ...headers }, ip: headers['x-forwarded-for'] } as Request;
}

test('server-side PIN sessions use opaque secure cookies and expire', () => {
  const sessions = new SessionManager(1_000, true);
  const { response, cookies, cleared, cookieOptions, clearOptions } = responseStub();
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
  assert.strictEqual(cookieOptions[0].secure, true);
  assert.strictEqual(clearOptions[0].secure, true);
  assert.strictEqual(clearOptions[0].maxAge, undefined);
});

test('PIN sessions can explicitly support a private HTTP tunnel', () => {
  const sessions = new SessionManager(1_000, false);
  const { response, cookieOptions } = responseStub();

  sessions.create(response);

  assert.strictEqual(cookieOptions[0].secure, false);
  assert.strictEqual(cookieOptions[0].httpOnly, true);
  assert.strictEqual(cookieOptions[0].sameSite, 'strict');
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

test('auto PIN mode trusts Tailscale requests but keeps local access protected', () => {
  const previousMode = process.env.DOCK_PIN_MODE;
  delete process.env.DOCK_PIN_MODE;

  try {
    const tailnetRequest = requestWithCookie(undefined, {
      host: 'danuseta-dock.tail01220c.ts.net',
      'x-forwarded-for': '100.105.125.100',
    });
    const localRequest = requestWithCookie(undefined, {
      host: 'localhost:3101',
      'x-forwarded-for': '192.168.1.20',
    });

    assert.strictEqual(isTailscaleRequest(tailnetRequest), true);
    assert.strictEqual(shouldRequirePin(tailnetRequest, true), false);
    assert.strictEqual(isTailscaleRequest(localRequest), false);
    assert.strictEqual(shouldRequirePin(localRequest, true), true);
  } finally {
    if (previousMode === undefined) delete process.env.DOCK_PIN_MODE;
    else process.env.DOCK_PIN_MODE = previousMode;
  }
});

test('the server warns when the PIN is required by mode but none is stored', () => {
  const previous = process.env.DOCK_PIN_MODE;
  try {
    process.env.DOCK_PIN_MODE = 'always';
    assert.match(missingPinWarning(false) ?? '', /DOCK_PIN_MODE is always but no master PIN is stored/);
    assert.strictEqual(missingPinWarning(true), null);
    assert.strictEqual(shouldRequirePin(requestWithCookie(), false), false, 'the first PIN can still be set');
    for (const mode of ['auto', 'disabled', undefined]) {
      if (mode) process.env.DOCK_PIN_MODE = mode; else delete process.env.DOCK_PIN_MODE;
      assert.strictEqual(missingPinWarning(false), null);
    }
  } finally {
    if (previous === undefined) delete process.env.DOCK_PIN_MODE; else process.env.DOCK_PIN_MODE = previous;
  }
});
