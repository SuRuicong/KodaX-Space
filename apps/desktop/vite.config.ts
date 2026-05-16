import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite renderer 配置。Electron main 不经 Vite，由 scripts/build-main.mjs 用 esbuild 打包。
export default defineConfig({
  root: __dirname,
  base: './', // Electron file:// 加载时需要相对路径
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  clearScreen: false,
});
