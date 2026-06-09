/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class', // FEATURE_019 主题切换会用到
  theme: {
    extend: {
      fontFamily: {
        // F054: UI 主字体 Geist；mono JetBrains Mono。值定义在 styles.css 的 --ui / --mono。
        sans: ['Geist Variable', 'Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: [
          'JetBrains Mono Variable',
          'JetBrains Mono',
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
      // 组件用 `bg-surface` / `text-fg-*` 等语义类，主题切换在 <html> 上加/去 'dark'
      // 自动生效，不必为每个组件加 `dark:` 前缀。
      colors: {
        // 表面 4 层：base / raised / inset / float (F054)
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
        'surface-4': 'rgb(var(--surface-4) / <alpha-value>)',
        // 文字主/次/弱/faint
        'fg-primary': 'rgb(var(--fg-primary) / <alpha-value>)',
        'fg-secondary': 'rgb(var(--fg-secondary) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-faint': 'rgb(var(--fg-faint) / <alpha-value>)',
        // 边框
        'border-default': 'rgb(var(--border-default) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        // hover 背景
        'hover-bg': 'rgb(var(--hover-bg) / <alpha-value>)',
        // 单一品牌强调色：fill / ink(文字) / fg(fill 上的字) (F054)
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        // 语义调色板 (F054 #1：收编彩虹字面色，每色一义)
        ok: 'rgb(var(--ok) / <alpha-value>)',
        run: 'rgb(var(--run) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        thinking: 'rgb(var(--thinking) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      boxShadow: {
        // 强调按钮辉光 (hero CTA 专用) (F054)
        accent: '0 2px 8px var(--accent-glow), inset 0 1px 0 rgb(255 255 255 / 0.28)',
        'accent-lg': '0 4px 13px var(--accent-glow), inset 0 1px 0 rgb(255 255 255 / 0.36)',
      },
    },
  },
  plugins: [],
};
