'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 30_000 + (process.pid % 20_000);
const baseUrl = `http://127.0.0.1:${port}`;
const childEnv = { ...process.env, NODE_ENV: 'test' };
delete childEnv.X_API_BEARER_TOKEN;
const child = spawn(
  process.execPath,
  [path.join(root, 'dist/main.js'), 'ArtifactSmoke', '', String(port)],
  {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
child.stdout.on('data', chunk => {
  output += chunk;
});
child.stderr.on('data', chunk => {
  output += chunk;
});

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    signal: AbortSignal.timeout(1000),
  });
  return { status: response.status, body: await response.text() };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Artifact exited before health check:\n${output}`);
    }
    try {
      const response = await request('/healthz');
      if (response.status === 200) return;
    } catch {
      // The local namespace server has not finished binding yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Artifact did not become healthy:\n${output}`);
}

async function stopChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGKILL');
}

(async () => {
  try {
    await waitForHealth();
    const ready = await request('/readyz');
    if (ready.status !== 503 || !ready.body.includes('not-ready')) {
      throw new Error(
        `/readyz did not fail closed: ${ready.status} ${ready.body}`,
      );
    }
    const taskState = await request('/taskState');
    if (taskState.status !== 404) {
      throw new Error(`/taskState must be absent, got ${taskState.status}`);
    }
    console.log('Artifact route smoke passed.');
  } finally {
    await stopChild();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
