const test = require('node:test');
const assert = require('node:assert/strict');
const TwitterTask = require('../../twitter-task');
const { getJSONFromCID } = require('../../twitter-task');
const { CoreLogic } = require('../../coreLogic');

const TARGET = { userId: '123456789' };
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

test('TwitterTask readiness launches observer and submission waits for collection', async () => {
  const calls = [];
  let release;
  const collection = new Promise(resolve => {
    release = resolve;
  });
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
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
});

test('TwitterTask validates every record with provider batch verification', async () => {
  let verified;
  const proof = [observation(), observation('1000000000000000002')];
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
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
  assert.equal(await task.validate('bafy-proof', 4), true);
  assert.equal(verified.records.length, 2);
  assert.deepEqual(verified.context.target, TARGET);
  assert.equal(await task.validate('bafy-proof', 5), false, 'same CID cannot replay in another round');
});

test('TwitterTask fails closed without full-proof provider verification', async () => {
  const task = new TwitterTask(4, {
    expectedTarget: TARGET,
    autoStart: false,
    adapterFactory: async () => adapter({ verifyObservationBatch: undefined }),
    cidValidator: async () => true,
    getJSONFromCID: async () => [observation()],
  });
  assert.equal(await task.validate('bafy-proof', 4), false);
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
  assert.equal(await core.validateNode('cid', 1), false);
  assert.equal(await core.validateDistribution('submitter', 1), false);
  assert.equal(await core.validateDistribution(null, 1), false);
});
