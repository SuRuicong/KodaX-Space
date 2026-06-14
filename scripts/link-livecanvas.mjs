// link-livecanvas — 把本地 LiveCanvas 仓的消费包挂进 Space 的 node_modules/@livecanvas/*
//
// 背景：Space 的 artifact 层嵌 LiveCanvas 的 sandbox 渲染基底(方案 D，见记忆
// livecanvas_artifact_plan)。LC 仓在 ../../LiveCanvas，包名 @livecanvas/* 是真名
// (不像 KodaX 仓 root name='kodax' 发布时才改)，且各包自带 package.json + exports + 已 build
// 的 dist。所以 link 比 link-kodax 简单：直接 junction 包目录即可，无需 staging + 重写
// package.json。
//
// 当前 v1(路径 D)只需两包：
//   - @livecanvas/sandbox-bridge  父子帧协议 createHost/createChild + Bootstrap schema
//   - @livecanvas/canvas-protocol AgentBackend 接口/ChatChunk(v1b AI-powered artifact 用)
// v2(全嵌 gateway-core，独立进程)再加 gateway-core/gateway-middleware/llm-clients。
//
// ⚠️ 注意：
//   - junction 在 node_modules 内，`npm install` 会冲掉 → 装后重跑 `npm run link:livecanvas`
//     (同 link:kodax 纪律)。
//   - LC 尚未发 npm(0.1.0)→ 打包时不能像 KodaX 那样 swap 成发布版；packaging 路径要等 LC
//     发布或单独处理(记 livecanvas_artifact_plan)。
//   - sandbox-shell-static bundle 不是 npm 包，是静态资源(LC/packages/cli/dist/sandbox-shell-static
//     或 apps/sandbox-shell/out)，由 Space main 在 P1 直接定位/服务，不经本脚本。
//
// 用法：
//   npm run link:livecanvas    # 创建 junction
//   npm run unlink:livecanvas  # 撤回

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPACE_ROOT = path.resolve(__dirname, '..');
const LC_REPO = path.resolve(SPACE_ROOT, '..', '..', 'LiveCanvas');
const SCOPE_DIR = path.join(SPACE_ROOT, 'node_modules', '@livecanvas');

// v1(路径 D)消费包。要扩展(v2 gateway-core 等)在此加。
const PACKAGES = ['sandbox-bridge', 'canvas-protocol'];

const unlinkMode = process.argv.includes('--unlink');

function rimrafSafe(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(p);
    else if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

if (unlinkMode) {
  for (const pkg of PACKAGES) rimrafSafe(path.join(SCOPE_DIR, pkg));
  console.log(`[link-livecanvas] removed @livecanvas/* junctions under ${SCOPE_DIR}`);
  console.log(`[link-livecanvas] run \`npm install --force\` if you also want to restore any published tarball.`);
  process.exit(0);
}

if (!fs.existsSync(LC_REPO)) {
  console.error(`[link-livecanvas] LiveCanvas repo not found at ${LC_REPO}`);
  process.exit(1);
}

fs.mkdirSync(SCOPE_DIR, { recursive: true });
const isWin = process.platform === 'win32';

for (const pkg of PACKAGES) {
  const target = path.join(LC_REPO, 'packages', pkg);
  const link = path.join(SCOPE_DIR, pkg);
  if (!fs.existsSync(target)) {
    console.error(`[link-livecanvas] missing target ${target} — build LC first (cd ${LC_REPO} && npm run build:packages)`);
    process.exit(1);
  }
  const distIndex = path.join(target, 'dist', 'index.js');
  if (!fs.existsSync(distIndex)) {
    console.warn(`[link-livecanvas] WARN: ${pkg}/dist not built — run \`cd ${LC_REPO} && npm run build:packages\``);
  }
  rimrafSafe(link);
  fs.symlinkSync(target, link, isWin ? 'junction' : 'dir');
  console.log(`[link-livecanvas] @livecanvas/${pkg} -> ${target}`);
}

console.log('');
console.log('Live LC iteration: edit LC src → `cd ' + LC_REPO + ' && npm run build:packages` → restart Space dev.');
console.log('Restore after npm install: `npm run link:livecanvas`.');
