// Dev orchestrator:
//   1) 启动 Vite dev server (renderer)
//   2) esbuild watch main + preload
//   3) 等 Vite 就绪后 spawn electron 指向 dev server URL
//
// Ctrl+C 退出时清理子进程树（Windows 必须 taskkill /t — 否则 cmd.exe wrapper 被杀掉但
// 真正的 vite / esbuild node 子进程作为孤儿继续运行，持有终端 stdin 让 PowerShell 退回
// raw mode，backspace 显示成 ^H、Ctrl+C 显示成 ^C）。

import { spawn, spawnSync } from 'node:child_process';
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
  // **stdin 一律 'ignore'**（之前默认 'inherit' 是地雷）：
  //   - Electron child Windows ConPTY：'inherit' 会让 child 持有 parent stdin handle，
  //     console routing 诡异；KodaX 团队 probe 12 步验证与 SDK 无关，是 Electron+ConPTY quirk。
  //   - Vite / esbuild：'inherit' 让它们读 parent stdin → Vite 启用 readline raw-mode
  //     ("press h + enter" 交互)，dev.mjs 退出时若没 tree-kill，孤儿 vite 仍持 stdin，
  //     PowerShell 看到的就是 raw mode（backspace=^H、Ctrl+C=^C）。
  // 调用方仍可 opts.stdinMode='inherit' 显式覆盖（目前没人用到）。
  const stdinMode = opts.stdinMode ?? 'ignore';
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

/**
 * Windows tree-kill via taskkill /t /f。
 * proc.kill() 只 SIGTERM cmd.exe wrapper，真正的 node/vite 子进程作为孤儿继续运行 →
 * 持有终端 stdin → PowerShell 退回 raw mode。taskkill /t 递归杀整棵进程树。
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM'); // POSIX: kill 进程组
    } catch {
      // 没分组就单杀
      try { process.kill(pid, 'SIGTERM'); } catch { /* gone already */ }
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of procs) {
    killTree(proc.pid);
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Vite dev server
spawnProc('vite', 'npm', ['run', 'dev', '-w', '@kodax-space/desktop']);

// 2. esbuild watch —— 显式传 NODE_ENV=development，让 build-main 出带 sourcemap 的 dev 产物。
//    build-main 默认 production，不靠外层 shell；dev 调试体验靠这里显式开启。
spawnProc('esbuild', 'node', ['scripts/build-main.mjs', '--watch'], { NODE_ENV: 'development' });

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
    // stdinMode 默认就是 'ignore'，留参数显式可读
    { stdinMode: 'ignore' },
  );
} catch (err) {
  console.error('[dev] failed:', err);
  shutdown(1);
}
