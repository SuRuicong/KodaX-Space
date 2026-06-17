// E2E: 浏览器式整窗缩放（v0.1.11）
//
// 验证（全部走真实 Electron webFrame，经 preload bridge）：
//   1. 初始 zoom = 100%（localStorage 清空后）
//   2. Ctrl+滚轮 上滚 → 放大（webFrame.getZoomFactor 增大 + localStorage 持久化）
//   3. ▤ 菜单里的 Zoom 行 −/+/百分比 复位（若菜单可见）
//   4. Ctrl+0 → 复位 100%
//   5. 设一个非 100% 系数 → reload → 开屏自动恢复（持久化生效）

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/zoom';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const getZoom = (win) => win.evaluate(() => window.kodaxSpace?.zoom?.get?.() ?? null);
const getLs = (win) => win.evaluate(() => localStorage.getItem('kodax.zoomFactor'));
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

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

  // 清掉缩放偏好让默认 100% 生效，reload 让 applyPersisted 跑一遍干净基线
  await win.evaluate(() => localStorage.removeItem('kodax.zoomFactor'));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 1) 初始 100%
  const z0 = await getZoom(win);
  console.log(`[e2e] initial zoom factor: ${z0}`);
  if (z0 === null) throw new Error('window.kodaxSpace.zoom bridge missing (preload not exposing zoom)');
  if (!near(z0, 1)) throw new Error(`expected initial zoom 1, got ${z0}`);

  // 2) Ctrl+滚轮 上滚两次 → ~1.2
  await win.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, cancelable: true, bubbles: true }),
      );
    }
  });
  await win.waitForTimeout(300);
  const zWheel = await getZoom(win);
  const lsWheel = await getLs(win);
  console.log(`[e2e] after Ctrl+wheel x2 — zoom: ${zWheel}, localStorage: ${lsWheel}`);
  if (!near(zWheel, 1.2)) throw new Error(`expected ~1.2 after wheel, got ${zWheel}`);
  if (!near(Number.parseFloat(lsWheel), 1.2)) throw new Error(`localStorage not persisted: ${lsWheel}`);
  await win.screenshot({ path: `${SHOT_DIR}/01-wheel-zoomed.png` });

  // 3) ▤ 菜单 Zoom 行（若可见）：点 + 一次 → ~1.3，点百分比复位 → 1.0
  let menuTested = false;
  await win.keyboard.press('Control+o').catch(() => {});
  await win.waitForTimeout(300);
  const zoomInBtn = win.locator('button[aria-label="Zoom in"]').first();
  if (await zoomInBtn.isVisible().catch(() => false)) {
    menuTested = true;
    await zoomInBtn.click();
    await win.waitForTimeout(150);
    const zMenuIn = await getZoom(win);
    console.log(`[e2e] menu "+" → zoom: ${zMenuIn}`);
    if (!near(zMenuIn, 1.3)) throw new Error(`expected ~1.3 after menu +, got ${zMenuIn}`);
    await win.screenshot({ path: `${SHOT_DIR}/02-menu-zoom-row.png` });

    const resetBtn = win.locator('button[aria-label="Reset zoom to 100%"]').first();
    await resetBtn.click();
    await win.waitForTimeout(150);
    const zMenuReset = await getZoom(win);
    console.log(`[e2e] menu "%" click → reset zoom: ${zMenuReset}`);
    if (!near(zMenuReset, 1)) throw new Error(`expected 1 after menu reset, got ${zMenuReset}`);
    await win.keyboard.press('Escape').catch(() => {});
  } else {
    console.log('[e2e] ▤ menu zoom row not visible in this boot state — skipping menu sub-check');
    // 没菜单也要把 zoom 拉回非 1 给步骤 4 测试
    await win.evaluate(() =>
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, cancelable: true })),
    );
    await win.waitForTimeout(150);
  }

  // 4) Ctrl+0 复位
  await win.keyboard.press('Control+0');
  await win.waitForTimeout(250);
  const zReset = await getZoom(win);
  console.log(`[e2e] after Ctrl+0 — zoom: ${zReset}`);
  if (!near(zReset, 1)) throw new Error(`expected 1 after Ctrl+0, got ${zReset}`);

  // 5) 持久化跨 reload：设 1.4 → reload → 开屏恢复
  await win.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, cancelable: true }));
    }
  });
  await win.waitForTimeout(250);
  const zBeforeReload = await getZoom(win);
  console.log(`[e2e] set before reload — zoom: ${zBeforeReload} (expect ~1.4)`);
  if (!near(zBeforeReload, 1.4)) throw new Error(`expected ~1.4, got ${zBeforeReload}`);

  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);
  const zAfterReload = await getZoom(win);
  const lsAfterReload = await getLs(win);
  console.log(`[e2e] after reload — zoom: ${zAfterReload}, localStorage: ${lsAfterReload}`);
  if (!near(zAfterReload, 1.4)) throw new Error(`persisted zoom not restored after reload: ${zAfterReload}`);
  await win.screenshot({ path: `${SHOT_DIR}/03-persisted-after-reload.png` });

  // 还原成 100% 别污染后续手动开 app
  await win.evaluate(() => localStorage.setItem('kodax.zoomFactor', '1'));

  await app.close();
  console.log(`[e2e] PASS (menu row tested: ${menuTested})`);
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
