import type { Readable } from 'node:stream';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from '../storage/service';
import { ledgerPeer } from './ledger-peer';
import { OrchestratorInputError, normalizeTicketKey } from './orchestrator';

export const MAX_DEMO_BYTES = 500 * 1024 * 1024;
const VIDEO_TYPES = new Set(['video/mp4']);

export interface DemoObject { key: string; size: number; lastModified: Date | null }
export interface DemoVideo { ticketKey: string; url: string; size: number; updatedAt: string | null }

/** The bucket folder the demo videos live in. */
export interface DemoStore {
  list(prefix: string): Promise<DemoObject[]>;
  put(key: string, body: Readable | Buffer, contentType: string, length: number): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Where a ticket's demo link is kept: here, and on the laptop DOCK, so both ticket pages show it. */
export interface DemoLinks {
  save(ticketKey: string, url: string): Promise<void>;
  remove(ticketKey: string, url: string): Promise<void>;
}

export interface DemoConfig { publicBaseUrl: string; prefix: string }

export function s3Store(env: NodeJS.ProcessEnv = process.env): (DemoStore & DemoConfig) | null {
  const accessKeyId = env.DEMO_S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.DEMO_S3_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const endpoint = (env.DEMO_S3_ENDPOINT?.trim() || 'https://kencana.basic.box.cloudeka.id').replace(/\/+$/, '');
  const bucket = env.DEMO_S3_BUCKET?.trim() || 'porto-rzwbgw';
  const client = new S3Client({ endpoint, region: env.DEMO_S3_REGION?.trim() || 'kencana', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return {
    publicBaseUrl: (env.DEMO_PUBLIC_BASE_URL?.trim() || `${endpoint}/${bucket}`).replace(/\/+$/, ''),
    prefix: env.DEMO_S3_PREFIX?.trim() || 'demo-qonflo/',
    list: async (prefix) => {
      const objects: DemoObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const item of page.Contents ?? []) if (item.Key) objects.push({ key: item.Key, size: item.Size ?? 0, lastModified: item.LastModified ?? null });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
    // Public-read: the link is permanent and opens from Discord without a login.
    put: async (key, body, contentType, length) => {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: length, ACL: 'public-read' }));
    },
    remove: async (key) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}

export function demoLinks(storage = new StorageService(), peer = ledgerPeer): DemoLinks {
  return {
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

/** The demo video of each ticket: one object per ticket, QRD-xxxx.mp4, whose link the ticket pages show. */
export class DemoVideos {
  constructor(private readonly store: (DemoStore & DemoConfig) | null, private readonly links: DemoLinks) {}

  get configured() { return Boolean(this.store); }

  private bucket() {
    if (!this.store) throw new OrchestratorInputError('Demo storage is not configured: set DEMO_S3_ACCESS_KEY and DEMO_S3_SECRET_KEY for the workspace DOCK');
    return this.store;
  }

  urlOf(ticketKey: string) {
    const store = this.bucket();
    return `${store.publicBaseUrl}/${store.prefix}${ticketKey}.mp4`;
  }

  async list(): Promise<DemoVideo[]> {
    const store = this.bucket();
    const videos: DemoVideo[] = [];
    for (const item of await store.list(store.prefix)) {
      const match = /^([A-Z][A-Z0-9]*-\d+)\.mp4$/.exec(item.key.slice(store.prefix.length));
      if (match) videos.push({ ticketKey: match[1], url: this.urlOf(match[1]), size: item.size, updatedAt: item.lastModified?.toISOString() ?? null });
    }
    return videos.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async upload(ticketKeyInput: string, body: Readable | Buffer, contentType: string, length: number | null): Promise<DemoVideo> {
    const store = this.bucket();
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    if (!VIDEO_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) throw new OrchestratorInputError('A demo video is an MP4 file (video/mp4)');
    if (!length || length <= 0) throw new OrchestratorInputError('The upload needs a content length');
    if (length > MAX_DEMO_BYTES) throw new OrchestratorInputError(`A demo video is at most ${MAX_DEMO_BYTES / 1024 / 1024} MB`);
    await store.put(`${store.prefix}${ticketKey}.mp4`, body, 'video/mp4', length);
    const url = this.urlOf(ticketKey);
    await this.links.save(ticketKey, url);
    return { ticketKey, url, size: length, updatedAt: new Date().toISOString() };
  }

  async remove(ticketKeyInput: string) {
    const store = this.bucket();
    const ticketKey = normalizeTicketKey(ticketKeyInput);
    await store.remove(`${store.prefix}${ticketKey}.mp4`);
    await this.links.remove(ticketKey, this.urlOf(ticketKey));
    return true;
  }
}

export const demoVideos = new DemoVideos(s3Store(), demoLinks());

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
