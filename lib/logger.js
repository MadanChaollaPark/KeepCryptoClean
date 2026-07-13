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

function currentSecretValues() {
  return [
    process.env.X_API_BEARER_TOKEN,
    process.env.SECRET_KEY,
    process.env.PRIVATE_KEY,
  ].filter(value => typeof value === 'string' && value.length >= 8);
}

function redactText(value) {
  if (typeof value !== 'string') return value;
  let redacted = value.replace(
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    'Bearer [Redacted]',
  );
  for (const secret of currentSecretValues()) {
    redacted = redacted.replaceAll(secret, '[Redacted]');
  }
  return redacted;
}

function sanitizeError(error) {
  if (typeof error === 'string') return redactText(error);
  if (!error || typeof error !== 'object') return error;
  return {
    type: error.constructor?.name || 'Error',
    name: error.name,
    message: redactText(error.message),
    stack: redactText(error.stack),
    code: typeof error.code === 'string' ? error.code : undefined,
    status: Number.isInteger(error.status) ? error.status : undefined,
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'authorization',
      'bearerToken',
      'token',
      'accessToken',
      'secretKey',
      'privateKey',
      'headers.authorization',
      'headers.Authorization',
      'config.headers.authorization',
      'config.headers.Authorization',
      'req.headers.authorization',
      'request.headers.authorization',
      '*.bearerToken',
      '*.accessToken',
    ],
    censor: '[Redacted]',
  },
  serializers: {
    err: sanitizeError,
    error: sanitizeError,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

logger.redactText = redactText;
logger.sanitizeError = sanitizeError;

module.exports = logger;
