// One-shot diagnostic: launch prod Electron pointed at REAL ~/.kodax,
// read store state via Playwright page.evaluate, log shape + key mismatch.
//
// 不写任何数据；只 read store state + window.kodaxSpace.invoke。安全跑。
// 用法：node scripts/diag-sessions-load.mjs

import { _electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ELECTRON_MAIN = path.join(REPO_ROOT, 'dist-electron', 'main.js');

console.log('[diag] launching Space (prod build) pointed at real ~/.kodax ...');

const baseEnv = { ...process.env };
delete baseEnv.ELECTRON_RUN_AS_NODE;
// 不设 KODAX_TEST_ONBOARDING → 走真 user data dir
// 不设 KODAX_FORCE_MOCK    → 真 SDK adapter

const app = await _electron.launch({
  args: [ELECTRON_MAIN],
  env: { ...baseEnv, NODE_ENV: 'production' },
});

const page = await app.firstWindow();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`[renderer:err] ${msg.text()}`);
});
page.on('pageerror', (err) => console.log(`[renderer:pageerror] ${err.message}`));

await page.waitForLoadState('domcontentloaded');

// 等 LeftSidebar mount + session.list 完成（最多 6s）
console.log('[diag] waiting 5s for store hydrate + session.list ...');
await page.waitForTimeout(5000);

// 直接读 zustand store。useAppStore 是 module-level singleton；
// renderer bundle 把它挂在某些 module，但 React DevTools 可拿。
// 简单粗暴：从 React fiber tree 反查 store；或者从 module side-effect 拿。
// 这里走 dispatchEvent 让 renderer 自己回 ack 不行，干脆用 onAppStoreDebug 钩。
//
// 最佳路径：renderer App.tsx 把 useAppStore 挂到 window 方便 debug。看看有没有。

const dump = await page.evaluate(() => {
  // 找 store — 优先 window._appStoreDebug，否则从 zustand 注册表
  // (zustand v5 不暴露注册表，得从 React fiber 反查)
  function findStoreViaFiber() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fiberKey = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    if (!fiberKey) return null;
    const fiber = /** @type {any} */ (root)[fiberKey];
    // 深度优先搜 fiber tree，找含 sessions+projects state 的组件
    let found = null;
    function walk(node, depth) {
      if (!node || depth > 80 || found) return;
      try {
        if (node.memoizedState) {
          let s = node.memoizedState;
          while (s) {
            const v = s.memoizedState;
            if (
              v &&
              typeof v === 'object' &&
              Array.isArray(v.sessions) &&
              Array.isArray(v.projects)
            ) {
              found = v;
              return;
            }
            s = s.next;
          }
        }
      } catch {
        /* best-effort diag — ignore */
      }
      walk(node.child, depth + 1);
      walk(node.sibling, depth + 1);
    }
    walk(fiber.stateNode?.current ?? fiber, 0);
    return found;
  }

  // alternative: 用 invoke 直接打 main 端拿源数据
  return (async () => {
    const out = { fromFiber: null, fromIpc: null, error: null };
    try {
      const state = findStoreViaFiber();
      if (state) {
        out.fromFiber = {
          sessionsCount: state.sessions.length,
          projectsCount: state.projects.length,
          sampleSessions: state.sessions.slice(0, 3).map((x) => ({
            sessionId: x.sessionId?.slice(0, 8),
            projectRoot: x.projectRoot,
            title: x.title,
          })),
          allProjects: state.projects.map((x) => ({
            path: x.path,
            name: x.name,
            lastUsedAt: x.lastUsedAt,
          })),
        };
      }
    } catch (e) {
      out.error = String(e?.message ?? e);
    }

    // 同步打 IPC 拿 main 端原始 session.list
    try {
      // @ts-ignore
      const r = await window.kodaxSpace.invoke('session.list', undefined);
      if (r.ok) {
        out.fromIpc = {
          totalCount: r.data.sessions.length,
          firstFew: r.data.sessions.slice(0, 5).map((s) => ({
            sessionId: s.sessionId?.slice(0, 8),
            projectRoot: s.projectRoot,
            title: s.title,
          })),
        };
      } else {
        out.fromIpc = { error: r.error };
      }
    } catch (e) {
      out.fromIpc = { error: String(e?.message ?? e) };
    }

    // 也打 projects 列表
    try {
      // @ts-ignore
      const r2 = await window.kodaxSpace.invoke('project.list', undefined);
      if (r2.ok) {
        out.projectsFromIpc = r2.data.projects.map((p) => ({
          path: p.path,
          name: p.name,
        }));
      }
    } catch {
      /* best-effort diag — ignore */
    }

    return out;
  })();
});

console.log('\n=== STORE DUMP ===');
console.log(JSON.stringify(dump, null, 2));

await app.close();
console.log('\n[diag] done');
