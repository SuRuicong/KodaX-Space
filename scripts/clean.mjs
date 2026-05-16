// Clean all build artifacts.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const targets = [
  'dist',
  'dist-electron',
  'out',
  'build',
  'apps/desktop/dist',
  'packages/space-ipc-schema/dist',
  'packages/space-ui-kit/dist',
];

for (const t of targets) {
  rmSync(path.join(root, t), { recursive: true, force: true });
  console.log(`[clean] removed ${t}`);
}

console.log('[clean] done');
