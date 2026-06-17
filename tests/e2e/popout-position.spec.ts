// Popout positioning regression e2e — guards the F060 `.glass` cascade bug.
//
// 回归现场：`.glass`（styles.css，无 @layer 的裸规则）带 `position: relative`，
// 在级联里永远压过 Tailwind `@layer utilities` 的 `.absolute`。PopoutOverlay 的
// <aside> 同时挂 `glass` + `absolute` → position 被强制成 relative → 浮层退回文档流、
// 渲染在 BottomBar(输入框) 之后，掉到输入框下面（plan / diff 两个 popout 同时中招）。
//
// 修复：aside 用 `!absolute`（important utility）压回 absolute。
//
// 本 spec 打开 Diff popout，断言：
//   1. aside 的 computed position === 'absolute'（根因断言）
//   2. aside 顶边在输入框(textarea)上方 —— 即它"浮"在对话区之上，而不是掉到输入框下面
// 任一断言失败即说明回归复现。

import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { launchSpace } from './fixtures.js';

const TEST_ID = `popout-position-${Date.now()}`;

test('diff popout overlays the conversation (absolute), not dropped below the input box', async () => {
  // seedProject 需要一个真实存在的目录（project.recent.add）
  const projectDir = path.join(os.tmpdir(), `kodax-test-proj-${TEST_ID}`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await page.waitForTimeout(1500);

    // 打开右上 Activity 下拉 → 点 Diff，弹出 PopoutOverlay
    // 注意：Diff 下拉项的 accessible name 含快捷键（"Diff ⇧Ctrl D"），不能用 exact。
    // 用 title="Diff (⇧Ctrl D)" 精准锚定那一项。
    await page.getByRole('button', { name: 'Activity views' }).click();
    await page.getByTitle('Diff (⇧Ctrl D)').click();

    // 浮层就绪：以"关闭"按钮锚定 aside
    const closeBtn = page.getByRole('button', { name: 'Close popout' });
    await expect(closeBtn).toBeVisible({ timeout: 5000 });

    const metrics = await page.evaluate(() => {
      const closeButton = document.querySelector('button[aria-label="Close popout"]');
      const aside = closeButton?.closest('aside') as HTMLElement | null;
      const textarea = document.querySelector('textarea') as HTMLElement | null;
      if (!aside || !textarea) return null;
      const asideRect = aside.getBoundingClientRect();
      const taRect = textarea.getBoundingClientRect();
      return {
        position: getComputedStyle(aside).position,
        asideTop: asideRect.top,
        asideBottom: asideRect.bottom,
        asideHeight: asideRect.height,
        textareaTop: taRect.top,
      };
    });

    expect(metrics, 'popout aside + textarea must both be present').not.toBeNull();
    const m = metrics!;

    // 1) 根因断言：absolute（bug 时会是 relative）
    expect(m.position, 'popout aside must be position:absolute').toBe('absolute');

    // 2) 布局断言：aside 顶边在输入框上方（浮在对话区），不是掉到输入框下面。
    //    bug 时 aside 在文档流里、位于 BottomBar 之后 → asideTop >= textareaTop。
    expect(
      m.asideTop,
      `popout top (${Math.round(m.asideTop)}) must be above textarea top (${Math.round(m.textareaTop)})`,
    ).toBeLessThan(m.textareaTop);

    // 3) 浮层有真实高度（不是被压塌成 0）
    expect(m.asideHeight, 'popout must have real height').toBeGreaterThan(100);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
