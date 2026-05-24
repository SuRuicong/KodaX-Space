// E2E: 全局 UI 交互 smoke — keyboard shortcuts + popovers
//
// 用一个 Electron 实例跑完整套交互验证，避免反复 cold start。验证项：
//   1. ? 打开 / Esc 关闭 HelpOverlay
//   2. Ctrl+\ 切换 focus mode（左右侧栏被隐藏 + breadcrumb 出现 ↗ Focus 退出 chip）
//   3. Shift+Tab 在 input 框外循环 permission mode（plan → accept-edits → auto）
//   4. Alt+M 切换 agent mode（AMA ⇄ SA）+ 持久化到 LS
//   5. Ctrl+T 循环 reasoning mode + 持久化到 LS
//   6. 输入框打 / 弹 slash popover；Esc 关
//   7. Ctrl+F 在 transcript 上打开 search overlay；Esc 关
//
// 每步只校验"可见性 + LS 副作用"，不点击执行 — 行为正确性由各自 unit + 已有 E2E 兜底。

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function main() {
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
  await win.waitForTimeout(1500);

  // 清掉所有 mode LS 让默认值生效
  await win.evaluate(() => {
    localStorage.removeItem('kodax-space.pendingPermissionMode');
    localStorage.removeItem('kodax-space.pendingReasoningMode');
    localStorage.removeItem('kodax-space.pendingAgentMode');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // body focus 落到非 input 才能让 ? / Ctrl+\ / Shift+Tab 生效（避免 textarea 吞键）
  async function focusBody() {
    await win.evaluate(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body) (ae instanceof HTMLElement) && ae.blur();
      document.body.focus();
    });
  }

  // ---- 1. Help overlay ----
  await focusBody();
  // Playwright keyboard.press('?') 直传 key='?'；body 上 dispatch 让 isInputContext 判定为 false
  await win.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
  });
  await win.waitForTimeout(300);
  const helpVisible = await win.locator('text=Keyboard shortcuts').first().isVisible().catch(() => false);
  console.log(`[e2e] help overlay visible after ?: ${helpVisible}`);
  if (!helpVisible) throw new Error('? did not open HelpOverlay');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  const helpClosed = !(await win.locator('text=Keyboard shortcuts').first().isVisible().catch(() => false));
  if (!helpClosed) throw new Error('Esc did not close HelpOverlay');
  console.log('[e2e] ✓ HelpOverlay open / close');

  // ---- 2. Focus mode (Ctrl+\) ----
  await focusBody();
  // 首先确保 right sidebar 开着（让 hidden 状态可观测）
  await win.evaluate(() => localStorage.setItem('kodax-space.rightSidebarOpen', '1'));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1200);

  const leftBefore = await win.locator('aside button:has-text("Coder")').first().isVisible().catch(() => false);
  if (!leftBefore) throw new Error('left sidebar should be visible before focus mode');

  await win.keyboard.press('Control+\\');
  await win.waitForTimeout(400);
  const leftHidden = !(await win.locator('aside button:has-text("Coder")').first().isVisible().catch(() => false));
  const focusChipVisible = await win.locator('button[title*="Exit focus mode"]').first().isVisible().catch(() => false);
  console.log(`[e2e] focus mode — left hidden: ${leftHidden} · focus chip visible: ${focusChipVisible}`);
  if (!leftHidden || !focusChipVisible) throw new Error('Ctrl+\\ focus mode failed');

  // Ctrl+\ 再切回来
  await win.keyboard.press('Control+\\');
  await win.waitForTimeout(400);
  const leftBack = await win.locator('aside button:has-text("Coder")').first().isVisible().catch(() => false);
  if (!leftBack) throw new Error('Ctrl+\\ second toggle did not restore sidebars');
  console.log('[e2e] ✓ Ctrl+\\ focus mode toggle');

  // ---- 3. Shift+Tab cycles permission mode ----
  await focusBody();
  const lsBefore = await win.evaluate(() => localStorage.getItem('kodax-space.pendingPermissionMode'));
  await win.keyboard.press('Shift+Tab');
  await win.waitForTimeout(300);
  const lsAfter1 = await win.evaluate(() => localStorage.getItem('kodax-space.pendingPermissionMode'));
  console.log(`[e2e] Shift+Tab cycle: ${lsBefore} → ${lsAfter1}`);
  if (lsAfter1 === lsBefore) throw new Error('Shift+Tab did not change permission mode');
  await win.keyboard.press('Shift+Tab');
  await win.keyboard.press('Shift+Tab');
  await win.waitForTimeout(300);
  const lsAfter3 = await win.evaluate(() => localStorage.getItem('kodax-space.pendingPermissionMode'));
  if (!['plan', 'accept-edits', 'auto'].includes(lsAfter3)) throw new Error('permission mode not in expected enum');
  console.log(`[e2e] ✓ Shift+Tab cycled mode (final=${lsAfter3})`);

  // ---- 4. Alt+M toggles agent mode ----
  await focusBody();
  const agentBefore = await win.evaluate(() => localStorage.getItem('kodax-space.pendingAgentMode'));
  await win.keyboard.press('Alt+m');
  await win.waitForTimeout(300);
  const agentAfter = await win.evaluate(() => localStorage.getItem('kodax-space.pendingAgentMode'));
  console.log(`[e2e] Alt+M cycle: ${agentBefore ?? 'null'} → ${agentAfter}`);
  if (!['ama', 'sa'].includes(agentAfter)) throw new Error('agent mode not in expected enum after Alt+M');
  console.log(`[e2e] ✓ Alt+M toggled agent mode (now=${agentAfter})`);

  // ---- 5. Ctrl+T cycles reasoning mode ----
  await focusBody();
  const reasonBefore = await win.evaluate(() => localStorage.getItem('kodax-space.pendingReasoningMode'));
  await win.keyboard.press('Control+t');
  await win.waitForTimeout(300);
  const reasonAfter = await win.evaluate(() => localStorage.getItem('kodax-space.pendingReasoningMode'));
  console.log(`[e2e] Ctrl+T cycle: ${reasonBefore ?? 'null'} → ${reasonAfter}`);
  if (!['off', 'quick', 'balanced', 'auto', 'deep'].includes(reasonAfter)) {
    throw new Error('reasoning mode not in expected enum after Ctrl+T');
  }
  console.log(`[e2e] ✓ Ctrl+T cycled reasoning mode (now=${reasonAfter})`);

  // ---- 6. 创建 mock session 让 session-dependent UI 可测试 ----
  // SlashCommandPopover / Ctrl+F search 都需要 currentSessionId
  const newBtn = win.locator('button:has-text("New session")').first();
  const newBtnVisible = await newBtn.isVisible().catch(() => false);
  if (!newBtnVisible) throw new Error('+ New session button not found');
  await newBtn.click();
  await win.waitForTimeout(2000); // session.create 走 IPC + provider lookup

  // 校验 currentSessionId 已置位
  const sidNow = await win.evaluate(() => {
    // store 没挂 window，从 DOM 推断 — Recents 列表里应当有 1 条
    return document.querySelectorAll('aside button[title]').length;
  });
  console.log(`[e2e] after + New session, aside button count: ${sidNow}`);

  // ---- 7. Slash popover ----
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('/');
  await win.waitForTimeout(1200);
  const slashItem = await win.locator('text=/mode').first().isVisible().catch(() => false);
  if (!slashItem) {
    await win.screenshot({ path: 'c:/tmp/e2e-slash-fail.png' });
  }
  console.log(`[e2e] slash popover after typing /: ${slashItem}`);
  if (!slashItem) throw new Error('slash popover did not show /mode (need session)');
  await textarea.fill('');
  await win.waitForTimeout(200);
  console.log('[e2e] ✓ slash popover');

  // ---- 8. Ctrl+F search overlay ----
  await focusBody();
  await win.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true,
    }));
  });
  await win.waitForTimeout(400);
  const searchInput = await win.locator('input[placeholder*="Find in transcript"]').first().isVisible().catch(() => false);
  console.log(`[e2e] Ctrl+F search input visible: ${searchInput}`);
  if (!searchInput) throw new Error('Ctrl+F did not open search overlay');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  const searchClosed = !(await win.locator('input[placeholder*="Find in transcript"]').first().isVisible().catch(() => false));
  if (!searchClosed) throw new Error('Esc did not close search overlay');
  console.log('[e2e] ✓ Ctrl+F search overlay open / close');

  await app.close();
  console.log('[e2e] PASS');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
