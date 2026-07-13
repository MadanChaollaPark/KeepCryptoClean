'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVIDENCE_PROVIDER,
  getConsensusConfig,
  getConsensusTargetUserId,
} = require('../../config/consensus');

test('source execution accepts only the explicit build-time target variable', () => {
  assert.equal(
    getConsensusTargetUserId({ KCC_TARGET_USER_ID: '1234567890' }),
    '1234567890',
  );
  assert.equal(
    getConsensusTargetUserId({ X_TARGET_USER_ID: '1234567890' }),
    null,
  );
  assert.equal(
    getConsensusTargetUserId({ KCC_TARGET_USER_ID: 'screen-name' }),
    null,
  );
  assert.equal(getConsensusTargetUserId({ KCC_TARGET_USER_ID: '0' }), null);
  assert.equal(getConsensusTargetUserId({ KCC_TARGET_USER_ID: '00042' }), null);
  assert.equal(
    getConsensusTargetUserId({ KCC_TARGET_USER_ID: '12345678901234567890' }),
    null,
  );
});

test('consensus provider is constant and not environment-overridable', () => {
  assert.equal(EVIDENCE_PROVIDER, 'x-api-v2');
  assert.deepEqual(
    getConsensusConfig({
      KCC_TARGET_USER_ID: '1234567890',
      EVIDENCE_PROVIDER: 'malicious-provider',
    }),
    {
      provider: 'x-api-v2',
      targetUserId: '1234567890',
      source: 'source-environment',
    },
  );
});
