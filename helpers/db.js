/**
 * Legacy database bootstrap.
 *
 * Initialises the namespace-wrapper-provided NeDB instance and ensures the
 * indices used by older imports (`runningId`, `ipfsId`, `proof`, `round`,
 * `id`, `termRound`).
 *
 * The active code path uses per-namespace `Data` instances created in the
 * Twitter adapter (see `adapters/twitter/twitter.js`), each of which calls
 * `initializeData()` and ensures its own indices. This file is retained so
 * legacy require sites still get a functional `Data` handle.
 */
const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const Data = require('../model/data');
const logger = require('../lib/logger');

namespaceWrapper.getDb().then(db => {
  logger.info('Database initialized');

  const indices = ['runningId', 'ipfsId', 'proof', 'round', 'id', 'termRound'];

  for (const fieldName of indices) {
    db.ensureIndex({ fieldName, unique: false, sparse: true }, err => {
      if (err) logger.error({ fieldName, err }, 'Index creation error');
    });
  }
});

let dataDb = new Data('twitterscrape');
module.exports = dataDb;
