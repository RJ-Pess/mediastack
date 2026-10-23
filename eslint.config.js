import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'pnpm-lock.yaml'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts de teste em Node puro (indexador falso, e2e): globais do Node.
    files: ['tests/**/*.mjs', 'e2e/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
