import { expect, test, type Page } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `sidebar-resize-${Date.now()}`;

async function inlineWidth(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible();
  return locator.evaluate((el) => (el as HTMLElement).style.width);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test('sidebar width writes to localStorage and survives reload', async () => {
  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.leftSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarOpen');
    });
    await reload(page);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '300');
      window.localStorage.setItem('kodax-space.rightSidebarWidth', '380');
    });
    await reload(page);

    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('300px');

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.rightSidebarOpen', '1');
    });
    await reload(page);

    await expect(inlineWidth(page, 'right-sidebar')).resolves.toBe('380px');
  } finally {
    await space.close();
  }
});

test('sidebar width clamps localStorage values to current bounds', async () => {
  const space = await launchSpace(`${TEST_ID}-clamp`);
  try {
    const { page } = space;
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.localStorage.removeItem('kodax-space.leftSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarWidth');
      window.localStorage.removeItem('kodax-space.rightSidebarOpen');
    });
    await reload(page);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '50');
    });
    await reload(page);
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('180px');

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', '9999');
    });
    await reload(page);
    const expectedMaxWidth = await page.evaluate(() => {
      return `${Math.max(300, Math.round(window.innerWidth * 0.5))}px`;
    });
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe(expectedMaxWidth);

    await page.evaluate(() => {
      window.localStorage.setItem('kodax-space.leftSidebarWidth', 'banana');
    });
    await reload(page);
    await expect(inlineWidth(page, 'left-sidebar')).resolves.toBe('260px');
  } finally {
    await space.close();
  }
});
