const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const XApiAdapter = require('../../adapters/x-api/adapter');

function store() {
  const records = [];
  return {
    records,
    initializeData() { return Promise.resolve(this); },
    create(record) {
      const index = records.findIndex(item => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      return Promise.resolve(record);
    },
    getList({ round }) { return Promise.resolve(records.filter(item => item.round === round)); },
    deleteList({ round }) {
      for (let index = records.length - 1; index >= 0; index--) {
        if (records[index].round === round) records.splice(index, 1);
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
    targetUserId: '42',
    observedAt: 1783904400,
  };
}

describe('XApiAdapter production contract', () => {
  it('observes, persists, uploads bounded canonical JSON, and cleans temporary files', async () => {
    const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kcc-x-api-test-'));
    const dataStore = store();
    dataStore.records.push({
      _id: 'nedb-old',
      id: '4:999',
      round: 4,
      record: { ...observation(), id: '999', tweetId: '999' },
    });
    const proofStore = store();
    const quotaStore = store();
    let uploaded;
    const client = {
      observeUserId(userId, round) {
        assert.equal(userId, '42');
        assert.equal(round, 4);
        return Promise.resolve([observation()]);
      },
      verifyObservationBatch() { return Promise.resolve(true); },
    };
    const adapter = new XApiAdapter({
      client,
      dataStore,
      proofStore,
      quotaStore,
      now: () => 1783904400,
      namespaceWrapper: {
        getBasePath: () => Promise.resolve(basePath),
        getSubmitterAccount: () => Promise.resolve({ publicKey: 'submitter' }),
      },
      storageClientFactory: () => ({
        async uploadFile(filePath) {
          assert.equal(path.basename(filePath), 'dataList.json');
          uploaded = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
          return { cid: 'bafy-test-cid' };
        },
      }),
      cidValidator: cid => Promise.resolve(cid === 'bafy-test-cid'),
    });

    assert.deepEqual(await adapter.search({ targetUserId: '42', round: 4 }), [observation()]);
    dataStore.records[0]._id = 'nedb-generated-id';
    assert.equal(await adapter.getSubmissionCID(4), 'bafy-test-cid');
    assert.deepEqual(uploaded, [observation()]);
    assert.equal(proofStore.records[0].recordCount, 1);
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
      dataStore,
      proofStore,
      quotaStore,
    });
    const context = { round: 4, target: { userId: '42' } };
    assert.equal(await adapter.verifyObservationBatch([observation()], context), false);
    assert.deepEqual(received, { records: [observation()], context });
  });

  it('persists an idempotent rolling 30-day quota and prunes expired reservations', async () => {
    const quotaStore = store();
    let now = 1783904400;
    const adapter = new XApiAdapter({
      client: {},
      dataStore: store(),
      proofStore: store(),
      quotaStore,
      maxRolling30DayIds: 1,
      now: () => now,
    });
    await adapter._reserveRollingIds(4, 1);
    await adapter._reserveRollingIds(4, 1);
    assert.equal(quotaStore.records[0].count, 1);
    await assert.rejects(
      () => adapter._reserveRollingIds(5, 1),
      /Rolling 30-day X Post ID redistribution quota would be exceeded/,
    );
    now += 30 * 24 * 60 * 60 + 1;
    await adapter._reserveRollingIds(5, 1);
    assert.equal(quotaStore.records[0].count, 1);
    assert.equal(quotaStore.records[0].reservations.length, 1);
  });
});
