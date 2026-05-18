// Build Electron main + preload with esbuild.
//
// 输出：
//   dist-electron/main.js
//   dist-electron/preload.js
//
// main 进程为 CommonJS（Electron 当前更稳定）；preload sandbox 模式下也必须 CJS。

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'apps/desktop/electron');
const outDir = path.join(root, 'dist-electron');

fs.mkdirSync(outDir, { recursive: true });

// 根 package.json 是 "type": "module"，但 esbuild 这里输出 CJS。
// 在 dist-electron/ 放一个 package.json 把该目录标记为 CommonJS，
// 否则 Node 会按扩展名 .js + 父级 type=module 误判为 ESM。
// 注意：必须带 "main"，否则 Electron 会把入口当作非主进程脚本，
// 此时 require('electron') 仅返回 electron.exe 路径字符串而非 API 模块。
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: 'kodax-space-main', type: 'commonjs', main: 'main.js' }, null, 2) + '\n',
);

const watch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV !== 'production';

/** @type {esbuild.BuildOptions} */
const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  // keytar 是原生模块（native binding），不能被 esbuild bundle；
  // 必须保持 require('keytar') 在运行时由 Node module 解析。
  // electron-builder 打包时会把 node_modules/keytar/build/Release/keytar.node 一并塞进。
  //
  // @kodax-ai/kodax 标 external：bundle 进 main.js 会让 main.js 从 880KB 涨到 53MB
  // （KodaX 自带 React/Ink/openai-sdk/anthropic-sdk 等大依赖）。external 后 require 时
  // 直接走 node_modules，electron-builder 把整个 @kodax-ai/kodax 塞进 asar——大小没变
  // 但 main.js 启动快很多，dev watch 重 bundle 也快。
  external: ['electron', 'keytar', '@kodax-ai/kodax', '@kodax-ai/kodax/coding'],
  logLevel: 'info',
};

async function buildOne(entry, outfile) {
  /** @type {esbuild.BuildOptions} */
  const opts = {
    ...sharedOptions,
    entryPoints: [entry],
    outfile,
  };

  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log(`[build-main] watching ${path.basename(entry)}`);
  } else {
    await esbuild.build(opts);
    console.log(`[build-main] built ${path.relative(root, outfile)}`);
  }
}

await Promise.all([
  buildOne(path.join(electronDir, 'main.ts'), path.join(outDir, 'main.js')),
  buildOne(path.join(electronDir, 'preload.ts'), path.join(outDir, 'preload.js')),
]);

if (!watch) {
  console.log('[build-main] done');
}
