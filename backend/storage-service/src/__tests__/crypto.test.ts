import test from 'node:test';
import assert from 'node:assert';
import { encrypt, decrypt, hashPin } from '../utils/crypto';

test('🔒 [Storage Service] AES-256 Encryption & Decryption verification', async (t) => {
  await t.test('should securely encrypt and correctly decrypt sensitive API tokens', () => {
    const originalToken = 'github_pat_11AAAAAA_secret_token_value_987654';
    const encrypted = encrypt(originalToken);

    // Verify encrypted output differs completely from plain text
    assert.notStrictEqual(encrypted, originalToken, 'Encrypted output should not match plaintext');
    assert.strictEqual(encrypted.split(':').length, 3, 'Encrypted output must contain IV:AuthTag:Ciphertext');

    const decrypted = decrypt(encrypted);
    assert.strictEqual(decrypted, originalToken, 'Decrypted string must exactly match original token');
  });

  await t.test('should handle empty strings without failing or throwing', () => {
    assert.strictEqual(encrypt(''), '', 'Empty string should encrypt to empty string');
    assert.strictEqual(decrypt(''), '', 'Empty string should decrypt to empty string');
  });
});

test('🔑 [Storage Service] Master PIN SHA-256 Security Hashing verification', async (t) => {
  await t.test('should deterministically hash master PIN codes with salt', () => {
    const pin = '889900';
    const hash1 = hashPin(pin);
    const hash2 = hashPin(pin);

    assert.strictEqual(hash1, hash2, 'Identical PIN inputs must yield identical hash outputs');
    assert.notStrictEqual(hash1, pin, 'Hashed PIN must not expose plaintext digits');
    assert.strictEqual(hash1.length, 64, 'SHA-256 hash must be 64 hexadecimal characters long');
  });
});
