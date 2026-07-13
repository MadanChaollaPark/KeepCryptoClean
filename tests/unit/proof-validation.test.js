const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProofReplayCache,
  validateProofPayload,
} = require('../../lib/proof-validation');

const TARGET = { userId: '123456789' };
const SUBMITTER = '11111111111111111111111111111111';
const TASK_ID = 'Vote111111111111111111111111111111111111111';

function record(id = '1000000000000000001', overrides = {}) {
  return {
    schemaVersion: 1,
    provider: 'x-api-v2',
    action: 'observe',
    id,
    tweetId: id,
    round: 7,
    targetUserId: TARGET.userId,
    submitterPublicKey: SUBMITTER,
    taskId: TASK_ID,
    ...overrides,
  };
}

const options = {
  round: 7,
  expectedTarget: TARGET,
  expectedProvider: 'x-api-v2',
  submitterPublicKey: SUBMITTER,
  taskId: TASK_ID,
};

test('accepts the canonical IDs-only observer proof', () => {
  const payload = [record()];
  assert.equal(validateProofPayload(payload, options), payload);
});

test('rejects malformed, off-target, cross-round, cross-submitter, and cross-task records', () => {
  const invalid = [
    record('1000000000000000002', { schemaVersion: 2 }),
    record('1000000000000000003', { provider: 'untrusted' }),
    record('1000000000000000004', { action: 'legacy-reply' }),
    record('1000000000000000005', { round: 8 }),
    record('1000000000000000006', { tweetId: '999' }),
    record('1000000000000000007', { targetUserId: '999' }),
    record('1000000000000000010', {
      submitterPublicKey: 'SysvarRent111111111111111111111111111111111',
    }),
    record('1000000000000000011', {
      taskId: 'SysvarRent111111111111111111111111111111111',
    }),
  ];
  for (const proof of invalid) {
    assert.throws(() => validateProofPayload([proof], options));
  }
});

test('rejects duplicate tweet IDs and exceeds no per-round ID limit', () => {
  const first = record('1000000000000000020');
  assert.throws(
    () =>
      validateProofPayload([first, structuredClone(first)], {
        ...options,
        limits: { maxItems: 2 },
      }),
    /Duplicate tweetId/,
  );
  assert.throws(
    () =>
      validateProofPayload([first, record('1000000000000000021')], {
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
    { observedAt: 2_000_000_000 },
    { sourceTimestamp: 1_999_999_980 },
    { username: 'Target_User' },
    { authorId: TARGET.userId },
    { target: TARGET },
    { reply: { id: '22' } },
  ]) {
    assert.throws(
      () =>
        validateProofPayload([record('1000000000000000030', extra)], options),
      /non-redistributable fields/,
    );
  }
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
