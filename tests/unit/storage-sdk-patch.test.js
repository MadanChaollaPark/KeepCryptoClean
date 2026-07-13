'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { KoiiStorageClient } = require('@_koii/storage-task-sdk');

const servers = new Set();
after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

test('patched storage SDK is singleton and uses only its HTTPS trust set', async () => {
  const first = KoiiStorageClient.getInstance({ debug: false });
  const second = KoiiStorageClient.getInstance({ debug: true });
  assert.equal(first, second);
  const nodes = await first.getNodesRunningTask(10);
  assert.equal(nodes.length, 3);
  assert.equal(
    nodes.every(node => node.startsWith('https://')),
    true,
  );
});

test('patched storage SDK rejects a chunked response above one MiB', async () => {
  const client = KoiiStorageClient.getInstance({ debug: false });
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
        controller.close();
      },
    }),
  );
  await assert.rejects(
    client.readLimitedResponse(response, 1024 * 1024),
    /exceeded the byte limit/,
  );
});

test('patched storage SDK keeps its timeout active while streaming the body', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write('partial');
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const client = KoiiStorageClient.getInstance({ debug: false });
  const response = await client.fetchWithTimeout(
    `http://127.0.0.1:${port}/slow`,
    {},
    50,
  );
  await assert.rejects(
    client.readLimitedResponse(response, 1024 * 1024),
    error => error?.name === 'AbortError',
  );
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  servers.delete(server);
});

test('patched storage SDK composes a caller AbortSignal into fetches', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write('partial');
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const client = KoiiStorageClient.getInstance({ debug: false });
  const controller = new AbortController();
  const response = await client.fetchWithTimeout(
    `http://127.0.0.1:${port}/abort`,
    { signal: controller.signal },
    1000,
  );
  controller.abort();
  await assert.rejects(
    client.readLimitedResponse(response, 1024 * 1024),
    error => error?.name === 'AbortError',
  );
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  servers.delete(server);
});

test('patched storage SDK refuses redirects from trusted endpoints', async () => {
  let redirectedTargetHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/internal') {
      redirectedTargetHits += 1;
      response.end('should-not-be-reached');
      return;
    }
    response.writeHead(302, { location: '/internal' });
    response.end();
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const client = KoiiStorageClient.getInstance({ debug: false });
  await assert.rejects(
    client.fetchWithTimeout(`http://127.0.0.1:${port}/redirect`, {}, 1000),
  );
  assert.equal(redirectedTargetHits, 0);
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  servers.delete(server);
});
