'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseArgs } = require('node:util');
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

function validatedBuildMetadata(metadata, mode) {
  if (mode !== 'production' && mode !== 'development') {
    throw new Error('Build mode must be production or development.');
  }

  const publicTargetUserId = metadata.publicTargetUserId || '';
  if (
    (mode === 'production' || publicTargetUserId) &&
    !isCanonicalXId(publicTargetUserId)
  ) {
    throw new Error(
      '--public-target-user-id must be a numeric X User ID (1-19 digits) for this build.',
    );
  }

  const releaseCommit = metadata.releaseCommit || '';
  if (releaseCommit && !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error(
      '--release-commit must be a lowercase 40-character Git commit.',
    );
  }

  return Object.freeze({ publicTargetUserId, releaseCommit });
}

function parseBuildMetadata(args, mode) {
  const { values } = parseArgs({
    args,
    options: {
      'public-target-user-id': { type: 'string' },
      'release-commit': { type: 'string' },
    },
    strict: true,
  });
  return validatedBuildMetadata(
    {
      publicTargetUserId: values['public-target-user-id'] || '',
      releaseCommit: values['release-commit'] || '',
    },
    mode,
  );
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
  const mode = process.argv[2] || 'production';
  let metadata;
  try {
    metadata = parseBuildMetadata(process.argv.slice(3), mode);
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
  parseBuildMetadata,
  validatedBuildMetadata,
  webpackArguments,
};
