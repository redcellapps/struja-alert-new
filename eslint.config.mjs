import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Expo config plugins are CommonJS and run in Node.
    files: ['apps/mobile/plugins/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', process: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Maestro runs these scripts with `http` and the flow's env variables as globals.
    files: ['.maestro/**/*.js'],
    languageOptions: { globals: { http: 'readonly', SCENARIO: 'readonly' } },
  },
);
