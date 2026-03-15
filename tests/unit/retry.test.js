const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { withRetry } = require('../../lib/retry');

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42), {
      maxRetries: 3,
      label: 'test',
    });
    assert.equal(result, 42);
  });

  it('should retry on failure and succeed', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return Promise.resolve('success');
      },
      { maxRetries: 5, baseDelayMs: 10, label: 'test' },
    );
    assert.equal(result, 'success');
    assert.equal(attempts, 3);
  });

  it('should throw after max retries', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            throw new Error('always fails');
          },
          { maxRetries: 2, baseDelayMs: 10, label: 'test' },
        ),
      { message: 'always fails' },
    );
    assert.equal(attempts, 3); // 1 initial + 2 retries
  });

  it('should respect shouldRetry predicate', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            throw new Error('permanent');
          },
          {
            maxRetries: 5,
            baseDelayMs: 10,
            shouldRetry: err => err.message !== 'permanent',
            label: 'test',
          },
        ),
      { message: 'permanent' },
    );
    assert.equal(attempts, 1);
  });
});
