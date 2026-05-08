/**
 * Shared pino logger.
 *
 * Output is JSON, one log object per line, suitable for ingestion by the
 * Koii task node and any downstream log shippers.
 *
 * Configuration:
 *   LOG_LEVEL   trace | debug | info | warn | error | fatal  (default: info)
 *
 * Usage:
 *   const logger = require('./lib/logger');
 *   logger.info({ round }, 'Round started');
 *   logger.error({ err }, 'Submission failed');
 */
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
