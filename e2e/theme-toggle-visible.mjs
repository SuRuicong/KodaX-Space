// E2E: ThemeToggle 按钮必须在窗口可视区内，不被 Windows OS 的 titleBarOverlay
// (close/min/max ~138px on the right) 盖住。
//
// 历史 bug：titlebar 没给右侧留位，ThemeToggle 用 flex-1 推到最右 → 落在 OS
// 按钮区下面，用户找不到。CSS 加 .platform-win32 .app-titlebar { padding-right: 144px }
// 修复。本测试 guard 那个 padding 不被回归。

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/theme-toggle';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const OS_OVERLAY_WIDTH = 138; // Windows 默认 close/min/max 三键栏 ~138px

async function main() {
  console.log('[e2e] launching Electron…');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron')],
    cwd: repoRoot,
    env: { ...childEnv, NODE_ENV: 'production' },
    timeout: 30_000,
  });

  let exitCode = 0;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    console.log('[e2e] window loaded.');

    // 等 ThemeToggle 渲染出来。button 的 title=`Theme: <label> (⇧Ctrl+T)`，
    // 用 title 前缀稳定匹配（不依赖具体 label 文字）。
    const btn = win.locator('button[title^="Theme:"]');
    await btn.waitFor({ timeout: 10_000 });
    console.log('[e2e] ThemeToggle button found.');

    const box = await btn.boundingBox();
    const innerWidth = await win.evaluate(() => window.innerWidth);
    console.log(`[e2e] window.innerWidth=${innerWidth}`);
    console.log(`[e2e] ThemeToggle bbox: ${JSON.stringify(box)}`);

    if (!box) {
      console.error('[e2e] FAIL: ThemeToggle has no bounding box (display:none?)');
      exitCode = 1;
    } else {
      // 按钮的 right 边必须落在 OS overlay 之前
      const right = box.x + box.width;
      const visibleRightLimit = innerWidth - OS_OVERLAY_WIDTH;
      console.log(`[e2e] button.right=${right}, visibleRightLimit=${visibleRightLimit}`);
      if (right > visibleRightLimit) {
        console.error(
          `[e2e] FAIL: ThemeToggle right edge (${right}) is beyond visibleRightLimit ` +
            `(${visibleRightLimit}) — covered by OS close/min/max overlay`,
        );
        exitCode = 1;
      } else {
        console.log('[e2e] ✓ ThemeToggle 在可视区内');
      }
    }

    // 同时验证 click 能展开 dropdown — 这部分独立于位置，逻辑层面 sanity check
    await btn.click();
    const dropdownOpened = await win.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button')).filter((b) =>
        ['Light', 'Dark', 'System'].some((label) => b.textContent?.includes(label) ?? false),
      );
      return items.length >= 3;
    });
    if (!dropdownOpened) {
      console.error('[e2e] FAIL: clicking ThemeToggle did not show Light/Dark/System options');
      exitCode = 1;
    } else {
      console.log('[e2e] ✓ dropdown 显示 Light / Dark / System');
    }

    await win.screenshot({ path: path.join(SHOT_DIR, 'theme-dropdown.png'), fullPage: true });
  } catch (err) {
    console.error('[e2e] error:', err);
    exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }

  if (exitCode === 0) {
    console.log('[e2e] PASS');
  } else {
    console.error('[e2e] FAILED');
  }
  process.exit(exitCode);
}

main();
