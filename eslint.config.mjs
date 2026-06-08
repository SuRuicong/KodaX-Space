// ESLint flat config (v9+)
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

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
      // 完整 browser + node 全局集（用 globals 包，而非手写少量名字）。
      // 不再 enumerate setTimeout / localStorage / HTMLElement / KeyboardEvent... 漏一个就 no-undef。
      globals: {
        ...globals.browser,
        ...globals.node,
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
      // 关键：核心 ESLint 里 TypeScript 自己已覆盖的规则必须关掉，否则在 TS 上误报。
      //   - no-undef：不认识 TS 类型（JSX.Element / HTMLElement）和 ambient 全局 → tsc 才是真检查器
      //   - no-unused-vars / no-redeclare：用 @typescript-eslint 版（理解 type / overload / enum）
      // 这是 typescript-eslint 官方 eslint-recommended 的做法；之前漏配导致全仓 ~5900 个假 no-undef。
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // 文案里的 ' / " / & 在 JSX 中渲染正常，本规则纯噪声（社区普遍关闭）。
      'react/no-unescaped-entities': 'off',
      // 本仓刻意用 \x00 (NUL byte) 做路径/输入校验（安全相关），非误写 → 允许控制字符正则。
      'no-control-regex': 'off',
      // 不可见字符（RTL override / 零宽 / BOM）的剥离正则里**故意**含 irregular whitespace，
      // 那是规则的目标本身 → 跳过 regex（字符串/模板默认已跳）。
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipTemplates: true }],
      // `_` 前缀 = 刻意丢弃（args / 解构变量 / catch 绑定 / 解构数组洞）。
      // 之前只配 argsIgnorePattern，导致 appStore 里 const {_drop, ...} 这类故意丢弃全报 unused。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    // .mjs / .js — 构建脚本(Node) + 个别浏览器注入诊断脚本，给全集 globals 避免 no-undef。
    files: ['**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    // Renderer (browser) 架构纯净性 — 由 no-restricted-imports 强制（真正的门）。
    // 注：renderer 不可用 node 全局这条，靠 tsc 的 lib/types + 本规则的 import 限制把关；
    // 不再用 globals 'off' 的小技巧（no-undef 已按 TS 惯例关闭，那个技巧失效）。
    files: ['apps/desktop/renderer/**/*.{ts,tsx}'],
    rules: {
      // Architectural rule (ADR-003 §5.4): renderer must not import runtime LLM/KodaX
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@anthropic-ai/sdk', message: 'renderer must not import LLM SDK runtime' },
            { name: 'openai', message: 'renderer must not import LLM SDK runtime' },
            {
              name: '@kodax-ai/coding',
              message: 'renderer must not import KodaX runtime; only types/constants allowed',
            },
            {
              name: '@kodax-ai/skills',
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
      // 用 **/ 前缀覆盖嵌套构建产物（之前 'dist/**' 只匹配顶层，漏了 apps/desktop/dist 等
      // → 几千个 minified bundle / Monaco 语言文件被 lint，淹没真实问题）。
      '**/node_modules/**',
      '**/.claude/**', // 子 agent 临时 worktree 副本（重复源码），非真实源
      '**/dist/**',
      '**/dist-electron/**',
      '**/out/**',
      '**/build/**',
      '**/*.config.{js,cjs,mjs}',
    ],
  },
];
