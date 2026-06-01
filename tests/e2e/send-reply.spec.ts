// Send + reply roundtrip — Path D Phase 1
//
// 验 KodaX Space 最核心的"开会话 → 发消息 → 看到回复"路径不退化。
// 用 KODAX_FORCE_MOCK=1 启 mock adapter（回固定文案），不依赖任何外部 API key。
//
// 流程：
//   1. 启 Space，KODAX_TEST_ONBOARDING + KODAX_FORCE_MOCK 双隔离
//   2. localStorage 注入 currentProjectPath = <tmp project dir>，reload 让 store hydrate
//   3. 等 textarea enabled（!busy + currentProjectPath）
//   4. 输入 prompt 按 Enter
//   5. 等 mock adapter 的回复文字出现在对话流

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

test('S3: send a prompt and see assistant reply via mock adapter', async () => {
  const testId = `s3-${Date.now()}`;
  // 准备一个真实存在的 project 目录（Space main 端 validateProjectRoot 会查盘）
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(testId);
  try {
    // 把 project path 注入 localStorage 让 store 启动时 hydrate 进 currentProjectPath
    await space.page.evaluate((p) => {
      localStorage.setItem('kodax-space.currentProjectPath', p);
    }, projectDir);
    // 注册到 recents 让 App.tsx project.list 能看见（避免 currentProjectPath 被覆盖）
    await space.page.evaluate((p) => {
      return (window as unknown as { kodaxSpace: { invoke: (n: string, i: unknown) => Promise<unknown> } })
        .kodaxSpace
        .invoke('project.recent.add', { path: p });
    }, projectDir);

    await space.page.reload();
    await space.page.waitForLoadState('domcontentloaded');

    // textarea 出现且未 disabled
    const textarea = space.page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(textarea).toBeEnabled({ timeout: 10_000 });

    // 发 prompt
    const prompt = 'hello from playwright e2e';
    await textarea.fill(prompt);
    await textarea.press('Enter');

    // user message 出现：对话流里 prompt 文本可见
    await expect(space.page.getByText(prompt).first()).toBeVisible({ timeout: 10_000 });

    // assistant 回复出现：mock adapter 固定回 "我收到了你的 prompt: ..."
    // 用 partial match 抓 reply chunk
    await expect(
      space.page.getByText(/我收到了你的 prompt/).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
