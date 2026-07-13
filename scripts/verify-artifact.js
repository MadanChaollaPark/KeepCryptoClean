'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const { isCanonicalXId } = require('../lib/identifiers');
const { verifyBundleIntegrity } = require('./bundle-notice-integrity');
const { readBoundedRegularFile } = require('./read-bounded-regular-file');
const dist = path.join(root, 'dist');
const artifact = path.join(dist, 'main.js');
const bundleNotice = path.join(dist, 'THIRD_PARTY_BUNDLE_NOTICES.txt');
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_NOTICE_BYTES = 8 * 1024 * 1024;
const failures = [];

let artifactBytes = null;
try {
  artifactBytes = readBoundedRegularFile(artifact, {
    minBytes: 10_000,
    maxBytes: MAX_ARTIFACT_BYTES,
  });
} catch (error) {
  failures.push(
    error?.code === 'ENOENT'
      ? 'dist/main.js does not exist; run yarn build first.'
      : `Unable to safely read dist/main.js: ${error.message}`,
  );
}

if (artifactBytes) {
  for (const variable of ['X_API_BEARER_TOKEN']) {
    const value = process.env[variable];
    if (
      value &&
      value.length >= 8 &&
      artifactBytes.includes(Buffer.from(value))
    ) {
      failures.push(`dist/main.js contains the value of ${variable}.`);
    }
  }

  const text = artifactBytes.toString('utf8');
  const targetUserId = process.env.KCC_TARGET_USER_ID;
  if (!isCanonicalXId(targetUserId)) {
    failures.push(
      'KCC_TARGET_USER_ID is required to verify the embedded consensus target.',
    );
  } else if (!text.includes(targetUserId)) {
    failures.push(
      'dist/main.js does not contain the expected embedded consensus target.',
    );
  }
  for (const marker of [
    'couch_comments.json',
    'puppeteer-chromium-resolver',
    'X_API_USER_ACCESS_TOKEN',
    'KEEP_CRYPTO_CLEAN_X_API_REPLY_MODE',
    'process.env.X_TARGET_USER_ID',
    'process.env.KCC_TARGET_USER_ID',
    'webasm_bincode_deserializer',
    'bincode_js_bg.wasm',
    'zstd.wasm',
  ]) {
    if (text.includes(marker)) {
      failures.push(
        `dist/main.js contains forbidden legacy/write marker: ${marker}.`,
      );
    }
  }
}

let actualFiles = null;
try {
  actualFiles = fs.readdirSync(dist);
} catch (error) {
  if (error?.code !== 'ENOENT') {
    failures.push(`Unable to inspect dist: ${error.message}`);
  }
}

if (actualFiles) {
  const expectedFiles = new Set(['main.js', 'THIRD_PARTY_BUNDLE_NOTICES.txt']);
  const unexpectedFiles = actualFiles.filter(file => !expectedFiles.has(file));
  const missingFiles = [...expectedFiles].filter(
    file => !actualFiles.includes(file),
  );
  if (unexpectedFiles.length || missingFiles.length) {
    failures.push(
      `Unexpected dist contents; missing [${missingFiles.join(', ')}], extra [${unexpectedFiles.join(', ')}].`,
    );
  }
  const executableFiles = actualFiles.filter(file => file.endsWith('.js'));
  if (executableFiles.length !== 1 || executableFiles[0] !== 'main.js') {
    failures.push(
      `Expected one executable (main.js), found: ${executableFiles.join(', ') || 'none'}.`,
    );
  }

  if (artifactBytes && actualFiles.includes(path.basename(bundleNotice))) {
    try {
      const bundleNoticeBytes = readBoundedRegularFile(bundleNotice, {
        minBytes: 1,
        maxBytes: MAX_BUNDLE_NOTICE_BYTES,
      });
      failures.push(
        ...verifyBundleIntegrity(artifactBytes, bundleNoticeBytes).failures,
      );
    } catch (error) {
      failures.push(`Unable to safely read bundle notices: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

console.log(`Verified ${path.relative(root, artifact)}.`);
