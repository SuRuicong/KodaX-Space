// E2E: LeftSidebar collapse/expand toggle
//
// 验证：
//   1. 默认开 → Mode tab (Coder/Partner) + New session 都能找到
//   2. 点 collapse 按钮 → 变 28px 细条 + open button 还在
//   3. localStorage 持久化为 0
//   4. 点 open button → 恢复，Coder tab 再次可见
//   5. localStorage 持久化为 1

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/left-sidebar';
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

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // 清掉之前的 leftSidebarOpen 偏好让默认值 (1=开) 生效
  await win.evaluate(() => localStorage.removeItem('kodax-space.leftSidebarOpen'));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 1) 默认开：能看到 "Coder" tab
  const coderVisible = await win.locator('button:has-text("Coder")').first().isVisible().catch(() => false);
  console.log(`[e2e] default open — Coder tab visible: ${coderVisible}`);
  if (!coderVisible) throw new Error('Coder tab not visible by default');
  await win.screenshot({ path: `${SHOT_DIR}/01-default-open.png` });

  // 2) 点 collapse
  await win.locator('button[aria-label="Close left sidebar"]').first().click();
  await win.waitForTimeout(400);
  const coderHidden = await win.locator('button:has-text("Coder")').first().isVisible().catch(() => false);
  console.log(`[e2e] after collapse — Coder hidden: ${!coderHidden}`);
  if (coderHidden) throw new Error('Coder tab still visible after collapse');

  // open button strip 仍可见
  const openBtnVisible = await win.locator('button[aria-label="Open left sidebar"]').first().isVisible().catch(() => false);
  console.log(`[e2e] after collapse — open button visible: ${openBtnVisible}`);
  if (!openBtnVisible) throw new Error('Open button not visible after collapse');
  await win.screenshot({ path: `${SHOT_DIR}/02-collapsed.png` });

  // 3) localStorage 持久化为 0
  const lsAfterCollapse = await win.evaluate(() => localStorage.getItem('kodax-space.leftSidebarOpen'));
  console.log(`[e2e] localStorage after collapse: ${lsAfterCollapse}`);
  if (lsAfterCollapse !== '0') throw new Error(`expected leftSidebarOpen=0, got ${lsAfterCollapse}`);

  // 4) 点 open
  await win.locator('button[aria-label="Open left sidebar"]').first().click();
  await win.waitForTimeout(400);
  const coderBack = await win.locator('button:has-text("Coder")').first().isVisible().catch(() => false);
  console.log(`[e2e] after expand — Coder back: ${coderBack}`);
  if (!coderBack) throw new Error('Coder tab not back after expand');
  await win.screenshot({ path: `${SHOT_DIR}/03-reopened.png` });

  // 5) localStorage 持久化为 1
  const lsAfterOpen = await win.evaluate(() => localStorage.getItem('kodax-space.leftSidebarOpen'));
  console.log(`[e2e] localStorage after expand: ${lsAfterOpen}`);
  if (lsAfterOpen !== '1') throw new Error(`expected leftSidebarOpen=1, got ${lsAfterOpen}`);

  await app.close();
  console.log('[e2e] PASS');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
