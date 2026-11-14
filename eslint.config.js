import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'data/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Stand-in CLI scripts run in Node.
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
  // Tests read arbitrary JSON from the API; typing every response would add noise, not safety.
  { files: ['**/test/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
