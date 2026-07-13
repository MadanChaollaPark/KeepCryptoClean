const createConfig = require('./webpack.config');

// Never use dotenv-webpack here: embedding a developer's .env in an artifact
// would turn credentials into public bundle contents.
module.exports = (env, argv) => createConfig(env, {
  ...argv,
  mode: 'development',
});
