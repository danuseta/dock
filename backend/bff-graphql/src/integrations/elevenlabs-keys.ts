import { dockMode } from '../mode';
import { prisma } from '../storage/client';
import { decrypt, encrypt } from '../storage/crypto';
import { ledgerPeer } from './ledger-peer';
import { OrchestratorInputError } from './orchestrator';

const NAME = /^[A-Za-z0-9._-]{1,40}$/;

export interface ElevenLabsKeyView { name: string; masked: string; parkedUntil: string | null; current: boolean }
/** The shape el-rotate.cjs rotates over: the full keys, their order, the index in use and the parked ones (epoch ms). */
export interface ElevenLabsStore { keys: Record<string, string>; order: string[]; current: number; cooldowns: Record<string, number> }

export interface ElevenLabsKeys {
  list(): Promise<ElevenLabsKeyView[]>;
  store(): Promise<ElevenLabsStore>;
  add(name: string, key: string): Promise<void>;
  remove(name: string): Promise<boolean>;
  park(name: string, until: Date | null): Promise<void>;
  setCurrent(name: string): Promise<void>;
}

export function maskKey(key: string): string {
  return key.length <= 10 ? `${key.slice(0, 3)}***` : `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function keyName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!NAME.test(name)) throw new OrchestratorInputError('A key name is letters, digits, dot, dash or underscore, up to 40');
  return name;
}

function keyValue(value: unknown): string {
  const key = String(value ?? '').trim();
  if (key.length < 8 || key.length > 200 || /\s/.test(key)) throw new OrchestratorInputError('An ElevenLabs key is 8 to 200 characters without spaces');
  return key;
}

/** The keys kept in this DOCK's database, encrypted. The laptop DOCK on the VPS is the one that keeps them. */
export class LocalElevenLabsKeys implements ElevenLabsKeys {
  constructor(private readonly db = prisma, private readonly clock: () => Date = () => new Date()) {}

  // A park that has run out is no park. Without a current key the first one is current.
  private async rows() {
    const now = this.clock();
    const rows = (await this.db.elevenLabsKey.findMany({ orderBy: { position: 'asc' } }))
      .map((row) => ({ ...row, parkedUntil: row.parkedUntil && row.parkedUntil > now ? row.parkedUntil : null }));
    const current = Math.max(0, rows.findIndex((row) => row.current));
    return { rows, current };
  }

  async list() {
    const { rows, current } = await this.rows();
    return rows.map((row, index) => ({
      name: row.name,
      masked: maskKey(decrypt(row.key)),
      parkedUntil: row.parkedUntil?.toISOString() ?? null,
      current: index === current,
    }));
  }

  async store() {
    const { rows, current } = await this.rows();
    return {
      keys: Object.fromEntries(rows.map((row) => [row.name, decrypt(row.key)])),
      order: rows.map((row) => row.name),
      current,
      cooldowns: Object.fromEntries(rows.filter((row) => row.parkedUntil).map((row) => [row.name, row.parkedUntil!.getTime()])),
    };
  }

  async add(nameInput: string, keyInput: string) {
    const name = keyName(nameInput);
    const key = encrypt(keyValue(keyInput));
    const last = await this.db.elevenLabsKey.findFirst({ orderBy: { position: 'desc' } });
    await this.db.elevenLabsKey.upsert({
      where: { name },
      create: { name, key, position: (last?.position ?? -1) + 1 },
      update: { key, parkedUntil: null },
    });
  }

  async remove(nameInput: string) {
    const removed = await this.db.elevenLabsKey.deleteMany({ where: { name: keyName(nameInput) } });
    return removed.count > 0;
  }

  async park(nameInput: string, until: Date | null) {
    await this.db.elevenLabsKey.updateMany({ where: { name: keyName(nameInput) }, data: { parkedUntil: until } });
  }

  async setCurrent(nameInput: string) {
    const name = keyName(nameInput);
    await this.db.$transaction([
      this.db.elevenLabsKey.updateMany({ where: { NOT: { name } }, data: { current: false } }),
      this.db.elevenLabsKey.updateMany({ where: { name }, data: { current: true } }),
    ]);
  }
}

/** The workspace DOCK keeps no key: every call goes to the laptop DOCK, so both DOCKs and both machines share one set. */
export class PeerElevenLabsKeys implements ElevenLabsKeys {
  constructor(private readonly call: (route: string, body: unknown) => Promise<unknown>) {}

  list() { return this.call('/elevenlabs/list', {}) as Promise<ElevenLabsKeyView[]>; }
  store() { return this.call('/elevenlabs/store', {}) as Promise<ElevenLabsStore>; }
  async add(name: string, key: string) { await this.call('/elevenlabs/add', { name, key }); }
  async remove(name: string) { return Boolean(await this.call('/elevenlabs/remove', { name })); }
  async park(name: string, until: Date | null) { await this.call('/elevenlabs/park', { name, until: until?.toISOString() ?? null }); }
  async setCurrent(name: string) { await this.call('/elevenlabs/current', { name }); }
}

export const ELEVENLABS_ROUTES = ['list', 'store', 'add', 'remove', 'park', 'current'] as const;

/** The ingest routes a machine token (or the workspace DOCK) calls. */
export function elevenLabsRoute(keys: ElevenLabsKeys, route: string, body: Record<string, unknown>) {
  switch (route) {
    case 'list': return keys.list();
    case 'store': return keys.store();
    case 'add': return keys.add(String(body.name ?? ''), String(body.key ?? '')).then(() => true);
    case 'remove': return keys.remove(String(body.name ?? ''));
    case 'park': {
      const until = body.until ? new Date(String(body.until)) : null;
      if (until && Number.isNaN(until.getTime())) throw new OrchestratorInputError('until must be a date');
      return keys.park(String(body.name ?? ''), until).then(() => true);
    }
    case 'current': return keys.setCurrent(String(body.name ?? '')).then(() => true);
    default: throw new OrchestratorInputError('Unknown ElevenLabs route');
  }
}

export const elevenLabsKeys: ElevenLabsKeys = dockMode() === 'workspace' && ledgerPeer
  ? new PeerElevenLabsKeys((route, body) => ledgerPeer!.call(route, body))
  : new LocalElevenLabsKeys();
