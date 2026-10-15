import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function defaultDatabaseUrl(): string {
  const dataDirectory = path.resolve(process.env.JIDIS_DATA_DIR || 'data');
  mkdirSync(dataDirectory, { recursive: true });
  return `file:${path.join(dataDirectory, 'jidis.db').replace(/\\/g, '/')}`;
}

export const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl();
export const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

/**
 * Write-ahead logging lets reads run while a write is in progress, so a slow write no longer stalls every query behind it.
 * The mode is stored in the database file; setting it again is a no-op. Resolves to the mode SQLite reports.
 */
export async function useWriteAheadLog(client: PrismaClient = prisma): Promise<string> {
  const [row] = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode = WAL');
  return String(row?.journal_mode ?? '');
}
