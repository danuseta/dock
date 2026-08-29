import crypto from 'crypto';

// AES-256-GCM encryption
const ALGORITHM = 'aes-256-gcm';
const SECRET_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const KEY = crypto.scryptSync(SECRET_KEY, 'jidis-salt', 32);

export function assertEncryptionKey(): void {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is required');
  }
}

export function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(cipherText: string): string {
  if (!cipherText) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return cipherText; // Return as-is if unencrypted legacy
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed, returning fallback:', error);
    return cipherText;
  }
}

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin + 'jidis-pin-salt').digest('hex');
}
