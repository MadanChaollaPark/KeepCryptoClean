const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const logger = require('../lib/logger');

/**
 * Data class - NeDB database wrapper for tweet/comment storage.
 *
 * @param {string} name - the name of the database
 * @param {object} data - the initial data
 */
class Data {
  constructor(name, data) {
    this.name = name;
    this.data = data;
    this.dbprefix = `${name}:`;
    this.fullList = [];
    this.lastUpdate = Date.now();
  }

  async initializeData() {
    if (this.db) return;
    const db = await namespaceWrapper.getDb();
    this.db = db;

    // Ensure indices for common query patterns
    this._ensureIndex('id');
    this._ensureIndex('round');
    this._ensureIndex('termRound');
  }

  _ensureIndex(fieldName) {
    if (!this.db) return;
    this.db.ensureIndex({ fieldName, sparse: true }, err => {
      if (err) logger.error({ fieldName, err }, 'Index creation error');
    });
  }

  async create(item) {
    try {
      const existingItem = await this.getItem(item);

      if (existingItem) {
        if (
          !existingItem[0].timestamp ||
          (item.timestamp && item.timestamp > existingItem[0].timestamp)
        ) {
          await this.db.remove({ id: item.id }, {});
          this.db.compactDatafile();
        } else {
          logger.debug({ id: item.id }, 'Item has older/equal timestamp; skipping');
          return undefined;
        }
      }

      await this.db.insert(item);
    } catch (e) {
      logger.error({ err: e, id: item?.id }, 'Error creating item');
      return undefined;
    }
  }

  async updateCookie(item) {
    try {
      await this.db.update({ id: 'cookies' }, { $set: item }, {});
      logger.debug('Cookie record updated');
    } catch (e) {
      logger.error({ err: e }, 'Error updating cookie');
      return undefined;
    }
  }

  async getItem(item) {
    try {
      const resp = await this.db.find({ id: item.id });
      return resp.length !== 0 ? resp : null;
    } catch (e) {
      logger.error({ err: e, id: item?.id }, 'Error retrieving item');
      return null;
    }
  }

  async getList(options) {
    logger.debug({ round: options.round }, 'Fetching list by round');
    return this.db.find({ round: options.round });
  }

  async createSearchTerm(searchTerms, round, randomComment) {
    try {
      await this.db.insert({
        termRound: round,
        terms: searchTerms,
        comment: randomComment,
      });
      logger.info({ round }, 'Search terms stored');
    } catch (e) {
      logger.error({ err: e, round }, 'Error storing search terms');
      return undefined;
    }
  }

  async getSearchTerm(round) {
    try {
      const resp = await this.db.find({ termRound: parseInt(round) });
      if (resp && resp.length > 0) {
        return resp[0].terms;
      }
      return null;
    } catch (e) {
      logger.error({ err: e, round }, 'Error retrieving search term');
      return null;
    }
  }

  async createTimestamp(comment, timestamp) {
    try {
      const existingItem = await this.db.find({ id: comment });
      if (existingItem.length > 0) {
        if (timestamp > existingItem[0].timestamp) {
          await this.db.update({ id: comment }, { $set: { timestamp } }, {});
          logger.debug({ comment }, 'Timestamp updated');
        }
      } else {
        await this.db.insert({ id: comment, timestamp });
        logger.debug({ comment }, 'Timestamp created');
      }
    } catch (e) {
      logger.error({ err: e, comment }, 'Error managing timestamp');
    }
  }

  async getTimestamp(comment) {
    try {
      const resp = await this.db.find({ id: comment });
      return resp.length > 0 ? resp[0].timestamp : null;
    } catch (e) {
      logger.error({ err: e, comment }, 'Error retrieving timestamp');
      return null;
    }
  }
}

module.exports = Data;
