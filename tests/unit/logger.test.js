'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../../lib/logger');

test('structured error serializer drops request configuration and bearer values', () => {
  const error = new Error('request failed with Bearer top.secret-token');
  error.code = 'ERR_REQUEST';
  error.config = {
    headers: { Authorization: 'Bearer top.secret-token' },
  };
  const serialized = logger.sanitizeError(error);
  assert.equal(JSON.stringify(serialized).includes('top.secret-token'), false);
  assert.equal('config' in serialized, false);
  assert.equal(serialized.code, 'ERR_REQUEST');
});

test('redaction tracks secrets loaded after the logger and sanitizes string errors', () => {
  const original = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = 'late-loaded-secret-token';
  try {
    assert.equal(
      logger.sanitizeError('retry failed: late-loaded-secret-token'),
      'retry failed: [Redacted]',
    );
  } finally {
    if (original === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = original;
  }
});
