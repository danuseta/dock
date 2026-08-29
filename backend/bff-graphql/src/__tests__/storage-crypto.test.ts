import assert from 'node:assert';
import test from 'node:test';
import crypto from 'node:crypto';
import { decrypt, encrypt, hashPin, verifyPin } from '../storage/crypto';

test('SQLite storage encrypts secrets and uses salted PIN hashes', () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'phase-3-test-encryption-key';

  try {
    const encrypted = encrypt('secret-value');
    assert.notStrictEqual(encrypted, 'secret-value');
    assert.strictEqual(decrypt(encrypted), 'secret-value');

    const first = hashPin('123456');
    const second = hashPin('123456');
    assert.notStrictEqual(first, second);
    assert.strictEqual(verifyPin('123456', first), true);
    assert.strictEqual(verifyPin('654321', first), false);

    const legacy = crypto.createHash('sha256').update('889900jidis-pin-salt').digest('hex');
    assert.strictEqual(verifyPin('889900', legacy), true);
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  }
});
