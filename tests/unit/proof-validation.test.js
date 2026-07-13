const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MonthlyIdQuota,
  ProofReplayCache,
  sampleWithoutReplacement,
  validateProofPayload,
} = require('../../lib/proof-validation');

const NOW = 2_000_000_000;
const TARGET = { userId: '123456789' };

function record(id = '1000000000000000001', overrides = {}) {
  return {
    schemaVersion: 1,
    provider: 'x-api-v2',
    action: 'observe',
    id,
    tweetId: id,
    round: 7,
    targetUserId: TARGET.userId,
    observedAt: NOW - 10,
    ...overrides,
  };
}

const options = {
  round: 7,
  expectedTarget: TARGET,
  expectedProvider: 'x-api-v2',
  nowSeconds: NOW,
};

test('accepts the canonical IDs-only observer proof', () => {
  const payload = [record()];
  assert.equal(validateProofPayload(payload, options), payload);
});

test('rejects malformed, off-target, cross-round, future, and stale records', () => {
  const invalid = [
    record('1000000000000000002', { schemaVersion: 2 }),
    record('1000000000000000003', { provider: 'untrusted' }),
    record('1000000000000000004', { action: 'legacy-reply' }),
    record('1000000000000000005', { round: 8 }),
    record('1000000000000000006', { tweetId: '999' }),
    record('1000000000000000007', { targetUserId: '999' }),
    record('1000000000000000008', { observedAt: NOW + 301 }),
    record('1000000000000000009', { observedAt: NOW - 21601 }),
  ];
  for (const proof of invalid) {
    assert.throws(() => validateProofPayload([proof], options));
  }
});

test('rejects duplicate tweet IDs and exceeds no per-round ID limit', () => {
  const first = record('1000000000000000020');
  assert.throws(() => validateProofPayload([first, structuredClone(first)], options), /Duplicate tweetId/);
  assert.throws(
    () => validateProofPayload([first, record('1000000000000000021')], {
      ...options,
      limits: { maxItems: 1 },
    }),
    /per-round ID limit/,
  );
});

test('rejects all hydrated, derivative, username, timestamp, and reply fields', () => {
  for (const extra of [
    { content: 'hydrated text' },
    { contentHash: 'a'.repeat(64) },
    { sourceTimestamp: NOW - 20 },
    { username: 'Target_User' },
    { authorId: TARGET.userId },
    { target: TARGET },
    { reply: { id: '22' } },
  ]) {
    assert.throws(
      () => validateProofPayload([record('1000000000000000030', extra)], options),
      /non-redistributable fields/,
    );
  }
});

test('sampling never samples with replacement or mutates input', () => {
  const items = Array.from({ length: 100 }, (_, index) => index);
  const values = [0.2, 0.8, 0.1, 0.6, 0.4];
  const sample = sampleWithoutReplacement(items, 5, () => values.shift());
  assert.equal(new Set(sample).size, 5);
  assert.deepEqual(items, Array.from({ length: 100 }, (_, index) => index));
});

test('monthly producer quota enforces a finite policy cap and can be persisted', () => {
  const quota = new MonthlyIdQuota(3);
  assert.equal(quota.consume(2, NOW), true);
  assert.equal(quota.consume(2, NOW), false);
  assert.equal(quota.consume(1, NOW), true);
  const restored = new MonthlyIdQuota(3, quota.snapshot());
  assert.equal(restored.consume(1, NOW), false);
});

test('replay cache rejects a CID reused in another round and stays bounded', () => {
  const cache = new ProofReplayCache(2);
  cache.set('cid-a', 1, Promise.resolve(true));
  assert.equal(cache.get('cid-a', 1).status, 'cached');
  assert.equal(cache.get('cid-a', 2).status, 'replay');
  cache.set('cid-b', 1, false);
  cache.set('cid-c', 1, true);
  assert.equal(cache.get('cid-a', 1).status, 'miss');
});
