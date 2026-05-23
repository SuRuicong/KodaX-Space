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
  // Electron 在 KodaX SDK 加载后会让某些 readline / tty 子组件抓住 stdin，
  // 直接 'inherit' 会让 user 的终端键盘"被吃" (typing 在 shell 里看不见 / 行为怪)。
  // 解决：调用方传 stdinMode='ignore' 让 Electron 子进程拿不到 stdin。
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
    { stdinMode: 'ignore' }, // 防 KodaX SDK 内部 readline 抢 user 的 terminal 键盘输入
  );
} catch (err) {
  console.error('[dev] failed:', err);
  shutdown(1);
}
