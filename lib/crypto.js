/**
 * Symmetric encryption helpers used to protect Twitter session cookies at rest.
 *
 * Cipher:  AES-256-GCM
 * Key:     32 bytes, supplied via the COOKIE_ENCRYPTION_KEY env var (64 hex
 *          chars). If the env var is missing or malformed, an ephemeral key
 *          is generated for the lifetime of the process — stored ciphertext
 *          will then be unreadable on the next boot and a fresh login is
 *          required.
 *
 * Wire format of an encrypted blob:
 *
 *   "<iv-hex>:<auth-tag-hex>:<ciphertext-hex>"
 */
const crypto = require('crypto');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Read the key from COOKIE_ENCRYPTION_KEY or fall back to a random one.
 * @returns {Buffer} 32-byte key
 */
function getEncryptionKey() {
  const envKey = process.env.COOKIE_ENCRYPTION_KEY;
  if (envKey) {
    const keyBuffer = Buffer.from(envKey, 'hex');
    if (keyBuffer.length === KEY_LENGTH) {
      return keyBuffer;
    }
    logger.warn('COOKIE_ENCRYPTION_KEY must be 64 hex chars (32 bytes); generating ephemeral key');
  }
  return crypto.randomBytes(KEY_LENGTH);
}

let _key;
function key() {
  if (!_key) _key = getEncryptionKey();
  return _key;
}

/**
 * Encrypt a string or JSON-serializable value.
 * Non-string values are passed through `JSON.stringify` first.
 *
 * @param {string|object} data
 * @returns {string} `iv:tag:ciphertext` (all hex)
 */
function encrypt(data) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);

  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a blob produced by {@link encrypt}. If the plaintext parses as JSON
 * the parsed value is returned; otherwise the raw string is returned.
 *
 * @param {string} encryptedStr
 * @returns {string|object}
 * @throws {Error} on malformed input or auth-tag failure
 */
function decrypt(encryptedStr) {
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

module.exports = { encrypt, decrypt };
