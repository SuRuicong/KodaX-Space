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
    },
  },
  plugins: [],
};
