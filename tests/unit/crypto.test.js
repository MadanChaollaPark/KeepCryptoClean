const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { encrypt, decrypt } = require('../../lib/crypto');

describe('encrypt/decrypt', () => {
  it('should round-trip a string', () => {
    const plaintext = 'hello world';
    const encrypted = encrypt(plaintext);
    assert.notEqual(encrypted, plaintext);
    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('should round-trip an object', () => {
    const obj = { token: 'abc123', expiry: 1234567890 };
    const encrypted = encrypt(obj);
    const decrypted = decrypt(encrypted);
    assert.deepEqual(decrypted, obj);
  });

  it('should round-trip an array', () => {
    const arr = [{ name: 'cookie1' }, { name: 'cookie2' }];
    const encrypted = encrypt(arr);
    const decrypted = decrypt(encrypted);
    assert.deepEqual(decrypted, arr);
  });

  it('should produce different ciphertext for same input (random IV)', () => {
    const plaintext = 'test';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    assert.notEqual(enc1, enc2);
  });

  it('should throw on invalid encrypted format', () => {
    assert.throws(() => decrypt('not:valid'), /Invalid encrypted data format/);
    assert.throws(() => decrypt('bad-data'), /Invalid encrypted data format/);
  });
});
