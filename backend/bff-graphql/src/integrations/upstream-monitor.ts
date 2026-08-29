import axios, { type AxiosInstance } from 'axios';
import { StorageService } from '../storage/service';

const MAX_TARGETS = 20;
const PROBE_CONCURRENCY = 5;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;

export interface MonitorTargetInput {
  name?: string;
  url?: string;
  expectedStatus?: number;
  timeoutMs?: number;
}

export function validateMonitorTarget(input: MonitorTargetInput) {
  const name = input.name?.trim() || '';
  const rawUrl = input.url?.trim() || '';
  let url: URL;

  try { url = new URL(rawUrl); } catch { throw new Error('A valid HTTP(S) URL is required'); }
  if (!name || name.length > 80) throw new Error('Monitor name must be between 1 and 80 characters');
  if (rawUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('A valid HTTP(S) URL is required');
  }
  if (url.username || url.password) throw new Error('Monitor URLs cannot contain credentials');

  const expectedStatus = input.expectedStatus ?? 200;
  const timeoutMs = input.timeoutMs ?? 5000;
  if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
    throw new Error('Expected status must be an HTTP status code');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms`);
  }

  return { name, url: url.toString(), expectedStatus, timeoutMs };
}

export class UpstreamMonitorService {
  constructor(
    private readonly storage = new StorageService(),
    private readonly http: AxiosInstance = axios,
  ) {}

  list(refresh = false) {
    return refresh ? this.checkAll() : this.storage.getMonitorTargets();
  }

  async add(input: MonitorTargetInput) {
    if (await this.storage.countMonitorTargets() >= MAX_TARGETS) {
      throw new Error(`A maximum of ${MAX_TARGETS} monitor targets is supported`);
    }
    return this.storage.createMonitorTarget(validateMonitorTarget(input));
  }

  async remove(id: string) {
    if (!id) return false;
    await this.storage.deleteMonitorTarget(id);
    return true;
  }

  async update(id: string, input: MonitorTargetInput) {
    if (!id) throw new Error('Monitor target ID is required');
    return this.storage.updateMonitorTarget(id, validateMonitorTarget(input));
  }

  async checkAll() {
    const targets = await this.storage.getMonitorTargets();
    const results = [];
    for (let index = 0; index < targets.length; index += PROBE_CONCURRENCY) {
      results.push(...await Promise.all(
        targets.slice(index, index + PROBE_CONCURRENCY).map((target) => this.check(target.id)),
      ));
    }
    return results;
  }

  async check(id: string) {
    const target = await this.storage.getMonitorTarget(id);
    if (!target) throw new Error('Monitor target not found');

    const startedAt = Date.now();
    try {
      const response = await this.http.get(target.url, {
        timeout: target.timeoutMs,
        maxRedirects: 0,
        responseType: 'stream',
        validateStatus: () => true,
      });
      response.data?.destroy?.();
      const latency = Date.now() - startedAt;
      const isUp = response.status === target.expectedStatus;
      return this.storage.updateMonitorResult(target.id, {
        lastStatus: isUp ? 'UP' : 'DOWN',
        lastStatusCode: response.status,
        lastLatencyMs: latency,
        lastCheckedAt: new Date(),
        lastError: isUp ? null : `Expected ${target.expectedStatus}, received ${response.status}`,
      });
    } catch (error: any) {
      return this.storage.updateMonitorResult(target.id, {
        lastStatus: 'DOWN',
        lastStatusCode: error.response?.status || null,
        lastLatencyMs: Date.now() - startedAt,
        lastCheckedAt: new Date(),
        lastError: String(error.code || error.message || 'Probe failed').slice(0, 240),
      });
    }
  }
}

export const upstreamMonitorService = new UpstreamMonitorService();
