const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const Data = require('../../model/data');
const { withRetry } = require('../../lib/retry');
const { isValidCID } = require('../../lib/cid');
const { isValidSubmitterPublicKey } = require('../../lib/proof-validation');
const {
  XApiClient,
  XApiRequestError,
  OBSERVATION_RECORD_KEYS,
} = require('./client');
const { normalizeId, normalizeRound } = require('./normalization');

const MAX_OBSERVATIONS_PER_ROUND = 1;
const DEFAULT_MAX_30_DAY_IDS = 1500000;
const ROLLING_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS = 60000;
const DEFAULT_RETENTION_ROUNDS = 512;

class StorageUploadTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Storage upload attempt timed out after ${timeoutMs}ms`);
    this.name = 'StorageUploadTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

async function withTimeout(operation, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timeout;
  let removeExternalAbort = () => {};
  try {
    const cancellation = new Promise((resolve, reject) => {
      const abortWith = error => {
        controller.abort(error);
        reject(error);
      };
      if (externalSignal?.aborted) {
        abortWith(
          new XApiRequestError('Storage operation was aborted', {
            code: 'ABORTED',
          }),
        );
        return;
      }
      if (externalSignal) {
        const onAbort = () =>
          abortWith(
            new XApiRequestError('Storage operation was aborted', {
              code: 'ABORTED',
            }),
          );
        externalSignal.addEventListener('abort', onAbort, { once: true });
        removeExternalAbort = () =>
          externalSignal.removeEventListener('abort', onAbort);
      }
      timeout = setTimeout(
        () => abortWith(new StorageUploadTimeoutError(timeoutMs)),
        timeoutMs,
      );
    });
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      cancellation,
    ]);
  } finally {
    clearTimeout(timeout);
    removeExternalAbort();
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new XApiRequestError('X API observation was aborted', {
      code: 'ABORTED',
    });
  }
}

const defaultCidValidator = isValidCID;

class XApiAdapter {
  constructor(options = {}) {
    if (!isValidSubmitterPublicKey(options.submitterPublicKey)) {
      throw new TypeError(
        'X API adapter requires a valid submitter public key',
      );
    }
    if (!isValidSubmitterPublicKey(options.taskId)) {
      throw new TypeError('X API adapter requires a valid Koii task ID');
    }
    this.submitterPublicKey = options.submitterPublicKey;
    this.taskId = options.taskId;
    this.client = options.client || new XApiClient(options);
    this.observations = options.dataStore || new Data('x-api:observations', []);
    this.proofs = options.proofStore || new Data('x-api:proofs', []);
    this.quota = options.quotaStore || new Data('x-api:rolling-id-quota', []);
    this.namespaceWrapper = options.namespaceWrapper || null;
    this.storageClientFactory =
      options.storageClientFactory ||
      (() => KoiiStorageClient.getInstance({ debug: false }));
    this.storageClient = options.storageClient || null;
    this.cidValidator = options.cidValidator || defaultCidValidator;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    const configuredQuota = options.maxRolling30DayIds ?? options.maxMonthlyIds;
    this.maxRolling30DayIds =
      Number.isSafeInteger(configuredQuota) && configuredQuota > 0
        ? configuredQuota
        : DEFAULT_MAX_30_DAY_IDS;
    this.maxObservations = Math.min(
      Math.max(
        Number(options.maxObservations) || MAX_OBSERVATIONS_PER_ROUND,
        1,
      ),
      MAX_OBSERVATIONS_PER_ROUND,
    );
    this.retentionRounds =
      Number.isSafeInteger(options.retentionRounds) &&
      options.retentionRounds >= 32 &&
      options.retentionRounds <= 4096
        ? options.retentionRounds
        : DEFAULT_RETENTION_ROUNDS;
    this.storageUploadTimeoutMs =
      Number.isSafeInteger(options.storageUploadTimeoutMs) &&
      options.storageUploadTimeoutMs > 0
        ? Math.min(options.storageUploadTimeoutMs, 120000)
        : DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS;
    this.storageUploadMaxRetries =
      Number.isSafeInteger(options.storageUploadMaxRetries) &&
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
    return (
      this.namespaceWrapper ||
      require('@_koii/task-manager/namespace-wrapper').namespaceWrapper
    );
  }

  async search(query = {}) {
    if (this.stopped)
      throw new XApiRequestError('X API adapter is stopped', {
        code: 'ABORTED',
      });
    await this.ready;
    if (this.stopped)
      throw new XApiRequestError('X API adapter is stopped', {
        code: 'ABORTED',
      });
    const round = normalizeRound(query.round);
    const targetUserId = normalizeId(query.targetUserId);
    if (
      round === null ||
      !targetUserId ||
      query.submitterPublicKey !== this.submitterPublicKey ||
      query.taskId !== this.taskId
    ) {
      throw new TypeError(
        'X API search requires the configured submitter, targetUserId, and a non-negative integer round',
      );
    }
    const requestedLimit = Math.min(
      Math.max(Number(query.limit) || this.maxObservations, 1),
      this.maxObservations,
    );
    const controller = this._createController(query.signal);
    try {
      const existing = (
        await this.observations.getItem({ id: `round:${round}` })
      )?.[0];
      if (existing) {
        this._validateCanonicalRecords(
          existing.records,
          round,
          targetUserId,
          this.submitterPublicKey,
          this.taskId,
        );
        return existing.records;
      }
      const records = await this.client.observeUserId(targetUserId, round, {
        maxResults: requestedLimit,
        signal: controller.signal,
        submitterPublicKey: this.submitterPublicKey,
        taskId: this.taskId,
      });
      throwIfAborted(controller.signal);
      if (records.length > this.maxObservations) {
        throw new Error(
          'X API observer returned more records than the configured round bound',
        );
      }
      this._validateCanonicalRecords(
        records,
        round,
        targetUserId,
        this.submitterPublicKey,
        this.taskId,
      );
      await this.observations.create(
        {
          id: `round:${round}`,
          round,
          records,
        },
        { signal: controller.signal },
      );
      await this.observations.deleteBeforeRound(
        Math.max(0, round - this.retentionRounds + 1),
      );
      throwIfAborted(controller.signal);
      if (records.length > 0) {
        this.lastContext = {
          round,
          target: { userId: records[0].targetUserId },
        };
      }
      return records;
    } catch (error) {
      if (controller.signal.aborted) {
        await this.observations.deleteList({ round }).catch(() => {});
      }
      throw error;
    } finally {
      this._releaseController(controller);
    }
  }

  async getSubmissionCID(round) {
    if (this.stopped) {
      throw new XApiRequestError('X API adapter is stopped', {
        code: 'ABORTED',
      });
    }
    await this.ready;
    if (this.stopped) {
      throw new XApiRequestError('X API adapter is stopped', {
        code: 'ABORTED',
      });
    }
    const normalizedRound = normalizeRound(round);
    if (normalizedRound === null)
      throw new TypeError('Submission round must be a non-negative integer');

    const existingProof = (
      await this.proofs.getItem({ id: `proof:${normalizedRound}` })
    )?.[0];
    if (existingProof) {
      if (
        typeof existingProof.proof_cid !== 'string' ||
        !(await this.cidValidator(existingProof.proof_cid))
      ) {
        throw new Error('Persisted proof CID is malformed');
      }
      return existingProof.proof_cid;
    }

    const stored = (
      await this.observations.getItem({ id: `round:${normalizedRound}` })
    )?.[0];
    if (!stored) return null;
    const records = stored.records;
    if (!Array.isArray(records) || records.length === 0) return null;
    if (records.length > this.maxObservations) {
      throw new Error(
        'Refusing to upload an observation set above the configured round bound',
      );
    }
    const sortedRecords = records
      .slice()
      .sort((left, right) => left.tweetId.localeCompare(right.tweetId));

    const targetUserId = normalizeId(sortedRecords[0]?.targetUserId);
    this._validateCanonicalRecords(
      sortedRecords,
      normalizedRound,
      targetUserId,
      this.submitterPublicKey,
      this.taskId,
    );
    const serializedRecords = JSON.stringify(sortedRecords);
    const payloadDigest = crypto
      .createHash('sha256')
      .update(serializedRecords)
      .digest('hex');
    await this._reserveRollingIds(
      normalizedRound,
      sortedRecords.length,
      payloadDigest,
    );

    const namespaceWrapper = this._namespaceWrapper();
    const basePath = await namespaceWrapper.getBasePath();
    const controller = this._createController();
    let submissionDirectory = null;
    try {
      submissionDirectory = await fs.promises.mkdtemp(
        path.join(basePath, 'x-api-submission-'),
      );
      const filePath = path.join(submissionDirectory, 'dataList.json');
      await fs.promises.writeFile(filePath, serializedRecords, {
        encoding: 'utf8',
        mode: 0o600,
      });
      const cid = await withRetry(
        async () => {
          if (this.stopped) {
            throw new XApiRequestError('X API adapter is stopped', {
              code: 'ABORTED',
            });
          }
          throwIfAborted(controller.signal);
          const client = this._getStorageClient();
          const submitter = await namespaceWrapper.getSubmitterAccount();
          if (submitter?.publicKey?.toBase58?.() !== this.submitterPublicKey) {
            throw new Error('Koii submitter account changed after observation');
          }
          const response = await withTimeout(
            signal => client.uploadFile(filePath, submitter, { signal }),
            this.storageUploadTimeoutMs,
            controller.signal,
          );
          if (
            !response ||
            typeof response.cid !== 'string' ||
            !response.cid.trim()
          ) {
            throw new Error('Storage upload did not return a CID');
          }
          const cid = response.cid.trim();
          if (!(await this.cidValidator(cid))) {
            throw new Error('Storage upload returned an invalid CID');
          }
          const readBack = await withTimeout(
            signal => client.getFile(cid, 'dataList.json', { signal }),
            this.storageUploadTimeoutMs,
            controller.signal,
          );
          if (
            !Number.isSafeInteger(readBack?.size) ||
            readBack.size !== Buffer.byteLength(serializedRecords, 'utf8') ||
            typeof readBack.arrayBuffer !== 'function'
          ) {
            throw new Error(
              'Storage read-back size did not match the submitted proof',
            );
          }
          const readBackBytes = Buffer.from(
            await withTimeout(
              () => readBack.arrayBuffer(),
              this.storageUploadTimeoutMs,
              controller.signal,
            ),
          );
          if (!readBackBytes.equals(Buffer.from(serializedRecords, 'utf8'))) {
            throw new Error(
              'Storage read-back content did not match the submitted proof',
            );
          }
          return cid;
        },
        {
          maxRetries: this.storageUploadMaxRetries,
          baseDelayMs: 1000,
          label: 'X API observation upload',
          shouldRetry: error =>
            !(error instanceof StorageUploadTimeoutError) &&
            !(error instanceof XApiRequestError && error.code === 'ABORTED'),
        },
      );
      await this.proofs.create({
        id: `proof:${normalizedRound}`,
        round: normalizedRound,
        proof_cid: cid,
        recordCount: sortedRecords.length,
        payloadDigest,
      });
      await this.proofs.deleteBeforeRound(
        Math.max(0, normalizedRound - this.retentionRounds + 1),
      );
      return cid;
    } finally {
      this._releaseController(controller);
      if (submissionDirectory) {
        await fs.promises
          .rm(submissionDirectory, { recursive: true, force: true })
          .catch(() => {});
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

  _validateCanonicalRecords(
    records,
    round,
    targetUserId,
    submitterPublicKey,
    taskId,
  ) {
    if (!Array.isArray(records) || !normalizeId(targetUserId)) {
      throw new Error('Observation set has an invalid target');
    }
    const seenIds = new Set();
    for (const record of records) {
      const exactKeys = Object.keys(record || {}).sort();
      const tweetId = normalizeId(record?.tweetId);
      if (
        exactKeys.length !== OBSERVATION_RECORD_KEYS.length ||
        exactKeys.some(
          (key, index) => key !== OBSERVATION_RECORD_KEYS[index],
        ) ||
        record.schemaVersion !== 1 ||
        record.provider !== 'x-api-v2' ||
        record.action !== 'observe' ||
        normalizeId(record.id) !== tweetId ||
        seenIds.has(tweetId) ||
        record.round !== round ||
        normalizeId(record.targetUserId) !== normalizeId(targetUserId) ||
        record.submitterPublicKey !== submitterPublicKey ||
        !isValidSubmitterPublicKey(record.submitterPublicKey) ||
        record.taskId !== taskId ||
        !isValidSubmitterPublicKey(record.taskId)
      ) {
        throw new Error(
          'Refusing to persist or upload malformed observation records',
        );
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

  _getStorageClient() {
    if (!this.storageClient) this.storageClient = this.storageClientFactory();
    if (
      !this.storageClient ||
      typeof this.storageClient.uploadFile !== 'function' ||
      typeof this.storageClient.getFile !== 'function'
    ) {
      throw new Error(
        'Storage client must support bounded upload and read-back',
      );
    }
    return this.storageClient;
  }

  _reserveRollingIds(round, recordCount, payloadDigest) {
    const reservation = this._quotaQueue.then(async () => {
      const now = this.now();
      if (!Number.isSafeInteger(now) || now <= 0)
        throw new Error('Invalid clock for rolling ID quota');
      const id = 'rolling:30-days';
      const existing = (await this.quota.getItem({ id }))?.[0] || null;
      const cutoff = now - ROLLING_WINDOW_SECONDS;
      if (existing && !Array.isArray(existing.reservations)) {
        throw new Error('Persisted rolling ID quota is malformed');
      }
      const allReservations = existing?.reservations || [];
      if (
        allReservations.some(
          item =>
            !Number.isSafeInteger(item?.round) ||
            !Number.isSafeInteger(item?.count) ||
            item.count <= 0 ||
            typeof item?.payloadDigest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(item.payloadDigest) ||
            !Number.isSafeInteger(item?.timestamp) ||
            item.timestamp <= 0,
        )
      ) {
        throw new Error('Persisted rolling ID quota is malformed');
      }
      const reservations = allReservations.filter(
        item => item.timestamp > cutoff,
      );
      const existingRound = reservations.find(item => item.round === round);
      if (existingRound) {
        if (
          existingRound.count !== recordCount ||
          existingRound.payloadDigest !== payloadDigest
        ) {
          throw new Error(
            'Round ID quota was already reserved for different proof bytes',
          );
        }
        const count = reservations.reduce((sum, item) => sum + item.count, 0);
        if (
          reservations.length !== allReservations.length ||
          existing.count !== count
        ) {
          return this.quota.create({
            id,
            count,
            reservations,
            timestamp: Math.max(now, (existing.timestamp || 0) + 1),
          });
        }
        return existing;
      }
      const currentCount = reservations.reduce(
        (sum, item) => sum + item.count,
        0,
      );
      if (currentCount + recordCount > this.maxRolling30DayIds) {
        throw new Error(
          'Rolling 30-day X Post ID redistribution quota would be exceeded',
        );
      }
      reservations.push({
        round,
        count: recordCount,
        payloadDigest,
        timestamp: now,
      });
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
module.exports.DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS =
  DEFAULT_STORAGE_UPLOAD_TIMEOUT_MS;
module.exports.DEFAULT_RETENTION_ROUNDS = DEFAULT_RETENTION_ROUNDS;
module.exports.defaultCidValidator = defaultCidValidator;
module.exports.StorageUploadTimeoutError = StorageUploadTimeoutError;
module.exports.withTimeout = withTimeout;
