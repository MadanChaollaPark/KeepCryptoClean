class TwitterAuthError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'TwitterAuthError';
    this.cause = cause;
  }
}

class RateLimitError extends Error {
  constructor(message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

class NetworkError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

class BrowserError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'BrowserError';
    this.cause = cause;
  }
}

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
