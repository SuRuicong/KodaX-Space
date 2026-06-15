// Minimal Vite build for the artifact-renderer gallery e2e (F059 verification).
// Builds the Space static renderers (Chart/Html/Media) into a standalone page so
// a real browser can prove they render — without the full app / a session.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  logLevel: 'warn',
});
