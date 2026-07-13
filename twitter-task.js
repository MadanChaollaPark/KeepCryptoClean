/**
 * Per-round evidence task. Construction is synchronous, while `ready()` is
 * the explicit barrier for database initialization, configuration, provider
 * authentication, and crawl launch.
 */
const dotenv = require('dotenv');
const logger = require('./lib/logger');
const { ValidationError } = require('./lib/errors');
const { withRetry } = require('./lib/retry');
const { isValidCID } = require('./lib/cid');
const { EVIDENCE_PROVIDER, getConsensusTargetUserId } = require('./config/consensus');
const {
  DEFAULT_PROOF_LIMITS,
  ProofReplayCache,
  isValidSubmitterPublicKey,
  validateProofPayload,
} = require('./lib/proof-validation');

dotenv.config();

const DEFAULT_STORAGE_GET_TIMEOUT_MS = 30_000;
const DEFAULT_BLOB_TEXT_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_SETTLEMENT_TIMEOUT_MS = 15_000;

class OperationTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function normalizeTimeout(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function withTimeout(operation, timeoutMs, label = 'operation') {
  const boundedTimeout = normalizeTimeout(timeoutMs, 1);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new OperationTimeoutError(label, boundedTimeout)),
      boundedTimeout,
    );
  });
  try {
    const pending = typeof operation === 'function'
      ? Promise.resolve().then(operation)
      : Promise.resolve(operation);
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class TwitterTask {
  constructor(round, options = {}) {
    if (!Number.isSafeInteger(round) || round < 0) {
      throw new ValidationError('round must be a non-negative safe integer', {
        field: 'round',
        value: round,
      });
    }

    this.round = round;
    this.isRunning = false;
    this.adapter = null;
    this.initializationError = null;
    this.runError = null;
    this._stopRequested = false;

    this.usesDefaultAdapter = !options.adapterFactory;
    this.adapterFactory = options.adapterFactory || (config => {
      // Lazy so a missing production provider fails readiness rather than
      // silently falling back to the legacy browser/reply implementation.
      const XApiAdapter = require('./adapters/x-api');
      return new XApiAdapter(config);
    });
    this.getJSONFromCID = options.getJSONFromCID || getJSONFromCID;
    this.cidValidator = options.cidValidator || isValidCID;
    this.batchProofVerifier = options.batchProofVerifier || null;
    this.targetBindingVerifier = options.targetBindingVerifier || null;
    this.expectedProvider = EVIDENCE_PROVIDER;
    this.limits = { ...DEFAULT_PROOF_LIMITS, ...options.limits };
    this.replayCache = options.replayCache || new ProofReplayCache(options.maxReplayEntries || 1000);
    this.autoStart = options.autoStart !== false;
    this.expectedTarget = options.expectedTarget || {
      userId: getConsensusTargetUserId(),
    };
    this.namespaceWrapper = options.namespaceWrapper || null;
    this.localSubmitterPublicKey = options.localSubmitterPublicKey || null;
    this.storageGetTimeoutMs = normalizeTimeout(
      options.storageGetTimeoutMs,
      DEFAULT_STORAGE_GET_TIMEOUT_MS,
    );
    this.blobTextTimeoutMs = normalizeTimeout(
      options.blobTextTimeoutMs,
      DEFAULT_BLOB_TEXT_TIMEOUT_MS,
    );
    this.stopSettlementTimeoutMs = normalizeTimeout(
      options.stopSettlementTimeoutMs,
      DEFAULT_STOP_SETTLEMENT_TIMEOUT_MS,
    );
    this._runPromise = null;
    this._readyPromise = this._bootstrap()
      .then(() => true)
      .catch(error => {
        this.initializationError = error;
        this.isRunning = false;
        logger.error({ err: error, round }, 'Evidence task initialization failed');
        return false;
      });
  }

  async _bootstrap() {
    await this.initialize();
    await this.setAdapter();
    if (this.autoStart && !this._stopRequested) this._launchCrawler();
  }

  async ready() {
    const initialized = await this._readyPromise;
    if (!initialized) throw this.initializationError;
    return this;
  }

  async initialize() {
    const userId = this.expectedTarget?.userId;
    if (!/^\d{1,32}$/.test(userId || '')) {
      throw new ValidationError('A build-time KCC_TARGET_USER_ID is required', {
        field: 'KCC_TARGET_USER_ID',
        value: userId,
      });
    }
    if (this.usesDefaultAdapter && !process.env.X_API_BEARER_TOKEN) {
      throw new ValidationError('X_API_BEARER_TOKEN is required', {
        field: 'X_API_BEARER_TOKEN',
      });
    }
    if (!this.localSubmitterPublicKey) {
      const wrapper = this.namespaceWrapper ||
        require('@_koii/task-manager/namespace-wrapper').namespaceWrapper;
      const account = await wrapper.getSubmitterAccount();
      this.localSubmitterPublicKey = account?.publicKey?.toBase58?.();
    }
    if (!isValidSubmitterPublicKey(this.localSubmitterPublicKey)) {
      throw new ValidationError('A valid local submitter public key is required', {
        field: 'submitterPublicKey',
        value: this.localSubmitterPublicKey,
      });
    }
    logger.info({ target: this.expectedTarget, round: this.round }, 'Evidence task configured');
  }

  async setAdapter() {
    const config = {
      bearerToken: process.env.X_API_BEARER_TOKEN,
      round: this.round,
      target: this.expectedTarget,
      submitterPublicKey: this.localSubmitterPublicKey,
    };
    this.adapter = await this.adapterFactory(config);
    if (!this.adapter) throw new Error('Evidence provider factory returned no adapter');
  }

  _launchCrawler() {
    if (this._runPromise) return this._runPromise;
    if (this._stopRequested) throw new Error('Cannot start a stopped evidence task');
    if (!this.adapter || typeof this.adapter.search !== 'function') {
      throw new Error('Evidence provider does not implement search()');
    }
    this.isRunning = true;
    const query = {
      limit: this.limits.maxItems,
      round: this.round,
      targetUserId: this.expectedTarget.userId,
      target: this.expectedTarget,
      action: 'observe',
      submitterPublicKey: this.localSubmitterPublicKey,
    };
    this._runPromise = Promise.resolve()
      .then(() => this.adapter.search(query))
      .catch(error => {
        this.runError = error;
        logger.error({ err: error, round: this.round }, 'Evidence collection failed');
      })
      .finally(() => {
        this.isRunning = false;
      });
    return this._runPromise;
  }

  async start() {
    await this.ready();
    return this._launchCrawler();
  }

  async stop() {
    this._stopRequested = true;
    this.isRunning = false;
    await withTimeout(async () => {
      await this._readyPromise;
      if (this.adapter && typeof this.adapter.stop === 'function') {
        await this.adapter.stop();
      }
      if (this._runPromise) await this._runPromise;
    }, this.stopSettlementTimeoutMs, 'Evidence task stop');
  }

  async getRoundCID(roundID) {
    await this.ready();
    if (roundID !== this.round) {
      throw new ValidationError('Cannot submit evidence for a different round', {
        field: 'round',
        value: roundID,
      });
    }
    if (this._runPromise) await this._runPromise;
    if (this.runError) throw this.runError;
    if (!this.adapter || typeof this.adapter.getSubmissionCID !== 'function') {
      throw new Error('Evidence provider does not implement getSubmissionCID()');
    }
    return this.adapter.getSubmissionCID(roundID);
  }

  async getJSONofCID(cid) {
    return this.getJSONFromCID(cid, 'dataList.json', 3, {
      limits: this.limits,
      storageGetTimeoutMs: this.storageGetTimeoutMs,
      blobTextTimeoutMs: this.blobTextTimeoutMs,
    });
  }

  async validate(proofCid, round, submitterPublicKey) {
    if (
      !Number.isSafeInteger(round) ||
      round < 0 ||
      !isValidSubmitterPublicKey(submitterPublicKey) ||
      !(await this.cidValidator(proofCid))
    ) {
      return false;
    }

    const cacheKey = `${submitterPublicKey}:${proofCid}`;
    const cached = this.replayCache.get(cacheKey, round);
    if (cached.status === 'replay') return false;
    if (cached.status === 'cached') return Boolean(await cached.value);

    const validation = this._validateProof(proofCid, round, submitterPublicKey).catch(error => {
      logger.error({ err: error, proofCid, round }, 'Proof validation failed closed');
      return false;
    });
    this.replayCache.set(cacheKey, round, validation);
    return validation;
  }

  async _validateProof(proofCid, round, submitterPublicKey) {
    await this.ready();
    if (round !== this.round) return false;

    const data = await this.getJSONFromCID(proofCid, 'dataList.json', 3, {
      limits: this.limits,
      storageGetTimeoutMs: this.storageGetTimeoutMs,
      blobTextTimeoutMs: this.blobTextTimeoutMs,
    });
    validateProofPayload(data, {
      round,
      expectedTarget: this.expectedTarget,
      expectedProvider: this.expectedProvider,
      submitterPublicKey,
      limits: this.limits,
    });

    if (this.targetBindingVerifier) {
      for (const record of data) {
        if (!(await this.targetBindingVerifier(record, {
          round,
          target: this.expectedTarget,
          submitterPublicKey,
        }))) {
          return false;
        }
      }
    }

    const verifyObservationBatch =
      this.batchProofVerifier ||
      (typeof this.adapter?.verifyObservationBatch === 'function'
        ? this.adapter.verifyObservationBatch.bind(this.adapter)
        : null);
    if (verifyObservationBatch) {
      return (await verifyObservationBatch(data, {
        round,
        target: this.expectedTarget,
        submitterPublicKey,
      })) === true;
    }
    logger.error({ proofCid, round }, 'Provider has no full-proof batch verifier');
    return false;
  }
}

/** Download and parse a bounded JSON proof from IPFS. */
async function getJSONFromCID(cid, fileName, retries = 3, options = {}) {
  const validator = options.cidValidator || isValidCID;
  if (!(await validator(cid))) return null;
  if (fileName !== 'dataList.json') {
    throw new ValidationError('Unexpected proof file name', { field: 'fileName', value: fileName });
  }

  const limits = { ...DEFAULT_PROOF_LIMITS, ...options.limits };
  const storageGetTimeoutMs = normalizeTimeout(
    options.storageGetTimeoutMs,
    DEFAULT_STORAGE_GET_TIMEOUT_MS,
  );
  const blobTextTimeoutMs = normalizeTimeout(
    options.blobTextTimeoutMs,
    DEFAULT_BLOB_TEXT_TIMEOUT_MS,
  );
  const storageClientFactory =
    options.storageClientFactory || (() => {
      const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
      return new KoiiStorageClient(undefined, undefined, false);
    });

  return withRetry(
    async () => {
      const blob = await withTimeout(
        () => storageClientFactory().getFile(cid, fileName),
        storageGetTimeoutMs,
        'IPFS proof download',
      );
      if (!Number.isSafeInteger(blob?.size) || blob.size < 0) {
        throw new ValidationError('Proof payload size is unavailable', {
          field: 'payload.size',
          value: blob?.size,
        });
      }
      if (blob.size > limits.maxPayloadBytes) {
        throw new ValidationError('Proof payload is too large', { field: 'payload.size', value: blob.size });
      }
      if (typeof blob.text !== 'function') {
        throw new ValidationError('Proof payload is not readable', { field: 'payload.text' });
      }
      const text = await withTimeout(
        () => blob.text(),
        blobTextTimeoutMs,
        'IPFS proof body read',
      );
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > limits.maxPayloadBytes) {
        throw new ValidationError('Proof payload is too large', {
          field: 'payload.size',
          value: typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : undefined,
        });
      }
      try {
        return JSON.parse(text);
      } catch (cause) {
        throw new ValidationError('Proof payload is not valid JSON', {
          field: 'payload',
          value: cause.message,
        });
      }
    },
    {
      maxRetries: retries,
      baseDelayMs: options.baseDelayMs ?? 3000,
      label: 'getJSONFromCID',
      shouldRetry: error => !(error instanceof ValidationError),
    },
  );
}

module.exports = TwitterTask;
module.exports.getJSONFromCID = getJSONFromCID;
module.exports.OperationTimeoutError = OperationTimeoutError;
module.exports.withTimeout = withTimeout;
