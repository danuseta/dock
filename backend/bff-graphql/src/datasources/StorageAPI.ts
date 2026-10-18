import { StorageService } from '../storage/service';
import { DEFAULT_DISCORD_MESSAGE_TEMPLATE, normalizeDiscordMessageTemplate } from '../integrations/discord';

const MIN_SERVICE_HEALTH_REFRESH_SECONDS = 5;
const MAX_SERVICE_HEALTH_REFRESH_SECONDS = 86_400;
const JIRA_TICKET_KEY = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d{0,9}$/;

export const normalizeTicketKey = (value: unknown) => {
  const key = String(value || '').trim().toUpperCase();
  if (!JIRA_TICKET_KEY.test(key)) throw new Error('Invalid Jira ticket key');
  return key;
};

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

  listDemoLinks() {
    return this.storage.listDemoLinks();
  }

  async saveDemoLink(ticketKey: string, url: string) {
    try {
      await this.storage.upsertDemoLink(ticketKey, url);
      return true;
    } catch (error) {
      console.error(`[Storage] Failed to save demo link for ${ticketKey}:`, error instanceof Error ? error.message : error);
      return false;
    }
  }

  async getTicketRelationGroup(ticketKeyInput: string) {
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    const relations = await this.storage.getTicketDependencies();
    const parentByTicket = new Map(relations.map((relation) => [relation.ticketKey, relation.dependsOnKey]));
    const adjacency = new Map<string, Set<string>>();
    const connect = (first: string, second: string) => {
      if (!adjacency.has(first)) adjacency.set(first, new Set());
      adjacency.get(first)?.add(second);
    };
    relations.forEach(({ ticketKey: child, dependsOnKey: parent }) => {
      connect(child, parent);
      connect(parent, child);
    });

    const group = new Set([ticketKey]);
    const queue = [ticketKey];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const related of adjacency.get(current) || []) {
        if (group.has(related)) continue;
        group.add(related);
        queue.push(related);
      }
    }

    let primaryKey = ticketKey;
    const visited = new Set<string>();
    while (parentByTicket.has(primaryKey) && !visited.has(primaryKey)) {
      visited.add(primaryKey);
      primaryKey = parentByTicket.get(primaryKey) as string;
    }
    const ticketKeys = [primaryKey, ...[...group].filter((key) => key !== primaryKey).sort()];
    return { primaryKey, dependsOnKey: parentByTicket.get(ticketKey) || null, ticketKeys };
  }

  async setTicketDependency(ticketKeyInput: string, dependsOnKeyInput: string) {
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    const dependsOnKey = normalizeTicketKey(dependsOnKeyInput);
    if (ticketKey === dependsOnKey) throw new Error('A ticket cannot depend on itself');
    const parentGroup = await this.getTicketRelationGroup(dependsOnKey);
    if (parentGroup.ticketKeys.includes(ticketKey)) throw new Error('Ticket dependency would create a cycle');
    await this.storage.upsertTicketDependency(ticketKey, dependsOnKey);
    return this.getTicketRelationGroup(ticketKey);
  }

  private orders: { at: number; value: Promise<Map<string, number>> } | null = null;

  /** DOCK work order numbers by ticket key, read at most once every two seconds (one board render asks per ticket). */
  ticketOrders(): Promise<Map<string, number>> {
    if (!this.orders || Date.now() - this.orders.at > 2000) this.orders = { at: Date.now(), value: this.storage.getTicketOrders() };
    return this.orders.value;
  }

  async setTicketOrder(ticketKeyInput: string, position: number) {
    if (!Number.isInteger(position) || position < 1 || position > 999) throw new Error('The order must be a whole number from 1 to 999');
    await this.storage.setTicketOrder(normalizeTicketKey(ticketKeyInput), position);
    this.orders = null;
  }

  async clearTicketOrder(ticketKeyInput: string) {
    await this.storage.deleteTicketOrder(normalizeTicketKey(ticketKeyInput));
    this.orders = null;
  }

  private manual: { at: number; value: Promise<Set<string>> } | null = null;

  /** Tickets the owner works by hand, read at most once every two seconds like the work order. */
  manualTickets(): Promise<Set<string>> {
    if (!this.manual || Date.now() - this.manual.at > 2000) this.manual = { at: Date.now(), value: this.storage.getManualTicketKeys() };
    return this.manual.value;
  }

  async setTicketManual(ticketKeyInput: string, manual: boolean) {
    await this.storage.setTicketManual(normalizeTicketKey(ticketKeyInput), manual);
    this.manual = null;
  }

  async clearTicketDependency(ticketKeyInput: string) {
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    await this.storage.deleteTicketDependency(ticketKey);
    return this.getTicketRelationGroup(ticketKey);
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

  hasMasterPin() {
    return this.storage.hasMasterPin();
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
      discordMessageTemplate: settings.discordMessageTemplate || DEFAULT_DISCORD_MESSAGE_TEMPLATE,
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
      if (input.discordMessageTemplate != null) normalizeDiscordMessageTemplate(String(input.discordMessageTemplate));
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
