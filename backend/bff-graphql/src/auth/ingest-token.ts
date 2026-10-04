import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';

const TOKEN_PREFIX = 'dock_ing_';

export interface GeneratedIngestToken {
  token: string;
  prefix: string;
  tokenHash: string;
}

export function hashIngestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The secret is shown once and only its SHA-256 is stored. The token carries
 * 256 bits of entropy, so a fast hash is enough and lookups stay constant-time
 * through the unique index instead of a string comparison.
 */
export function generateIngestToken(): GeneratedIngestToken {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 6), tokenHash: hashIngestToken(token) };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && token.startsWith(TOKEN_PREFIX) && token.length <= 128 ? token : null;
}
