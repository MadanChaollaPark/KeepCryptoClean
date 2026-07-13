const { ValidationError } = require('./errors');

const DEFAULT_PROOF_LIMITS = Object.freeze({
  maxItems: 100,
  maxMonthlyIds: 1_500_000,
  maxPayloadBytes: 1024 * 1024,
  maxClockSkewSeconds: 5 * 60,
  maxObservationAgeSeconds: 6 * 60 * 60,
});

const DECIMAL_ID = /^\d{1,32}$/;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OBSERVATION_FIELDS = new Set([
  'schemaVersion',
  'provider',
  'action',
  'id',
  'tweetId',
  'round',
  'targetUserId',
  'observedAt',
]);

function fail(message, field, value) {
  throw new ValidationError(message, { field, value });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateExpectedTarget(expectedTarget) {
  if (
    !isPlainObject(expectedTarget) ||
    !DECIMAL_ID.test(expectedTarget.userId || '')
  ) {
    fail('Configured target userId is required', 'expectedTarget.userId', expectedTarget?.userId);
  }
  return expectedTarget;
}

function validateTimestamp(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} must be a positive Unix-second integer`, field, value);
  }
}

/**
 * Validate the X-policy-safe proof boundary. IPFS records contain IDs and
 * task-generated metadata only. Hydrated X content, hashes/derivatives,
 * usernames, source timestamps, and reply details are rejected as unknown
 * fields; the provider must rehydrate IDs live during audit.
 */
function validateProofPayload(payload, options = {}) {
  const limits = { ...DEFAULT_PROOF_LIMITS, ...options.limits };
  const expectedRound = options.round;
  const expectedTarget = validateExpectedTarget(options.expectedTarget);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!Number.isSafeInteger(expectedRound) || expectedRound < 0) {
    fail('round must be a non-negative safe integer', 'round', expectedRound);
  }
  if (!Array.isArray(payload)) fail('Proof payload must be an array', 'payload', payload);
  if (payload.length === 0) fail('Proof payload must not be empty', 'payload.length', 0);
  if (payload.length > limits.maxItems) {
    fail('Proof exceeds the per-round ID limit', 'payload.length', payload.length);
  }

  const tweetIds = new Set();
  payload.forEach((record, index) => {
    const base = `records[${index}]`;
    if (!isPlainObject(record)) fail('Proof record must be an object', base, record);
    const fields = Object.keys(record);
    const unknown = fields.find(field => !OBSERVATION_FIELDS.has(field));
    const missing = [...OBSERVATION_FIELDS].find(field => !Object.hasOwn(record, field));
    if (unknown || missing || fields.length !== OBSERVATION_FIELDS.size) {
      fail('Proof record contains missing or non-redistributable fields', base, unknown || missing);
    }
    if (record.schemaVersion !== 1) {
      fail('Unsupported proof schema version', `${base}.schemaVersion`, record.schemaVersion);
    }
    if (!PROVIDER.test(record.provider || '')) {
      fail('provider is invalid', `${base}.provider`, record.provider);
    }
    if (options.expectedProvider && record.provider !== options.expectedProvider) {
      fail('Proof provider is not approved', `${base}.provider`, record.provider);
    }
    if (record.action !== 'observe') {
      fail('Only read-only observe records are accepted', `${base}.action`, record.action);
    }
    if (!DECIMAL_ID.test(record.id || '')) fail('id is invalid', `${base}.id`, record.id);
    if (record.tweetId !== record.id) {
      fail('tweetId must match id', `${base}.tweetId`, record.tweetId);
    }
    if (record.round !== expectedRound) {
      fail('Record is bound to a different round', `${base}.round`, record.round);
    }
    if (!DECIMAL_ID.test(record.targetUserId || '')) {
      fail('targetUserId is invalid', `${base}.targetUserId`, record.targetUserId);
    }
    if (record.targetUserId !== expectedTarget.userId) {
      fail('Record targetUserId does not match the campaign', `${base}.targetUserId`, record.targetUserId);
    }
    validateTimestamp(record.observedAt, `${base}.observedAt`);
    if (record.observedAt > nowSeconds + limits.maxClockSkewSeconds) {
      fail('Observation timestamp is in the future', `${base}.observedAt`, record.observedAt);
    }
    if (nowSeconds - record.observedAt > limits.maxObservationAgeSeconds) {
      fail('Observation timestamp is stale', `${base}.observedAt`, record.observedAt);
    }
    if (tweetIds.has(record.tweetId)) {
      fail('Duplicate tweetId in proof', `${base}.tweetId`, record.tweetId);
    }
    tweetIds.add(record.tweetId);
  });

  return payload;
}

function sampleWithoutReplacement(items, count, random = Math.random) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  const pool = items.slice();
  const size = Math.min(count, pool.length);
  for (let i = 0; i < size; i += 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('random must return a value in [0, 1)');
    }
    const selected = i + Math.floor(value * (pool.length - i));
    [pool[i], pool[selected]] = [pool[selected], pool[i]];
  }
  return pool.slice(0, size);
}

/** In-memory quota primitive; producers should persist `snapshot()` monthly. */
class MonthlyIdQuota {
  constructor(limit = DEFAULT_PROOF_LIMITS.maxMonthlyIds, snapshot = {}) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('limit must be positive');
    if (!isPlainObject(snapshot)) throw new TypeError('snapshot must be an object');
    for (const [month, count] of Object.entries(snapshot)) {
      if (!/^\d{4}-\d{2}$/.test(month) || !Number.isSafeInteger(count) || count < 0 || count > limit) {
        throw new RangeError('snapshot contains an invalid monthly count');
      }
    }
    this.limit = limit;
    this.counts = new Map(Object.entries(snapshot));
  }

  consume(count, timestampSeconds = Math.floor(Date.now() / 1000)) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      !Number.isSafeInteger(timestampSeconds) ||
      timestampSeconds <= 0
    ) return false;
    const month = new Date(timestampSeconds * 1000).toISOString().slice(0, 7);
    const next = (this.counts.get(month) || 0) + count;
    if (next > this.limit) return false;
    this.counts.set(month, next);
    return true;
  }

  snapshot() {
    return Object.fromEntries(this.counts);
  }
}

class ProofReplayCache {
  constructor(maxEntries = 1000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError('maxEntries must be a positive integer');
    }
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(cid, round) {
    const existing = this.entries.get(cid);
    if (!existing) return { status: 'miss' };
    if (existing.round !== round) return { status: 'replay' };
    return { status: 'cached', value: existing.value };
  }

  set(cid, round, value) {
    this.entries.delete(cid);
    this.entries.set(cid, { round, value });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}

module.exports = {
  DEFAULT_PROOF_LIMITS,
  MonthlyIdQuota,
  ProofReplayCache,
  isPlainObject,
  sampleWithoutReplacement,
  validateProofPayload,
};
