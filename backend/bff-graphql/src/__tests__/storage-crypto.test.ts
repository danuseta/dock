import assert from 'node:assert';
import test, { mock } from 'node:test';
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

test('the encryption key is derived once per ENCRYPTION_KEY, not on every encrypt and decrypt', () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  const scrypt = mock.method(crypto, 'scryptSync');

  try {
    process.env.ENCRYPTION_KEY = 'derive-once-key-a';
    const values = Array.from({ length: 5 }, (_, index) => encrypt(`secret-${index}`));
    values.forEach((value, index) => assert.strictEqual(decrypt(value), `secret-${index}`));
    assert.strictEqual(scrypt.mock.callCount(), 1);

    process.env.ENCRYPTION_KEY = 'derive-once-key-b';
    assert.strictEqual(decrypt(encrypt('other')), 'other');
    assert.strictEqual(scrypt.mock.callCount(), 2);
    assert.throws(() => decrypt(values[0]));
  } finally {
    scrypt.mock.restore();
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  }
});
