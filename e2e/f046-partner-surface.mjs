// E2E smoke (F046): Partner surface 三栏渲染 + Coder↔Partner 切换不白屏。
//
// 验证 F046 的"功能可用"地基真的渲染：
//   1. 默认 Coder 布局（ConversationStream + 输入框）。
//   2. 点 [Partner] tab → PartnerWorkspace 三栏（Sources | 对话 | Artifact）渲染，无白屏。
//   3. Partner 无 session → PartnerWelcome 落地态；输入框（裁剪版 BottomBar）在场。
//   4. 点回 [Coder] → 恢复 Coder 布局。
//
// 不发真 LLM；只验渲染/路由/切换。复用现有 e2e 启动模式（launch dist-electron）。

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

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
  await win.waitForTimeout(2000);

  // 启动时把 surface 强制回 Coder（避免上次持久化到 Partner 干扰本测）。
  await win.evaluate(() => {
    try {
      window.localStorage.setItem('kodax-space.currentSurface', 'code');
    } catch {
      /* ignore */
    }
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 1) 默认 Coder：SurfaceTabs 两个 tab 在场
  const partnerTab = win.locator('aside button', { hasText: 'Partner' }).first();
  const coderTab = win.locator('aside button', { hasText: 'Coder' }).first();
  ok(await partnerTab.isVisible().catch(() => false), '[Partner] tab 可见');
  ok(await coderTab.isVisible().catch(() => false), '[Coder] tab 可见');

  // 2) 切到 Partner
  await partnerTab.click();
  await win.waitForTimeout(1000);

  const bodyText = await win.evaluate(() => document.body.innerText);
  // 注：列头用 CSS text-transform:uppercase，innerText 反映渲染态 → "SOURCES"/"ARTIFACT"。
  // 用小写归一化比较，避免误判。
  const lower = bodyText.toLowerCase();
  ok(lower.includes('doc-workspace'), 'Partner header "doc-workspace" 渲染');
  ok(lower.includes('sources'), '左栏 Sources 渲染');
  ok(lower.includes('artifact'), '右栏 Artifact 渲染');
  ok(bodyText.includes('Partner · 知识工作'), 'PartnerWelcome 落地态渲染');

  // 3) 无白屏：body 文本量充足
  ok(bodyText.length > 100, `无白屏 (body innerText 长度 ${bodyText.length})`);

  // 4) 输入框（裁剪版 BottomBar）在场：textarea 存在
  const textareaCount = await win.locator('textarea').count();
  ok(textareaCount > 0, `Partner 中栏输入框在场 (textarea ×${textareaCount})`);

  // 5) 切回 Coder
  await coderTab.click();
  await win.waitForTimeout(1000);
  const bodyAfter = await win.evaluate(() => document.body.innerText);
  ok(!bodyAfter.includes('doc-workspace'), '切回 Coder 后 Partner header 消失');

  await app.close();

  if (failures > 0) {
    console.error(`[e2e] FAIL: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('[e2e] PASS — F046 Partner 三栏渲染 + 切换正常');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
