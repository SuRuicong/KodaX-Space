// OC-29 + KX-I-02 e2e — unified Settings modal Esc/click-out + smart popout toggle persistence.
//
// 验证:
//   1. SettingsModal 可通过 LeftSidebar 底栏 ⚙ 打开
//   2. Esc 关闭 modal
//   3. Preferences tab 的 "Auto-open Plan / Diff / Tasks" 复选框反映 store
//      smartPopoutEnabled 状态,toggle 后 lsKey 'kodax-space.smartPopoutEnabled' 写入正确

import { test, expect } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `settings-modal-${Date.now()}`;

test('SettingsModal opens via sidebar ⚙, Esc closes, smart-popout toggle persists', async () => {
  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await page.waitForTimeout(2000); // 让 hydrate 完成
    // localStorage 跨 test 共享 — 清掉本测专用 keys 避免上次跑的值串进默认状态
    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.smartPopoutEnabled');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // 默认状态: smartPopoutEnabled === true (新装无 lsKey → 默认 on)
    const defaultEnabled = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    // 默认没写过 → null;开关默认 on (代码 lsGet !== '0' 判定)
    expect(defaultEnabled === null || defaultEnabled === '1').toBe(true);

    // 点 LeftSidebar 底栏 ⚙ 按钮 — aria-label="Settings"
    const settingsBtn = page.locator('button[aria-label="Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // Modal 标题出现
    const modalTitle = page.locator('#settings-modal-title');
    await expect(modalTitle).toBeVisible();
    await expect(modalTitle).toHaveText('Settings');

    // Preferences tab 默认就在 (initialTab='preferences')
    const prefPanel = page.locator('#settings-panel-preferences');
    await expect(prefPanel).toBeVisible();

    // 找到 "Auto-open Plan / Diff / Tasks popouts" 复选框
    const dirToggle = page.locator('input[type="checkbox"]').nth(0);
    await expect(dirToggle).toBeChecked();

    // 关掉 director toggle
    await dirToggle.uncheck();
    await page.waitForTimeout(100); // 让 setState + lsSet 完成
    const afterUncheck = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    expect(afterUncheck).toBe('0');

    // 重新勾上
    await dirToggle.check();
    await page.waitForTimeout(100);
    const afterCheck = await page.evaluate(() =>
      window.localStorage.getItem('kodax-space.smartPopoutEnabled'),
    );
    expect(afterCheck).toBe('1');

    // Esc 关 modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(modalTitle).not.toBeVisible();
  } finally {
    await space.close();
  }
});

test('SettingsModal tab switch keeps both panels mounted (preserves in-progress edits)', async () => {
  // OC-29 review HIGH-1 anti-regression: 切 tab 时 panel 用 hidden 而非 unmount,
  // 验证 Preferences tab 隐藏后再切回,DOM 还在(不丢编辑中的输入)。
  const space = await launchSpace(`${TEST_ID}-tabs`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('#settings-modal-title')).toBeVisible();

    // Preferences panel 在,Providers panel 也在 (hidden 模式),只是 hidden 属性切换
    const prefPanel = page.locator('#settings-panel-preferences');
    const provPanel = page.locator('#settings-panel-providers');
    await expect(prefPanel).toBeVisible();
    // Providers panel 在 DOM 里但 hidden
    await expect(provPanel).toBeAttached();
    await expect(provPanel).not.toBeVisible();

    // 点 Providers tab
    await page.locator('button[role="tab"]', { hasText: 'Providers' }).click();
    await page.waitForTimeout(100);
    await expect(provPanel).toBeVisible();
    // Preferences 还在 DOM,只是 hidden — 不 unmount
    await expect(prefPanel).toBeAttached();
    await expect(prefPanel).not.toBeVisible();

    // 切回 Preferences
    await page.locator('button[role="tab"]', { hasText: 'Preferences' }).click();
    await expect(prefPanel).toBeVisible();
  } finally {
    await space.close();
  }
});
