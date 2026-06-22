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

import { promises as fs, readdirSync } from 'node:fs';
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function keyringNativePatternForAsar(asarPath) {
  const normalizedPath = asarPath.replace(/\\/g, '/');
  if (normalizedPath.includes('/mac-arm64/')) {
    return /keyring\.darwin-arm64\.node$/;
  }
  if (normalizedPath.includes('/mac-universal/')) {
    return /keyring\.darwin-(universal|x64|arm64)\.node$/;
  }
  if (normalizedPath.includes('/mac/')) {
    // electron-builder may use out/mac for a single-arch mac build regardless
    // of the target arch. The DMG artifact name is the reliable release signal.
    const macArtifacts = safeReadOutEntries().filter((name) => /\.dmg$/i.test(name));
    const hasArm64Dmg = macArtifacts.some((name) => /-arm64\.dmg$/i.test(name));
    const hasX64Dmg = macArtifacts.some((name) => /-x64\.dmg$/i.test(name));
    if (hasArm64Dmg && !hasX64Dmg) return /keyring\.darwin-arm64\.node$/;
    if (hasX64Dmg && !hasArm64Dmg) return /keyring\.darwin-x64\.node$/;
    if (process.arch === 'arm64') return /keyring\.darwin-arm64\.node$/;
    if (process.arch === 'x64') return /keyring\.darwin-x64\.node$/;
    return /keyring\.darwin-x64\.node$/;
  }

  if (process.platform === 'win32') {
    if (process.arch === 'x64') return /keyring\.win32-x64-msvc\.node$/;
    if (process.arch === 'arm64') return /keyring\.win32-arm64-msvc\.node$/;
    if (process.arch === 'ia32') return /keyring\.win32-ia32-msvc\.node$/;
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return /keyring\.darwin-x64\.node$/;
    if (process.arch === 'arm64') return /keyring\.darwin-arm64\.node$/;
    return /keyring\.darwin-(universal|x64|arm64)\.node$/;
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return /keyring\.linux-x64-(gnu|musl)\.node$/;
    if (process.arch === 'arm64') return /keyring\.linux-arm64-(gnu|musl)\.node$/;
    if (process.arch === 'arm') return /keyring\.linux-arm-gnueabihf\.node$/;
    if (process.arch === 'riscv64') return /keyring\.linux-riscv64-gnu\.node$/;
  }
  return /keyring\..+\.node$/;
}

function safeReadOutEntries() {
  try {
    return readdirSync(outDir);
  } catch {
    return [];
  }
}

async function findInstaller() {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (err) {
    fail(`out/ directory not found: ${err.message}`);
  }
  // 平台对应：Win .exe / mac .dmg / Linux .AppImage (future)
  const candidates = entries.filter(
    (name) => /\.(exe|dmg|AppImage|deb|zip)$/i.test(name) && !/^builder-/.test(name),
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

async function findAsarPaths() {
  // electron-builder 把 app.asar 放在不同位置：
  //   Win unpacked:   out/win-unpacked/resources/app.asar
  //   mac unpacked:   out/mac/KodaX Space.app/Contents/Resources/app.asar
  //   universal:      out/mac-universal/KodaX Space.app/Contents/Resources/app.asar
  //   Linux unpacked: out/linux-unpacked/resources/app.asar
  const candidates = [
    path.join(outDir, 'win-unpacked', 'resources', 'app.asar'),
    path.join(outDir, 'mac', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-arm64', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'mac-universal', 'KodaX Space.app', 'Contents', 'Resources', 'app.asar'),
    path.join(outDir, 'linux-unpacked', 'resources', 'app.asar'),
  ];
  const asarPaths = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) asarPaths.push(candidate);
  }
  if (asarPaths.length === 0) {
    fail(`app.asar not found in any expected location (checked: ${candidates.join(', ')})`);
  }
  return asarPaths;
}

async function checkAsarContents(asarPath) {
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
    const asarBin = path.join(
      rootDir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'asar.cmd' : 'asar',
    );
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

  // Runtime dependency guards: fail the package smoke when dynamic/native
  // modules needed at app startup are missing from asar or app.asar.unpacked.
  // Keyring is loaded dynamically by the packaged main process; keep a hard
  // smoke guard so provider keys do not silently fall back to memory storage.
  const keyringRequired = [
    '/node_modules/@napi-rs/keyring/keytar.js',
    '/node_modules/@napi-rs/keyring/index.js',
    '/node_modules/@napi-rs/keyring/package.json',
  ];
  for (const req of keyringRequired) {
    if (!normalized.some((f) => f === req || f.endsWith(req))) {
      fail(
        `keychain runtime missing from asar: ${req}. ` +
          'Packaged provider keys will fall back to memory only.',
      );
    }
    ok(`asar contains ${req}`);
  }

  const nativePattern = keyringNativePatternForAsar(asarPath);
  const hasKeyringNativeInAsar = normalized.some(
    (f) => /\/node_modules\/@napi-rs\/keyring-[^/]+\/.+\.node$/.test(f) && nativePattern.test(f),
  );
  const unpackedDir = `${asarPath}.unpacked`;
  const unpackedFiles = (await pathExists(unpackedDir))
    ? (await listFilesRecursive(unpackedDir)).map((f) => f.replace(/\\/g, '/'))
    : [];
  const hasKeyringNativeUnpacked = unpackedFiles.some(
    (f) => /\/node_modules\/@napi-rs\/keyring-[^/]+\/.+\.node$/.test(f) && nativePattern.test(f),
  );
  if (!hasKeyringNativeInAsar && !hasKeyringNativeUnpacked) {
    fail(
      `current-platform @napi-rs/keyring native binding missing (expected ${nativePattern}). ` +
        'Packaged provider keys will fall back to memory only.',
    );
  }
  if (!hasKeyringNativeUnpacked) {
    fail(
      `@napi-rs/keyring native binding is present but not unpacked from asar (expected ${nativePattern}). ` +
        'Native .node modules must live under app.asar.unpacked.',
    );
  }
  ok('@napi-rs/keyring native binding present in app.asar.unpacked');

  // yaml's dist/doc files are runtime code. A previous files glob stripped this
  // directory from node_modules and broke packaged startup.
  const yamlComposer = normalized.some((f) =>
    /\/node_modules\/yaml\/dist\/compose\/composer\.js$/.test(f),
  );
  if (yamlComposer) {
    const yamlDoc = normalized.some((f) =>
      /\/node_modules\/yaml\/dist\/doc\/directives\.js$/.test(f),
    );
    if (!yamlDoc) {
      fail(
        'yaml packed but yaml/dist/doc/directives.js missing — runtime doc/ stripped. ' +
          'Check electron-builder.yml files globs do not exclude **/doc/** under node_modules.',
      );
    }
    ok('yaml/dist/doc/directives.js present (runtime doc/ not stripped)');
  }

  // 只有 jest 约定的 __tests__/__mocks__ 才该被排除；它们若出现说明排除 glob 没生效（仅 WARN，体积问题）。
  // 注意：doc/docs/test/example 这类目录现在是“故意保留”的（可能是包的运行时代码），不再当泄漏报警。
  const leaks = normalized.filter((f) => /\/(__tests__|__mocks__)\//.test(f));
  if (leaks.length > 0) {
    console.warn(
      `[smoke-pack] WARN: ${leaks.length} __tests__/__mocks__ paths leaked into asar (first 5):`,
    );
    leaks.slice(0, 5).forEach((f) => console.warn(`  - ${f}`));
  } else {
    ok('no __tests__/__mocks__ leaked into asar');
  }
}

async function main() {
  const installers = await findInstaller();
  for (const installer of installers) {
    await checkSize(installer);
  }
  for (const asarPath of await findAsarPaths()) {
    await checkAsarContents(asarPath);
  }
  console.log('\n[smoke-pack] all checks passed');
}

main().catch((err) => {
  console.error('[smoke-pack] uncaught error:', err);
  process.exit(1);
});
