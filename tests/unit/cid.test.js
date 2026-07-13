const test = require('node:test');
const assert = require('node:assert/strict');
const { createCIDValidator } = require('../../lib/cid');

test('CID validator uses the injected canonical parser', async () => {
  const seen = [];
  const validate = createCIDValidator(async () => ({
    parse(value) {
      seen.push(value);
      if (value === 'bad') throw new Error('bad CID');
    },
  }));
  assert.equal(await validate('bafy-test'), true);
  assert.equal(await validate('bad'), false);
  assert.deepEqual(seen, ['bafy-test', 'bad']);
});

test('CID validator rejects unsafe input before loading multiformats', async () => {
  let loaded = false;
  const validate = createCIDValidator(async () => {
    loaded = true;
    return { parse() {} };
  });
  assert.equal(await validate(''), false);
  assert.equal(await validate(' padded '), false);
  assert.equal(await validate('x'.repeat(257)), false);
  assert.equal(await validate({}), false);
  assert.equal(loaded, false);
});
