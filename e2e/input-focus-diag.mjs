// E2E 诊断: 输入框无法选中/输入 (F054 视觉刷新回归排查)
// 两阶段: ①WelcomeDashboard(新会话) ②点开历史会话(对话流加载后) 各测一次输入框。

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT = 'c:/tmp/input-diag';
fs.mkdirSync(SHOT, { recursive: true });

async function probe(win, label) {
  const ta = win.locator('textarea').first();
  if (!(await ta.count())) return { label, error: 'no textarea' };
  const disabled = await ta.isDisabled().catch(() => 'err');

  const hit = await win.evaluate(() => {
    const t = document.querySelector('textarea');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const el = document.elementFromPoint(cx, cy);
    return {
      hitTag: el?.tagName ?? null,
      hitClass: el?.className?.toString?.().slice(0, 140) ?? null,
      hitIsTextarea: el === t,
      rect: { y: Math.round(r.y), h: Math.round(r.height) },
    };
  });

  let typed = null, threw = null;
  try {
    await ta.click({ timeout: 3000 });
    await ta.fill(''); // 清掉旧内容
    await ta.type('hello-e2e', { timeout: 3000 });
    typed = await ta.inputValue();
  } catch (e) { threw = e.message.split('\n')[0]; }

  const verdict =
    disabled === true ? 'DISABLED'
    : hit && !hit.hitIsTextarea ? `OVERLAY: <${hit.hitTag} class="${hit.hitClass}">`
    : threw ? `THREW: ${threw}`
    : typed === 'hello-e2e' ? 'OK'
    : `BROKEN value=${JSON.stringify(typed)}`;
  return { label, disabled, hit, typed, verdict };
}

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
  await win.waitForTimeout(3500);

  // 阶段 1: WelcomeDashboard
  const r1 = await probe(win, 'welcome-dashboard');
  console.log('[diag] STAGE 1:', JSON.stringify(r1, null, 2));
  await win.screenshot({ path: `${SHOT}/stage1-welcome.png` });

  // 阶段 2: 点开第一个历史会话
  const sessionBtn = win.locator('button[title*="double-click to rename"]').first();
  const hasSession = await sessionBtn.count();
  console.log('[diag] history session rows:', hasSession);
  if (hasSession) {
    await sessionBtn.click();
    await win.waitForTimeout(3500); // 等历史 replay / ConversationStreamV2 渲染
    await win.screenshot({ path: `${SHOT}/stage2-session-loaded.png` });
    const r2 = await probe(win, 'history-session-loaded');
    console.log('[diag] STAGE 2:', JSON.stringify(r2, null, 2));
    await win.screenshot({ path: `${SHOT}/stage2-after-type.png` });
  } else {
    console.log('[diag] no history session to click — skip stage 2');
  }

  await app.close();
}

main().catch((err) => { console.error('[diag] FAIL:', err); process.exit(1); });
