// ESLint flat config (v9+)
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Node + browser baseline; per-file overrides set below
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    // Renderer (browser) — no node globals
    // Flat config 的 globals 是叠加的，所以这里需要显式把上层 Node globals 关掉，
    // 否则 renderer 文件里 `process` / `Buffer` / `__dirname` 仍被认为合法。
    files: ['apps/desktop/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        process: 'off',
        Buffer: 'off',
        __dirname: 'off',
        __filename: 'off',
        global: 'off',
      },
    },
    rules: {
      // Architectural rule (ADR-003 §5.4): renderer must not import runtime LLM/KodaX
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@anthropic-ai/sdk', message: 'renderer must not import LLM SDK runtime' },
            { name: 'openai', message: 'renderer must not import LLM SDK runtime' },
            {
              name: '@kodax-ai/kodax/coding',
              message: 'renderer must not import KodaX runtime; only types/constants allowed',
            },
          ],
          // `electron` 必须连同 `electron/common`, `electron/renderer` 等子路径一起禁
          patterns: [
            { group: ['electron', 'electron/*'], message: 'renderer must not import electron' },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'out/**',
      'build/**',
      '**/*.config.{js,cjs,mjs}',
    ],
  },
];
