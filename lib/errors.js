/**
 * Domain-specific error classes used across the adapter layer.
 *
 * Throwing one of these (instead of a bare `Error`) lets callers branch on
 * `err instanceof TwitterAuthError`, decide whether to retry, and keep the
 * original cause attached for diagnostics.
 */

/**
 * Login failed: bad credentials, email/phone challenge, or Twitter blocked
 * the automation. The session manager treats this as fatal and stops
 * retrying credential-based logins.
 */
class TwitterAuthError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'TwitterAuthError';
    this.cause = cause;
  }
}

/**
 * Twitter has rate-limited the account or IP. `retryAfterMs` (when set)
 * tells the caller how long to wait before trying again.
 */
class RateLimitError extends Error {
  constructor(message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Network-level failure (DNS, TCP, TLS, fetch). Usually transient and
 * a candidate for retry via `lib/retry.js`.
 */
class NetworkError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * Puppeteer / Chromium failed to launch, navigate, or evaluate. Wraps the
 * underlying browser error in `cause`.
 */
class BrowserError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'BrowserError';
    this.cause = cause;
  }
}

/**
 * A piece of submitted/audited data did not match expectations.
 * `field` and `value` describe which field failed and the offending value.
 */
class ValidationError extends Error {
  constructor(message, { field, value } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

module.exports = {
  TwitterAuthError,
  RateLimitError,
  NetworkError,
  BrowserError,
  ValidationError,
};
