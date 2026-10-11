import axios from 'axios';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { StorageService } from '../storage/service';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const OAUTH_STATE_NAMESPACE = 'google-oauth-state';
const OAUTH_STATE_TTL_SECONDS = 30 * 60;
const FAILURE_BACKOFF_MS = 60 * 1000;
const SIGN_IN_REJECTED_MESSAGE = 'Google rejected the saved sign-in. Connect Google Calendar again in Settings.';
const REQUEST_REJECTED_MESSAGE = 'Google rejected the calendar request. Check the Calendar ID in Settings.';
const TEMPORARY_FAILURE_MESSAGE = 'Google Calendar could not be reached. DOCK will retry shortly.';

interface OAuthState {
  value: string;
  expiresAt: number;
}

interface CalendarFailure {
  credential: string;
  message: string;
  retryAt: number;
}

export class CalendarUnavailableError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly logLine: string) {
    super(message);
  }
}

function googleErrorLine(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { error?: string | { status?: string; message?: string }; error_description?: string } } })?.response;
  const data = response?.data;
  const parts = typeof data?.error === 'string'
    ? [data.error, data.error_description]
    : [data?.error?.status, data?.error?.message];
  return [`status=${response?.status ?? 'none'}`, ...parts.filter((part) => typeof part === 'string' && part)].join(' ');
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  url: string | null;
  calendarId: string;
}

export function normalizeCalendarEvent(event: any, calendarId: string): CalendarEvent | null {
  if (event.status === 'cancelled' || (!event.start?.dateTime && !event.start?.date)) return null;
  return {
    id: String(event.id),
    title: event.summary || 'Untitled event',
    start: event.start.dateTime || event.start.date,
    end: event.end?.dateTime || event.end?.date || null,
    allDay: Boolean(event.start.date && !event.start.dateTime),
    location: event.location || null,
    url: event.htmlLink || null,
    calendarId,
  };
}

export class GoogleCalendarService {
  private readonly states = new Map<string, OAuthState>();
  private failure: CalendarFailure | null = null;

  constructor(private readonly storage = new StorageService()) {}

  private async settings(): Promise<Record<string, string>> {
    const items = await this.storage.getSettings();
    return Object.fromEntries(items.map((item) => [item.key, item.value]));
  }

  private async createState(): Promise<string> {
    const value = randomBytes(32).toString('base64url');
    this.states.set(value, { value, expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000 });
    for (const [key, state] of this.states) {
      if (state.expiresAt <= Date.now()) this.states.delete(key);
    }
    const storage = this.storage as StorageService & {
      upsertCache?: (namespace: string, key: string, state: unknown, ttlSeconds?: number) => Promise<unknown>;
    };
    await Promise.resolve(storage.upsertCache?.(OAUTH_STATE_NAMESPACE, value, value, OAUTH_STATE_TTL_SECONDS)).catch(() => undefined);
    return value;
  }

  private async consumeState(received: string): Promise<boolean> {
    const stored = this.states.get(received);
    this.states.delete(received);
    const storage = this.storage as StorageService & {
      getCache?: (namespace: string, key: string) => Promise<unknown>;
      deleteCache?: (namespace: string, key: string) => Promise<unknown>;
    };
    const persisted = stored ? null : await Promise.resolve(storage.getCache?.(OAUTH_STATE_NAMESPACE, received)).catch(() => null);
    await Promise.resolve(storage.deleteCache?.(OAUTH_STATE_NAMESPACE, received)).catch(() => undefined);
    const candidate = stored && stored.expiresAt > Date.now() ? stored.value : persisted;
    if (typeof candidate !== 'string') return false;
    const left = Buffer.from(received);
    const right = Buffer.from(candidate);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async authorizationUrl(redirectUri: string): Promise<string> {
    const settings = await this.settings();
    if (!settings.googleClientId || !settings.googleClientSecret) {
      throw new Error('Google OAuth client credentials are not configured');
    }
    const query = new URLSearchParams({
      client_id: settings.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: await this.createState(),
    });
    return `${GOOGLE_AUTH_URL}?${query.toString()}`;
  }

  async completeAuthorization(code: string, state: string, redirectUri: string): Promise<void> {
    if (!code || !state) throw new Error('Invalid or expired OAuth state');
    const settings = await this.settings();
    if (!settings.googleClientId || !settings.googleClientSecret) throw new Error('Google OAuth is not configured');
    if (!await this.consumeState(state)) throw new Error('Invalid or expired OAuth state');
    const body = new URLSearchParams({
      code,
      client_id: settings.googleClientId,
      client_secret: settings.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const response = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    const refreshToken = response.data?.refresh_token || settings.googleRefreshToken;
    if (!refreshToken) throw new Error('Google did not return a refresh token');
    this.failure = null;
    if (response.data?.refresh_token) {
      await this.storage.upsertSetting('googleRefreshToken', refreshToken, 'Google Calendar OAuth refresh token');
    }
  }

  private async accessToken(settings?: Record<string, string>): Promise<string> {
    const activeSettings = settings || await this.settings();
    if (!activeSettings.googleClientId || !activeSettings.googleClientSecret || !activeSettings.googleRefreshToken) {
      throw new Error('Google Calendar is not connected');
    }
    const body = new URLSearchParams({
      client_id: activeSettings.googleClientId,
      client_secret: activeSettings.googleClientSecret,
      refresh_token: activeSettings.googleRefreshToken,
      grant_type: 'refresh_token',
    });
    const response = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }).catch((error) => {
      const status = error?.response?.status;
      if (status === 400 || status === 401) {
        throw new CalendarUnavailableError(SIGN_IN_REJECTED_MESSAGE, false, `token refresh rejected ${googleErrorLine(error)}`);
      }
      throw error;
    });
    if (!response.data?.access_token) throw new Error('Google access token refresh failed');
    return response.data.access_token;
  }

  async listEvents(timeMin?: string, timeMax?: string, maxResults = 25): Promise<CalendarEvent[]> {
    const settings = await this.settings();
    if (!settings.googleClientId || !settings.googleClientSecret || !settings.googleRefreshToken) {
      throw new Error('Google Calendar is not connected');
    }
    const calendarId = settings.googleCalendarId?.trim() || 'primary';
    const validTimeMin = timeMin && !Number.isNaN(Date.parse(timeMin)) ? timeMin : undefined;
    const validTimeMax = timeMax && !Number.isNaN(Date.parse(timeMax)) ? timeMax : undefined;
    const from = validTimeMin ? new Date(validTimeMin) : new Date();
    const to = validTimeMax
      ? new Date(validTimeMax)
      : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (to <= from) throw new Error('Calendar timeMax must be after timeMin');
    const limit = Math.max(1, Math.min(maxResults, 50));
    const credentialId = createHash('sha256').update(settings.googleRefreshToken).digest('hex').slice(0, 16);
    const cacheKey = [credentialId, calendarId, validTimeMin || 'now', validTimeMax || '30d', limit].join('_');
    const cached = await this.storage.getCache('google-calendar', cacheKey).catch(() => null);
    if (Array.isArray(cached)) return cached;

    const credential = createHash('sha256')
      .update([settings.googleClientId, settings.googleClientSecret, settings.googleRefreshToken].join('\n'))
      .digest('hex');
    if (this.failure?.credential === credential && Date.now() < this.failure.retryAt) {
      throw new CalendarUnavailableError(this.failure.message, true, '');
    }

    try {
      const token = await this.accessToken(settings);
      const response = await axios.get(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: limit,
          },
          timeout: 10000,
        },
      );
      const events = (response.data?.items || [])
        .map((event: any) => normalizeCalendarEvent(event, calendarId))
        .filter((event: CalendarEvent | null): event is CalendarEvent => event !== null);
      this.failure = null;
      await this.storage.upsertCache('google-calendar', cacheKey, events, 300).catch(() => undefined);
      return events;
    } catch (error) {
      throw this.recordFailure(credential, error);
    }
  }

  lastError(): string | null {
    return this.failure?.message ?? null;
  }

  private recordFailure(credential: string, error: unknown): CalendarUnavailableError {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const known = error instanceof CalendarUnavailableError ? error : null;
    const message = known?.message
      ?? (status === 400 || status === 404 ? REQUEST_REJECTED_MESSAGE : TEMPORARY_FAILURE_MESSAGE);
    const logLine = known?.logLine ?? `events request failed ${googleErrorLine(error)}`;
    if (this.failure?.credential !== credential || this.failure.message !== message) {
      console.warn(`[Google Calendar] ${logLine}`);
    }
    this.failure = {
      credential,
      message,
      retryAt: known && !known.retryable ? Number.POSITIVE_INFINITY : Date.now() + FAILURE_BACKOFF_MS,
    };
    return new CalendarUnavailableError(message, this.failure.retryAt !== Number.POSITIVE_INFINITY, logLine);
  }

  async disconnect(): Promise<void> {
    const settings = await this.settings();
    if (settings.googleRefreshToken) {
      await axios.post(GOOGLE_REVOKE_URL, new URLSearchParams({ token: settings.googleRefreshToken }).toString(), {
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 10000,
      }).catch(() => undefined);
    }
    this.failure = null;
    await this.storage.deleteSetting('googleRefreshToken');
  }
}

export const googleCalendarService = new GoogleCalendarService();
