const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const XApiAdapter = require('../../adapters/x-api/adapter');
const SUBMITTER = '11111111111111111111111111111111';
const TASK_ID = 'Vote111111111111111111111111111111111111111';

function store() {
  const records = [];
  return {
    records,
    initializeData() {
      return Promise.resolve(this);
    },
    create(record, options = {}) {
      if (options.signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      }
      const index = records.findIndex(item => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      return Promise.resolve(record);
    },
    getList({ round }) {
      return Promise.resolve(records.filter(item => item.round === round));
    },
    deleteList({ round }) {
      for (let index = records.length - 1; index >= 0; index--) {
        if (records[index].round === round) records.splice(index, 1);
      }
      return Promise.resolve();
    },
    deleteBeforeRound(round) {
      for (let index = records.length - 1; index >= 0; index--) {
        if (
          Number.isSafeInteger(records[index].round) &&
          records[index].round < round
        ) {
          records.splice(index, 1);
        }
      }
      return Promise.resolve();
    },
    getItem({ id }) {
      const matches = records.filter(item => item.id === id);
      return Promise.resolve(matches.length > 0 ? matches : null);
    },
  };
}

function observation() {
  return {
    schemaVersion: 1,
    provider: 'x-api-v2',
    action: 'observe',
    id: '123',
    tweetId: '123',
    round: 4,
    submitterPublicKey: SUBMITTER,
    taskId: TASK_ID,
    targetUserId: '42',
  };
}

describe('XApiAdapter production contract', () => {
  it('observes, persists, uploads bounded canonical JSON, and cleans temporary files', async () => {
    const basePath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'kcc-x-api-test-'),
    );
    const dataStore = store();
    const proofStore = store();
    const quotaStore = store();
    let uploaded;
    const client = {
      observeUserId(userId, round, options) {
        assert.equal(userId, '42');
        assert.equal(round, 4);
        assert.ok(options.signal instanceof AbortSignal);
        return Promise.resolve([observation()]);
      },
      verifyObservationBatch() {
        return Promise.resolve(true);
      },
    };
    const adapter = new XApiAdapter({
      client,
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore,
      quotaStore,
      now: () => 1783904400,
      namespaceWrapper: {
        getBasePath: () => Promise.resolve(basePath),
        getSubmitterAccount: () =>
          Promise.resolve({
            publicKey: { toBase58: () => SUBMITTER },
          }),
      },
      storageClientFactory: () => ({
        async uploadFile(filePath) {
          assert.equal(path.basename(filePath), 'dataList.json');
          uploaded = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
          return { cid: 'bafy-test-cid' };
        },
        async getFile() {
          return new Blob([JSON.stringify(uploaded)]);
        },
      }),
      cidValidator: cid => Promise.resolve(cid === 'bafy-test-cid'),
    });

    assert.deepEqual(
      await adapter.search({
        targetUserId: '42',
        round: 4,
        submitterPublicKey: SUBMITTER,
        taskId: TASK_ID,
      }),
      [observation()],
    );
    dataStore.records.find(item => item.id === 'round:4')._id =
      'nedb-generated-id';
    assert.equal(await adapter.getSubmissionCID(4), 'bafy-test-cid');
    assert.deepEqual(uploaded, [observation()]);
    assert.equal(proofStore.records[0].recordCount, 1);
    assert.match(proofStore.records[0].payloadDigest, /^[a-f0-9]{64}$/);
    assert.equal(quotaStore.records[0].count, 1);
    assert.deepEqual(await fs.promises.readdir(basePath), []);
    assert.equal(await adapter.stop(), true);
    await fs.promises.rm(basePath, { recursive: true, force: true });
  });

  it('delegates strict full-batch verification', async () => {
    const dataStore = store();
    const proofStore = store();
    const quotaStore = store();
    let received;
    const adapter = new XApiAdapter({
      client: {
        verifyObservationBatch(records, context) {
          received = { records, context };
          return Promise.resolve(false);
        },
      },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore,
      quotaStore,
    });
    const context = {
      round: 4,
      target: { userId: '42' },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
    };
    assert.equal(
      await adapter.verifyObservationBatch([observation()], context),
      false,
    );
    assert.deepEqual(received.records, [observation()]);
    assert.deepEqual(received.context.target, context.target);
    assert.equal(received.context.round, 4);
    assert.ok(received.context.signal instanceof AbortSignal);
  });

  it('persists an idempotent rolling 30-day quota and prunes expired reservations', async () => {
    const quotaStore = store();
    let now = 1783904400;
    const adapter = new XApiAdapter({
      client: {},
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore: store(),
      proofStore: store(),
      quotaStore,
      maxRolling30DayIds: 1,
      now: () => now,
    });
    const firstDigest = 'a'.repeat(64);
    const secondDigest = 'b'.repeat(64);
    await adapter._reserveRollingIds(4, 1, firstDigest);
    await adapter._reserveRollingIds(4, 1, firstDigest);
    assert.equal(quotaStore.records[0].count, 1);
    await assert.rejects(
      () => adapter._reserveRollingIds(4, 1, secondDigest),
      /reserved for different proof bytes/,
    );
    await assert.rejects(
      () => adapter._reserveRollingIds(5, 1, secondDigest),
      /Rolling 30-day X Post ID redistribution quota would be exceeded/,
    );
    now += 30 * 24 * 60 * 60 + 1;
    await adapter._reserveRollingIds(5, 1, secondDigest);
    assert.equal(quotaStore.records[0].count, 1);
    assert.equal(quotaStore.records[0].reservations.length, 1);
  });

  it('freezes the first canonical observation set for a round', async () => {
    const dataStore = store();
    let calls = 0;
    const adapter = new XApiAdapter({
      client: {
        observeUserId() {
          calls += 1;
          return Promise.resolve([observation()]);
        },
      },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore: store(),
      quotaStore: store(),
    });
    const query = {
      targetUserId: '42',
      round: 4,
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
    };
    assert.deepEqual(await adapter.search(query), [observation()]);
    assert.deepEqual(await adapter.search(query), [observation()]);
    assert.equal(calls, 1);
  });

  it('aborts active collection and performs no persistence after stop', async () => {
    const dataStore = store();
    let collectionSignal;
    const adapter = new XApiAdapter({
      client: {
        observeUserId(_userId, _round, options) {
          collectionSignal = options.signal;
          return new Promise(resolve => {
            options.signal.addEventListener(
              'abort',
              () => resolve([observation()]),
              { once: true },
            );
          });
        },
      },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore: store(),
      quotaStore: store(),
    });

    const search = adapter.search({
      targetUserId: '42',
      round: 4,
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
    });
    while (!collectionSignal) await Promise.resolve();
    await adapter.stop();
    await assert.rejects(search, error => error.code === 'ABORTED');
    assert.equal(collectionSignal.aborted, true);
    assert.equal(await dataStore.getItem({ id: 'round:4' }), null);
    await assert.rejects(
      () =>
        adapter.search({
          targetUserId: '42',
          round: 4,
          submitterPublicKey: SUBMITTER,
          taskId: TASK_ID,
        }),
      error => error.code === 'ABORTED',
    );
  });

  it('rejects non-canonical client output before any database write', async () => {
    const dataStore = store();
    const adapter = new XApiAdapter({
      client: {
        observeUserId() {
          return Promise.resolve([
            { ...observation(), text: 'must never persist' },
          ]);
        },
      },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore: store(),
      quotaStore: store(),
      now: () => 1783904400,
    });
    await assert.rejects(
      () =>
        adapter.search({
          targetUserId: '42',
          round: 4,
          submitterPublicKey: SUBMITTER,
          taskId: TASK_ID,
        }),
      /Refusing to persist or upload malformed observation records/,
    );
    assert.equal(dataStore.records.length, 0);
  });

  it('bounds every storage upload attempt with a timeout', async () => {
    let uploadCalls = 0;
    let uploadAborted = false;
    const basePath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'kcc-upload-timeout-'),
    );
    const dataStore = store();
    dataStore.records.push({
      id: 'round:4',
      round: 4,
      records: [observation()],
    });
    const adapter = new XApiAdapter({
      client: {},
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
      dataStore,
      proofStore: store(),
      quotaStore: store(),
      now: () => 1783904400,
      storageUploadTimeoutMs: 5,
      storageUploadMaxRetries: 3,
      namespaceWrapper: {
        getBasePath: () => Promise.resolve(basePath),
        getSubmitterAccount: () =>
          Promise.resolve({
            publicKey: { toBase58: () => SUBMITTER },
          }),
      },
      storageClientFactory: () => ({
        uploadFile: (_filePath, _submitter, { signal }) => {
          uploadCalls += 1;
          return new Promise((resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                uploadAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
        getFile: () => Promise.resolve(new Blob()),
      }),
      cidValidator: () => Promise.resolve(true),
    });

    await assert.rejects(
      () => adapter.getSubmissionCID(4),
      /Storage upload attempt timed out after 5ms/,
    );
    assert.equal(uploadCalls, 1);
    assert.equal(uploadAborted, true);
    assert.deepEqual(await fs.promises.readdir(basePath), []);
    await fs.promises.rm(basePath, { recursive: true, force: true });
  });
});
