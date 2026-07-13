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
const {
  DEFAULT_PROOF_LIMITS,
  ProofReplayCache,
  validateProofPayload,
} = require('./lib/proof-validation');

dotenv.config();

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

    this.usesDefaultAdapter = !options.adapterFactory;
    this.adapterFactory = options.adapterFactory || (config => {
      // Lazy so a missing production provider fails readiness rather than
      // silently falling back to the legacy browser/reply implementation.
      const XApiAdapter = require('./adapters/x-api/adapter');
      return new XApiAdapter(config);
    });
    this.getJSONFromCID = options.getJSONFromCID || getJSONFromCID;
    this.cidValidator = options.cidValidator || isValidCID;
    this.batchProofVerifier = options.batchProofVerifier || null;
    this.targetBindingVerifier = options.targetBindingVerifier || null;
    this.expectedProvider = options.expectedProvider || process.env.EVIDENCE_PROVIDER || 'x-api-v2';
    this.limits = { ...DEFAULT_PROOF_LIMITS, ...options.limits };
    this.replayCache = options.replayCache || new ProofReplayCache(options.maxReplayEntries || 1000);
    this.autoStart = options.autoStart !== false;
    this.expectedTarget = options.expectedTarget || {
      userId: process.env.X_TARGET_USER_ID,
    };
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
    if (this.autoStart) this._launchCrawler();
  }

  async ready() {
    const initialized = await this._readyPromise;
    if (!initialized) throw this.initializationError;
    return this;
  }

  async initialize() {
    const userId = this.expectedTarget?.userId;
    if (!/^\d{1,32}$/.test(userId || '')) {
      throw new ValidationError('X_TARGET_USER_ID is required', {
        field: 'X_TARGET_USER_ID',
        value: userId,
      });
    }
    if (this.usesDefaultAdapter && !process.env.X_API_BEARER_TOKEN) {
      throw new ValidationError('X_API_BEARER_TOKEN is required', {
        field: 'X_API_BEARER_TOKEN',
      });
    }
    logger.info({ target: this.expectedTarget, round: this.round }, 'Evidence task configured');
  }

  async setAdapter() {
    const config = {
      bearerToken: process.env.X_API_BEARER_TOKEN,
      round: this.round,
      target: this.expectedTarget,
    };
    this.adapter = await this.adapterFactory(config);
    if (!this.adapter) throw new Error('Evidence provider factory returned no adapter');
  }

  _launchCrawler() {
    if (this._runPromise) return this._runPromise;
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
    await this._readyPromise;
    this.isRunning = false;
    if (this.adapter && typeof this.adapter.stop === 'function') {
      await this.adapter.stop();
    }
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
    return this.getJSONFromCID(cid, 'dataList.json', 3, { limits: this.limits });
  }

  async validate(proofCid, round) {
    if (!Number.isSafeInteger(round) || round < 0 || !(await this.cidValidator(proofCid))) {
      return false;
    }

    const cached = this.replayCache.get(proofCid, round);
    if (cached.status === 'replay') return false;
    if (cached.status === 'cached') return Boolean(await cached.value);

    const validation = this._validateProof(proofCid, round).catch(error => {
      logger.error({ err: error, proofCid, round }, 'Proof validation failed closed');
      return false;
    });
    this.replayCache.set(proofCid, round, validation);
    return validation;
  }

  async _validateProof(proofCid, round) {
    await this.ready();
    if (round !== this.round) return false;

    const data = await this.getJSONFromCID(proofCid, 'dataList.json', 3, {
      limits: this.limits,
    });
    validateProofPayload(data, {
      round,
      expectedTarget: this.expectedTarget,
      expectedProvider: this.expectedProvider,
      limits: this.limits,
    });

    if (this.targetBindingVerifier) {
      for (const record of data) {
        if (!(await this.targetBindingVerifier(record, { round, target: this.expectedTarget }))) {
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
      return (await verifyObservationBatch(data, { round, target: this.expectedTarget })) === true;
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
  const storageClientFactory =
    options.storageClientFactory || (() => {
      const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
      return new KoiiStorageClient(undefined, undefined, false);
    });

  return withRetry(
    async () => {
      const blob = await storageClientFactory().getFile(cid, fileName);
      if (Number.isFinite(blob?.size) && blob.size > limits.maxPayloadBytes) {
        throw new ValidationError('Proof payload is too large', { field: 'payload.size', value: blob.size });
      }
      const text = await blob.text();
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
