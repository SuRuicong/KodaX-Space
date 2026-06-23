import { test, expect } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `window-throttling-${Date.now()}`;

test('main window restores background throttling after first reveal', async () => {
  const space = await launchSpace(TEST_ID);

  try {
    await expect
      .poll(
        () =>
          space.app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return null;
            return {
              visible: win.isVisible(),
              minimized: win.isMinimized(),
              throttling: win.webContents.getBackgroundThrottling(),
            };
          }),
        { timeout: 10_000 },
      )
      .toMatchObject({
        visible: true,
        minimized: false,
        throttling: true,
      });
  } finally {
    await space.close();
  }
});
