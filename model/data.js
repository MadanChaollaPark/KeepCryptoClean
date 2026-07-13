const logger = require('../lib/logger');

const NAMESPACE_FIELD = '_dataNamespace';

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Database operation was aborted');
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * A namespaced, initialization-safe wrapper around Koii's shared NeDB.
 *
 * Every query includes `_dataNamespace`, so logical stores cannot shadow one
 * another even though Koii supplies one shared database.
 */
class Data {
  constructor(name, _initialData, options = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('Data requires a non-empty namespace name');
    }
    this.name = name.trim();
    this.db = options.db || null;
    this._initializePromise = null;
  }

  initializeData() {
    if (this._initializePromise) return this._initializePromise;
    this._initializePromise = (async () => {
      if (!this.db) {
        const {
          namespaceWrapper,
        } = require('@_koii/task-manager/namespace-wrapper');
        this.db = await namespaceWrapper.getDb();
      }
      if (!this.db)
        throw new Error(`Database unavailable for namespace ${this.name}`);
      await Promise.all([
        this._ensureIndex(NAMESPACE_FIELD),
        this._ensureIndex('id'),
        this._ensureIndex('round'),
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
        const result = this.db.ensureIndex(
          { fieldName, sparse: true },
          callback,
        );
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

  async create(item, options = {}) {
    if (!item || item.id === undefined || item.id === null) {
      throw new TypeError('Data.create requires an item id');
    }
    throwIfAborted(options.signal);
    await this.initializeData();
    throwIfAborted(options.signal);
    const existing = await this.getItem({ id: item.id });
    throwIfAborted(options.signal);
    if (
      existing?.[0]?.timestamp !== undefined &&
      (!Number.isFinite(item.timestamp) ||
        item.timestamp <= existing[0].timestamp)
    ) {
      logger.debug(
        { id: item.id, namespace: this.name },
        'Item has older/equal timestamp; skipping',
      );
      return undefined;
    }
    const record = this._record(item);
    throwIfAborted(options.signal);
    await this.db.update(this._scope({ id: item.id }), record, {
      upsert: true,
    });
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

  async deleteBeforeRound(round) {
    await this.initializeData();
    const normalizedRound = Number(round);
    if (!Number.isSafeInteger(normalizedRound) || normalizedRound < 0) {
      throw new TypeError(
        'deleteBeforeRound requires a non-negative integer round',
      );
    }
    return this.db.remove(this._scope({ round: { $lt: normalizedRound } }), {
      multi: true,
    });
  }
}

Data.NAMESPACE_FIELD = NAMESPACE_FIELD;
Data.throwIfAborted = throwIfAborted;

module.exports = Data;
