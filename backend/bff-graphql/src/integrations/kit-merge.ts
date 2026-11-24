import { createHash } from 'node:crypto';
import { StorageService } from '../storage/service';
import { OrchestratorInputError } from './orchestrator';
import type { PushMessage } from './push';

const CACHE = 'kit-merge';
const REPORTS_KEY = 'reports';
const MAX_ROWS = 500;
const SEGMENT = /^[A-Za-z0-9_@][A-Za-z0-9._@+-]{0,119}$/;
const SKILL_EXT = /\.(md|json|txt)$/i;
const SKILL_MAX_DEPTH = 8;
export const SKILL_MAX_BYTES = 100 * 1024;
export const KIT_RESOLVE_ACTIONS = ['local', 'kit', 'edit'] as const;
export type KitResolveAction = typeof KIT_RESOLVE_ACTIONS[number];

export interface KitMergeRow { path: string; at: string }
export interface KitMergeConflict { path: string; kitNew: string; reason: string; at: string }
export interface KitMergeResolved { path: string; action: string; at: string }
export interface KitMergeReport {
  machine: string;
  at: string | null;
  receivedAt: string;
  merged: KitMergeRow[];
  kept: KitMergeRow[];
  conflicts: KitMergeConflict[];
  resolved: KitMergeResolved[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** A config path the kit merges on install: skills/** or agents/*.md, plain segments only. Same rule as kit/kit-merge.cjs. */
export function isMergePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 400) return false;
  if (!/^(skills\/.+|agents\/[^/]+\.md)$/.test(value) || value.endsWith('.kit-new')) return false;
  return value.split('/').every((part) => SEGMENT.test(part) && part !== '.' && part !== '..');
}

/**
 * A skill file path as the kit's skills-edit.cjs normalizes it: relative to skills/, plain segments, no .., not absolute, a .md, .json
 * or .txt file. The kit checks it again, with links and size, before any read or write.
 */
export function skillPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new OrchestratorInputError('A skill file path is required');
  const raw = value.trim().replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new OrchestratorInputError('The path must be relative to the skills folder');
  const rel = raw.replace(/^skills\//, '');
  const parts = rel.split('/');
  if (parts.some((part) => part === '.' || part === '..')) throw new OrchestratorInputError('The path may not contain . or .. segments');
  if (parts.length < 2 || parts.length > SKILL_MAX_DEPTH || !parts.every((part) => SEGMENT.test(part))) throw new OrchestratorInputError('The path is <skill>/<file>, made of plain names');
  if (!SKILL_EXT.test(rel) || rel.endsWith('.kit-new')) throw new OrchestratorInputError('Only .md, .json and .txt files of a skill can be edited');
  return rel;
}

export function skillText(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > SKILL_MAX_BYTES || value.includes('\u0000')) {
    throw new OrchestratorInputError(`The file must be text of at most ${SKILL_MAX_BYTES / 1024} KB`);
  }
  return value;
}

export function kitResolveAction(value: unknown): KitResolveAction {
  if (typeof value !== 'string' || !(KIT_RESOLVE_ACTIONS as readonly string[]).includes(value)) throw new OrchestratorInputError('action must be local, kit or edit');
  return value as KitResolveAction;
}

/** What DOCK's one-use nonce is bound to; the kit (gm.cjs skillPutSha and resolveSha) computes the same string before it writes. */
export const skillPutSha = (rel: string, body: string) => `skill:${rel}:${sha256(body)}`;
export const kitResolveSha = (rel: string, action: KitResolveAction, body: string | null) => `kit-resolve:${rel}:${action}:${action === 'edit' && body !== null ? sha256(body) : ''}`;

const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord).filter((row) => isMergePath(row.path)).slice(0, MAX_ROWS) : []);

/** The install merge report the kit's bridge posts; `machine` is the DOCK machine of the token that sent it. */
export function parseKitMergeReport(input: unknown, machine: string, now: Date): KitMergeReport {
  if (!isRecord(input)) throw new OrchestratorInputError('A merge report object is required');
  const at = new Date(text(input.at, 40));
  return {
    machine,
    at: Number.isNaN(at.getTime()) ? null : (at > now ? now : at).toISOString(),
    receivedAt: now.toISOString(),
    merged: rows(input.merged).map((row) => ({ path: row.path as string, at: text(row.at, 40) })),
    kept: rows(input.kept).map((row) => ({ path: row.path as string, at: text(row.at, 40) })),
    conflicts: rows(input.conflicts).map((row) => ({ path: row.path as string, kitNew: `${row.path as string}.kit-new`, reason: text(row.reason, 200) || 'both changed the same lines', at: text(row.at, 40) })),
    resolved: rows(input.resolved).slice(-50).map((row) => ({ path: row.path as string, action: text(row.action, 10), at: text(row.at, 40) })),
  };
}

/** The push for conflicts a report brings that the last one of that machine did not have. */
export function kitConflictNotice(machine: string, paths: string[]): PushMessage {
  const names = paths.map((item) => item.replace(/^skills\//, '').replace(/\/SKILL\.md$/, '').replace(/^agents\//, 'agent ').replace(/\.md$/, ''));
  return {
    title: `Kit conflict on ${machine}`,
    body: `bentrok di ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}. Choose local, kit or a merge in Agents > Library.`,
    url: '/agents?tab=library',
    tag: `kit-conflict-${machine}`,
  };
}

/** The newest merge report of each machine, kept in one cache entry; a new conflict calls onConflicts once. */
export class KitMergeReports {
  onConflicts: ((machine: string, paths: string[]) => void) | null = null;

  constructor(private readonly storage: {
    getCache(namespace: string, key: string): Promise<unknown>;
    upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): PromiseLike<unknown>;
  } = new StorageService()) {}

  private async all(): Promise<Record<string, KitMergeReport>> {
    const saved = await this.storage.getCache(CACHE, REPORTS_KEY);
    return isRecord(saved) ? saved as Record<string, KitMergeReport> : {};
  }

  async ingest(input: unknown, machine: string, now = new Date()) {
    const report = parseKitMergeReport(input, machine, now);
    const all = await this.all();
    const before = new Set((all[machine]?.conflicts ?? []).map((row) => row.path));
    const fresh = report.conflicts.map((row) => row.path).filter((item) => !before.has(item));
    await this.storage.upsertCache(CACHE, REPORTS_KEY, { ...all, [machine]: report }, 0);
    if (fresh.length) this.onConflicts?.(machine, fresh);
    return { machine, conflicts: report.conflicts.length, fresh: fresh.length };
  }

  async list(): Promise<KitMergeReport[]> {
    return Object.values(await this.all()).sort((a, b) => a.machine.localeCompare(b.machine));
  }
}

export const kitMergeReports = new KitMergeReports();
