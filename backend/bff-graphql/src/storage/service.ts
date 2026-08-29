import type { PrismaClient } from '@prisma/client';
import { prisma } from './client';
import { decrypt, encrypt, hashPin, verifyPin } from './crypto';

const SENSITIVE_KEYS = new Set([
  'jiraApiToken',
  'githubToken',
  'discordWebhookUrl',
  'googleClientSecret',
  'googleRefreshToken',
]);

export class StorageService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private cacheKey(namespace: string, key: string) { return `cache:${namespace}:${key}`; }

  async getCache(namespace: string, key: string) {
    const cache = await this.db.cacheEntry.findUnique({ where: { key: this.cacheKey(namespace, key) } });
    if (!cache) return null;
    if (cache.expiresAt && cache.expiresAt <= new Date()) {
      await this.db.cacheEntry.delete({ where: { key: cache.key } }).catch(() => undefined);
      return null;
    }
    return JSON.parse(cache.value);
  }

  upsertCache(namespace: string, key: string, value: unknown, ttlSeconds = 3600) {
    const cacheKey = this.cacheKey(namespace, key);
    const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const serializedValue = JSON.stringify(value);
    return this.db.cacheEntry.upsert({
      where: { key: cacheKey },
      update: { value: serializedValue, expiresAt },
      create: { key: cacheKey, value: serializedValue, expiresAt },
    });
  }

  getDemoLink(ticketKey: string) { return this.db.demoLink.findUnique({ where: { ticketKey } }); }
  upsertDemoLink(ticketKey: string, url: string) {
    return this.db.demoLink.upsert({ where: { ticketKey }, update: { url }, create: { ticketKey, url } });
  }
  deleteDemoLink(ticketKey: string) { return this.db.demoLink.delete({ where: { ticketKey } }); }

  async getSettings() {
    const settings = await this.db.appSettings.findMany();
    return settings.map((setting) => SENSITIVE_KEYS.has(setting.key)
      ? { ...setting, value: decrypt(setting.value) }
      : setting);
  }

  upsertSetting(key: string, value: string, description?: string) {
    const storedValue = SENSITIVE_KEYS.has(key) ? encrypt(value) : value;
    return this.db.appSettings.upsert({
      where: { key }, update: { value: storedValue, description },
      create: { key, value: storedValue, description },
    });
  }

  deleteSetting(key: string) {
    return this.db.appSettings.delete({ where: { key } }).catch(() => undefined);
  }

  getQuickLinks() {
    return this.db.quickLink.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  createQuickLink(data: { title: string; url: string; color: string; position?: number }) {
    return this.db.quickLink.create({ data: { ...data, position: data.position ?? 0 } });
  }

  deleteQuickLink(id: string) {
    return this.db.quickLink.delete({ where: { id } });
  }

  getMonitorTargets() {
    return this.db.monitorTarget.findMany({ orderBy: [{ name: 'asc' }, { createdAt: 'asc' }] });
  }

  countMonitorTargets() {
    return this.db.monitorTarget.count();
  }

  getMonitorTarget(id: string) {
    return this.db.monitorTarget.findUnique({ where: { id } });
  }

  createMonitorTarget(data: { name: string; url: string; expectedStatus: number; timeoutMs: number }) {
    return this.db.monitorTarget.create({ data });
  }

  updateMonitorTarget(id: string, data: { name: string; url: string; expectedStatus: number; timeoutMs: number }) {
    return this.db.monitorTarget.update({ where: { id }, data });
  }

  updateMonitorResult(id: string, data: {
    lastStatus: string;
    lastStatusCode?: number | null;
    lastLatencyMs: number;
    lastCheckedAt: Date;
    lastError?: string | null;
  }) {
    return this.db.monitorTarget.update({ where: { id }, data });
  }

  deleteMonitorTarget(id: string) {
    return this.db.monitorTarget.delete({ where: { id } });
  }

  async hasMasterPin() {
    const pin = await this.db.appSettings.findUnique({ where: { key: 'masterPin' } });
    return Boolean(pin?.value);
  }

  setMasterPin(pin: string) {
    const value = hashPin(pin);
    return this.db.appSettings.upsert({
      where: { key: 'masterPin' }, update: { value, description: 'Master Passcode PIN Hash' },
      create: { key: 'masterPin', value, description: 'Master Passcode PIN Hash' },
    });
  }

  async verifyMasterPin(pin: string) {
    const stored = await this.db.appSettings.findUnique({ where: { key: 'masterPin' } });
    return !stored?.value || verifyPin(pin, stored.value);
  }

  async changeMasterPin(oldPin: string, newPin: string) {
    if (!await this.verifyMasterPin(oldPin)) return false;
    await this.setMasterPin(newPin);
    return true;
  }

  async removeMasterPin(oldPin: string) {
    if (!await this.verifyMasterPin(oldPin)) return false;
    await this.db.appSettings.delete({ where: { key: 'masterPin' } }).catch(() => undefined);
    return true;
  }

  getRepositories() { return this.db.monitoredRepository.findMany(); }
  createRepository(data: { owner: string; name: string; webhookSecret?: string }) {
    return this.db.monitoredRepository.create({ data });
  }
  getTicketCache(key: string) { return this.db.ticketCache.findUnique({ where: { key } }); }
  getAllTicketCache() { return this.db.ticketCache.findMany(); }
  upsertTicketCache(data: { key: string; summary: string; description?: string; status: string; assignee?: string; reporter?: string; priority?: string }) {
    return this.db.ticketCache.upsert({ where: { key: data.key }, update: data, create: data });
  }
  getPullRequestCache(repository: string, number: number) {
    return this.db.pullRequestCache.findUnique({ where: { repository_number: { repository, number } } });
  }
  getAllPullRequestCache() { return this.db.pullRequestCache.findMany(); }
  upsertPullRequestCache(data: { number: number; title: string; description?: string; state: string; url: string; author: string; repository: string; mergedAt?: Date | null }) {
    const where = { repository_number: { repository: data.repository, number: data.number } };
    return this.db.pullRequestCache.upsert({ where, update: data, create: data });
  }
}
