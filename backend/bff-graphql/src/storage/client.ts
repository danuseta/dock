import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function defaultDatabaseUrl(): string {
  const dataDirectory = path.resolve(process.env.JIDIS_DATA_DIR || 'data');
  mkdirSync(dataDirectory, { recursive: true });
  return `file:${path.join(dataDirectory, 'jidis.db').replace(/\\/g, '/')}`;
}

const POOL_PARAMS = { connection_limit: '1', pool_timeout: '30', socket_timeout: '10' };

/** One connection serialises SQLite writes in the client, so they queue instead of timing out on the file lock; a value the URL already sets stays. */
export function withPoolParams(url: string): string {
  if (!url.startsWith('file:')) return url;
  const mark = url.indexOf('?');
  const query = mark < 0 ? '' : url.slice(mark + 1);
  const set = new Set(query.split('&').map((pair) => pair.split('=')[0]));
  const missing = Object.entries(POOL_PARAMS).filter(([name]) => !set.has(name)).map(([name, value]) => `${name}=${value}`);
  return [mark < 0 ? url : url.slice(0, mark), [query, ...missing].filter(Boolean).join('&')].join('?');
}

export const databaseUrl = withPoolParams(process.env.DATABASE_URL || defaultDatabaseUrl());
export const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 20_000 } });

/**
 * Write-ahead logging lets reads run while a write is in progress, so a slow write no longer stalls every query behind it.
 * The mode is stored in the database file; setting it again is a no-op. Resolves to the mode SQLite reports.
 */
export async function useWriteAheadLog(client: PrismaClient = prisma): Promise<string> {
  const [row] = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode = WAL');
  return String(row?.journal_mode ?? '');
}

/** Makes a write wait for the file lock instead of failing at once. Per connection, so it holds for every query while the pool has one. */
export async function useBusyTimeout(client: PrismaClient = prisma, milliseconds = 10_000): Promise<number> {
  const [row] = await client.$queryRawUnsafe<Array<{ timeout: number | bigint }>>(`PRAGMA busy_timeout = ${Math.trunc(milliseconds)}`);
  return Number(row?.timeout ?? 0);
}
