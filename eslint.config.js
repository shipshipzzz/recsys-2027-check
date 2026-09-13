import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.migration-backup/**',
      'test-results/**',
      'coverage/**',
      'playwright-report/**',
      'data/**',
      'supabase/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  { files: ['e2e/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['src/**/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['*.{js,mjs}', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node },
  },
];
