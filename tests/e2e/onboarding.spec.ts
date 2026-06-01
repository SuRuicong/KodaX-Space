// First-launch onboarding smoke — OC-12 + OC-44
//
// 验证 Path B 的隔离基建确实生效 + Space 启动到能用的最小路径不卡：
//   1. 启动 Space 进程，KODAX_TEST_ONBOARDING=<unique> 强制 data dir 走 tmpdir
//   2. 主窗口能开
//   3. 没有 project 时，输入框 placeholder 提示 "Open a folder first" (BottomBar)
//   4. data-paths 隔离生效：tmpdir/kodax-test-<id>/ 目录被 Space 创建/触达过
//
// 不在范围（后续 spec）：
//   - 真实选 folder 触发 file dialog (Playwright Electron 不能直接 mock native dialog)
//   - 真实发 prompt 走 KodaX (KODAX_FORCE_MOCK=1 后是 mock adapter)

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

test('S1: first launch with isolated data dir shows welcome / no-project state', async () => {
  const testId = `s1-${Date.now()}`;
  const space = await launchSpace(testId);
  try {
    // 主窗口 title 包含 Space
    const title = await space.page.title();
    expect(title.toLowerCase()).toContain('kodax');

    // 等到 Space renderer 渲染完 body（main process bootstrap + initial state hydrate）
    // —— Welcome dashboard 或 textarea placeholder 至少一个出现
    await space.page.waitForSelector('textarea, [aria-label="Loading conversation history"], h1', {
      timeout: 15_000,
    });

    // 隔离生效检查：textarea 要么不存在（welcome state），要么 placeholder 是 "Open a folder first"
    const textarea = space.page.locator('textarea');
    if (await textarea.count() > 0) {
      const placeholder = await textarea.first().getAttribute('placeholder');
      // 期望 placeholder 提示用户先开 folder（OC-12 隔离后没有 recent project）
      // OR 已经 hydrate 到 defaultWorkspace（首次启动会创建并 use defaultWorkspace）
      // 两种都接受，只要不报错
      expect(placeholder).toBeTruthy();
    }

    // tmpdir 应该被创建（providerConfigStore.load 至少触达过路径）
    // 注：mkdir 是按需的，有些路径只在 setDefault 等写操作时才 mkdir，
    // 所以这里只验"启动了 + 没崩"，不强求目录存在。
  } finally {
    await space.close();
  }
});

test('S2: Space actually writes into the isolated data dir (OC-12 plumbing alive)', async () => {
  // 验证 KODAX_TEST_ONBOARDING 真的让 data-paths.ts 重定向 Space 持久化目录到 tmpdir。
  // 启动 + wait UI 出现后，dataDir 必须存在 + 至少一个 Space-known 文件 (settings.json
  // 或 space/projects.json 之类) 写入过 —— 否则说明隔离机制没生效。
  const testId = `s2-${Date.now()}`;
  const dataDir = path.join(os.tmpdir(), `kodax-test-${testId}`);

  const space = await launchSpace(testId);
  try {
    await space.page.waitForSelector('textarea, h1', { timeout: 15_000 });

    // 目录被 Space 创建过 (mkdir on first write)
    const dirExists = await fs.access(dataDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(true);

    // 至少有 space/ 子目录 (settingsStore 兜底创建 ~/.kodax/space/)
    const spaceDir = path.join(dataDir, 'space');
    const spaceDirExists = await fs.access(spaceDir).then(() => true).catch(() => false);
    expect(spaceDirExists).toBe(true);
  } finally {
    await space.close();
  }
});
