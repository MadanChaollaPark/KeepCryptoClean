'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const { isCanonicalXId } = require('../lib/identifiers');
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

if (
  !atLeast(process.versions.node, '22.22.0') ||
  atLeast(process.versions.node, '23.0.0')
) {
  failures.push(
    `Node ${process.versions.node} is unsupported; use >=22.22.0 and <23.`,
  );
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
const canonicalRepository =
  'https://github.com/MadanChaollaPark/KeepCryptoClean';

function yamlScalar(key) {
  const prefix = `${key}:`;
  const matches = taskConfig
    .split(/\r?\n/)
    .filter(line => line.startsWith(prefix));
  if (matches.length !== 1) {
    failures.push(`config-task.yml must contain exactly one top-level ${key}.`);
    return null;
  }
  const raw = matches[0].slice(prefix.length).trim();
  if (
    raw.length >= 2 &&
    ((raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"')))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

if (!packageJson.repository.url.includes('MadanChaollaPark/KeepCryptoClean')) {
  failures.push('package.json repository is not canonical.');
}
if (metadata.repositoryUrl !== canonicalRepository) {
  failures.push('metadata.json repositoryUrl is not canonical.');
}
if (!metadata.privacyPolicyUrl?.endsWith('/PRIVACY.md')) {
  failures.push('metadata.json privacyPolicyUrl is missing or non-canonical.');
}
if (yamlScalar('repositoryUrl') !== canonicalRepository) {
  failures.push('config-task.yml repositoryUrl is not canonical.');
}
if (yamlScalar('environment') !== 'TEST') {
  failures.push(
    'config-task.yml must remain constrained to Koii TEST until promotion review.',
  );
}
if (yamlScalar('task_type') !== 'KOII') {
  failures.push('config-task.yml must use the reviewed KOII token type.');
}
if (taskConfig.includes("value: 'X_TARGET_USER_ID'")) {
  failures.push(
    'The consensus target must be embedded at build time, not supplied as a node task variable.',
  );
}

if (!process.env.X_API_BEARER_TOKEN) {
  const message =
    'X_API_BEARER_TOKEN is unset; observation calls will fail closed.';
  if (strict) failures.push(message);
  else warnings.push(message);
}
if (process.env.X_TARGET_USER_ID) {
  failures.push(
    'X_TARGET_USER_ID is unsupported; use build-time KCC_TARGET_USER_ID.',
  );
}
if (!process.env.KCC_TARGET_USER_ID) {
  const message =
    'KCC_TARGET_USER_ID is unset; no build-time consensus target is configured.';
  if (strict) failures.push(message);
  else warnings.push(message);
} else if (!isCanonicalXId(process.env.KCC_TARGET_USER_ID)) {
  failures.push(
    'KCC_TARGET_USER_ID must be a canonical positive X User ID (1-19 digits).',
  );
}

const roundSlots = Number(yamlScalar('round_time'));
const auditSlots = Number(yamlScalar('audit_window'));
const submissionSlots = Number(yamlScalar('submission_window'));
const slotSeconds = 0.408;
const rollingWindowSeconds = 30 * 24 * 60 * 60;
const maxIdsPerRound = 1;
const redistributionCap = 1_500_000;
if (!Number.isSafeInteger(roundSlots) || roundSlots <= 0) {
  failures.push('config-task.yml round_time must be a positive integer.');
} else {
  if (
    !Number.isSafeInteger(auditSlots) ||
    auditSlots <= 0 ||
    !Number.isSafeInteger(submissionSlots) ||
    submissionSlots <= 0 ||
    auditSlots + submissionSlots >= roundSlots
  ) {
    failures.push(
      'Audit and submission windows must be positive and leave execution time in each round.',
    );
  }
  // Add one boundary round to stay conservative when a 30-day window starts
  // immediately before a round boundary.
  const maximumRounds =
    Math.ceil(rollingWindowSeconds / (roundSlots * slotSeconds)) + 1;
  const maximumRedistributedIds = maximumRounds * maxIdsPerRound;
  if (maximumRedistributedIds > redistributionCap) {
    failures.push(
      `Configured cadence can redistribute up to ${maximumRedistributedIds} Post IDs per 30 days, above the ${redistributionCap} cap.`,
    );
  }
}

const totalBounty = Number(yamlScalar('total_bounty_amount'));
const roundBounty = Number(yamlScalar('bounty_amount_per_round'));
if (
  !Number.isFinite(totalBounty) ||
  totalBounty <= 0 ||
  !Number.isFinite(roundBounty) ||
  roundBounty <= 0 ||
  roundBounty > totalBounty ||
  !Number.isSafeInteger(totalBounty * 1_000_000_000) ||
  !Number.isSafeInteger(roundBounty * 1_000_000_000)
) {
  failures.push(
    'KOII bounty values must be positive, bounded, and exactly representable in atomic units.',
  );
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exit(1);
}

console.log(
  `Preflight passed on Node ${process.versions.node}${strict ? ' (strict)' : ''}.`,
);
