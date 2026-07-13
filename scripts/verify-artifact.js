'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const artifact = path.join(dist, 'main.js');
const failures = [];

if (!fs.existsSync(artifact)) {
  failures.push('dist/main.js does not exist; run yarn build first.');
} else {
  const stat = fs.statSync(artifact);
  if (!stat.isFile() || stat.size < 10_000) {
    failures.push(`dist/main.js is unexpectedly small (${stat.size} bytes).`);
  }

  const bytes = fs.readFileSync(artifact);
  for (const variable of [
    'X_API_BEARER_TOKEN',
  ]) {
    const value = process.env[variable];
    if (value && value.length >= 8 && bytes.includes(Buffer.from(value))) {
      failures.push(`dist/main.js contains the value of ${variable}.`);
    }
  }

  const text = bytes.toString('utf8');
  for (const marker of [
    'couch_comments.json',
    'puppeteer-chromium-resolver',
    'X_API_USER_ACCESS_TOKEN',
    'KEEP_CRYPTO_CLEAN_X_API_REPLY_MODE',
  ]) {
    if (text.includes(marker)) {
      failures.push(`dist/main.js contains forbidden legacy/write marker: ${marker}.`);
    }
  }
}

if (fs.existsSync(dist)) {
  const executableFiles = fs
    .readdirSync(dist)
    .filter(file => file.endsWith('.js'));
  if (executableFiles.length !== 1 || executableFiles[0] !== 'main.js') {
    failures.push(
      `Expected one executable (main.js), found: ${executableFiles.join(', ') || 'none'}.`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

console.log(`Verified ${path.relative(root, artifact)}.`);
