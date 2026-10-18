import type { Readable } from 'node:stream';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from '../storage/service';
import { FOLDER, demoStorage, type DemoStorage, type DemoStorageConfig } from './demo-storage';
import { ledgerPeer } from './ledger-peer';
import { OrchestratorInputError, normalizeTicketKey } from './orchestrator';

export const MAX_DEMO_BYTES = 500 * 1024 * 1024;
const VIDEO_TYPES = new Set(['video/mp4']);

export interface DemoObject { key: string; size: number; lastModified: Date | null }
export interface DemoVideo { ticketKey: string; url: string; size: number | null; updatedAt: string | null }
export interface DemoLinkRow { ticketKey: string; url: string; updatedAt: Date }

/** The bucket the demo videos live in. Keys are full object keys, folder included. */
export interface DemoStore {
  list(prefix: string): Promise<DemoObject[]>;
  put(key: string, body: Readable | Buffer, contentType: string, length: number): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Where a ticket's demo link is kept: here, and on the laptop DOCK, so both ticket pages show it. */
export interface DemoLinks {
  get(ticketKey: string): Promise<{ url: string } | null>;
  save(ticketKey: string, url: string): Promise<void>;
  remove(ticketKey: string, url: string): Promise<void>;
}

export function s3Store(config: DemoStorageConfig): DemoStore {
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } });
  return {
    list: async (prefix) => {
      const objects: DemoObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const item of page.Contents ?? []) if (item.Key) objects.push({ key: item.Key, size: item.Size ?? 0, lastModified: item.LastModified ?? null });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
    put: async (key, body, contentType, length) => {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: length }));
    },
    remove: async (key) => { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })); },
  };
}

export function demoLinks(storage = new StorageService(), peer = ledgerPeer): DemoLinks {
  return {
    get: async (ticketKey) => storage.getDemoLink(ticketKey),
    save: async (ticketKey, url) => {
      await storage.upsertDemoLink(ticketKey, url);
      void peer?.forward('/demo-link', { key: ticketKey, url });
    },
    remove: async (ticketKey, url) => {
      if ((await storage.getDemoLink(ticketKey))?.url === url) await storage.deleteDemoLink(ticketKey);
      void peer?.forward('/demo-link', { key: ticketKey, remove: url });
    },
  };
}

/**
 * The demo video of each ticket: one object per ticket, <folder>/QRD-xxxx.mp4, whose link the ticket pages show.
 * The link goes through the public base URL (the website's asset proxy), so the bucket stays private and unnamed.
 */
export class DemoVideos {
  private cached: { signature: string; store: DemoStore } | null = null;

  constructor(
    private readonly settings: DemoStorage,
    private readonly links: DemoLinks,
    private readonly makeStore: (config: DemoStorageConfig) => DemoStore = s3Store,
  ) {}

  private bucket(config: DemoStorageConfig | null) {
    if (!config) throw new OrchestratorInputError('Demo storage is not configured: set it in Settings > Agents > Demo video storage');
    const signature = JSON.stringify(config);
    if (this.cached?.signature !== signature) this.cached = { signature, store: this.makeStore(config) };
    return { config, store: this.cached.store, prefix: `${config.folder}/` };
  }

  private urlOf(config: DemoStorageConfig, ticketKey: string) {
    return `${config.publicBaseUrl}/${config.folder}/${ticketKey}.mp4`;
  }

  private objectKeyOf(config: DemoStorageConfig, row: DemoLinkRow) {
    const base = `${config.publicBaseUrl}/`;
    if (!row.url.startsWith(base)) return null;
    const rest = row.url.slice(base.length);
    const match = /^([^/]+)\/[A-Z][A-Z0-9]*-\d+\.mp4$/.exec(rest);
    return match && FOLDER.test(match[1]) && rest.endsWith(`/${row.ticketKey}.mp4`) ? rest : null;
  }

  async list(rows: DemoLinkRow[]) {
    const config = await this.settings.full().catch(() => null);
    const sizes = new Map<string, number>();
    if (config) {
      const folders = new Set(rows.map((row) => this.objectKeyOf(config, row)?.split('/')[0]).filter((folder): folder is string => Boolean(folder)));
      try {
        const { store } = this.bucket(config);
        for (const folder of folders) for (const item of await store.list(`${folder}/`)) sizes.set(item.key, item.size);
      } catch (error) {
        console.warn('[DemoVideos] list failed:', error instanceof Error ? error.message : error);
      }
    }
    const videos: DemoVideo[] = rows.map((row) => {
      const key = config ? this.objectKeyOf(config, row) : null;
      return { ticketKey: row.ticketKey, url: row.url, size: key ? sizes.get(key) ?? null : null, updatedAt: row.updatedAt.toISOString() };
    });
    return { configured: config != null, videos };
  }

  async upload(ticketKeyInput: string, body: Readable | Buffer, contentType: string, length: number | null): Promise<DemoVideo> {
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    if (!VIDEO_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) throw new OrchestratorInputError('A demo video is an MP4 file (video/mp4)');
    if (!length || length <= 0) throw new OrchestratorInputError('The upload needs a content length');
    if (length > MAX_DEMO_BYTES) throw new OrchestratorInputError(`A demo video is at most ${MAX_DEMO_BYTES / 1024 / 1024} MB`);
    const { config, store, prefix } = this.bucket(await this.settings.full());
    await store.put(`${prefix}${ticketKey}.mp4`, body, 'video/mp4', length);
    const url = this.urlOf(config, ticketKey);
    await this.links.save(ticketKey, url);
    return { ticketKey, url, size: length, updatedAt: new Date().toISOString() };
  }

  async remove(ticketKeyInput: string) {
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    const row = await this.links.get(ticketKey);
    if (!row) return true;
    const config = await this.settings.full().catch(() => null);
    const key = config ? this.objectKeyOf(config, { ticketKey, url: row.url, updatedAt: new Date() }) : null;
    if (config && key) await this.bucket(config).store.remove(key);
    await this.links.remove(ticketKey, row.url);
    return true;
  }
}

export const demoVideos = new DemoVideos(demoStorage, demoLinks());

/** On the laptop DOCK: a demo link the workspace DOCK set or removed. A removal only clears the link it set. */
export async function ingestDemoLink(input: unknown, storage = new StorageService()) {
  if (typeof input !== 'object' || input === null) throw new OrchestratorInputError('A request object is required');
  const body = input as Record<string, unknown>;
  const ticketKey = normalizeTicketKey(body.key);
  if (typeof body.url === 'string' && /^https?:\/\//.test(body.url)) {
    await storage.upsertDemoLink(ticketKey, body.url);
    return true;
  }
  if (typeof body.remove === 'string' && (await storage.getDemoLink(ticketKey))?.url === body.remove) {
    await storage.deleteDemoLink(ticketKey);
    return true;
  }
  return false;
}
