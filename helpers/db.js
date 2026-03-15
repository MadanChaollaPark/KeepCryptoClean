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
