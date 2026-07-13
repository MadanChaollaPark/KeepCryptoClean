const path = require('path');
const webpack = require('webpack');
const { isCanonicalXId } = require('./lib/identifiers');
const { BundleLicensePlugin } = require('./scripts/bundle-license-plugin');

module.exports = (env = {}, argv = {}) => {
  const production = argv.mode === 'production';
  const consensusTargetUserId =
    typeof env.publicTargetUserId === 'string' ? env.publicTargetUserId : '';
  const releaseCommit =
    typeof env.releaseCommit === 'string' ? env.releaseCommit : '';

  if (
    (production || consensusTargetUserId) &&
    !isCanonicalXId(consensusTargetUserId)
  ) {
    throw new Error(
      'KCC_TARGET_USER_ID must be a numeric X User ID (1-19 digits) when building the production task.',
    );
  }
  if (releaseCommit && !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error(
      'KCC_RELEASE_COMMIT must be a lowercase 40-character Git commit.',
    );
  }

  return {
    entry: './index.js',
    target: 'node22',
    mode: production ? 'production' : 'development',
    devtool: production ? false : 'inline-source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'main.js',
      chunkFilename: 'main.[id].js',
      clean: true,
      library: {
        type: 'commonjs2',
      },
    },
    optimization: {
      minimize: false,
      splitChunks: false,
      runtimeChunk: false,
    },
    plugins: [
      new webpack.BannerPlugin({
        banner:
          'KeepCryptoClean 3.0.0. Complete project and bundled third-party ' +
          'license notices are embedded at the end of this executable and ' +
          'emitted as THIRD_PARTY_BUNDLE_NOTICES.txt.',
      }),
      new BundleLicensePlugin({
        releaseCommit,
      }),
      new webpack.DefinePlugin({
        __KCC_BUNDLED__: JSON.stringify(true),
        __KCC_TARGET_USER_ID__: JSON.stringify(consensusTargetUserId),
      }),
      // Koii accepts a single task_audit_program file. This also folds lazy
      // imports (including multiformats) into the uploadable executable.
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      // The former campaign fallback was intentionally deleted. If an older
      // code path still requests it, fail closed at runtime instead of adding
      // campaign text back to the executable.
      new webpack.IgnorePlugin({
        resourceRegExp: /^\.\/couch_comments\.json$/,
      }),
      ...(production
        ? [
            // Website scripting is a dev-only migration aid. Production uses
            // the official X API and must not ship a browser engine.
            new webpack.IgnorePlugin({
              resourceRegExp:
                /^(bcryptjs|cheerio|puppeteer|puppeteer-core|puppeteer-chromium-resolver)$/,
            }),
          ]
        : []),
    ],
    resolve: {
      extensions: ['.js', '.json'],
      // multiformats v13 is ESM-only. Webpack can translate it into the
      // CommonJS task bundle when the import export condition is preferred.
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    stats: {
      errorDetails: true,
      moduleTrace: false,
    },
    ignoreWarnings: [
      {
        module: /express[\\/]lib[\\/]view\.js$/,
        message: /request of a dependency is an expression/,
      },
    ],
    node: {
      __dirname: true,
      __filename: true,
    },
  };
};
