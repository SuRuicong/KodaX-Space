/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class', // FEATURE_019 主题切换会用到
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      // 语义化色板 — 把 css 变量 (定义在 styles.css :root / .dark) 映射成 Tailwind 颜色名。
      // 组件用 `bg-surface` / `text-app` 等语义类，主题切换在 <html> 上加/去 'dark'
      // 自动生效，不必为每个组件加 `dark:` 前缀。
      colors: {
        // 主背景 / 二级背景 / 卡片背景
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
        // 文字主/次/弱
        'fg-primary': 'rgb(var(--fg-primary) / <alpha-value>)',
        'fg-secondary': 'rgb(var(--fg-secondary) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        // 边框
        'border-default': 'rgb(var(--border-default) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        // hover 背景
        'hover-bg': 'rgb(var(--hover-bg) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
