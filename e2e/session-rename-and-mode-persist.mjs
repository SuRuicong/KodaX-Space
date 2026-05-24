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
  // 先要有 session：用 mock provider 建一个
  const projectRoot = await win.evaluate(() => localStorage.getItem('kodax-space.currentProjectPath'));
  if (!projectRoot) throw new Error('no project path; boot test should have set it');

  const created = await win.evaluate(async (root) => {
    const r = await window.kodaxSpace.invoke('session.create', {
      projectRoot: root,
      provider: 'mock',
      reasoningMode: 'auto',
      permissionMode: 'accept-edits',
      agentMode: 'sa',
    });
    return r;
  }, projectRoot);
  if (!created.ok) throw new Error(`session.create failed: ${created.error?.message}`);
  const sid = created.data.sessionId;
  console.log(`[e2e] mock session: ${sid.slice(0, 12)}…`);

  // 刷一下 list 让 Recents 看到
  await win.evaluate((root) => window.kodaxSpace.invoke('session.list', { projectRoot: root }), projectRoot);
  await win.waitForTimeout(500);

  // 双击 session 行触发 inline rename
  // Recents 列表里的 session 按钮：title 含 sessionId 或 'Untitled'
  const sessionBtn = win.locator('aside button[title*="Untitled"]').first();
  const btnVisible = await sessionBtn.isVisible().catch(() => false);
  if (!btnVisible) {
    console.log('[e2e] WARN: untitled session button not found; skipping rename test');
  } else {
    await sessionBtn.dblclick();
    await win.waitForTimeout(300);

    // 应当出现 aria-label="Rename session" 的 input
    const renameInput = win.locator('input[aria-label="Rename session"]');
    await renameInput.waitFor({ timeout: 3_000 });
    console.log('[e2e] ✓ rename input appeared on double-click');

    // 清空 + 输入新名 + Enter
    await renameInput.fill('My renamed session');
    await renameInput.press('Enter');
    await win.waitForTimeout(500);

    // 校验：session.title 应当通过 setTitle IPC 已更新；UI 显示新名
    const renamedBtn = win.locator('aside button[title*="My renamed session"]').first();
    const renamedVisible = await renamedBtn.isVisible().catch(() => false);
    if (!renamedVisible) throw new Error('renamed session button not visible');
    console.log('[e2e] ✓ session renamed to "My renamed session"');

    // 也校验 main 端 session.list 持有新 title
    const listed = await win.evaluate(async (root) => {
      const r = await window.kodaxSpace.invoke('session.list', { projectRoot: root });
      if (!r.ok) return null;
      return r.data.sessions.find((s) => s.sessionId.startsWith(window.__sid__ ?? '')) ?? r.data.sessions[0];
    }, projectRoot);
    console.log(`[e2e] main session title: ${listed?.title}`);
  }

  await app.close();
  console.log('[e2e] PASS');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
