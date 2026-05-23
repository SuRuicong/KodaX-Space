// Dev orchestrator:
//   1) 启动 Vite dev server (renderer)
//   2) esbuild watch main + preload
//   3) 等 Vite 就绪后 spawn electron 指向 dev server URL
//
// Ctrl+C 退出时清理子进程。

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import waitOn from 'wait-on';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const VITE_URL = 'http://127.0.0.1:5173';
const procs = [];
let shuttingDown = false;

function spawnProc(name, cmd, args, env = {}, opts = {}) {
  // ELECTRON_RUN_AS_NODE=1 在外层 shell 出现时，electron 入口会退化成 Node 脚本，
  // require('electron') 仅返回二进制路径，window 永远不弹。强制在子进程剥掉。
  const baseEnv = { ...process.env };
  delete baseEnv.ELECTRON_RUN_AS_NODE;
  // 默认 'inherit' 三流共享 — vite/esbuild 不读 stdin 所以安全。
  //
  // Electron child 在 Windows 上若以 stdio: 'inherit' 启动，会持有 parent stdin handle
  // (即便没人 read)，Windows ConPTY 的 console routing 在这种情况下会变得诡异——
  // 用户在 dev 终端打字 / Ctrl+C 行为不对。这是 Electron+Windows ConPTY 的已知
  // quirk，与 KodaX SDK 无关 (KodaX 团队 probe 验证：import / hydrate / probe 12 步
  // listener Δ=0 / rawMode Δ=0；hydrateProcessEnvFromShell 在 Windows 直接 return false
  // 不 spawn；POSIX 平台 spawn 时也写死 stdio:['ignore','pipe','pipe'] 不碰 parent stdin)。
  // Canonical fix：调用方传 stdinMode='ignore' 让 Electron child 不持有 parent stdin handle。
  const stdinMode = opts.stdinMode ?? 'inherit';
  const proc = spawn(cmd, args, {
    cwd: root,
    stdio: [stdinMode, 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...baseEnv, ...env },
  });
  proc.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[dev] ${name} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
  procs.push({ name, proc });
  return proc;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of procs) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Vite dev server
spawnProc('vite', 'npm', ['run', 'dev', '-w', '@kodax-space/desktop']);

// 2. esbuild watch
spawnProc('esbuild', 'node', ['scripts/build-main.mjs', '--watch']);

// 3. Electron when Vite AND main bundle are both ready.
// 之前用 setTimeout(1500) 等 esbuild 首轮产出——慢机器/CI 上不稳；改成
// 同步 wait 两个资源都就绪。`file:`/`http:` 两种 resource 类型由 wait-on 区分。
try {
  console.log(`[dev] waiting for ${VITE_URL} + dist-electron/main.js ...`);
  await waitOn({
    resources: [VITE_URL, `file:${path.join(root, 'dist-electron/main.js').replace(/\\/g, '/')}`],
    timeout: 60_000,
    interval: 200,
  });
  console.log('[dev] both ready, launching electron');

  spawnProc(
    'electron',
    'npx',
    ['electron', 'dist-electron'],
    {
      VITE_DEV_SERVER_URL: VITE_URL,
      NODE_ENV: 'development',
    },
    { stdinMode: 'ignore' }, // Electron+Windows ConPTY quirk — 见 spawnProc 注释
  );
} catch (err) {
  console.error('[dev] failed:', err);
  shutdown(1);
}
