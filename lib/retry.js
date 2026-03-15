const logger = require('./logger');

/**
 * Retry an async function with exponential backoff and jitter.
 *
 * @param {Function} fn - async function to retry
 * @param {object} opts
 * @param {number} opts.maxRetries - max number of retries (default 3)
 * @param {number} opts.baseDelayMs - initial delay in ms (default 1000)
 * @param {number} opts.maxDelayMs - cap on delay (default 30000)
 * @param {Function} opts.shouldRetry - predicate(error) returning boolean (default: always true)
 * @param {string} opts.label - label for log messages
 * @returns {Promise<*>} - result of fn()
 */
async function withRetry(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = () => true,
    label = 'operation',
  } = opts;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt > maxRetries || !shouldRetry(error)) {
        break;
      }

      const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) * jitter, maxDelayMs);

      logger.warn(
        { attempt, maxRetries, delayMs: Math.round(delay), error: error.message },
        `${label}: retrying after failure`,
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

module.exports = { withRetry };
