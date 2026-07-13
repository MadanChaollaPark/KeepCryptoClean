'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// namespace-wrapper 1.0.23 starts its local Express server at import time.
// Isolate this test process from the other parallel test workers and close it.
process.argv[4] = String(20_000 + (process.pid % 40_000));

const dependencyRoot = path.resolve(
  __dirname,
  '../../node_modules/@_koii/task-manager/dist/main',
);
const { initializeTaskManager } = require(
  path.join(dependencyRoot, 'taskManager.js'),
);
const { audit } = require(path.join(dependencyRoot, 'task/audit.js'));
const { distribution } = require(
  path.join(dependencyRoot, 'task/distribution.js'),
);
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

test('patched task-manager does not register the task-state disclosure route', () => {
  const setupSource = fs.readFileSync(
    path.join(dependencyRoot, 'task/setup.js'),
    'utf8',
  );
  assert.equal(setupSource.includes('app.get("/taskState"'), false);
});

test('patched namespace-wrapper bounds RPCs and throws error-shaped responses', () => {
  const wrapperSource = fs.readFileSync(
    require.resolve('@_koii/namespace-wrapper'),
    'utf8',
  );
  assert.equal(wrapperSource.includes('timeout: 30000'), true);
  assert.equal(wrapperSource.includes('maxContentLength: 1048576'), true);
  assert.equal(wrapperSource.includes('TASK NODE RPC RETURNED AN ERROR'), true);
  assert.equal(wrapperSource.includes('return { error: err }'), false);
  assert.equal(wrapperSource.includes('webasm_bincode_deserializer'), false);
  assert.equal(wrapperSource.includes('bincode_js_bg.wasm'), false);
  assert.equal(
    wrapperSource.includes(
      'KPL TASK-STATE DECODING IS NOT SUPPORTED BY THIS KOII-ONLY TASK',
    ),
    true,
  );
});

test('task-manager exits nonzero when administered startup cannot reach Task Node', () => {
  const port = 30_000 + (process.pid % 20_000);
  const main = path.join(dependencyRoot, 'index.js');
  const child = spawnSync(
    process.execPath,
    [
      main,
      'FailingStartup',
      'Vote111111111111111111111111111111111111111',
      String(port),
      '',
      '',
      '',
      '',
      '',
      '',
      '1',
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.error?.code, undefined, child.error?.message);
  assert.equal(child.status, 1, `${child.stdout}\n${child.stderr}`);
});

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
  assert.equal(
    await distribution.validateDistribution(null, 1, 'auditor'),
    false,
  );

  const originalGetDistributionList = namespaceWrapper.getDistributionList;
  const originalGenerateDistributionList =
    distribution.generateDistributionList;
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

test('patched task-manager rejects error-shaped on-chain submission responses', async () => {
  const originalGenerateDistributionList =
    distribution.generateDistributionList;
  const originalUploadDistributionList =
    namespaceWrapper.uploadDistributionList;
  const originalOnChain = namespaceWrapper.distributionListSubmissionOnChain;
  distribution.generateDistributionList = async () => ({ submitter: 1 });
  namespaceWrapper.uploadDistributionList = async () => true;
  namespaceWrapper.distributionListSubmissionOnChain = async () => ({
    error: 'offline',
  });
  try {
    await assert.rejects(
      distribution.submitDistributionList(1),
      /ON-CHAIN SUBMISSION FAILED/,
    );
  } finally {
    distribution.generateDistributionList = originalGenerateDistributionList;
    namespaceWrapper.uploadDistributionList = originalUploadDistributionList;
    namespaceWrapper.distributionListSubmissionOnChain = originalOnChain;
  }
});
