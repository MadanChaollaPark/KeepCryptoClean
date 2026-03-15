const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  TwitterAuthError,
  RateLimitError,
  NetworkError,
  BrowserError,
  ValidationError,
} = require('../../lib/errors');

describe('TwitterAuthError', () => {
  it('should have correct name and message', () => {
    const err = new TwitterAuthError('Login failed');
    assert.equal(err.name, 'TwitterAuthError');
    assert.equal(err.message, 'Login failed');
    assert.ok(err instanceof Error);
  });

  it('should support cause', () => {
    const cause = new Error('timeout');
    const err = new TwitterAuthError('Login failed', { cause });
    assert.equal(err.cause, cause);
  });
});

describe('RateLimitError', () => {
  it('should store retryAfterMs', () => {
    const err = new RateLimitError('Rate limited', { retryAfterMs: 60000 });
    assert.equal(err.name, 'RateLimitError');
    assert.equal(err.retryAfterMs, 60000);
    assert.ok(err instanceof Error);
  });
});

describe('NetworkError', () => {
  it('should have correct name', () => {
    const err = new NetworkError('Connection refused');
    assert.equal(err.name, 'NetworkError');
    assert.ok(err instanceof Error);
  });
});

describe('BrowserError', () => {
  it('should have correct name', () => {
    const err = new BrowserError('Chromium crash');
    assert.equal(err.name, 'BrowserError');
    assert.ok(err instanceof Error);
  });
});

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
