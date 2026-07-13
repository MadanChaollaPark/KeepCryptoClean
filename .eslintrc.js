module.exports = {
  root: true,
  env: {
    browser: true,
    commonjs: true,
    es2022: true,
    node: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'no-var': 'error',
    'prefer-const': 'off',
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^(NetworkError|ValidationError|TAG_LENGTH)$',
      },
    ],
    'no-console': 'off',
    eqeqeq: 'off',
    curly: 'off',
    'no-throw-literal': 'error',
    'no-return-await': 'off',
    'no-process-exit': 'error',
    'require-await': 'off',
  },
  overrides: [
    {
      files: ['tests/**/*.js', 'scripts/**/*.js', 'prod-debug.js'],
      rules: {
        'no-process-exit': 'off',
      },
    },
  ],
};
