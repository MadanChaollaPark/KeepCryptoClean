const logger = require('../lib/logger');

const NAMESPACE_FIELD = '_dataNamespace';

/**
 * A namespaced, initialization-safe wrapper around Koii's shared NeDB.
 *
 * Every query includes `_dataNamespace`. Previous versions constructed four
 * logical stores over the same database but queried only by `id`, allowing a
 * cookie, proof, tweet, or cooldown record from one store to shadow another.
 */
class Data {
  constructor(name, data, options = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('Data requires a non-empty namespace name');
    }
    this.name = name.trim();
    this.data = data;
    this.dbprefix = `${this.name}:`;
    this.fullList = [];
    this.lastUpdate = Date.now();
    this.db = options.db || null;
    this._initializePromise = null;
  }

  initializeData() {
    if (this._initializePromise) return this._initializePromise;
    this._initializePromise = (async () => {
      if (!this.db) {
        const { namespaceWrapper } = require('@_koii/task-manager/namespace-wrapper');
        this.db = await namespaceWrapper.getDb();
      }
      if (!this.db) throw new Error(`Database unavailable for namespace ${this.name}`);
      await Promise.all([
        this._ensureIndex(NAMESPACE_FIELD),
        this._ensureIndex('id'),
        this._ensureIndex('round'),
        this._ensureIndex('termRound'),
      ]);
      return this.db;
    })().catch(error => {
      this._initializePromise = null;
      throw error;
    });
    return this._initializePromise;
  }

  async _ensureIndex(fieldName) {
    if (!this.db || typeof this.db.ensureIndex !== 'function') return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const callback = error => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      try {
        const result = this.db.ensureIndex({ fieldName, sparse: true }, callback);
        if (result && typeof result.then === 'function') {
          result.then(() => callback()).catch(callback);
        }
      } catch (error) {
        callback(error);
      }
    });
  }

  _scope(query = {}) {
    return { ...query, [NAMESPACE_FIELD]: this.name };
  }

  _record(item) {
    return { ...item, [NAMESPACE_FIELD]: this.name };
  }

  async create(item) {
    if (!item || item.id === undefined || item.id === null) {
      throw new TypeError('Data.create requires an item id');
    }
    await this.initializeData();
    const existing = await this.getItem({ id: item.id });
    if (
      existing?.[0]?.timestamp !== undefined &&
      (!Number.isFinite(item.timestamp) || item.timestamp <= existing[0].timestamp)
    ) {
      logger.debug({ id: item.id, namespace: this.name }, 'Item has older/equal timestamp; skipping');
      return undefined;
    }
    const record = this._record(item);
    await this.db.update(this._scope({ id: item.id }), record, { upsert: true });
    return record;
  }

  async updateCookie(item) {
    if (!item || item.id !== 'cookies' || typeof item.data !== 'string') {
      throw new TypeError('updateCookie requires an encrypted cookies record');
    }
    await this.initializeData();
    const record = this._record(item);
    await this.db.update(this._scope({ id: 'cookies' }), record, { upsert: true });
    return record;
  }

  async getItem(item) {
    if (!item || item.id === undefined || item.id === null) return null;
    await this.initializeData();
    const response = await this.db.find(this._scope({ id: item.id }));
    return response.length > 0 ? response : null;
  }

  async getList(options = {}) {
    await this.initializeData();
    const round = Number(options.round);
    if (!Number.isSafeInteger(round) || round < 0) return [];
    return this.db.find(this._scope({ round }));
  }

  async deleteList(options = {}) {
    await this.initializeData();
    const round = Number(options.round);
    if (!Number.isSafeInteger(round) || round < 0) {
      throw new TypeError('deleteList requires a non-negative integer round');
    }
    return this.db.remove(this._scope({ round }), { multi: true });
  }

  async createSearchTerm(searchTerms, round, randomComment) {
    await this.initializeData();
    const normalizedRound = Number(round);
    if (!Number.isSafeInteger(normalizedRound) || normalizedRound < 0) {
      throw new TypeError('createSearchTerm requires a non-negative integer round');
    }
    const record = this._record({
      termRound: normalizedRound,
      terms: searchTerms,
      comment: randomComment,
    });
    await this.db.update(
      this._scope({ termRound: normalizedRound }),
      record,
      { upsert: true },
    );
    return record;
  }

  async getSearchTerm(round) {
    await this.initializeData();
    const normalizedRound = Number(round);
    if (!Number.isSafeInteger(normalizedRound) || normalizedRound < 0) return null;
    const response = await this.db.find(this._scope({ termRound: normalizedRound }));
    return response.length > 0 ? response[0].terms : null;
  }

  async createTimestamp(key, timestamp) {
    await this.initializeData();
    if (typeof key !== 'string' || !key || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError('createTimestamp requires a key and Unix timestamp in seconds');
    }
    const existing = await this.db.find(this._scope({ id: key }));
    if (existing.length > 0 && existing[0].timestamp >= timestamp) return existing[0];
    const record = this._record({ id: key, timestamp });
    await this.db.update(this._scope({ id: key }), record, { upsert: true });
    return record;
  }

  async getTimestamp(key) {
    await this.initializeData();
    if (typeof key !== 'string' || !key) return null;
    const response = await this.db.find(this._scope({ id: key }));
    const timestamp = response[0]?.timestamp;
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  }
}

Data.NAMESPACE_FIELD = NAMESPACE_FIELD;

module.exports = Data;
