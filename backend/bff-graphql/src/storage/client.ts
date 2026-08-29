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
