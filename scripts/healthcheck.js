'use strict';

const http = require('node:http');

const port = 3000;
const request = http.get(
  {
    host: '127.0.0.1',
    port,
    path: '/healthz',
    timeout: 2_000,
  },
  response => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);

request.on('timeout', () => request.destroy(new Error('healthcheck timeout')));
request.on('error', () => process.exit(1));
