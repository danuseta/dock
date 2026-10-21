import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageService } from '../storage/service';
import { agentSlug } from './agents';
import { OrchestratorInputError } from './orchestrator';

const CACHE = 'agent-looks';
const LOOKS_KEY = 'all';
export const AVATAR_MAX_BYTES = 512 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR = /^#[0-9a-f]{6}$/i;

export interface SavedLook { displayName: string | null; initials: string | null; color: string | null; avatarAt: number | null }
export interface AgentLookView { slug: string; displayName: string | null; initials: string | null; color: string | null; avatarUrl: string | null }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalText = (value: unknown, max: number, label: string) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new OrchestratorInputError(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new OrchestratorInputError(`${label} takes at most ${max} characters`);
  return trimmed || null;
};

export class AvatarRefusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** True for PNG bytes. SVG is refused: DOCK has no SVG sanitizer, and an SVG can carry script. */
export const isPng = (bytes: Buffer) => bytes.length > PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);

/**
 * How an agent looks in DOCK: display name, initials, colour and avatar, keyed by slug.
 * The looks sit in one cache entry, like the doctor reports; the avatar PNG is a file in the data dir, like chat attachments.
 */
export class AgentLooks {
  constructor(
    private readonly storage: {
      getCache(namespace: string, key: string): Promise<unknown>;
      upsertCache(namespace: string, key: string, value: unknown, ttlSeconds?: number): PromiseLike<unknown>;
    } = new StorageService(),
    private readonly dir: () => string = () => path.join(path.resolve(process.env.JIDIS_DATA_DIR || 'data'), 'agent-avatars'),
    private readonly now: () => number = Date.now,
  ) {}

  private async all(): Promise<Record<string, SavedLook>> {
    const saved = await this.storage.getCache(CACHE, LOOKS_KEY);
    return isRecord(saved) ? saved as Record<string, SavedLook> : {};
  }

  private view(slug: string, look: SavedLook): AgentLookView {
    return {
      slug,
      displayName: look.displayName,
      initials: look.initials,
      color: look.color,
      avatarUrl: look.avatarAt ? `/api/agent-looks/${slug}/avatar?v=${look.avatarAt}` : null,
    };
  }

  private file(slug: string) {
    return path.join(this.dir(), `${agentSlug(slug)}.png`);
  }

  async list(): Promise<AgentLookView[]> {
    return Object.entries(await this.all()).sort(([a], [b]) => a.localeCompare(b)).map(([slug, look]) => this.view(slug, look));
  }

  async save(input: unknown): Promise<AgentLookView> {
    if (!isRecord(input)) throw new OrchestratorInputError('A look object is required');
    const slug = agentSlug(input.slug);
    const color = optionalText(input.color, 7, 'color');
    if (color && !COLOR.test(color)) throw new OrchestratorInputError('color must be a #rrggbb colour');
    const looks = await this.all();
    const previous = looks[slug];
    const look: SavedLook = {
      displayName: optionalText(input.displayName, 40, 'displayName'),
      initials: optionalText(input.initials, 3, 'initials'),
      color: color?.toLowerCase() ?? null,
      avatarAt: input.removeAvatar === true ? null : previous?.avatarAt ?? null,
    };
    if (input.removeAvatar === true && previous?.avatarAt) await unlink(this.file(slug)).catch(() => undefined);
    await this.storage.upsertCache(CACHE, LOOKS_KEY, { ...looks, [slug]: look }, 0);
    return this.view(slug, look);
  }

  async setAvatar(slugInput: unknown, contentType: string, bytes: Buffer): Promise<AgentLookView> {
    const slug = agentSlug(slugInput);
    if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarRefusal(413, 'The avatar is larger than 512 KB');
    if (contentType.split(';')[0].trim().toLowerCase() !== 'image/png' || !isPng(bytes)) throw new AvatarRefusal(415, 'The avatar must be a PNG image');
    await mkdir(this.dir(), { recursive: true });
    const target = this.file(slug);
    const partial = `${target}.${process.pid}.part`;
    await writeFile(partial, bytes);
    await rename(partial, target);
    const looks = await this.all();
    const previous = looks[slug];
    const look: SavedLook = {
      displayName: previous?.displayName ?? null,
      initials: previous?.initials ?? null,
      color: previous?.color ?? null,
      avatarAt: this.now(),
    };
    await this.storage.upsertCache(CACHE, LOOKS_KEY, { ...looks, [slug]: look }, 0);
    return this.view(slug, look);
  }

  async avatar(slugInput: unknown): Promise<Buffer | null> {
    try {
      return await readFile(this.file(String(slugInput)));
    } catch {
      return null;
    }
  }

  /** A deleted custom agent takes its look and avatar with it. */
  async remove(slugInput: unknown) {
    const slug = agentSlug(slugInput);
    const looks = await this.all();
    if (!looks[slug]) return;
    delete looks[slug];
    await unlink(this.file(slug)).catch(() => undefined);
    await this.storage.upsertCache(CACHE, LOOKS_KEY, looks, 0);
  }
}

export const agentLooks = new AgentLooks();
