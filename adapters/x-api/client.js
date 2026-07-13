const axios = require('axios');
const {
  convertToTimestamp,
  normalizeId,
  normalizeRound,
  isValidTimestamp,
} = require('./normalization');

const X_API_BASE_URL = 'https://api.x.com/2';
const MAX_GET_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30000;
const DEFAULT_MAX_SOURCE_AGE_SECONDS = 6 * 60 * 60;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const OBSERVATION_RECORD_KEYS = Object.freeze([
  'action',
  'id',
  'observedAt',
  'provider',
  'round',
  'schemaVersion',
  'targetUserId',
  'tweetId',
]);
const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

class XApiConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XApiConfigurationError';
  }
}

class XApiPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XApiPolicyError';
  }
}

class XApiRequestError extends Error {
  constructor(message, { status = null, code = 'UNKNOWN', retryable = false } = {}) {
    super(message);
    this.name = 'XApiRequestError';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.code = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
      ? code
      : 'UNKNOWN';
    this.retryable = retryable === true;
  }
}

function isAbortError(error, signal) {
  return (
    signal?.aborted === true ||
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError'
  );
}

function sanitizedRequestError(error, retryable, aborted = false) {
  if (aborted) {
    return new XApiRequestError('X API read request was aborted', {
      code: 'ABORTED',
      retryable: false,
    });
  }
  return new XApiRequestError('X API read request failed', {
    status: Number(error?.response?.status),
    code: error?.code,
    retryable,
  });
}

async function abortableSleep(sleep, delayMs, signal) {
  if (!signal) return sleep(delayMs);
  if (signal.aborted) throw sanitizedRequestError(null, false, true);
  let onAbort;
  try {
    await Promise.race([
      sleep(delayMs),
      new Promise((_resolve, reject) => {
        onAbort = () => reject(sanitizedRequestError(null, false, true));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function retryDelayMs(error, attempt, nowMs = Date.now(), random = Math.random) {
  const headers = error?.response?.headers || {};
  const retryAfter = headers['retry-after'];
  let requestedDelay = null;
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) requestedDelay = seconds * 1000;
    else {
      const dateMs = Date.parse(retryAfter);
      if (Number.isFinite(dateMs)) requestedDelay = Math.max(0, dateMs - nowMs);
    }
  }
  if (requestedDelay === null && headers['x-rate-limit-reset'] !== undefined) {
    const resetSeconds = Number(headers['x-rate-limit-reset']);
    if (Number.isFinite(resetSeconds)) requestedDelay = Math.max(0, resetSeconds * 1000 - nowMs);
  }
  if (requestedDelay === null) {
    const jitter = 0.85 + Math.max(0, Math.min(1, random())) * 0.3;
    requestedDelay = 500 * Math.pow(2, attempt) * jitter;
  }
  return Math.min(Math.round(requestedDelay), MAX_RETRY_DELAY_MS);
}

class XApiClient {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.bearerToken = options.bearerToken || this.env.X_API_BEARER_TOKEN;
    this.maxSourceAgeSeconds = Number.isSafeInteger(options.maxSourceAgeSeconds) &&
      options.maxSourceAgeSeconds > 0
      ? options.maxSourceAgeSeconds
      : DEFAULT_MAX_SOURCE_AGE_SECONDS;
    this.maxResponseBytes = Number.isSafeInteger(options.maxResponseBytes) &&
      options.maxResponseBytes > 0
      ? Math.min(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
      : DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.random = options.random || Math.random;
    this.nowMs = options.nowMs || Date.now;
    this.transport = options.transport || axios.create({
      baseURL: X_API_BASE_URL,
      timeout: 30000,
      maxContentLength: this.maxResponseBytes,
      maxBodyLength: this.maxResponseBytes,
    });
  }

  _authorization() {
    if (!this.bearerToken || typeof this.bearerToken !== 'string') {
      throw new XApiConfigurationError('X_API_BEARER_TOKEN is required');
    }
    return { Authorization: `Bearer ${this.bearerToken}` };
  }

  async _get(path, params, { signal } = {}) {
    const headers = this._authorization();
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw sanitizedRequestError(null, false, true);
      try {
        const response = await this.transport.get(path, {
          params,
          headers,
          signal,
          maxContentLength: this.maxResponseBytes,
          maxBodyLength: this.maxResponseBytes,
        });
        return response.data;
      } catch (error) {
        if (isAbortError(error, signal)) throw sanitizedRequestError(error, false, true);
        const status = Number(error?.response?.status);
        const networkFailure = !error?.response && (
          TRANSIENT_NETWORK_CODES.has(error?.code) ||
          (error?.isAxiosError === true && !!error?.request)
        );
        const retryable = networkFailure || status === 429 || (status >= 500 && status <= 599);
        if (!retryable || attempt >= MAX_GET_RETRIES) {
          throw sanitizedRequestError(error, retryable);
        }
        await abortableSleep(
          this.sleep,
          retryDelayMs(error, attempt, this.nowMs(), this.random),
          signal,
        );
      }
    }
  }

  async getTweet(tweetId, options = {}) {
    const id = normalizeId(tweetId);
    if (!id) throw new XApiConfigurationError('A valid numeric Post ID is required');
    const payload = await this._get(`/tweets/${id}`, {
      'tweet.fields': 'id,author_id,created_at',
    }, { signal: options.signal });
    if (normalizeId(payload?.data?.id) !== id) {
      throw new XApiPolicyError('X API response did not bind to the requested Post ID');
    }
    return payload.data;
  }

  async getTweets(tweetIds, options = {}) {
    if (!Array.isArray(tweetIds) || tweetIds.length === 0 || tweetIds.length > 100) {
      throw new XApiConfigurationError('getTweets requires between 1 and 100 Post IDs');
    }
    const ids = tweetIds.map(normalizeId);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      throw new XApiConfigurationError('getTweets requires unique numeric Post IDs');
    }

    const payload = await this._get('/tweets', {
      ids: ids.join(','),
      'tweet.fields': 'id,author_id,created_at',
    }, { signal: options.signal });
    if (!Array.isArray(payload?.data) || payload.data.length !== ids.length) {
      throw new XApiPolicyError('X API batch response did not contain every requested Post');
    }

    const requested = new Set(ids);
    const byId = new Map();
    for (const tweet of payload.data) {
      const id = normalizeId(tweet?.id);
      if (!id || !requested.has(id) || byId.has(id)) {
        throw new XApiPolicyError('X API batch response contained an unexpected or duplicate Post');
      }
      byId.set(id, tweet);
    }
    return ids.map(id => byId.get(id));
  }

  async getUserTweets(userId, options = {}) {
    const targetUserId = normalizeId(userId);
    if (!targetUserId) throw new XApiConfigurationError('A valid numeric target User ID is required');
    const maxResults = Math.min(Math.max(Number(options.maxResults) || 10, 5), 100);
    const payload = await this._get(`/users/${targetUserId}/tweets`, {
      max_results: maxResults,
      exclude: 'retweets,replies',
      'tweet.fields': 'id,author_id,created_at',
    }, { signal: options.signal });
    if (payload?.data !== undefined && !Array.isArray(payload.data)) {
      throw new XApiPolicyError('X API user timeline response was malformed');
    }
    return payload?.data || [];
  }

  /** Return only policy-permitted IDs plus task-generated metadata. */
  async observeUserId(userId, round, options = {}) {
    const targetUserId = normalizeId(userId);
    const normalizedRound = normalizeRound(round);
    if (!targetUserId || normalizedRound === null) {
      throw new XApiConfigurationError('A numeric target User ID and non-negative integer round are required');
    }

    const tweets = await this.getUserTweets(targetUserId, options);
    const observedAt = this.now();
    if (!isValidTimestamp(observedAt, observedAt)) {
      throw new XApiConfigurationError('Clock returned an invalid Unix timestamp');
    }

    const records = [];
    const seenIds = new Set();
    for (const tweet of tweets) {
      const tweetId = normalizeId(tweet.id);
      const authorId = normalizeId(tweet.author_id);
      const sourceTimestamp = convertToTimestamp(tweet.created_at);
      if (
        !tweetId ||
        authorId !== targetUserId ||
        !isValidTimestamp(sourceTimestamp, observedAt) ||
        seenIds.has(tweetId)
      ) {
        throw new XApiPolicyError('X API observation contained an unbound, malformed, or future Post');
      }
      seenIds.add(tweetId);
      if (observedAt - sourceTimestamp > this.maxSourceAgeSeconds) continue;
      records.push({
        schemaVersion: 1,
        provider: 'x-api-v2',
        action: 'observe',
        id: tweetId,
        tweetId,
        round: normalizedRound,
        targetUserId,
        observedAt,
      });
    }
    return records;
  }

  /** Rehydrate and verify every ID; no hydrated X Content is persisted. */
  async verifyObservationBatch(records, context = {}) {
    try {
      if (!Array.isArray(records) || records.length === 0 || records.length > 100) return false;
      const expectedRound = normalizeRound(context.round);
      const expectedUserId = normalizeId(context.target?.userId);
      if (expectedRound === null || !expectedUserId) return false;
      const verificationTime = this.now();
      if (!isValidTimestamp(verificationTime, verificationTime)) return false;
      const maxSourceAgeSeconds = Number.isSafeInteger(context.maxSourceAgeSeconds) &&
        context.maxSourceAgeSeconds > 0
        ? context.maxSourceAgeSeconds
        : this.maxSourceAgeSeconds;

      const ids = [];
      for (const record of records) {
        const tweetId = normalizeId(record?.tweetId);
        const exactKeys = Object.keys(record || {}).sort();
        if (
          exactKeys.length !== OBSERVATION_RECORD_KEYS.length ||
          exactKeys.some((key, index) => key !== OBSERVATION_RECORD_KEYS[index]) ||
          record?.schemaVersion !== 1 ||
          record?.provider !== 'x-api-v2' ||
          record?.action !== 'observe' ||
          normalizeId(record.id) !== tweetId ||
          normalizeRound(record.round) !== expectedRound ||
          normalizeId(record.targetUserId) !== expectedUserId ||
          !isValidTimestamp(record.observedAt, verificationTime, 5 * 60)
        ) {
          return false;
        }
        ids.push(tweetId);
      }
      if (new Set(ids).size !== ids.length) return false;

      const tweets = await this.getTweets(ids, { signal: context.signal });
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const tweet = tweets[index];
        const sourceTimestamp = convertToTimestamp(tweet.created_at);
        if (
          normalizeId(tweet.author_id) !== expectedUserId ||
          !isValidTimestamp(sourceTimestamp, verificationTime, 5 * 60) ||
          sourceTimestamp > record.observedAt + 5 * 60 ||
          sourceTimestamp > verificationTime + 5 * 60 ||
          verificationTime - sourceTimestamp > maxSourceAgeSeconds
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  X_API_BASE_URL,
  MAX_GET_RETRIES,
  MAX_RETRY_DELAY_MS,
  DEFAULT_MAX_SOURCE_AGE_SECONDS,
  DEFAULT_MAX_RESPONSE_BYTES,
  OBSERVATION_RECORD_KEYS,
  TRANSIENT_NETWORK_CODES,
  XApiConfigurationError,
  XApiPolicyError,
  XApiRequestError,
  isAbortError,
  sanitizedRequestError,
  abortableSleep,
  retryDelayMs,
  XApiClient,
};
