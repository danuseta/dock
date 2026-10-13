import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  prismaChatAttachmentStore,
  prismaChatSessionLookup,
  type AttachmentRow,
  type ChatAttachmentStore,
  type ChatSessionLookup,
} from '../storage/chat-attachments';
import { OrchestratorInputError } from './orchestrator';

export const ATTACHMENT_LIMITS: {
  perMessage: 4;
  imageBytes: number;
  fileBytes: number;
  totalBytes: number;
  unsentPerSession: 8;
} = {
  perMessage: 4,
  imageBytes: 5 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 300 * 1024 * 1024,
  unsentPerSession: 8,
};

export interface AttachmentView { id: string; name: string; mime: string; size: number; state: string }

export interface ClaimAttachmentView { id: string; name: string; mime: string; size: number; sha256: string }

export interface BridgeFile { path: string; size: number; sha256: string }

export interface UploadInput {
  sessionId: string;
  name: string;
  contentType: string;
  contentLength: number | null;
}

export class AttachmentRefusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const MAX_CONCURRENT_UPLOADS = 2;
const UNSENT_TTL_MS = 60 * 60 * 1000;
const SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
const DELETED_ROW_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN_MESSAGE_STATES = ['draft', 'queued', 'taken'];
const HEAD_BYTES = 512;
const MAX_NAME_CHARS = 120;
const MAX_MIME_CHARS = 100;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'log', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'sh', 'sql', 'diff', 'patch']);
const STORED_MIMES = new Set([
  ...IMAGE_MIMES,
  'application/pdf',
  'application/json',
  'application/octet-stream',
  'text/plain',
  'text/markdown',
  'text/csv',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const isAttachmentId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function normalizeMime(declared: string): string {
  if (STORED_MIMES.has(declared)) return declared;
  return declared.startsWith('text/') ? 'text/plain' : 'application/octet-stream';
}

export const isInlineImage = (mime: string) => IMAGE_MIMES.has(mime);

export function sanitizeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/\p{Cc}/gu, '')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return clean.slice(0, MAX_NAME_CHARS).trim() || 'file';
}

export function sniffImage(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && (head.subarray(0, 6).toString('latin1') === 'GIF87a' || head.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function declaredKind(mime: string, name: string): 'image' | 'other' | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime === 'application/pdf' || mime === 'application/json' || mime.startsWith('text/')) return 'other';
  if (mime === 'application/octet-stream' && TEXT_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase())) return 'other';
  return null;
}

const toView = (row: AttachmentRow): AttachmentView => ({ id: row.id, name: row.name, mime: row.mime, size: row.size, state: row.state });

const isSent = (row: AttachmentRow) => row.state === 'attached' || row.state === 'fetched';

const removeFile = (file: string) => unlink(file).catch(() => undefined);

interface ServiceOptions {
  dir?: () => string;
  now?: () => Date;
}

class UploadGate extends Transform {
  private readonly head: Buffer[] = [];
  private headLength = 0;
  private decided = false;
  private limit = ATTACHMENT_LIMITS.fileBytes;
  readonly hash = createHash('sha256');
  size = 0;
  mime: string;

  constructor(private readonly declared: string, private readonly kind: 'image' | 'other') {
    super();
    this.mime = normalizeMime(declared);
    if (kind === 'image') this.limit = ATTACHMENT_LIMITS.imageBytes;
  }

  private decide() {
    this.decided = true;
    const head = Buffer.concat(this.head);
    const sniffed = sniffImage(head);
    if (sniffed) {
      this.mime = sniffed;
      this.limit = ATTACHMENT_LIMITS.imageBytes;
    } else if (this.kind === 'image') {
      throw new AttachmentRefusal(415, 'The file is not a valid image');
    } else if (this.declared === 'application/pdf') {
      if (head.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AttachmentRefusal(415, 'The file is not a valid PDF');
    } else if (head.includes(0)) {
      throw new AttachmentRefusal(415, 'This file type is not supported');
    }
    if (this.size > this.limit) throw new AttachmentRefusal(413, 'The file is too large');
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    try {
      this.size += chunk.length;
      if (this.size > this.limit) throw new AttachmentRefusal(413, 'The file is too large');
      if (!this.decided) {
        const part = chunk.subarray(0, HEAD_BYTES - this.headLength);
        this.head.push(part);
        this.headLength += part.length;
        if (this.headLength >= HEAD_BYTES) this.decide();
      }
      this.hash.update(chunk);
      callback(null, chunk);
    } catch (error) {
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void) {
    try {
      if (!this.decided) this.decide();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

export class ChatAttachmentService {
  private active = 0;
  private lastPrune: Date | null = null;

  constructor(
    private readonly store: ChatAttachmentStore,
    private readonly lookup: ChatSessionLookup,
    private readonly options: ServiceOptions = {},
  ) {}

  private dir() {
    return this.options.dir ? this.options.dir() : path.join(path.resolve(process.env.JIDIS_DATA_DIR || 'data'), 'chat-attachments');
  }

  private now() {
    return this.options.now ? this.options.now() : new Date();
  }

  private file(id: string) {
    return path.join(this.dir(), id);
  }

  async receive(input: UploadInput, body: Readable): Promise<AttachmentView> {
    if (this.active >= MAX_CONCURRENT_UPLOADS) throw new AttachmentRefusal(429, 'Too many uploads at once. Try again in a moment.');
    this.active += 1;
    try {
      return await this.save(input, body);
    } finally {
      this.active -= 1;
    }
  }

  private async save(input: UploadInput, body: Readable): Promise<AttachmentView> {
    if (!SESSION_ID.test(input.sessionId)) throw new AttachmentRefusal(400, 'A sessionId is required');
    const session = await this.lookup.session(input.sessionId);
    if (!session || session.source !== 'dock') throw new AttachmentRefusal(404, 'Unknown session');
    if (await this.store.countBySessionState(session.id, 'uploaded') >= ATTACHMENT_LIMITS.unsentPerSession) {
      throw new AttachmentRefusal(409, 'Too many files are waiting to be sent. Send or remove some first.');
    }
    const name = sanitizeName(input.name);
    const declared = input.contentType.split(';')[0].trim().toLowerCase().slice(0, MAX_MIME_CHARS);
    const kind = declaredKind(declared, name);
    if (!kind) throw new AttachmentRefusal(415, 'This file type is not supported');
    const declaredLimit = kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes;
    if (input.contentLength !== null && input.contentLength > declaredLimit) throw new AttachmentRefusal(413, 'The file is too large');

    const id = randomUUID();
    const target = this.file(id);
    await mkdir(this.dir(), { recursive: true });
    const gate = new UploadGate(declared, kind);
    try {
      await pipeline(body, gate, createWriteStream(target, { flags: 'wx' }));
      if (gate.size === 0) throw new AttachmentRefusal(400, 'The file is empty');
      const row = await this.store.create({
        id,
        sessionId: session.id,
        messageId: null,
        name,
        mime: gate.mime,
        size: gate.size,
        sha256: gate.hash.digest('hex'),
        state: 'uploaded',
        createdAt: this.now(),
        fetchedAt: null,
      });
      await this.evict(await this.store.live(), id);
      await this.prune(this.now());
      return toView(row);
    } catch (error) {
      await removeFile(target);
      throw error;
    }
  }

  async get(id: string): Promise<{ row: AttachmentRow; path: string } | null> {
    if (!isAttachmentId(id)) return null;
    const row = await this.store.get(id);
    if (!row || row.state === 'deleted') return null;
    const file = this.file(id);
    const info = await stat(file).catch(() => null);
    return info?.isFile() ? { row, path: file } : null;
  }

  async discard(id: string): Promise<'deleted' | 'missing' | 'sent'> {
    if (!isAttachmentId(id)) return 'missing';
    const row = await this.store.get(id);
    if (!row || row.state === 'deleted') return 'missing';
    if (row.state !== 'uploaded' || !await this.store.removeUploaded(id)) return 'sent';
    await removeFile(this.file(id));
    return 'deleted';
  }

  async attach(sessionId: string, messageId: number, ids: string[]): Promise<AttachmentView[]> {
    if (ids.length === 0) return [];
    if (ids.length > ATTACHMENT_LIMITS.perMessage) throw new OrchestratorInputError(`At most ${ATTACHMENT_LIMITS.perMessage} files per message`);
    if (new Set(ids).size !== ids.length || !ids.every(isAttachmentId)) throw new OrchestratorInputError('Invalid attachment id');
    const rows = await this.store.getMany(ids);
    if (rows.length !== ids.length || rows.some((row) => row.sessionId !== sessionId || row.state !== 'uploaded')) {
      throw new OrchestratorInputError('An attachment is unknown or was already sent');
    }
    if (await this.store.claim(sessionId, ids, messageId) !== ids.length) {
      await this.store.release(messageId);
      throw new OrchestratorInputError('An attachment is unknown or was already sent');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => toView({ ...(byId.get(id) as AttachmentRow), messageId, state: 'attached' }));
  }

  async release(messageId: number): Promise<void> {
    await this.store.release(messageId);
  }

  async forMessages(messageIds: number[]): Promise<Map<number, AttachmentView[]>> {
    const grouped = new Map<number, AttachmentView[]>();
    if (messageIds.length === 0) return grouped;
    for (const row of await this.store.forMessages(messageIds)) {
      if (row.messageId === null) continue;
      const list = grouped.get(row.messageId) ?? [];
      list.push(toView(row));
      grouped.set(row.messageId, list);
    }
    return grouped;
  }

  async forClaim(messageId: number): Promise<ClaimAttachmentView[]> {
    return (await this.store.forMessages([messageId]))
      .filter((row) => row.messageId === messageId && isSent(row))
      .map((row) => ({ id: row.id, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256 }));
  }

  async openForBridge(input: unknown, machine: string): Promise<BridgeFile | null> {
    if (typeof input !== 'object' || input === null || typeof machine !== 'string' || machine === '') return null;
    const { sessionId, replyTo, id } = input as Record<string, unknown>;
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
    if (typeof replyTo !== 'number' || !Number.isSafeInteger(replyTo) || replyTo < 1) return null;
    if (!isAttachmentId(id)) return null;
    const session = await this.lookup.session(sessionId);
    if (!session || session.machine !== machine || session.source !== 'dock') return null;
    const message = await this.lookup.message(replyTo);
    if (!message || message.sessionId !== session.id || message.state !== 'taken') return null;
    const row = await this.store.get(id);
    if (!row || row.sessionId !== session.id || row.messageId !== replyTo || !isSent(row)) return null;
    const file = this.file(id);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size !== row.size) return null;
    if (row.state === 'attached') await this.store.update(id, { state: 'fetched', fetchedAt: this.now() });
    return { path: file, size: row.size, sha256: row.sha256 };
  }

  async deleteForSession(sessionId: string): Promise<void> {
    for (const row of await this.store.forSession(sessionId)) await removeFile(this.file(row.id));
    await this.store.removeSession(sessionId);
  }

  async prune(now: Date): Promise<void> {
    if (this.lastPrune && now.getTime() - this.lastPrune.getTime() < PRUNE_INTERVAL_MS) return;
    this.lastPrune = now;
    const remaining: AttachmentRow[] = [];
    const live = await this.store.live();
    await this.removeOrphans(now, new Set(live.map((row) => row.id)));
    await this.store.purgeDeleted(new Date(now.getTime() - DELETED_ROW_KEEP_MS));
    for (const row of live) {
      const age = now.getTime() - row.createdAt.getTime();
      if (row.state === 'uploaded' && age > UNSENT_TTL_MS) {
        await this.drop(row);
      } else if (isSent(row) && age > SENT_TTL_MS) {
        await this.drop(row);
      } else {
        remaining.push(row);
      }
    }
    await this.evict(remaining, null);
  }

  private async removeOrphans(now: Date, known: Set<string>) {
    const names = await readdir(this.dir()).catch(() => [] as string[]);
    for (const name of names) {
      if (!UUID.test(name) || known.has(name)) continue;
      const info = await stat(this.file(name)).catch(() => null);
      if (info?.isFile() && now.getTime() - info.mtimeMs > ORPHAN_MIN_AGE_MS) await removeFile(this.file(name));
    }
  }

  private async drop(row: AttachmentRow) {
    await removeFile(this.file(row.id));
    if (row.state === 'uploaded') await this.store.remove(row.id);
    else await this.store.update(row.id, { state: 'deleted' });
  }

  private async evict(rows: AttachmentRow[], keepId: string | null) {
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows) {
      if (total <= ATTACHMENT_LIMITS.totalBytes) return;
      if (row.id === keepId) continue;
      if (row.messageId !== null && OPEN_MESSAGE_STATES.includes((await this.lookup.message(row.messageId))?.state ?? '')) continue;
      await this.drop(row);
      total -= row.size;
    }
  }
}

export const chatAttachmentService = new ChatAttachmentService(prismaChatAttachmentStore, prismaChatSessionLookup);
