const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDistributionFromSubmitters,
  equalDistributionLists,
  isDistributionList,
  submittersFromTaskState,
} = require('../../lib/distribution');

test('distribution is sorted, deterministic, and allocates the full remainder', () => {
  const submitters = [
    { publicKey: 'charlie', votes: 1, stake: 0 },
    { publicKey: 'alpha', votes: 2, stake: 0 },
    { publicKey: 'bravo', votes: 1, stake: 0 },
  ];
  const first = buildDistributionFromSubmitters(submitters, 10);
  const second = buildDistributionFromSubmitters(
    submitters.slice().reverse(),
    10,
  );
  assert.deepEqual(first, { alpha: 4, bravo: 3, charlie: 3 });
  assert.deepEqual(second, first);
  assert.equal(
    Object.values(first).reduce((sum, value) => sum + value, 0),
    10,
  );
});

test('zero, tied, and negative votes are explicitly slashed', () => {
  assert.deepEqual(
    buildDistributionFromSubmitters(
      [
        { publicKey: 'a', votes: 1, stake: 0 },
        { publicKey: 'b', votes: 0, stake: 0 },
        { publicKey: 'c', votes: -1, stake: 0 },
      ],
      2,
    ),
    { a: 2, b: 0, c: 0 },
  );
});

test('malformed candidates and bounties fail closed', () => {
  assert.deepEqual(buildDistributionFromSubmitters([], -1), {});
  assert.deepEqual(
    buildDistributionFromSubmitters([{ publicKey: 'a', votes: 1.5 }], 10),
    {},
  );
  assert.deepEqual(
    buildDistributionFromSubmitters(
      [
        { publicKey: 'a', votes: 1 },
        { publicKey: 'a', votes: 1 },
      ],
      10,
    ),
    {},
  );
});

test('legacy audit records become deterministic submitter vote totals', () => {
  const submitters = submittersFromTaskState(
    { a: {}, b: {}, c: {}, d: {} },
    {
      b: { votes: [] },
      c: { votes: [{ is_valid: true }, { is_valid: false }] },
      d: { votes: [{ is_valid: 'yes' }] },
    },
  );
  assert.deepEqual(submitters, [
    { publicKey: 'a', votes: 1, stake: 0 },
    { publicKey: 'b', votes: 0, stake: 0 },
    { publicKey: 'c', votes: 0, stake: 0 },
    { publicKey: 'd', votes: -1, stake: 0 },
  ]);
});

test('distribution comparison rejects malformed and prototype-only keys', () => {
  assert.equal(isDistributionList({ a: 1, b: 0 }), true);
  assert.equal(isDistributionList({ a: -1 }), false);
  assert.equal(isDistributionList({ a: 1.2 }), false);
  assert.equal(equalDistributionLists({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(equalDistributionLists({ a: 1 }, { a: 1, b: 0 }), false);
});
