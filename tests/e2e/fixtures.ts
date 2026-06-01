// Shared Playwright fixtures — OC-12 / OC-44 e2e infra
//
// 每个 spec 直接 import `launchSpace(testId)` 起一个 Space 进程 +
// 隔离 data dir。spec 退出时 cleanup 关进程并删 tmp 目录。

import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname derivation (Playwright transpiles to ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const ELECTRON_MAIN = path.join(REPO_ROOT, 'dist-electron', 'main.js');

export interface SpaceInstance {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly testDataDir: string;
  close(): Promise<void>;
}

/**
 * Launch a Space process with KODAX_TEST_ONBOARDING set to `testId`.
 * data-paths.ts redirects ~/.kodax to $TMPDIR/kodax-test-<testId>.
 */
export async function launchSpace(testId: string): Promise<SpaceInstance> {
  const testDataDir = path.join(os.tmpdir(), `kodax-test-${testId}`);
  // 清掉可能上一次跑的同名残留 (testId 来自 spec 名 + timestamp，正常情况不冲突)
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});

  // memory note: 用户 shell 有时 export ELECTRON_RUN_AS_NODE=1 让 electron.exe 退化成 Node
  // 跑。Node 不识别 Playwright 注入的 --remote-debugging-port=0 等 Chromium flag，
  // 启动期立刻报 "bad option" 失败。这里显式剥掉。
  const baseEnv = { ...process.env } as Record<string, string | undefined>;
  delete baseEnv.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    args: [ELECTRON_MAIN],
    env: {
      ...baseEnv,
      KODAX_TEST_ONBOARDING: testId,
      // 关掉 Sentry / 真实 LLM 网络调，让首启不依赖外部
      KODAX_FORCE_MOCK: '1',
      NODE_ENV: 'production',
    } as Record<string, string>,
  });

  // 调试 hook：把 main process console + renderer console 都打到 test stdout，
  // 方便 30s 超时时定位卡在哪一步。CI 上可以静默掉。
  if (process.env.E2E_DEBUG === '1') {
    app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${d}`));
    app.process().stderr?.on('data', (d: Buffer) => process.stderr.write(`[main:err] ${d}`));
  }

  const page = await app.firstWindow();
  if (process.env.E2E_DEBUG === '1') {
    page.on('console', (msg) => console.log(`[renderer:${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.error('[renderer:pageerror]', err.message));
  }
  // 等 renderer mount —— index.html bundle 进来后才有 body
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    testDataDir,
    async close() {
      await app.close().catch(() => {});
      await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
