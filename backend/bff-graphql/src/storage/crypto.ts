import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function encryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required');
  return crypto.scryptSync(secret, 'jidis-salt', 32);
}

export function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(cipherText: string): string {
  if (!cipherText) return '';
  const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) return cipherText;
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [prefix, saltHex, hashHex] = storedHash.split(':');
  if (prefix === 'scrypt' && saltHex && hashHex) {
    const actual = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  const legacy = crypto.createHash('sha256').update(pin + 'jidis-pin-salt').digest();
  const expected = Buffer.from(storedHash, 'hex');
  return legacy.length === expected.length && crypto.timingSafeEqual(legacy, expected);
}
