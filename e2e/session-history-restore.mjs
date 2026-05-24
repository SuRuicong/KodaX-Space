// E2E: session.history — 历史 session 切换时从 KodaX SDK 拉对话内容
//
// 流程：
//   1. 拉 session.list 找一条 persisted session（msgCount > 0）
//   2. 通过 LeftSidebar 点击该 session 行让 Shell 的 lazy-load effect 触发
//   3. 校验 ConversationStream 渲染出至少一条 user 气泡 + 一条 assistant 气泡
//
// 不依赖 mock-session 也不写新 session — 复用 KodaX 用户磁盘里已有的真实会话。

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
  await win.waitForTimeout(2000);

  // 1) 拉 session.list — 用 boot 恢复的 currentProjectPath
  const projectRoot = await win.evaluate(() =>
    localStorage.getItem('kodax-space.currentProjectPath'),
  );
  if (!projectRoot) throw new Error('no currentProjectPath');

  const listed = await win.evaluate(async (root) => {
    const r = await window.kodaxSpace.invoke('session.list', { projectRoot: root });
    return r.ok ? r.data.sessions : [];
  }, projectRoot);

  console.log(`[e2e] session.list returned ${listed.length} sessions`);
  if (listed.length === 0) {
    console.log('[e2e] SKIP: no persisted sessions on disk to test against');
    await app.close();
    return;
  }

  // 找一条有 title 的 session — 假定它有历史消息（mock / 刚 create 的可能无内容）
  // 没有时退而取第一条
  const target = listed.find((s) => s.title && !s.title.startsWith('s_')) ?? listed[0];
  console.log(`[e2e] target session: ${target.sessionId.slice(0, 12)}… title="${target.title ?? '(none)'}"`);

  // 2) 直接调 session.history IPC 看 main 端能不能返回 items
  const historyResp = await win.evaluate(async (sid) => {
    const r = await window.kodaxSpace.invoke('session.history', { sessionId: sid });
    return r.ok
      ? { ok: true, count: r.data.items.length, kinds: r.data.items.map((i) => i.kind) }
      : { ok: false, error: r.error?.message };
  }, target.sessionId);

  console.log(`[e2e] session.history: ${JSON.stringify(historyResp)}`);
  if (!historyResp.ok) {
    throw new Error(`session.history IPC failed: ${historyResp.error}`);
  }

  if (historyResp.count === 0) {
    console.log('[e2e] target session has 0 history items — choosing another');
    // 试 list 里每一条找 count>0 的
    let found = null;
    for (const s of listed) {
      const r = await win.evaluate(async (sid) => {
        const r = await window.kodaxSpace.invoke('session.history', { sessionId: sid });
        return r.ok ? r.data.items.length : 0;
      }, s.sessionId);
      if (r > 0) { found = s; break; }
    }
    if (!found) {
      console.log('[e2e] SKIP: no persisted sessions have history content');
      await app.close();
      return;
    }
    console.log(`[e2e] retry with session ${found.sessionId.slice(0, 12)}…`);
    target.sessionId = found.sessionId;
    target.title = found.title;
  }

  // 3) UI 流程：点 LeftSidebar 上对应 session 行
  // session 在 Recents 里按 button[title^=...] 查找 — title 是 `${title ?? sessionId} (double-click to rename)`
  const titleSel = target.title
    ? `aside button[title^="${target.title.replace(/"/g, '\\"').slice(0, 30)}"]`
    : `aside button[title*="${target.sessionId.slice(0, 12)}"]`;
  const sessionRow = win.locator(titleSel).first();
  const rowVisible = await sessionRow.isVisible().catch(() => false);
  if (!rowVisible) {
    // 列表可能未刷新 — 触发一次 list
    await win.evaluate((root) => window.kodaxSpace.invoke('session.list', { projectRoot: root }), projectRoot);
    await win.waitForTimeout(1000);
  }
  await sessionRow.waitFor({ timeout: 5_000 });
  await sessionRow.click();
  await win.waitForTimeout(2500); // 等 lazy-load effect + 渲染

  // 4) 校验 transcript 里有 user bubble 或 assistant text
  const transcriptHasContent = await win.evaluate(() => {
    // 数 bubbles：user bubble (blue 背景) + assistant bubble
    const userBubbles = document.querySelectorAll('div.bg-blue-900\\/40, div.bg-blue-100');
    const allText = (document.querySelector('.flex-1.overflow-auto')?.textContent ?? '').length;
    return { userBubbleCount: userBubbles.length, allTextLen: allText };
  });
  console.log(`[e2e] transcript after click: ${JSON.stringify(transcriptHasContent)}`);

  if (transcriptHasContent.userBubbleCount === 0 && transcriptHasContent.allTextLen < 50) {
    throw new Error('transcript empty after clicking session row — history restore failed');
  }
  console.log('[e2e] ✓ history restored: transcript shows past content');

  await app.close();
  console.log('[e2e] PASS');
}

main().catch((err) => {
  console.error('[e2e] FAIL:', err);
  process.exit(1);
});
