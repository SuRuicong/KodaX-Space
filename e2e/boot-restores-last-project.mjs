// E2E: boot should restore last-used project, not always default workspace.
//
// Steps:
//   1) Snapshot ~/.kodax/space/projects.json
//   2) Bump KodaX-Space.lastUsedAt to "now" (newer than kodax_workspace) so it's most recent
//   3) Launch Electron via Playwright (talks to running Vite at 127.0.0.1:5173)
//   4) Wait for breadcrumb / ChipBar to show project name
//   5) Assert it's "KodaX-Space" (not kodax_workspace)
//   6) Restore projects.json
//
// 不动 user 跑着的 npm run dev — playwright 启的是另一个 Electron 实例，共享 ~/.kodax 但
// 独立的 OS process。

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PROJECTS_JSON = path.join(os.homedir(), '.kodax', 'space', 'projects.json');

const SHOT_DIR = 'c:/tmp/boot-restore';
fs.mkdirSync(SHOT_DIR, { recursive: true });

function readProjects() {
  return JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf-8'));
}
function writeProjects(obj) {
  fs.writeFileSync(PROJECTS_JSON, JSON.stringify(obj, null, 2), 'utf-8');
}

async function main() {
  // Step 1: snapshot
  const original = readProjects();
  console.log('[e2e] original projects.json:');
  for (const p of original.projects) {
    console.log(`  ${p.name} lastUsedAt=${p.lastUsedAt}`);
  }

  // Step 2: bump KodaX-Space
  const kodaxSpace = original.projects.find((p) => p.name === 'KodaX-Space');
  if (!kodaxSpace) {
    console.error('[e2e] FAIL: KodaX-Space not in projects.json — re-open it once in dev first');
    process.exit(2);
  }
  const seeded = {
    version: 1,
    projects: original.projects.map((p) =>
      p.name === 'KodaX-Space'
        ? { ...p, lastUsedAt: Date.now() }
        : p.name === 'kodax_workspace'
          ? { ...p, lastUsedAt: Date.now() - 60_000 } // 1 分钟前
          : p,
    ),
  };
  writeProjects(seeded);
  console.log('[e2e] seeded: KodaX-Space is now most recent.');

  let app = null;
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    writeProjects(original);
    console.log('[e2e] restored projects.json.');
  }
  process.on('SIGINT', restore);
  process.on('uncaughtException', (err) => {
    console.error('[e2e] uncaught:', err);
    restore();
    process.exit(1);
  });

  try {
    // Step 3: launch
    console.log('[e2e] launching Electron…');
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    // 不依赖 vite dev server — 走 RENDERER_DIST/index.html prod 路径，更稳定
    app = await electron.launch({
      args: [path.join(repoRoot, 'dist-electron')],
      cwd: repoRoot,
      env: {
        ...childEnv,
        NODE_ENV: 'production',
      },
      timeout: 30_000,
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    console.log('[e2e] window loaded.');

    // 清掉 localStorage 中持久化的 currentProjectPath / Session，确保走的是 App.tsx
    // 新加的 "most-recent project restore" 路径，而不是 localStorage 残留命中。
    // 然后 reload 让 App.tsx 启动 effect 重跑（store 这次 init 时 lsGet 返回 null）。
    await win.evaluate(() => {
      window.localStorage.removeItem('kodax-space.currentProjectPath');
      window.localStorage.removeItem('kodax-space.currentSessionId');
    });
    console.log('[e2e] cleared LS keys; reloading…');
    await win.reload();
    await win.waitForLoadState('domcontentloaded');

    // 我们的 store 在 setCurrentProject 时落 localStorage('kodax-space.currentProjectPath')。
    // 等 App.tsx 启动 effect 跑完 → localStorage 有值 → 拿出来对照。
    const projectPath = await win
      .waitForFunction(() => window.localStorage.getItem('kodax-space.currentProjectPath'), null, {
        timeout: 15_000,
      })
      .then((h) => h.jsonValue());

    console.log('[e2e] localStorage currentProjectPath:', JSON.stringify(projectPath));

    await win.screenshot({ path: path.join(SHOT_DIR, 'boot.png'), fullPage: true });

    // 期望：path 末尾是 KodaX-Space（path 分隔符跨平台 — 末段 basename 即可）。
    const basename = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;
    if (basename === 'KodaX-Space') {
      console.log('[e2e] PASS: boot restored to KodaX-Space (most recent), not kodax_workspace');
      await app.close();
      restore();
      process.exit(0);
    } else {
      console.error(
        `[e2e] FAIL: expected basename "KodaX-Space", got "${basename}" (full: ${projectPath})`,
      );
      await app.close();
      restore();
      process.exit(1);
    }
  } catch (err) {
    console.error('[e2e] error:', err);
    if (app) await app.close().catch(() => {});
    restore();
    process.exit(1);
  }
}

main();
