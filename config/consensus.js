'use strict';

/* global __KCC_BUNDLED__, __KCC_TARGET_USER_ID__ */

// Webpack replaces both constants in the production task executable. Source
// tests and local `yarn start` deliberately use the build-time environment
// variable instead. A bundled task must never fall back to a node-local value.
const IS_BUNDLED =
  typeof __KCC_BUNDLED__ !== 'undefined' && __KCC_BUNDLED__ === true;
const EMBEDDED_TARGET_USER_ID =
  typeof __KCC_TARGET_USER_ID__ !== 'undefined' ? __KCC_TARGET_USER_ID__ : '';

const EVIDENCE_PROVIDER = 'x-api-v2';

function getConsensusTargetUserId(env = process.env) {
  const value = IS_BUNDLED ? EMBEDDED_TARGET_USER_ID : env.KCC_TARGET_USER_ID;
  return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
}

function getConsensusConfig(env = process.env) {
  return Object.freeze({
    provider: EVIDENCE_PROVIDER,
    targetUserId: getConsensusTargetUserId(env),
    source: IS_BUNDLED ? 'embedded' : 'source-environment',
  });
}

module.exports = {
  EVIDENCE_PROVIDER,
  getConsensusConfig,
  getConsensusTargetUserId,
};
