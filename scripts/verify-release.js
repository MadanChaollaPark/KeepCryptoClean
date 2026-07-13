'use strict';

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { isCanonicalXId } = require('../lib/identifiers');
const { readBoundedRegularFile } = require('./read-bounded-regular-file');

const root = path.resolve(__dirname, '..');
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_NOTICE_BYTES = 8 * 1024 * 1024;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

function digest(relativePath, maxBytes) {
  return crypto
    .createHash('sha256')
    .update(
      readBoundedRegularFile(path.join(root, relativePath), {
        minBytes: 1,
        maxBytes,
      }),
    )
    .digest('hex');
}

if (process.versions.node !== '22.22.0') {
  fail(
    `Release verification requires Node 22.22.0, found ${process.versions.node}.`,
  );
}

let yarnVersion;
try {
  yarnVersion = execFileSync('yarn', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (error) {
  fail(`Unable to inspect Yarn: ${error.message}`);
}
if (yarnVersion !== '1.22.22') {
  fail(`Release verification requires Yarn 1.22.22, found ${yarnVersion}.`);
}
if (!isCanonicalXId(process.env.KCC_TARGET_USER_ID)) {
  fail('KCC_TARGET_USER_ID must be the reviewed numeric X User ID.');
}

let head;
try {
  head = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain', '--untracked-files=all'])) {
    fail('Release verification requires a clean source worktree.');
  }
} catch (error) {
  fail(`Unable to inspect the release checkout: ${error.message}`);
}
if (!/^[0-9a-f]{40}$/.test(head)) fail('Git HEAD is not a full commit ID.');
if (process.env.KCC_RELEASE_COMMIT && process.env.KCC_RELEASE_COMMIT !== head) {
  fail('KCC_RELEASE_COMMIT does not match Git HEAD.');
}

const releaseEnv = {
  ...process.env,
  KCC_RELEASE_COMMIT: head,
};

run(
  'yarn',
  ['install', '--frozen-lockfile', '--force', '--non-interactive'],
  releaseEnv,
);
if (git(['status', '--porcelain', '--untracked-files=all'])) {
  fail('The frozen release install changed tracked source.');
}

run('yarn', ['build'], releaseEnv);
const first = {
  artifact: digest('dist/main.js', MAX_ARTIFACT_BYTES),
  notices: digest(
    'dist/THIRD_PARTY_BUNDLE_NOTICES.txt',
    MAX_BUNDLE_NOTICE_BYTES,
  ),
};
run('yarn', ['build'], releaseEnv);
const second = {
  artifact: digest('dist/main.js', MAX_ARTIFACT_BYTES),
  notices: digest(
    'dist/THIRD_PARTY_BUNDLE_NOTICES.txt',
    MAX_BUNDLE_NOTICE_BYTES,
  ),
};
if (first.artifact !== second.artifact || first.notices !== second.notices) {
  fail('Two consecutive release builds were not byte-for-byte deterministic.');
}

run('node', ['scripts/verify-artifact.js'], releaseEnv);
run('node', ['scripts/verify-licenses.js', '--release'], releaseEnv);

console.log(`Release artifact verified at ${second.artifact}.`);
