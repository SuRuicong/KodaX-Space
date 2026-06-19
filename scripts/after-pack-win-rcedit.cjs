const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appBuilderPath } = require('app-builder-bin');

function valueOrFallback(value, fallback) {
  return value == null || value === '' ? fallback : String(value);
}

async function resolveIconPath(packager) {
  if (typeof packager.getIconPath !== 'function') {
    return null;
  }
  const iconPath = await packager.getIconPath();
  return iconPath && fs.existsSync(iconPath) ? iconPath : null;
}

function getCacheRoots() {
  return [
    process.env.ELECTRON_BUILDER_CACHE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron-builder'),
  ].filter(Boolean);
}

function findCachedRcedit() {
  const binaryName = process.arch === 'ia32' ? 'rcedit-ia32.exe' : 'rcedit-x64.exe';
  const matches = [];

  for (const root of getCacheRoots()) {
    const start = path.join(root, 'winCodeSign');
    if (!fs.existsSync(start)) {
      continue;
    }

    const stack = [start];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name === binaryName) {
          matches.push({ path: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
        }
      }
    }
  }

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.path ?? null;
}

function resolveSevenZipDir() {
  try {
    const packageDir = path.dirname(require.resolve('7zip-bin/package.json'));
    if (process.platform === 'win32') {
      return path.join(packageDir, 'win', process.arch === 'ia32' ? 'ia32' : 'x64');
    }
  } catch {
    return null;
  }
  return null;
}

function runDirectRcedit(rceditPath, args) {
  try {
    execFileSync(rceditPath, args, { stdio: 'pipe' });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const detail = stderr || error.message;
    throw new Error(`[afterPack] rcedit failed: ${detail}`);
  }
}

function bootstrapRcedit(args) {
  const sevenZipDir = resolveSevenZipDir();
  const env = { ...process.env };
  if (sevenZipDir) {
    env.PATH = `${sevenZipDir}${path.delimiter}${env.PATH ?? ''}`;
  }

  try {
    execFileSync(appBuilderPath, ['rcedit', '--args', JSON.stringify(args)], {
      env,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    console.warn('[afterPack] skip Windows exe resource patch: rcedit is only wired for win32/darwin hosts.');
    return;
  }

  const appInfo = context.packager.appInfo;
  const productName = valueOrFallback(appInfo.productName, 'KodaX Space');
  const productFilename = valueOrFallback(appInfo.productFilename, productName);
  const exeFileName = `${productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeFileName);

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] cannot patch Windows exe resources; missing ${exePath}`);
  }

  const shortVersion = valueOrFallback(appInfo.shortVersion, appInfo.version);
  const productVersion = valueOrFallback(
    appInfo.shortVersionWindows,
    typeof appInfo.getVersionInWeirdWindowsForm === 'function'
      ? appInfo.getVersionInWeirdWindowsForm()
      : shortVersion,
  );

  const args = [
    exePath,
    '--set-version-string',
    'FileDescription',
    productName,
    '--set-version-string',
    'ProductName',
    productName,
    '--set-version-string',
    'LegalCopyright',
    valueOrFallback(appInfo.copyright, ''),
    '--set-file-version',
    shortVersion,
    '--set-product-version',
    productVersion,
    '--set-version-string',
    'InternalName',
    path.basename(exeFileName, '.exe'),
    '--set-version-string',
    'OriginalFilename',
    '',
  ];

  if (appInfo.companyName) {
    args.push('--set-version-string', 'CompanyName', String(appInfo.companyName));
  }

  const iconPath = await resolveIconPath(context.packager);
  if (iconPath) {
    args.push('--set-icon', iconPath);
  }

  const cachedRcedit = findCachedRcedit();
  if (cachedRcedit) {
    runDirectRcedit(cachedRcedit, args);
  } else if (!bootstrapRcedit(args)) {
    const bootstrappedRcedit = findCachedRcedit();
    if (!bootstrappedRcedit) {
      throw new Error('[afterPack] failed to locate rcedit after app-builder bootstrap.');
    }
    runDirectRcedit(bootstrappedRcedit, args);
  }

  console.log(`[afterPack] patched Windows exe resources: ${exePath}`);
};
