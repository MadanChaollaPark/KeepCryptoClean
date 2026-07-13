const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  XApiClient,
  XApiPolicyError,
  XApiRequestError,
  DEFAULT_MAX_RESPONSE_BYTES,
  OBSERVATION_RECORD_KEYS,
} = require('../../adapters/x-api/client');
const SUBMITTER = '11111111111111111111111111111111';
const TASK_ID = 'Vote111111111111111111111111111111111111111';

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
    submitterPublicKey: SUBMITTER,
    taskId: TASK_ID,
    targetUserId: '42',
  };
}

describe('read-only X API observations', () => {
  it('emits only the nine policy-permitted ID/task metadata fields', async () => {
    const client = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [
            { id: '123', author_id: '42' },
            { id: '124', author_id: '42' },
            { id: '125', author_id: '42' },
            { id: '126', author_id: '42' },
            { id: '127', author_id: '42' },
          ],
        },
      }),
    });
    const records = await client.observeUserId('42', 4, {
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
    });
    assert.deepEqual(records, [record()]);
    assert.deepEqual(Object.keys(records[0]).sort(), OBSERVATION_RECORD_KEYS);
    assert.equal('contentHash' in records[0], false);
    assert.equal('sourceTimestamp' in records[0], false);
    assert.equal('username' in records[0], false);
    assert.equal(typeof client.createOptInReply, 'undefined');
  });

  it('fails closed on wrong-author, malformed, and duplicate timeline data', async () => {
    const wrongAuthor = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [{ id: '123', author_id: '666' }],
        },
      }),
    });
    await assert.rejects(
      () =>
        wrongAuthor.observeUserId('42', 4, {
          submitterPublicKey: SUBMITTER,
          taskId: TASK_ID,
        }),
      XApiPolicyError,
    );

    const duplicate = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/users/42/tweets': {
          data: [
            { id: '123', author_id: '42' },
            { id: '123', author_id: '42' },
          ],
        },
      }),
    });
    await assert.rejects(
      () =>
        duplicate.observeUserId('42', 4, {
          submitterPublicKey: SUBMITTER,
          taskId: TASK_ID,
        }),
      XApiPolicyError,
    );

    const malformed = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/users/42/tweets': { data: [{ id: 'not-an-id', author_id: '42' }] },
      }),
    });
    await assert.rejects(
      () =>
        malformed.observeUserId('42', 4, {
          submitterPublicKey: SUBMITTER,
          taskId: TASK_ID,
        }),
      XApiPolicyError,
    );
  });

  it('batch fetches in request order and rejects incomplete/injected results', async () => {
    const complete = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/tweets': { data: [{ id: '2' }, { id: '1' }] },
      }),
    });
    assert.deepEqual(
      (await complete.getTweets(['1', '2'])).map(tweet => tweet.id),
      ['1', '2'],
    );

    const incomplete = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({ '/tweets': { data: [{ id: '1' }] } }),
    });
    await assert.rejects(
      () => incomplete.getTweets(['1', '2']),
      XApiPolicyError,
    );

    const injected = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/tweets': { data: [{ id: '1' }, { id: '3' }] },
      }),
    });
    await assert.rejects(() => injected.getTweets(['1', '2']), XApiPolicyError);
  });

  it('rehydrates every ID and verifies immutable target-author binding', async () => {
    const client = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/tweets': {
          data: [{ id: '123', author_id: '42' }],
        },
      }),
    });
    const context = {
      round: 4,
      target: { userId: '42' },
      submitterPublicKey: SUBMITTER,
      taskId: TASK_ID,
    };
    assert.equal(
      await client.verifyObservationBatch([record()], context),
      true,
    );
    assert.equal(
      await client.verifyObservationBatch([{ ...record(), round: 5 }], context),
      false,
    );
    assert.equal(
      await client.verifyObservationBatch(
        [
          {
            ...record(),
            submitterPublicKey: 'SysvarRent111111111111111111111111111111111',
          },
        ],
        context,
      ),
      false,
    );
    assert.equal(
      await client.verifyObservationBatch(
        [
          {
            ...record(),
            taskId: 'SysvarRent111111111111111111111111111111111',
          },
        ],
        context,
      ),
      false,
    );
    assert.equal(
      await client.verifyObservationBatch(
        [{ ...record(), contentHash: 'a'.repeat(64) }],
        context,
      ),
      false,
    );

    const wrongAuthor = new XApiClient({
      bearerToken: 'read-token',
      env: {},
      transport: transportFor({
        '/tweets': { data: [{ id: '123', author_id: '666' }] },
      }),
    });
    assert.equal(
      await wrongAuthor.verifyObservationBatch([record()], context),
      false,
    );
  });

  it('retries bounded read GETs for 429/5xx without exposing a write transport', async () => {
    let calls = 0;
    const delays = [];
    const client = new XApiClient({
      bearerToken: 'read-token',
      sleep: ms => {
        delays.push(ms);
        return Promise.resolve();
      },
      transport: {
        get() {
          calls += 1;
          if (calls === 1) {
            return Promise.reject({
              response: { status: 429, headers: { 'retry-after': '120' } },
            });
          }
          return Promise.resolve({
            data: { data: { id: '123', author_id: '42' } },
          });
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

  it('sets hard response limits and returns only sanitized terminal errors', async () => {
    const bearer = 'super-secret-bearer';
    let requestConfig;
    const client = new XApiClient({
      bearerToken: bearer,
      maxResponseBytes: 2048,
      env: {},
      transport: {
        get(_path, config) {
          requestConfig = config;
          return Promise.reject({
            code: 'ERR_BAD_REQUEST',
            message: `failed with ${bearer}`,
            config: { headers: { Authorization: `Bearer ${bearer}` } },
            response: { status: 401, data: { bearer } },
          });
        },
      },
    });

    let terminalError;
    try {
      await client.getTweet('123');
    } catch (error) {
      terminalError = error;
    }
    assert.ok(terminalError instanceof XApiRequestError);
    assert.equal(terminalError.status, 401);
    assert.equal(terminalError.code, 'ERR_BAD_REQUEST');
    assert.equal(terminalError.cause, undefined);
    assert.equal(
      `${terminalError.message}${JSON.stringify(terminalError)}`.includes(
        bearer,
      ),
      false,
    );
    assert.equal(requestConfig.maxContentLength, 2048);
    assert.equal(requestConfig.maxBodyLength, 2048);
    assert.equal(DEFAULT_MAX_RESPONSE_BYTES, 1024 * 1024);
  });

  it('propagates AbortSignal to Axios and does not retry cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    let receivedSignal;
    const client = new XApiClient({
      bearerToken: 'read-token',
      sleep: () => Promise.resolve(),
      transport: {
        get(_path, config) {
          calls += 1;
          receivedSignal = config.signal;
          return new Promise((_resolve, reject) => {
            config.signal.addEventListener(
              'abort',
              () =>
                reject({
                  code: 'ERR_CANCELED',
                  name: 'CanceledError',
                  config: { headers: config.headers },
                }),
              { once: true },
            );
          });
        },
      },
    });
    const request = client.getTweet('123', { signal: controller.signal });
    controller.abort();
    await assert.rejects(
      request,
      error => error instanceof XApiRequestError && error.code === 'ABORTED',
    );
    assert.equal(receivedSignal, controller.signal);
    assert.equal(calls, 1);
  });
});
