const test = require('node:test');
const assert = require('node:assert/strict');
const TwitterTask = require('../../twitter-task');
const { getJSONFromCID } = require('../../twitter-task');
const { CoreLogic } = require('../../coreLogic');

const TARGET = { userId: '123456789' };
const SUBMITTER = '11111111111111111111111111111111';
const COPIER = '22222222222222222222222222222222';
const NOW = Math.floor(Date.now() / 1000);

function observation(id = '1000000000000000001') {
  return {
    schemaVersion: 1,
    provider: 'x-api-v2',
    action: 'observe',
    id,
    tweetId: id,
    round: 4,
    targetUserId: TARGET.userId,
    observedAt: NOW,
    submitterPublicKey: SUBMITTER,
  };
}

function adapter(overrides = {}) {
  return {
    async search() {},
    async getSubmissionCID() {
      return 'bafy-proof';
    },
    async verifyObservationBatch() {
      return true;
    },
    async stop() {},
    ...overrides,
  };
}

test('TwitterTask resolves and passes the local Koii submitter key to the producer', async () => {
  let config;
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    autoStart: false,
    namespaceWrapper: {
      async getSubmitterAccount() {
        return { publicKey: { toBase58: () => SUBMITTER } };
      },
    },
    adapterFactory: async received => {
      config = received;
      return adapter();
    },
  });
  await task.ready();
  assert.equal(config.submitterPublicKey, SUBMITTER);
  await task.stop();
});

test('TwitterTask readiness launches observer and submission waits for collection', async () => {
  const calls = [];
  let release;
  const collection = new Promise(resolve => {
    release = resolve;
  });
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    localSubmitterPublicKey: SUBMITTER,
    adapterFactory: async config =>
      adapter({
        async search(query) {
          calls.push(['search', config, query]);
          await collection;
        },
        async getSubmissionCID(round) {
          calls.push(['cid', round]);
          return 'bafy-proof';
        },
      }),
  });
  await task.ready();
  const cidPromise = task.getRoundCID(4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.some(([name]) => name === 'cid'), false);
  release();
  assert.equal(await cidPromise, 'bafy-proof');
  assert.equal(calls[0][2].action, 'observe');
  assert.equal(calls[0][2].submitterPublicKey, SUBMITTER);
  await task.stop();
});

test('TwitterTask validates every record with provider batch verification', async () => {
  let verified;
  const proof = [observation(), observation('1000000000000000002')];
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    localSubmitterPublicKey: SUBMITTER,
    autoStart: false,
    adapterFactory: async () =>
      adapter({
        async verifyObservationBatch(records, context) {
          verified = { records, context };
          return true;
        },
      }),
    cidValidator: async () => true,
    getJSONFromCID: async () => proof,
  });
  assert.equal(await task.validate('bafy-proof', 4, SUBMITTER), true);
  assert.equal(verified.records.length, 2);
  assert.deepEqual(verified.context.target, TARGET);
  assert.equal(verified.context.submitterPublicKey, SUBMITTER);
  assert.equal(
    await task.validate('bafy-proof', 4, COPIER),
    false,
    'a copied CID cannot validate for another submitter',
  );
  assert.equal(
    await task.validate('bafy-proof', 5, SUBMITTER),
    false,
    'same CID cannot replay in another round',
  );
});

test('TwitterTask fails closed without full-proof provider verification', async () => {
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    localSubmitterPublicKey: SUBMITTER,
    autoStart: false,
    adapterFactory: async () => adapter({ verifyObservationBatch: undefined }),
    cidValidator: async () => true,
    getJSONFromCID: async () => [observation()],
  });
  assert.equal(await task.validate('bafy-proof', 4, SUBMITTER), false);
});

test('bounded IPFS reader rejects oversized and malformed payloads without retrying', async () => {
  let calls = 0;
  const storageClientFactory = () => ({
    async getFile() {
      calls += 1;
      return { size: 20, async text() { return '{not json'; } };
    },
  });
  await assert.rejects(
    getJSONFromCID('bafy-proof', 'dataList.json', 3, {
      cidValidator: async () => true,
      storageClientFactory,
      baseDelayMs: 0,
    }),
    /not valid JSON/,
  );
  assert.equal(calls, 1);

  await assert.rejects(
    getJSONFromCID('bafy-proof', 'dataList.json', 3, {
      cidValidator: async () => true,
      limits: { maxPayloadBytes: 2 },
      storageClientFactory,
      baseDelayMs: 0,
    }),
    /too large/,
  );

  let textCalled = false;
  await assert.rejects(
    getJSONFromCID('bafy-proof', 'dataList.json', 0, {
      cidValidator: async () => true,
      storageClientFactory: () => ({
        async getFile() {
          return { async text() { textCalled = true; return '[]'; } };
        },
      }),
    }),
    /size is unavailable/,
  );
  assert.equal(textCalled, false, 'body must not be read before a finite size is known');

  await assert.rejects(
    getJSONFromCID('bafy-proof', 'dataList.json', 0, {
      cidValidator: async () => true,
      storageGetTimeoutMs: 5,
      storageClientFactory: () => ({
        getFile() { return new Promise(() => {}); },
      }),
    }),
    /IPFS proof download timed out/,
  );

  await assert.rejects(
    getJSONFromCID('bafy-proof', 'dataList.json', 0, {
      cidValidator: async () => true,
      blobTextTimeoutMs: 5,
      storageClientFactory: () => ({
        async getFile() {
          return { size: 2, text() { return new Promise(() => {}); } };
        },
      }),
    }),
    /IPFS proof body read timed out/,
  );
});

test('TwitterTask stop waits for provider cancellation and is itself bounded', async () => {
  let release;
  let stopCalled = false;
  const running = new Promise(resolve => { release = resolve; });
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    localSubmitterPublicKey: SUBMITTER,
    stopSettlementTimeoutMs: 100,
    adapterFactory: async () => adapter({
      search() { return running; },
      async stop() {
        stopCalled = true;
        release();
      },
    }),
  });
  await task.ready();
  await task.stop();
  assert.equal(stopCalled, true);
  assert.equal(task.isRunning, false);

  const stuck = new TwitterTask(4, {
    expectedTarget: TARGET,
    localSubmitterPublicKey: SUBMITTER,
    stopSettlementTimeoutMs: 5,
    adapterFactory: async () => adapter({
      search() { return new Promise(() => {}); },
      async stop() {},
    }),
  });
  await stuck.ready();
  await assert.rejects(stuck.stop(), /Evidence task stop timed out/);
});

test('CoreLogic serializes round replacement and closes the previous task', async () => {
  const events = [];
  class Task {
    constructor(round) {
      this.round = round;
      events.push(`construct:${round}`);
    }
    async ready() {
      events.push(`ready:${this.round}`);
    }
    async stop() {
      events.push(`stop:${this.round}`);
    }
    async validate() {
      return true;
    }
    async getRoundCID() {
      return `cid-${this.round}`;
    }
  }
  const core = new CoreLogic({ TaskClass: Task, namespaceWrapper: {} });
  await Promise.all([core.task(1), core.task(2)]);
  assert.deepEqual(events, [
    'construct:1',
    'ready:1',
    'stop:1',
    'construct:2',
    'ready:2',
  ]);
  assert.equal(await core.fetchSubmission(1), undefined);
  assert.equal(await core.fetchSubmission(2), 'cid-2');
});

test('CoreLogic node and distribution validation fail closed', async () => {
  const wrapper = {
    async getDistributionList() {
      throw new Error('offline');
    },
  };
  const core = new CoreLogic({ TaskClass: class {}, namespaceWrapper: wrapper });
  assert.equal(await core.validateNode('cid', 1, SUBMITTER), false);
  assert.equal(await core.validateDistribution('submitter', 1), false);
  assert.equal(await core.validateDistribution(null, 1), false);
});

test('CoreLogic passes the task-manager submitter key into proof validation', async () => {
  let received;
  const core = new CoreLogic({ namespaceWrapper: {} });
  core.twitterTask = {
    round: 4,
    async ready() {},
    async validate(...args) {
      received = args;
      return true;
    },
  };
  assert.equal(await core.validateNode('bafy-proof', 4, SUBMITTER), true);
  assert.deepEqual(received, ['bafy-proof', 4, SUBMITTER]);
});
