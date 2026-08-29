import axios from 'axios';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StorageService } from '../storage/service';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

interface OAuthState {
  value: string;
  expiresAt: number;
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

  constructor(private readonly storage = new StorageService()) {}

  private async settings(): Promise<Record<string, string>> {
    const items = await this.storage.getSettings();
    return Object.fromEntries(items.map((item) => [item.key, item.value]));
  }

  private createState(): string {
    const value = randomBytes(32).toString('base64url');
    this.states.set(value, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
    for (const [key, state] of this.states) {
      if (state.expiresAt <= Date.now()) this.states.delete(key);
    }
    return value;
  }

  private consumeState(received: string): boolean {
    const stored = this.states.get(received);
    this.states.delete(received);
    if (!stored || stored.expiresAt <= Date.now()) return false;
    const left = Buffer.from(received);
    const right = Buffer.from(stored.value);
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
      state: this.createState(),
    });
    return `${GOOGLE_AUTH_URL}?${query.toString()}`;
  }

  async completeAuthorization(code: string, state: string, redirectUri: string): Promise<void> {
    if (!code || !state || !this.consumeState(state)) throw new Error('Invalid or expired OAuth state');
    const settings = await this.settings();
    if (!settings.googleClientId || !settings.googleClientSecret) throw new Error('Google OAuth is not configured');
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
    const refreshToken = response.data?.refresh_token;
    if (!refreshToken) throw new Error('Google did not return a refresh token');
    await this.storage.upsertSetting('googleRefreshToken', refreshToken, 'Google Calendar OAuth refresh token');
  }

  private async accessToken(): Promise<{ token: string; settings: Record<string, string> }> {
    const settings = await this.settings();
    if (!settings.googleClientId || !settings.googleClientSecret || !settings.googleRefreshToken) {
      throw new Error('Google Calendar is not connected');
    }
    const body = new URLSearchParams({
      client_id: settings.googleClientId,
      client_secret: settings.googleClientSecret,
      refresh_token: settings.googleRefreshToken,
      grant_type: 'refresh_token',
    });
    const response = await axios.post(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    if (!response.data?.access_token) throw new Error('Google access token refresh failed');
    return { token: response.data.access_token, settings };
  }

  async listEvents(timeMin?: string, timeMax?: string, maxResults = 25): Promise<CalendarEvent[]> {
    const { token, settings } = await this.accessToken();
    const calendarId = settings.googleCalendarId?.trim() || 'primary';
    const from = timeMin && !Number.isNaN(Date.parse(timeMin)) ? new Date(timeMin) : new Date();
    const to = timeMax && !Number.isNaN(Date.parse(timeMax))
      ? new Date(timeMax)
      : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (to <= from) throw new Error('Calendar timeMax must be after timeMin');
    const response = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: Math.max(1, Math.min(maxResults, 50)),
        },
        timeout: 10000,
      },
    );
    return (response.data?.items || [])
      .map((event: any) => normalizeCalendarEvent(event, calendarId))
      .filter((event: CalendarEvent | null): event is CalendarEvent => event !== null);
  }

  async disconnect(): Promise<void> {
    const settings = await this.settings();
    if (settings.googleRefreshToken) {
      await axios.post(GOOGLE_REVOKE_URL, new URLSearchParams({ token: settings.googleRefreshToken }).toString(), {
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 10000,
      }).catch(() => undefined);
    }
    await this.storage.deleteSetting('googleRefreshToken');
  }
}

export const googleCalendarService = new GoogleCalendarService();
