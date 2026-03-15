const crypto = require('crypto');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

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

function encrypt(data) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);

  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

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
