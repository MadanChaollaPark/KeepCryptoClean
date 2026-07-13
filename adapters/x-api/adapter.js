const fs = require('fs');
const path = require('path');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const Data = require('../../model/data');
const { withRetry } = require('../../lib/retry');
const { XApiClient, OBSERVATION_RECORD_KEYS } = require('./client');
const { normalizeId, normalizeRound } = require('./normalization');

const MAX_OBSERVATIONS_PER_ROUND = 100;
const DEFAULT_MAX_30_DAY_IDS = 1500000;
const ROLLING_WINDOW_SECONDS = 30 * 24 * 60 * 60;

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
    this.ready = Promise.all([
      this.observations.initializeData(),
      this.proofs.initializeData(),
      this.quota.initializeData(),
    ]);
    this.lastContext = null;
    this._quotaQueue = Promise.resolve();
  }

  _namespaceWrapper() {
    return this.namespaceWrapper ||
      require('@_koii/task-manager/namespace-wrapper').namespaceWrapper;
  }

  async search(query = {}) {
    await this.ready;
    const round = normalizeRound(query.round);
    const targetUserId = normalizeId(query.targetUserId);
    if (round === null || !targetUserId) {
      throw new TypeError('X API search requires targetUserId and a non-negative integer round');
    }
    const requestedLimit = Math.min(
      Math.max(Number(query.limit) || this.maxObservations, 5),
      this.maxObservations,
    );
    const records = await this.client.observeUserId(targetUserId, round, {
      maxResults: requestedLimit,
    });
    if (records.length > this.maxObservations) {
      throw new Error('X API observer returned more records than the configured round bound');
    }
    await this.observations.deleteList({ round });
    for (const record of records) {
      await this.observations.create({
        id: `${round}:${record.tweetId}`,
        round,
        record,
      });
    }
    if (records.length > 0) {
      this.lastContext = {
        round,
        target: { userId: records[0].targetUserId },
      };
    }
    return records;
  }

  async getSubmissionCID(round) {
    await this.ready;
    const normalizedRound = normalizeRound(round);
    if (normalizedRound === null) throw new TypeError('Submission round must be a non-negative integer');

    const stored = await this.observations.getList({ round: normalizedRound });
    if (stored.length === 0) return null;
    if (stored.length > this.maxObservations) {
      throw new Error('Refusing to upload an observation set above the configured round bound');
    }
    const records = stored
      .map(item => item.record)
      .sort((left, right) => left.tweetId.localeCompare(right.tweetId));

    const targetUserId = records[0].targetUserId;
    // A local schema pass before upload catches mixed-target or malformed
    // persistence even when live API verification is deferred to auditors.
    for (const record of records) {
      const exactKeys = Object.keys(record).sort();
      if (
        exactKeys.length !== OBSERVATION_RECORD_KEYS.length ||
        exactKeys.some((key, index) => key !== OBSERVATION_RECORD_KEYS[index]) ||
        record.schemaVersion !== 1 ||
        record.provider !== 'x-api-v2' ||
        record.action !== 'observe' ||
        record.round !== normalizedRound ||
        record.targetUserId !== targetUserId
      ) {
        throw new Error('Refusing to upload malformed or mixed-context observations');
      }
    }
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
        const response = await client.uploadFile(filePath, submitter);
        if (!response || typeof response.cid !== 'string' || !response.cid.trim()) {
          throw new Error('Storage upload did not return a CID');
        }
        const cid = response.cid.trim();
        if (!(await this.cidValidator(cid))) {
          throw new Error('Storage upload returned an invalid CID');
        }
        return cid;
      }, {
        maxRetries: 3,
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

  verifyObservationBatch(records, context) {
    return this.client.verifyObservationBatch(records, context);
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
    await this.ready;
    return true;
  }
}

module.exports = XApiAdapter;
module.exports.XApiAdapter = XApiAdapter;
module.exports.MAX_OBSERVATIONS_PER_ROUND = MAX_OBSERVATIONS_PER_ROUND;
module.exports.DEFAULT_MAX_30_DAY_IDS = DEFAULT_MAX_30_DAY_IDS;
module.exports.ROLLING_WINDOW_SECONDS = ROLLING_WINDOW_SECONDS;
module.exports.defaultCidValidator = defaultCidValidator;
