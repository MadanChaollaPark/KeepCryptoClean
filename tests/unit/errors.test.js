const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ValidationError } = require('../../lib/errors');

describe('ValidationError', () => {
  it('should store field and value', () => {
    const err = new ValidationError('Invalid CID', {
      field: 'cid',
      value: 'not-a-cid',
    });
    assert.equal(err.name, 'ValidationError');
    assert.equal(err.field, 'cid');
    assert.equal(err.value, 'not-a-cid');
    assert.ok(err instanceof Error);
  });
});
