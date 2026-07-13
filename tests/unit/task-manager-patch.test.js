'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// namespace-wrapper 1.0.23 starts its local Express server at import time.
// Isolate this test process from the other parallel test workers and close it.
process.argv[4] = String(20_000 + (process.pid % 40_000));

const dependencyRoot = path.resolve(
  __dirname,
  '../../node_modules/@_koii/task-manager/dist/main',
);
const { initializeTaskManager } = require(path.join(dependencyRoot, 'taskManager.js'));
const { audit } = require(path.join(dependencyRoot, 'task/audit.js'));
const { distribution } = require(path.join(dependencyRoot, 'task/distribution.js'));
const { _server, namespaceWrapper } = require('@_koii/namespace-wrapper');

after(() => new Promise(resolve => _server.close(resolve)));

function initializeAudit(callback) {
  initializeTaskManager({
    setup: async () => {},
    task: async () => {},
    submission: async () => undefined,
    audit: callback,
    distribution: async () => ({}),
    routes: async () => {},
  });
}

test('patched task-manager accepts only a literal true audit vote', async () => {
  for (const value of [undefined, null, false, 1, 'true']) {
    initializeAudit(async () => value);
    assert.equal(await audit.validateNode('bafy-test', 1, 'submitter'), false);
  }
  initializeAudit(async () => {
    throw new Error('audit dependency offline');
  });
  assert.equal(await audit.validateNode('bafy-test', 1, 'submitter'), false);

  initializeAudit(async () => true);
  assert.equal(await audit.validateNode('bafy-test', 1, 'submitter'), true);
});

test('patched task-manager rejects absent and non-regenerable distributions', async () => {
  assert.equal(await distribution.validateDistribution(null, 1, 'auditor'), false);

  const originalGetDistributionList = namespaceWrapper.getDistributionList;
  const originalGenerateDistributionList = distribution.generateDistributionList;
  namespaceWrapper.getDistributionList = async () => '{}';
  distribution.generateDistributionList = async () => ({});
  try {
    assert.equal(
      await distribution.validateDistribution('submitter', 1, 'auditor'),
      false,
    );
    await assert.rejects(
      distribution.submitDistributionList(1),
      /NO DISTRIBUTION LIST GENERATED/,
    );
  } finally {
    namespaceWrapper.getDistributionList = originalGetDistributionList;
    distribution.generateDistributionList = originalGenerateDistributionList;
  }
});
