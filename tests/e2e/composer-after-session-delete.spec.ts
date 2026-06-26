import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { launchSpace } from './fixtures.js';

const TEST_ID = `composer-after-session-delete-${Date.now()}`;

test('composer remains focusable after deleting the current session', async () => {
  const projectDir = path.join(os.tmpdir(), `kodax-test-proj-${TEST_ID}`);
  await fs.mkdir(projectDir, { recursive: true });

  const space = await launchSpace(TEST_ID);
  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await page.waitForTimeout(1500);

    const composer = page.locator('textarea[placeholder^="Describe a task"]').first();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await composer.fill('create a disposable session');
    await composer.press('Enter');

    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
      return textarea !== null && !textarea.readOnly;
    });

    await page.getByRole('button', { name: 'Session options' }).click();
    // Delete now uses an in-app confirm dialog (no native window.confirm — native
    // dialogs steal the renderer's keyboard focus and the textarea can't recover it).
    // Note: a native confirm would be auto-dismissed by Playwright and would NOT
    // reproduce the focus loss, which is why the old test gave false confidence.
    await page.getByRole('button', { name: /^Delete\b/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(composer).toHaveAttribute(
      'placeholder',
      /session will be created on send/,
    );
    await expect(composer).toHaveValue('');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const composerTextarea = document.querySelector(
            'textarea[placeholder^="Describe a task"]',
          );
          return document.activeElement === composerTextarea;
        }),
      )
      .toBe(true);

    await page.keyboard.type('typing after delete still works');
    await expect(composer).toHaveValue('typing after delete still works');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
