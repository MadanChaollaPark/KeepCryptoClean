module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 15,
  },
  rules: {
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'warn',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'multi-line'],
    'no-throw-literal': 'error',
    'no-return-await': 'warn',
    'no-process-exit': 'error',
    'require-await': 'warn',
  },
};
