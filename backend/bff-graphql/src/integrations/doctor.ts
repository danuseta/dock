import { StorageService } from '../storage/service';
import { OrchestratorInputError } from './orchestrator';

const CACHE = 'doctor';
const REPORTS_KEY = 'reports';
const MAX_CHECKS = 40;

export interface DoctorCheck { name: string; ok: boolean; detail: string | null }
export interface DoctorReport { machine: string; host: string; os: string; at: string; receivedAt: string; kitVersion: string | null; checks: DoctorCheck[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** A doctor report from the kit's doctor.cjs. `machine` is the DOCK machine of the token that sent it; the hostname is kept as `host`. */
export function parseDoctorReport(input: unknown, machine: string, now: Date): DoctorReport {
  if (!isRecord(input)) throw new OrchestratorInputError('A doctor report object is required');
  const raw = Array.isArray(input.checks) ? input.checks : [];
  if (raw.length === 0 || raw.length > MAX_CHECKS) throw new OrchestratorInputError(`Between 1 and ${MAX_CHECKS} checks are required`);
  const checks = raw.map((item): DoctorCheck => {
    if (!isRecord(item) || !text(item.name, 40) || typeof item.ok !== 'boolean') throw new OrchestratorInputError('Each check needs a name and ok true or false');
    return { name: text(item.name, 40), ok: item.ok, detail: text(item.detail, 500) || null };
  });
  const at = new Date(text(input.at, 40));
  return {
    machine,
    host: text(input.machine, 80) || machine,
    os: text(input.os, 20) || 'unknown',
    at: (Number.isNaN(at.getTime()) || at > now ? now : at).toISOString(),
    receivedAt: now.toISOString(),
    kitVersion: text(input.kitVersion, 80) || null,
    checks,
  };
}

/** The latest doctor report of each machine, kept in one cache entry. */
export class DoctorReports {
  constructor(private readonly storage: {
    getCache(namespace: string, key: string): Promise<unknown>;
    upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): PromiseLike<unknown>;
  } = new StorageService()) {}

  private async all(): Promise<Record<string, DoctorReport>> {
    const saved = await this.storage.getCache(CACHE, REPORTS_KEY);
    return isRecord(saved) ? saved as Record<string, DoctorReport> : {};
  }

  async ingest(input: unknown, machine: string, now = new Date()) {
    const report = parseDoctorReport(input, machine, now);
    await this.storage.upsertCache(CACHE, REPORTS_KEY, { ...(await this.all()), [machine]: report }, 0);
    return { machine, checks: report.checks.length, failing: report.checks.filter((check) => !check.ok).length };
  }

  async list(): Promise<DoctorReport[]> {
    return Object.values(await this.all()).sort((a, b) => a.machine.localeCompare(b.machine));
  }
}

export const doctorReports = new DoctorReports();
