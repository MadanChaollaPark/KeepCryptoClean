'use strict';

const CANONICAL_X_ID = /^[1-9]\d{0,18}$/;

function isCanonicalXId(value) {
  return typeof value === 'string' && CANONICAL_X_ID.test(value);
}

function normalizeXId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    return null;
  }
  const normalized = String(value).trim();
  return isCanonicalXId(normalized) ? normalized : null;
}

module.exports = { CANONICAL_X_ID, isCanonicalXId, normalizeXId };
