// pack.mjs — link-safe electron-builder packaging.
//
// 为什么需要这层包装：
//   开发期 `@kodax-ai/kodax` 通常 dev-link 到 ../KodaX（symlink/junction，见 link-kodax.mjs）。
//   electron-builder 有条硬规则——打进 asar 的文件必须在项目根目录之下；而 link 状态下
//   SDK 全部文件 realpath 都在 Space 根之外，会直接抛
//     "C:\...\KodaX\.agent\heap-analysis.cjs must be under C:\...\KodaX-Space\"。
//   即便绕过该报错，也会把 KodaX 私有源码 + .kodax/config.json 密钥打进安装包，
//   违反 HLD §18「不内嵌 KodaX-private 任何代码」。
//
//   唯一正解：打包时 node_modules/@kodax-ai/kodax 必须是发布版实体拷贝，不是 symlink。
//
// 本脚本做法（对开发者无感）：
//   1. 检测 SDK 是否 dev-link（realpath 落在 Space 根之外）
//   2. 若是：记下原 link 目标 → 拆链 → `npm install --force` 装回 package.json 声明的发布版
//   3. 跑 electron-builder（透传平台参数，如 --win / --mac / --linux）
//   4. finally：把原 link 原样重建（无论打包成功失败都恢复联调链路）
//   5. 本来就不是 link（干净 CI/release checkout）→ 直接打包，零额外动作
//
// 用法：node scripts/pack.mjs [electron-builder 透传参数...]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPACE_ROOT = path.resolve(__dirname, '..');
const SDK_DIR = path.join(SPACE_ROOT, 'node_modules', '@kodax-ai', 'kodax');
const ROOT_PREFIX = SPACE_ROOT.endsWith(path.sep) ? SPACE_ROOT : SPACE_ROOT + path.sep;

/**
 * dev-link 判定：SDK 目录的真实路径落在 Space 根之外即为 link。
 * 兼容 Windows junction（lstat 报 isDirectory 而非 isSymbolicLink）——一律用 realpath 判。
 * 返回 { linked, target, type } —— target 为原 link 目标，用于事后原样重建。
 */
function inspectSdkLink() {
  let lstat;
  try {
    lstat = fs.lstatSync(SDK_DIR);
  } catch {
    return { linked: false }; // 没装 SDK，交给 electron-builder 自己报缺依赖
  }
  let real;
  try {
    real = fs.realpathSync(SDK_DIR);
  } catch {
    return { linked: false };
  }
  const linked = !real.startsWith(ROOT_PREFIX);
  if (!linked) return { linked: false };

  // 记录原始 link 目标（symlink 读 readlink；junction 用 realpath）
  let target = real;
  if (lstat.isSymbolicLink()) {
    try {
      target = fs.readlinkSync(SDK_DIR);
    } catch {
      target = real;
    }
  }
  // win32 一律用 'junction' 重建：junction 不需要 SeCreateSymbolicLinkPrivilege，
  // 而 fs.symlinkSync(..., 'dir') 在无管理员/开发者模式时会 EPERM。junction 对 node
  // 模块解析与原 symlink 完全等价（realpath 透传）。非 win32 用 'dir'。
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  return { linked: true, target, type };
}

function run(cmd, args, label, envOverride) {
  console.log(`[pack] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: SPACE_ROOT,
    shell: process.platform === 'win32', // win 下 npm/npx 是 .cmd，需 shell
    // 关键：不强设 NODE_ENV=production。否则 `npm install` 会丢掉 devDependencies
    // （electron / electron-builder），打包随即失败。各步按需传 envOverride。
    env: { ...process.env, ...envOverride },
  });
  if (r.status !== 0) {
    throw new Error(`${label ?? cmd} exited with code ${r.status}`);
  }
}

function restoreLink({ target, type }) {
  // 先清掉刚装上的发布版实体目录，再原样重建 link
  fs.rmSync(SDK_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SDK_DIR), { recursive: true });
  fs.symlinkSync(target, SDK_DIR, type);
  console.log(`[pack] restored dev link: @kodax-ai/kodax → ${target}`);
}

const passthrough = process.argv.slice(2); // e.g. ['--win'] / ['--mac']
const link = inspectSdkLink();

if (!link.linked) {
  // 干净状态：直接打包（CI / 已 unlink 的 release checkout）
  run('npx', ['electron-builder', '-p', 'never', ...passthrough], 'electron-builder');
  process.exit(0);
}

console.log(`[pack] @kodax-ai/kodax is dev-linked (→ ${link.target}).`);
console.log('[pack] swapping to the published tarball for packaging (HLD §18: no KodaX-private code).');

try {
  run('node', ['scripts/link-kodax.mjs', '--unlink'], 'unlink:kodax');
  // NODE_ENV=development + --include=dev：否则(用户 shell 常 export NODE_ENV=production)
  // npm 会丢掉 electron / electron-builder 等 devDeps，打包随即失败。
  run(
    'npm',
    ['install', '--force', '--no-audit', '--no-fund', '--include=dev'],
    'npm install (published SDK)',
    { NODE_ENV: 'development' },
  );
  run('npx', ['electron-builder', '-p', 'never', ...passthrough], 'electron-builder');
} finally {
  try {
    restoreLink(link);
  } catch (err) {
    console.error('[pack] WARN: failed to restore dev link — run `npm run link:kodax` manually.');
    console.error(`[pack]   ${err.message}`);
  }
}
