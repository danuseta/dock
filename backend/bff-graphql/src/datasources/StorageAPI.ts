import { StorageService } from '../storage/service';

const MIN_SERVICE_HEALTH_REFRESH_SECONDS = 5;
const MAX_SERVICE_HEALTH_REFRESH_SECONDS = 86_400;

export const isValidServiceHealthRefreshSeconds = (value: unknown) => {
  const seconds = Number(value);
  return Number.isInteger(seconds)
    && seconds >= MIN_SERVICE_HEALTH_REFRESH_SECONDS
    && seconds <= MAX_SERVICE_HEALTH_REFRESH_SECONDS;
};

export class StorageAPI {
  private readonly sensitiveKeys = new Set([
    'jiraApiToken', 'githubToken', 'discordWebhookUrl', 'googleClientSecret', 'googleRefreshToken',
  ]);

  constructor(private readonly storage = new StorageService()) {}

  getDemoLink(ticketKey: string) {
    return this.storage.getDemoLink(ticketKey).catch(() => null);
  }

  async saveDemoLink(ticketKey: string, url: string) {
    try {
      await this.storage.upsertDemoLink(ticketKey, url);
      return true;
    } catch { return false; }
  }

  async getSettings(): Promise<Record<string, any>> {
    const [rawSettings, hasMasterPin] = await Promise.all([
      this.storage.getSettings(), this.storage.hasMasterPin(),
    ]);
    const formatted: Record<string, any> = {};
    rawSettings.forEach((item) => { formatted[item.key] = item.value; });
    formatted.hasMasterPin = hasMasterPin;
    return formatted;
  }

  async getPublicSettings() {
    const settings: any = await this.getSettings();
    return {
      jiraUrl: settings.jiraUrl || null,
      jiraEmail: settings.jiraEmail || null,
      jiraProjectKeys: settings.jiraProjectKeys || null,
      githubRepos: settings.githubRepos || null,
      googleClientId: settings.googleClientId || null,
      googleCalendarId: settings.googleCalendarId || 'primary',
      hasJiraApiToken: Boolean(settings.jiraApiToken),
      hasGithubToken: Boolean(settings.githubToken),
      hasDiscordWebhookUrl: Boolean(settings.discordWebhookUrl),
      hasGoogleClientSecret: Boolean(settings.googleClientSecret),
      googleCalendarConnected: Boolean(settings.googleRefreshToken),
      serviceHealthRefreshSeconds: isValidServiceHealthRefreshSeconds(settings.serviceHealthRefreshSeconds)
        ? Number(settings.serviceHealthRefreshSeconds)
        : 60,
      hasMasterPin: Boolean(settings.hasMasterPin),
    };
  }

  async updateSettings(input: Record<string, unknown>) {
    try {
      if (input.serviceHealthRefreshSeconds != null
        && !isValidServiceHealthRefreshSeconds(input.serviceHealthRefreshSeconds)) {
        throw new Error('Invalid service health refresh interval');
      }
      await Promise.all(Object.entries(input)
        .filter(([key, value]) => !(this.sensitiveKeys.has(key)
          && (value == null || String(value).trim() === '')))
        .map(([key, value]) => this.storage.upsertSetting(key, value == null ? '' : String(value))));
      return true;
    } catch { return false; }
  }

  getQuickLinks() {
    return this.storage.getQuickLinks();
  }

  async addQuickLink(input: { title?: string; url?: string; color?: string }) {
    const title = input.title?.trim() || '';
    const url = input.url?.trim() || '';
    const color = input.color?.trim() || '#60a5fa';
    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(url); } catch { parsedUrl = null; }
    if (!title || title.length > 80 || !parsedUrl
      || !['http:', 'https:'].includes(parsedUrl.protocol) || url.length > 2048) {
      throw new Error('A title and a valid HTTP(S) URL are required');
    }
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid highlight color');
    return this.storage.createQuickLink({ title, url, color });
  }

  async removeQuickLink(id: string) {
    if (!id) return false;
    await this.storage.deleteQuickLink(id);
    return true;
  }

  async setMasterPin(pin: string) {
    if (!/^\d{4,6}$/.test(pin)) return false;
    await this.storage.setMasterPin(pin);
    return true;
  }

  verifyMasterPin(pin: string) {
    if (!/^\d{4,6}$/.test(pin)) return Promise.resolve(false);
    return this.storage.verifyMasterPin(pin).catch(() => false);
  }

  changeMasterPin(oldPin: string, newPin: string) {
    if (!/^\d{4,6}$/.test(newPin)) return Promise.resolve(false);
    return this.storage.changeMasterPin(oldPin, newPin).catch(() => false);
  }

  removeMasterPin(oldPin: string) {
    return this.storage.removeMasterPin(oldPin).catch(() => false);
  }
}
