// E2E: inline session rename + mode persistence
//
// 1) Mode persistence — 切换 permission/agent/reasoning 后写入 localStorage；reload 后保留
// 2) Inline rename — 双击 session 行进入 inline edit；Enter 提交 → session.setTitle IPC

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

  // ---- Test 1: Permission mode persistence ----
  // 清掉 LS 让默认生效
  await win.evaluate(() => {
    localStorage.removeItem('kodax-space.pendingPermissionMode');
    localStorage.removeItem('kodax-space.pendingReasoningMode');
    localStorage.removeItem('kodax-space.pendingAgentMode');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 打开 ModeSelector，选 plan
  // ModeSelector 按钮: button title 含 "Mode:"
  const modeBtn = win.locator('button[title*="Mode"]').first();
  await modeBtn.click();
  await win.waitForTimeout(300);
  await win.locator('button:has-text("Plan")').first().click();
  await win.waitForTimeout(400);

  // 校验 localStorage
  const lsPerm = await win.evaluate(() => localStorage.getItem('kodax-space.pendingPermissionMode'));
  console.log(`[e2e] localStorage pendingPermissionMode after pick: ${lsPerm}`);
  if (lsPerm !== 'plan') throw new Error(`expected pendingPermissionMode='plan', got ${lsPerm}`);

  // reload — 偏好仍在
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);
  const lsPermAfterReload = await win.evaluate(() => localStorage.getItem('kodax-space.pendingPermissionMode'));
  if (lsPermAfterReload !== 'plan') throw new Error('permission mode lost after reload');
  console.log('[e2e] ✓ permission mode persisted across reload');

  // Mode chip 显示 "Plan (next)" — 无 session 时
  const modeBtnAfterReload = win.locator('button[title*="Plan"]').first();
  const visible = await modeBtnAfterReload.isVisible().catch(() => false);
  console.log(`[e2e] Plan chip visible after reload: ${visible}`);
  if (!visible) throw new Error('Plan mode chip not visible after reload');

  // 切回 accept-edits 让后续测试不受影响
  await win.locator('button[title*="Plan"]').first().click();
  await win.waitForTimeout(200);
  await win.locator('button:has-text("Accept edits")').first().click();
  await win.waitForTimeout(300);

  // ---- Test 2: Inline session rename ----
  // 通过点击 "+ New session" 让 store 走完整 setSessions 路径，session 自然进 Recents
  const newBtn = win.locator('button:has-text("New session")').first();
  await newBtn.waitFor({ timeout: 5_000 });
  await newBtn.click();
  await win.waitForTimeout(2500); // 等 session.create + session.list 回写

  // 找最新创建的 session 行：title 含 'Untitled' 或 session id 前缀
  // Recents 列表 button title 是 `${session.title ?? session.sessionId} (double-click to rename)`
  const untitled = win.locator('aside button[title*="Untitled"]').first();
  const sidTitled = win.locator('aside button[title*="double-click to rename"]').first();
  const sessionBtn = (await untitled.isVisible().catch(() => false)) ? untitled : sidTitled;
  const btnVisible = await sessionBtn.isVisible().catch(() => false);
  if (!btnVisible) throw new Error('newly created session row not found in Recents');

  await sessionBtn.dblclick();
  await win.waitForTimeout(400);

  // 应当出现 aria-label="Rename session" 的 input
  const renameInput = win.locator('input[aria-label="Rename session"]');
  await renameInput.waitFor({ timeout: 3_000 });
  console.log('[e2e] ✓ rename input appeared on double-click');

  // 输入新名 + Enter
  await renameInput.fill('My renamed session');
  await renameInput.press('Enter');
  await win.waitForTimeout(800);

  // 校验：UI 显示新名
  const renamedBtn = win.locator('aside button[title*="My renamed session"]').first();
  const renamedVisible = await renamedBtn.isVisible().catch(() => false);
  if (!renamedVisible) throw new Error('renamed session button not visible after Enter');
  console.log('[e2e] ✓ session renamed in UI to "My renamed session"');

  // 也校验 main 端 session.list 持有新 title
  const projectRoot = await win.evaluate(() => localStorage.getItem('kodax-space.currentProjectPath'));
  const listed = await win.evaluate(async (root) => {
    const r = await window.kodaxSpace.invoke('session.list', { projectRoot: root });
    if (!r.ok) return null;
    return r.data.sessions.map((s) => ({ id: s.sessionId.slice(0, 12), title: s.title }));
  }, projectRoot);
  console.log(`[e2e] main session.list titles: ${JSON.stringify(listed)}`);
  const found = (listed ?? []).find((x) => x.title === 'My renamed session');
  if (!found) throw new Error('main session.list does not have the new title');
  console.log('[e2e] ✓ rename persisted to main via session.setTitle IPC');

  await app.close();
  console.log('[e2e] PASS');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
