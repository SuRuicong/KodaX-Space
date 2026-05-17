// Post-build smoke check for installer artifacts (F010).
//
// 跑在 electron-builder 之后；目标：
//   1. 安装包文件存在
//   2. 文件大小 < 200 MB（F010 验收硬指标）
//   3. asar 内核心文件齐全（main.js / preload.js / renderer index.html）
//
// 不做：实际 install / launch—— Windows 上 NSIS 安装包是 GUI 流程，CI 里 driver 困难。
// 真正"装 → 启 → 退"的 e2e 留 v0.1.0-rc.1 用 spectron 或 playwright-electron 做（F010 设计 step 5）。
//
// 这层 smoke 抓的是 build 配置漂移：忘了 bundle main.js / files glob 把 dist 排除 / 误塞超大依赖。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'out');
const SIZE_LIMIT_BYTES = 200 * 1024 * 1024;

function fail(msg) {
  console.error(`[smoke-pack] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[smoke-pack] OK: ${msg}`);
}

async function findInstaller() {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (err) {
    fail(`out/ directory not found: ${err.message}`);
  }
  // 平台对应：Win .exe / mac .dmg / Linux .AppImage (future)
  const candidates = entries.filter((name) =>
    /\.(exe|dmg|AppImage|deb|zip)$/i.test(name) && !/^builder-/.test(name),
  );
  if (candidates.length === 0) {
    fail(`no installer artifact in out/ (entries: ${entries.join(', ') || 'empty'})`);
  }
  return candidates.map((name) => path.join(outDir, name));
}

async function checkSize(installerPath) {
  const stat = await fs.stat(installerPath);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  if (stat.size > SIZE_LIMIT_BYTES) {
    fail(`${path.basename(installerPath)} is ${mb} MB — exceeds 200 MB cap`);
  }
  ok(`${path.basename(installerPath)} = ${mb} MB (< 200 MB cap)`);
}

async function checkAsarContents() {
  // electron-builder 把 app.asar 放在不同位置：
  //   Win unpacked: out/win-unpacked/resources/app.asar
  //   mac unpacked: out/mac/KodaX Space.app/Contents/Resources/app.asar
  //   universal: out/mac-universal/KodaX Space.app/Contents/Resources/app.asar
  const candidates = [
    path.join(outDir, 'win-unpacked', 'resources', 'app.asar'),
    path.join(outDir, 'mac', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-arm64', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-universal', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
  ];
  let asarPath = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      asarPath = candidate;
      break;
    } catch {
      // try next
    }
  }
  if (!asarPath) {
    fail(`app.asar not found in any expected location (checked: ${candidates.join(', ')})`);
  }
  ok(`app.asar located at ${asarPath}`);

  // 用 @electron/asar 的程序化 API 列内容——避免 spawn .cmd 的 Windows EUNKNOWN 坑
  // electron-builder 传递依赖了 @electron/asar
  let files = [];
  try {
    const asar = await import('@electron/asar');
    const list = asar.listPackage(asarPath);
    files = list;
  } catch (err) {
    // fallback：尝试 spawn asar CLI（shell: true on Windows for .cmd 兼容）
    const asarBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
    const result = spawnSync(asarBin, ['list', asarPath], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      fail(
        `asar list failed: programmatic (${err.message}) + CLI (status=${result.status}, ` +
          `stderr=${result.stderr || 'empty'})`,
      );
    }
    files = result.stdout.split(/\r?\n/);
  }
  // 跨平台归一化：asar list 在 Windows 上返回 `\dist-electron\main.js`
  const normalized = files.map((f) => f.replace(/\\/g, '/'));
  const required = [
    '/dist-electron/main.js',
    '/dist-electron/preload.js',
    '/apps/desktop/dist/index.html',
    '/package.json',
  ];
  for (const req of required) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(`required file missing from asar: ${req}`);
    }
    ok(`asar contains ${req}`);
  }

  // 反例：node_modules/**/test/** 不该进
  const leaks = normalized.filter((f) => /\/(test|tests|__tests__|docs|examples?)\//.test(f));
  if (leaks.length > 0) {
    console.warn(`[smoke-pack] WARN: ${leaks.length} test/docs/examples paths leaked into asar (first 5):`);
    leaks.slice(0, 5).forEach((f) => console.warn(`  - ${f}`));
  } else {
    ok('no test/docs/examples leaked into asar');
  }
}

async function main() {
  const installers = await findInstaller();
  for (const installer of installers) {
    await checkSize(installer);
  }
  await checkAsarContents();
  console.log('\n[smoke-pack] all checks passed');
}

main().catch((err) => {
  console.error('[smoke-pack] uncaught error:', err);
  process.exit(1);
});
