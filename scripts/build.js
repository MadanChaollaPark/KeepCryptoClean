'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { isCanonicalXId } = require('../lib/identifiers');

const root = path.resolve(__dirname, '..');
const publicBuildEnvironmentKeys = [
  'CI',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'PATH',
  'SOURCE_DATE_EPOCH',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'WINDIR',
];

function validatedBuildMetadata(environment, mode) {
  if (mode !== 'production' && mode !== 'development') {
    throw new Error('Build mode must be production or development.');
  }

  const publicTargetUserId = environment.KCC_TARGET_USER_ID || '';
  if (
    (mode === 'production' || publicTargetUserId) &&
    !isCanonicalXId(publicTargetUserId)
  ) {
    throw new Error(
      'KCC_TARGET_USER_ID must be a numeric X User ID (1-19 digits) for this build.',
    );
  }

  const releaseCommit = environment.KCC_RELEASE_COMMIT || '';
  if (releaseCommit && !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error(
      'KCC_RELEASE_COMMIT must be a lowercase 40-character Git commit.',
    );
  }

  return Object.freeze({ publicTargetUserId, releaseCommit });
}

function isolatedWebpackEnvironment(environment, mode) {
  const isolated = { NODE_ENV: mode };
  for (const key of publicBuildEnvironmentKeys) {
    if (typeof environment[key] === 'string') isolated[key] = environment[key];
  }
  return isolated;
}

function webpackArguments(mode, metadata) {
  const args = [require.resolve('webpack-cli/bin/cli.js'), '--mode', mode];
  if (metadata.publicTargetUserId) {
    args.push('--env', `publicTargetUserId=${metadata.publicTargetUserId}`);
  }
  if (metadata.releaseCommit) {
    args.push('--env', `releaseCommit=${metadata.releaseCommit}`);
  }
  return args;
}

function run() {
  require('dotenv').config({ path: path.join(root, '.env') });
  const mode = process.argv[2] || 'production';
  let metadata;
  try {
    metadata = validatedBuildMetadata(process.env, mode);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, webpackArguments(mode, metadata), {
    cwd: root,
    env: isolatedWebpackEnvironment(process.env, mode),
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`ERROR: Webpack failed to start: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === 0 ? 0 : result.status || 1);
}

if (require.main === module) run();

module.exports = {
  isolatedWebpackEnvironment,
  validatedBuildMetadata,
  webpackArguments,
};
