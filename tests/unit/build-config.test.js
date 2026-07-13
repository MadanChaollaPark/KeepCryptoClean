'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isolatedWebpackEnvironment,
  parseBuildMetadata,
  validatedBuildMetadata,
  webpackArguments,
} = require('../../scripts/build');
const webpackConfig = require('../../webpack.config');

test('build metadata accepts only explicit public identifiers', () => {
  assert.deepEqual(
    validatedBuildMetadata(
      {
        publicTargetUserId: '1234567890',
        releaseCommit: 'a'.repeat(40),
      },
      'production',
    ),
    {
      publicTargetUserId: '1234567890',
      releaseCommit: 'a'.repeat(40),
    },
  );
  assert.deepEqual(validatedBuildMetadata({}, 'development'), {
    publicTargetUserId: '',
    releaseCommit: '',
  });
  assert.throws(
    () => validatedBuildMetadata({}, 'production'),
    /public-target-user-id/,
  );
  assert.throws(
    () =>
      validatedBuildMetadata(
        { publicTargetUserId: 'screen-name' },
        'development',
      ),
    /public-target-user-id/,
  );
  assert.throws(
    () =>
      validatedBuildMetadata(
        {
          publicTargetUserId: '1',
          releaseCommit: 'not-a-commit',
        },
        'production',
      ),
    /release-commit/,
  );

  assert.deepEqual(
    parseBuildMetadata(
      ['--public-target-user-id', '42', '--release-commit', 'c'.repeat(40)],
      'production',
    ),
    { publicTargetUserId: '42', releaseCommit: 'c'.repeat(40) },
  );
  assert.throws(
    () => parseBuildMetadata(['--unknown', 'value'], 'production'),
    /Unknown option/,
  );
});

test('Webpack child receives no credential-bearing build environment', () => {
  const child = isolatedWebpackEnvironment(
    {
      CI: 'true',
      KCC_RELEASE_COMMIT: 'a'.repeat(40),
      KCC_TARGET_USER_ID: '1234567890',
      PATH: '/usr/bin',
      RANDOM_PRIVATE_KEY: 'test-placeholder-private-key',
      X_API_BEARER_TOKEN: 'example-not-a-token',
    },
    'production',
  );

  assert.deepEqual(child, {
    CI: 'true',
    NODE_ENV: 'production',
    PATH: '/usr/bin',
  });
  assert.equal(JSON.stringify(child).includes('example-not-a-token'), false);
  assert.equal(
    JSON.stringify(child).includes('test-placeholder-private-key'),
    false,
  );
});

test('Webpack receives validated metadata only through explicit CLI inputs', () => {
  const releaseCommit = 'b'.repeat(40);
  const metadata = {
    publicTargetUserId: '1234567890',
    releaseCommit,
  };
  const args = webpackArguments('production', metadata);
  assert.deepEqual(args.slice(1), [
    '--mode',
    'production',
    '--env',
    'publicTargetUserId=1234567890',
    '--env',
    `releaseCommit=${releaseCommit}`,
  ]);

  const config = webpackConfig(metadata, { mode: 'production' });
  const definePlugin = config.plugins.find(
    plugin => plugin.constructor.name === 'DefinePlugin',
  );
  const licensePlugin = config.plugins.find(
    plugin => plugin.constructor.name === 'BundleLicensePlugin',
  );
  assert.equal(definePlugin.definitions.__KCC_TARGET_USER_ID__, '"1234567890"');
  assert.equal(licensePlugin.releaseCommit, releaseCommit);
  assert.throws(() => webpackConfig({}, { mode: 'production' }), /target/i);
});
