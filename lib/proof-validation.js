const { ValidationError } = require('./errors');
const { PublicKey } = require('@_koii/web3.js');
const { isCanonicalXId } = require('./identifiers');

const DEFAULT_PROOF_LIMITS = Object.freeze({
  maxItems: 1,
  maxPayloadBytes: 1024 * 1024,
});

const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OBSERVATION_FIELDS = new Set([
  'schemaVersion',
  'provider',
  'action',
  'id',
  'tweetId',
  'round',
  'targetUserId',
  'submitterPublicKey',
  'taskId',
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
    !isCanonicalXId(expectedTarget.userId)
  ) {
    fail(
      'Configured target userId is required',
      'expectedTarget.userId',
      expectedTarget?.userId,
    );
  }
  return expectedTarget;
}

function isValidSubmitterPublicKey(value) {
  if (typeof value !== 'string' || !BASE58_PUBLIC_KEY.test(value)) return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
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
  const expectedSubmitter = options.submitterPublicKey;
  const expectedTaskId = options.taskId;

  if (!Number.isSafeInteger(expectedRound) || expectedRound < 0) {
    fail('round must be a non-negative safe integer', 'round', expectedRound);
  }
  if (!isValidSubmitterPublicKey(expectedSubmitter)) {
    fail(
      'A valid submitter public key is required',
      'submitterPublicKey',
      expectedSubmitter,
    );
  }
  if (!isValidSubmitterPublicKey(expectedTaskId)) {
    fail('A valid Koii task ID is required', 'taskId', expectedTaskId);
  }
  if (!Array.isArray(payload))
    fail('Proof payload must be an array', 'payload', payload);
  if (payload.length === 0)
    fail('Proof payload must not be empty', 'payload.length', 0);
  if (payload.length > limits.maxItems) {
    fail(
      'Proof exceeds the per-round ID limit',
      'payload.length',
      payload.length,
    );
  }

  const tweetIds = new Set();
  payload.forEach((record, index) => {
    const base = `records[${index}]`;
    if (!isPlainObject(record))
      fail('Proof record must be an object', base, record);
    const fields = Object.keys(record);
    const unknown = fields.find(field => !OBSERVATION_FIELDS.has(field));
    const missing = [...OBSERVATION_FIELDS].find(
      field => !Object.hasOwn(record, field),
    );
    if (unknown || missing || fields.length !== OBSERVATION_FIELDS.size) {
      fail(
        'Proof record contains missing or non-redistributable fields',
        base,
        unknown || missing,
      );
    }
    if (record.schemaVersion !== 1) {
      fail(
        'Unsupported proof schema version',
        `${base}.schemaVersion`,
        record.schemaVersion,
      );
    }
    if (!PROVIDER.test(record.provider || '')) {
      fail('provider is invalid', `${base}.provider`, record.provider);
    }
    if (
      options.expectedProvider &&
      record.provider !== options.expectedProvider
    ) {
      fail(
        'Proof provider is not approved',
        `${base}.provider`,
        record.provider,
      );
    }
    if (record.action !== 'observe') {
      fail(
        'Only read-only observe records are accepted',
        `${base}.action`,
        record.action,
      );
    }
    if (!isCanonicalXId(record.id))
      fail('id is invalid', `${base}.id`, record.id);
    if (record.tweetId !== record.id) {
      fail('tweetId must match id', `${base}.tweetId`, record.tweetId);
    }
    if (record.round !== expectedRound) {
      fail(
        'Record is bound to a different round',
        `${base}.round`,
        record.round,
      );
    }
    if (!isCanonicalXId(record.targetUserId)) {
      fail(
        'targetUserId is invalid',
        `${base}.targetUserId`,
        record.targetUserId,
      );
    }
    if (record.targetUserId !== expectedTarget.userId) {
      fail(
        'Record targetUserId does not match the campaign',
        `${base}.targetUserId`,
        record.targetUserId,
      );
    }
    if (!isValidSubmitterPublicKey(record.submitterPublicKey)) {
      fail(
        'submitterPublicKey is invalid',
        `${base}.submitterPublicKey`,
        record.submitterPublicKey,
      );
    }
    if (record.submitterPublicKey !== expectedSubmitter) {
      fail(
        'Record submitterPublicKey does not match the submitting node',
        `${base}.submitterPublicKey`,
        record.submitterPublicKey,
      );
    }
    if (
      !isValidSubmitterPublicKey(record.taskId) ||
      record.taskId !== expectedTaskId
    ) {
      fail(
        'Record taskId does not match this Koii task',
        `${base}.taskId`,
        record.taskId,
      );
    }
    if (tweetIds.has(record.tweetId)) {
      fail('Duplicate tweetId in proof', `${base}.tweetId`, record.tweetId);
    }
    tweetIds.add(record.tweetId);
  });

  return payload;
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
  BASE58_PUBLIC_KEY,
  DEFAULT_PROOF_LIMITS,
  ProofReplayCache,
  isPlainObject,
  isValidSubmitterPublicKey,
  validateProofPayload,
};
