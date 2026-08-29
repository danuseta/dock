import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt, hashPin } from '../utils/crypto';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error('DATABASE_URL is required');
}
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

const SENSITIVE_KEYS = ['jiraApiToken', 'githubToken', 'discordWebhookUrl'];

export class StorageService {
  private cacheKey(namespace: string, key: string) {
    return `cache:${namespace}:${key}`;
  }

  async getCache(namespace: string, key: string) {
    const cache = await prisma.cacheEntry.findUnique({
      where: { key: this.cacheKey(namespace, key) }
    });

    if (!cache) return null;
    if (cache.expiresAt && cache.expiresAt <= new Date()) {
      await prisma.cacheEntry.delete({ where: { key: cache.key } }).catch(() => undefined);
      return null;
    }

    return cache.value;
  }

  async upsertCache(namespace: string, key: string, value: any, ttlSeconds = 3600) {
    const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
    return prisma.cacheEntry.upsert({
      where: { key: this.cacheKey(namespace, key) },
      update: { value, expiresAt },
      create: { key: this.cacheKey(namespace, key), value, expiresAt }
    });
  }

  // Demo Links
  async getDemoLink(ticketKey: string) {
    return prisma.demoLink.findUnique({ where: { ticketKey } });
  }

  async upsertDemoLink(ticketKey: string, url: string) {
    return prisma.demoLink.upsert({
      where: { ticketKey },
      update: { url },
      create: { ticketKey, url }
    });
  }

  async deleteDemoLink(ticketKey: string) {
    return prisma.demoLink.delete({ where: { ticketKey } });
  }

  // Settings with AES-256 Encryption at Rest
  async getSettings() {
    const settings = await prisma.appSettings.findMany();
    return settings.map((s) => {
      if (SENSITIVE_KEYS.includes(s.key)) {
        return { ...s, value: decrypt(s.value) };
      }
      return s;
    });
  }

  async upsertSetting(key: string, value: string, description?: string) {
    const finalValue = SENSITIVE_KEYS.includes(key) ? encrypt(value) : value;
    return prisma.appSettings.upsert({
      where: { key },
      update: { value: finalValue, description },
      create: { key, value: finalValue, description }
    });
  }

  // Master PIN Security
  async hasMasterPin(): Promise<boolean> {
    const pinSetting = await prisma.appSettings.findUnique({ where: { key: 'masterPin' } });
    return !!pinSetting && !!pinSetting.value;
  }

  async setMasterPin(pin: string) {
    const hashed = hashPin(pin);
    return prisma.appSettings.upsert({
      where: { key: 'masterPin' },
      update: { value: hashed, description: 'Master Passcode PIN Hash' },
      create: { key: 'masterPin', value: hashed, description: 'Master Passcode PIN Hash' }
    });
  }

  async changeMasterPin(oldPin: string, newPin: string): Promise<boolean> {
    const isValid = await this.verifyMasterPin(oldPin);
    if (!isValid) return false;
    await this.setMasterPin(newPin);
    return true;
  }

  async removeMasterPin(oldPin: string): Promise<boolean> {
    const isValid = await this.verifyMasterPin(oldPin);
    if (!isValid) return false;
    try {
      await prisma.appSettings.delete({ where: { key: 'masterPin' } });
      return true;
    } catch {
      return false;
    }
  }

  async verifyMasterPin(pin: string): Promise<boolean> {
    const pinSetting = await prisma.appSettings.findUnique({ where: { key: 'masterPin' } });
    if (!pinSetting || !pinSetting.value) return true; // No PIN set
    const hashedInput = hashPin(pin);
    return pinSetting.value === hashedInput;
  }

  // Repositories
  async getRepositories() {
    return prisma.monitoredRepository.findMany();
  }

  async createRepository(data: { owner: string; name: string; webhookSecret?: string }) {
    return prisma.monitoredRepository.create({ data });
  }

  // Jira Cache
  async getTicketCache(key: string) {
    return prisma.ticketCache.findUnique({ where: { key } });
  }

  async getAllTicketCache() {
    return prisma.ticketCache.findMany();
  }

  async upsertTicketCache(data: {
    key: string; summary: string; description?: string; status: string;
    assignee?: string; reporter?: string; priority?: string;
  }) {
    return prisma.ticketCache.upsert({
      where: { key: data.key },
      update: data,
      create: data
    });
  }

  // GitHub Cache
  async getPullRequestCache(repository: string, number: number) {
    return prisma.pullRequestCache.findUnique({
      where: {
        repository_number: { repository, number }
      }
    });
  }

  async getAllPullRequestCache() {
    return prisma.pullRequestCache.findMany();
  }

  async upsertPullRequestCache(data: {
    number: number; title: string; description?: string; state: string;
    url: string; author: string; repository: string; mergedAt?: Date | null;
  }) {
    return prisma.pullRequestCache.upsert({
      where: {
        repository_number: { repository: data.repository, number: data.number }
      },
      update: data,
      create: data
    });
  }
}
