const fs = require('fs');
const path = require('path');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const Data = require('../../model/data');
const { withRetry } = require('../../lib/retry');
const { XApiClient, XApiRequestError, OBSERVATION_RECORD_KEYS } = require('./client');
const { normalizeId, normalizeRound, isValidTimestamp } = require('./normalization');

const MAX_OBSERVATIONS_PER_ROUND = 100;
const DEFAULT_MAX_30_DAY_IDS = 1500000;
const ROLLING_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS = 60000;

class StorageUploadTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Storage upload attempt timed out after ${timeoutMs}ms`);
    this.name = 'StorageUploadTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

async function withTimeout(operation, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new StorageUploadTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new XApiRequestError('X API observation was aborted', { code: 'ABORTED' });
  }
}

async function defaultCidValidator(value) {
  try {
    const { CID } = await import('multiformats/cid');
    CID.parse(value);
    return true;
  } catch {
    return false;
  }
}

class XApiAdapter {
  constructor(options = {}) {
    this.client = options.client || new XApiClient(options);
    this.observations = options.dataStore || new Data('x-api:observations', []);
    this.proofs = options.proofStore || new Data('x-api:proofs', []);
    this.quota = options.quotaStore || new Data('x-api:rolling-id-quota', []);
    this.namespaceWrapper = options.namespaceWrapper || null;
    this.storageClientFactory = options.storageClientFactory ||
      (() => new KoiiStorageClient(undefined, undefined, false));
    this.cidValidator = options.cidValidator || defaultCidValidator;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    const configuredQuota = options.maxRolling30DayIds ?? options.maxMonthlyIds;
    this.maxRolling30DayIds = Number.isSafeInteger(configuredQuota) && configuredQuota > 0
      ? configuredQuota
      : DEFAULT_MAX_30_DAY_IDS;
    this.maxObservations = Math.min(
      Math.max(Number(options.maxObservations) || MAX_OBSERVATIONS_PER_ROUND, 5),
      MAX_OBSERVATIONS_PER_ROUND,
    );
    this.storageUploadTimeoutMs = Number.isSafeInteger(options.storageUploadTimeoutMs) &&
      options.storageUploadTimeoutMs > 0
      ? Math.min(options.storageUploadTimeoutMs, 120000)
      : DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS;
    this.storageUploadMaxRetries = Number.isSafeInteger(options.storageUploadMaxRetries) &&
      options.storageUploadMaxRetries >= 0
      ? Math.min(options.storageUploadMaxRetries, 3)
      : 3;
    this.ready = Promise.all([
      this.observations.initializeData(),
      this.proofs.initializeData(),
      this.quota.initializeData(),
    ]);
    this.lastContext = null;
    this._quotaQueue = Promise.resolve();
    this._activeControllers = new Set();
    this._controllerCleanup = new Map();
    this.stopped = false;
  }

  _namespaceWrapper() {
    return this.namespaceWrapper ||
      require('@_koii/task-manager/namespace-wrapper').namespaceWrapper;
  }

  async search(query = {}) {
    if (this.stopped) throw new XApiRequestError('X API adapter is stopped', { code: 'ABORTED' });
    await this.ready;
    if (this.stopped) throw new XApiRequestError('X API adapter is stopped', { code: 'ABORTED' });
    const round = normalizeRound(query.round);
    const targetUserId = normalizeId(query.targetUserId);
    if (round === null || !targetUserId) {
      throw new TypeError('X API search requires targetUserId and a non-negative integer round');
    }
    const requestedLimit = Math.min(
      Math.max(Number(query.limit) || this.maxObservations, 5),
      this.maxObservations,
    );
    const controller = this._createController(query.signal);
    try {
      const records = await this.client.observeUserId(targetUserId, round, {
        maxResults: requestedLimit,
        signal: controller.signal,
      });
      throwIfAborted(controller.signal);
      if (records.length > this.maxObservations) {
        throw new Error('X API observer returned more records than the configured round bound');
      }
      this._validateCanonicalRecords(records, round, targetUserId);
      await this.observations.create({
        id: `round:${round}`,
        round,
        records,
      }, { signal: controller.signal });
      throwIfAborted(controller.signal);
      if (records.length > 0) {
        this.lastContext = {
          round,
          target: { userId: records[0].targetUserId },
        };
      }
      return records;
    } finally {
      this._releaseController(controller);
    }
  }

  async getSubmissionCID(round) {
    await this.ready;
    const normalizedRound = normalizeRound(round);
    if (normalizedRound === null) throw new TypeError('Submission round must be a non-negative integer');

    const stored = (await this.observations.getItem({ id: `round:${normalizedRound}` }))?.[0];
    if (!stored) return null;
    const records = stored.records;
    if (!Array.isArray(records) || records.length === 0) return null;
    if (records.length > this.maxObservations) {
      throw new Error('Refusing to upload an observation set above the configured round bound');
    }
    records.sort((left, right) => left.tweetId.localeCompare(right.tweetId));

    const targetUserId = normalizeId(records[0]?.targetUserId);
    this._validateCanonicalRecords(records, normalizedRound, targetUserId);
    await this._reserveRollingIds(normalizedRound, records.length);

    const namespaceWrapper = this._namespaceWrapper();
    const basePath = await namespaceWrapper.getBasePath();
    let submissionDirectory = null;
    try {
      submissionDirectory = await fs.promises.mkdtemp(
        path.join(basePath, 'x-api-submission-'),
      );
      const filePath = path.join(submissionDirectory, 'dataList.json');
      await fs.promises.writeFile(filePath, JSON.stringify(records), {
        encoding: 'utf8',
        mode: 0o600,
      });
      const cid = await withRetry(async () => {
        const client = this.storageClientFactory();
        const submitter = await namespaceWrapper.getSubmitterAccount();
        const response = await withTimeout(
          () => client.uploadFile(filePath, submitter),
          this.storageUploadTimeoutMs,
        );
        if (!response || typeof response.cid !== 'string' || !response.cid.trim()) {
          throw new Error('Storage upload did not return a CID');
        }
        const cid = response.cid.trim();
        if (!(await this.cidValidator(cid))) {
          throw new Error('Storage upload returned an invalid CID');
        }
        return cid;
      }, {
        maxRetries: this.storageUploadMaxRetries,
        baseDelayMs: 1000,
        label: 'X API observation upload',
      });
      await this.proofs.create({
        id: `proof:${normalizedRound}`,
        round: normalizedRound,
        proof_cid: cid,
        recordCount: records.length,
      });
      return cid;
    } finally {
      if (submissionDirectory) {
        await fs.promises.rm(submissionDirectory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async verifyObservationBatch(records, context = {}) {
    if (this.stopped) return false;
    const controller = this._createController(context.signal);
    try {
      return await this.client.verifyObservationBatch(records, {
        ...context,
        signal: controller.signal,
      });
    } finally {
      this._releaseController(controller);
    }
  }

  _validateCanonicalRecords(records, round, targetUserId) {
    const validationTime = this.now();
    if (!Array.isArray(records) || !normalizeId(targetUserId) || !isValidTimestamp(validationTime, validationTime)) {
      throw new Error('Observation set has an invalid target or validation clock');
    }
    const seenIds = new Set();
    for (const record of records) {
      const exactKeys = Object.keys(record || {}).sort();
      const tweetId = normalizeId(record?.tweetId);
      if (
        exactKeys.length !== OBSERVATION_RECORD_KEYS.length ||
        exactKeys.some((key, index) => key !== OBSERVATION_RECORD_KEYS[index]) ||
        record.schemaVersion !== 1 ||
        record.provider !== 'x-api-v2' ||
        record.action !== 'observe' ||
        normalizeId(record.id) !== tweetId ||
        seenIds.has(tweetId) ||
        record.round !== round ||
        normalizeId(record.targetUserId) !== normalizeId(targetUserId) ||
        !isValidTimestamp(record.observedAt, validationTime, 5 * 60)
      ) {
        throw new Error('Refusing to persist or upload malformed observation records');
      }
      seenIds.add(tweetId);
    }
  }

  _createController(externalSignal) {
    const controller = new AbortController();
    let cleanup = () => {};
    if (externalSignal?.aborted) controller.abort();
    else if (externalSignal) {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      cleanup = () => externalSignal.removeEventListener('abort', onAbort);
    }
    this._activeControllers.add(controller);
    this._controllerCleanup.set(controller, cleanup);
    return controller;
  }

  _releaseController(controller) {
    this._controllerCleanup.get(controller)?.();
    this._controllerCleanup.delete(controller);
    this._activeControllers.delete(controller);
  }

  _reserveRollingIds(round, recordCount) {
    const reservation = this._quotaQueue.then(async () => {
      const now = this.now();
      if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid clock for rolling ID quota');
      const id = 'rolling:30-days';
      const existing = (await this.quota.getItem({ id }))?.[0] || null;
      const cutoff = now - ROLLING_WINDOW_SECONDS;
      if (existing && !Array.isArray(existing.reservations)) {
        throw new Error('Persisted rolling ID quota is malformed');
      }
      const allReservations = existing?.reservations || [];
      if (allReservations.some(item =>
        !Number.isSafeInteger(item?.round) ||
        !Number.isSafeInteger(item?.count) ||
        item.count <= 0 ||
        !Number.isSafeInteger(item?.timestamp) ||
        item.timestamp <= 0
      )) {
        throw new Error('Persisted rolling ID quota is malformed');
      }
      const reservations = allReservations.filter(item => item.timestamp > cutoff);
      const existingRound = reservations.find(item => item.round === round);
      if (existingRound) {
        if (existingRound.count !== recordCount) {
          throw new Error('Round ID quota was already reserved with a different record count');
        }
        const count = reservations.reduce((sum, item) => sum + item.count, 0);
        if (reservations.length !== allReservations.length || existing.count !== count) {
          return this.quota.create({
            id,
            count,
            reservations,
            timestamp: Math.max(now, (existing.timestamp || 0) + 1),
          });
        }
        return existing;
      }
      const currentCount = reservations.reduce((sum, item) => sum + item.count, 0);
      if (currentCount + recordCount > this.maxRolling30DayIds) {
        throw new Error('Rolling 30-day X Post ID redistribution quota would be exceeded');
      }
      reservations.push({ round, count: recordCount, timestamp: now });
      return this.quota.create({
        id,
        count: currentCount + recordCount,
        reservations,
        timestamp: Math.max(now, (existing?.timestamp || 0) + 1),
      });
    });
    this._quotaQueue = reservation.catch(() => {});
    return reservation;
  }

  async stop() {
    this.stopped = true;
    for (const controller of [...this._activeControllers]) {
      controller.abort();
      this._releaseController(controller);
    }
    await this.ready;
    return true;
  }
}

module.exports = XApiAdapter;
module.exports.XApiAdapter = XApiAdapter;
module.exports.MAX_OBSERVATIONS_PER_ROUND = MAX_OBSERVATIONS_PER_ROUND;
module.exports.DEFAULT_MAX_30_DAY_IDS = DEFAULT_MAX_30_DAY_IDS;
module.exports.ROLLING_WINDOW_SECONDS = ROLLING_WINDOW_SECONDS;
module.exports.DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS = DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS;
module.exports.defaultCidValidator = defaultCidValidator;
module.exports.StorageUploadTimeoutError = StorageUploadTimeoutError;
module.exports.withTimeout = withTimeout;
