'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const failures = [];
const warnings = [];

function atLeast(current, minimum) {
  const left = current.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

if (!atLeast(process.versions.node, '18.17.0')) {
  failures.push(`Node ${process.versions.node} is unsupported; use >=18.17.0 (22 LTS recommended).`);
}

const requiredFiles = [
  'config-task.yml',
  'metadata.json',
  'package.json',
  'yarn.lock',
];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing ${file}.`);
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'),
);
const taskConfig = fs.readFileSync(path.join(root, 'config-task.yml'), 'utf8');
const canonicalRepository = 'https://github.com/MadanChaollaPark/KeepCryptoClean';

if (!packageJson.repository.url.includes('MadanChaollaPark/KeepCryptoClean')) {
  failures.push('package.json repository is not canonical.');
}
if (metadata.repositoryUrl !== canonicalRepository) {
  failures.push('metadata.json repositoryUrl is not canonical.');
}
if (!metadata.privacyPolicyUrl?.endsWith('/PRIVACY.md')) {
  failures.push('metadata.json privacyPolicyUrl is missing or non-canonical.');
}
if (!taskConfig.includes(`repositoryUrl: '${canonicalRepository}'`)) {
  failures.push('config-task.yml repositoryUrl is not canonical.');
}
if (!taskConfig.includes("environment: 'TEST'")) {
  warnings.push('config-task.yml is not constrained to the Koii TEST environment.');
}
if (!taskConfig.includes("task_type: 'KOII'")) {
  warnings.push('Review the configured token type before funding a task.');
}
if (!taskConfig.includes("value: 'X_TARGET_USER_ID'")) {
  failures.push('config-task.yml must require the consensus target User ID.');
}

if (!process.env.X_API_BEARER_TOKEN) {
  const message = 'X_API_BEARER_TOKEN is unset; observation calls will fail closed.';
  if (strict) failures.push(message);
  else warnings.push(message);
}
if (!process.env.X_TARGET_USER_ID) {
  const message = 'X_TARGET_USER_ID is unset; no consensus target is configured.';
  if (strict) failures.push(message);
  else warnings.push(message);
} else if (!/^\d{1,20}$/.test(process.env.X_TARGET_USER_ID)) {
  failures.push('X_TARGET_USER_ID must be a numeric X User ID (1-20 digits).');
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

console.log(
  `Preflight passed on Node ${process.versions.node}${strict ? ' (strict)' : ''}.`,
);
