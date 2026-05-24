// E2E: RightSidebar — 三块 section（Progress / Working folder / Context），可收起
//
// 验证：
//   1. 默认开 → 三块 section 标题都能找到
//   2. Working folder 显示当前 project basename
//   3. 点 breadcrumb 行 toggle → 整列 0 占位（不再保留 strip）
//   4. 再点同一 toggle → 恢复
//   5. localStorage 持久化偏好

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/right-sidebar';
fs.mkdirSync(SHOT_DIR, { recursive: true });

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

    // 把 LS rightSidebarOpen 重置（清除上次测试残留），然后 reload
    await win.evaluate(() => {
      window.localStorage.removeItem('kodax-space.rightSidebarOpen');
    });
    await win.reload();
    await win.waitForLoadState('domcontentloaded');

    // 等 Progress section 标题出现（默认开）
    await win.locator('text=Progress').first().waitFor({ timeout: 10_000 });
    console.log('[e2e] ✓ Progress section visible');

    await win.locator('text=Working folder').first().waitFor({ timeout: 5_000 });
    console.log('[e2e] ✓ Working folder section visible');

    await win.locator('text=Context').first().waitFor({ timeout: 5_000 });
    console.log('[e2e] ✓ Context section visible');

    // 验证 Working folder 显示项目名（应当从 lastUsedAt 恢复 KodaX-Space）
    const projName = await win.evaluate(() => {
      // 找含项目路径的元素：用 monospace path 文本
      const spans = Array.from(document.querySelectorAll('span'));
      for (const s of spans) {
        const t = s.textContent ?? '';
        if (/KodaX-Space|kodax_workspace/i.test(t) && t.length < 100) return t.trim();
      }
      return null;
    });
    console.log(`[e2e] working folder project text: ${JSON.stringify(projName)}`);
    if (!projName || !/KodaX-Space|kodax_workspace/i.test(projName)) {
      console.error('[e2e] FAIL: project name not found in right sidebar');
      exitCode = 1;
    } else {
      console.log('[e2e] ✓ Working folder shows current project name');
    }

    await win.screenshot({ path: path.join(SHOT_DIR, 'open.png'), fullPage: true });

    // 点击 breadcrumb 行的 toggle (aria-label="Hide right sidebar")
    const toggleBtn = win.locator('button[aria-label="Hide right sidebar"]');
    await toggleBtn.click();
    // 收起后 Progress text 不应再可见
    await win.locator('text=Progress').first().waitFor({ state: 'hidden', timeout: 5_000 });
    console.log('[e2e] ✓ collapsed (Progress hidden)');

    // 同一按钮变为 "Show right sidebar"
    const showBtn = win.locator('button[aria-label="Show right sidebar"]');
    await showBtn.waitFor({ timeout: 5_000 });
    console.log('[e2e] ✓ topbar toggle now shows "Show right sidebar"');

    // 检验 localStorage 写入
    const lsValue = await win.evaluate(() => window.localStorage.getItem('kodax-space.rightSidebarOpen'));
    if (lsValue !== '0') {
      console.error(`[e2e] FAIL: localStorage rightSidebarOpen should be "0", got ${JSON.stringify(lsValue)}`);
      exitCode = 1;
    } else {
      console.log('[e2e] ✓ localStorage persisted (rightSidebarOpen=0)');
    }

    await win.screenshot({ path: path.join(SHOT_DIR, 'collapsed.png'), fullPage: true });

    // 展开 → Progress 回来
    await showBtn.click();
    await win.locator('text=Progress').first().waitFor({ timeout: 5_000 });
    console.log('[e2e] ✓ re-opened');
  } catch (err) {
    console.error('[e2e] error:', err);
    exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }

  if (exitCode === 0) console.log('[e2e] PASS');
  else console.error('[e2e] FAILED');
  process.exit(exitCode);
}

main();
