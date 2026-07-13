const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  XApiClient,
  XApiPolicyError,
  OBSERVATION_RECORD_KEYS,
} = require('../../adapters/x-api/client');

function transportFor(routes) {
  return {
    get(path) {
      if (!(path in routes)) throw new Error(`Unexpected GET ${path}`);
      return Promise.resolve({ data: routes[path] });
    },
  };
}

function record() {
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

describe('read-only X API observations', () => {
  it('emits only the eight policy-permitted ID/task metadata fields', async () => {
    const client = new XApiClient({
      bearerToken: 'read-token',
      now: () => 1783904400,
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [{ id: '123', author_id: '42', created_at: '2026-07-13T00:00:00.000Z' }],
        },
      }),
    });
    const records = await client.observeUserId('42', 4);
    assert.deepEqual(records, [record()]);
    assert.deepEqual(Object.keys(records[0]).sort(), OBSERVATION_RECORD_KEYS);
    assert.equal('contentHash' in records[0], false);
    assert.equal('sourceTimestamp' in records[0], false);
    assert.equal('username' in records[0], false);
    assert.equal(typeof client.createOptInReply, 'undefined');
  });

  it('rejects wrong-author and stale hydrated Posts before persistence', async () => {
    const wrongAuthor = new XApiClient({
      bearerToken: 'read-token',
      now: () => 1783904400,
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [{ id: '123', author_id: '666', created_at: '2026-07-13T00:00:00.000Z' }],
        },
      }),
    });
    await assert.rejects(() => wrongAuthor.observeUserId('42', 4), XApiPolicyError);

    const stale = new XApiClient({
      bearerToken: 'read-token',
      now: () => 1783904400,
      maxSourceAgeSeconds: 60,
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [{ id: '123', author_id: '42', created_at: '2026-07-13T00:00:00.000Z' }],
        },
      }),
    });
    await assert.rejects(() => stale.observeUserId('42', 4), XApiPolicyError);
  });

  it('batch fetches in request order and rejects incomplete/injected results', async () => {
    const complete = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({ '/tweets': { data: [{ id: '2' }, { id: '1' }] } }),
    });
    assert.deepEqual((await complete.getTweets(['1', '2'])).map(tweet => tweet.id), ['1', '2']);

    const incomplete = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({ '/tweets': { data: [{ id: '1' }] } }),
    });
    await assert.rejects(() => incomplete.getTweets(['1', '2']), XApiPolicyError);

    const injected = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({ '/tweets': { data: [{ id: '1' }, { id: '3' }] } }),
    });
    await assert.rejects(() => injected.getTweets(['1', '2']), XApiPolicyError);
  });

  it('rehydrates and verifies every ID against configured target/round/recency', async () => {
    const client = new XApiClient({
      bearerToken: 'read-token',
      now: () => 1783904400,
      env: {},
      transport: transportFor({
        '/tweets': {
          data: [{ id: '123', author_id: '42', created_at: '2026-07-13T00:00:00.000Z' }],
        },
      }),
    });
    const context = { round: 4, target: { userId: '42' } };
    assert.equal(await client.verifyObservationBatch([record()], context), true);
    assert.equal(await client.verifyObservationBatch([{ ...record(), round: 5 }], context), false);
    assert.equal(
      await client.verifyObservationBatch([{ ...record(), contentHash: 'a'.repeat(64) }], context),
      false,
    );
  });

  it('retries bounded read GETs for 429/5xx without exposing a write transport', async () => {
    let calls = 0;
    const delays = [];
    const client = new XApiClient({
      bearerToken: 'read-token',
      sleep: ms => { delays.push(ms); return Promise.resolve(); },
      transport: {
        get() {
          calls += 1;
          if (calls === 1) {
            return Promise.reject({
              response: { status: 429, headers: { 'retry-after': '120' } },
            });
          }
          return Promise.resolve({ data: { data: { id: '123', author_id: '42' } } });
        },
      },
    });
    assert.equal((await client.getTweet('123')).id, '123');
    assert.deepEqual(delays, [30000]);
    assert.equal(calls, 2);
  });

  it('retries transient no-response network failures but not ordinary 4xx errors', async () => {
    let calls = 0;
    const networkClient = new XApiClient({
      bearerToken: 'read-token',
      sleep: () => Promise.resolve(),
      transport: {
        get() {
          calls += 1;
          if (calls === 1) return Promise.reject({ code: 'ECONNRESET' });
          return Promise.resolve({ data: { data: { id: '123' } } });
        },
      },
    });
    assert.equal((await networkClient.getTweet('123')).id, '123');
    assert.equal(calls, 2);

    let badRequestCalls = 0;
    const badRequestClient = new XApiClient({
      bearerToken: 'read-token',
      sleep: () => Promise.resolve(),
      transport: {
        get() {
          badRequestCalls += 1;
          return Promise.reject({ response: { status: 400, headers: {} } });
        },
      },
    });
    await assert.rejects(() => badRequestClient.getTweet('123'));
    assert.equal(badRequestCalls, 1);
  });
});
