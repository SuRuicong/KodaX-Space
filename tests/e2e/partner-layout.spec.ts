// Partner visual layout e2e coverage.
//
// This catches the class of regressions that normal interaction tests miss:
// usable-width collapse, panel overlap, clipped menus, and modal/composer
// layering problems on the Partner surface.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

// Partner surface is intentionally disabled (PARTNER_ENABLED=false in
// store/surface.ts, commit c28a0746) until its deliverable chain is complete —
// the [Partner] tab is greyed out and cannot be switched to, so every flow here
// (which starts by switching to Partner) can't run. Re-enable this whole file
// when PARTNER_ENABLED flips back to true.
test.beforeEach(() => {
  test.skip(true, 'Partner surface disabled (PARTNER_ENABLED=false) until deliverable chain complete');
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface LayoutSnapshot {
  viewport: { width: number; height: number };
  rects: Record<string, Rect | null>;
}

const AUDIT_DIR = path.join(process.cwd(), 'artifacts', 'partner-ui-audit');

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'brief.md'),
    '# Partner brief\n\nUse this file as evidence for visual layout checks.\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(projectDir, 'docs', 'long-file-name-for-layout-overflow-testing.md'),
    '# Long file\n',
    'utf-8',
  );
  return projectDir;
}

async function switchToPartner(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Partner', exact: true }).click();
  await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  const stream = page.getByTestId('conversation-stream');
  await expect(stream.getByTestId('user-message-bubble').filter({ hasText: prompt })).toBeVisible({
    timeout: 10_000,
  });
  await expect(stream.getByText(/Ran 1 command/).first()).toBeVisible({ timeout: 20_000 });
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(AUDIT_DIR, `${name}.png`), fullPage: false });
}

async function snapshotLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const selectors: Record<string, string> = {
      left: '[data-testid="left-sidebar"]',
      workspace: '[data-testid="partner-workspace"]',
      sources: '[data-testid="partner-sources-panel"]',
      conversation: '[data-testid="partner-conversation"]',
      artifact: '[data-testid="partner-artifact-panel"]',
      stream: '[data-testid="conversation-stream"]',
      textarea: 'textarea',
      send: '[aria-label="Send message"]',
      menu: '[role="menu"]',
      dialog: '[role="dialog"]',
    };
    const rectFor = (selector: string): Rect | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rects: Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => [name, rectFor(selector)]),
      ),
    };
  });
}

function horizontallySeparated(left: Rect, right: Rect): boolean {
  return left.right <= right.x + 0.5;
}

function insideViewport(rect: Rect, viewport: { width: number; height: number }): boolean {
  return (
    rect.x >= -0.5 &&
    rect.y >= -0.5 &&
    rect.right <= viewport.width + 0.5 &&
    rect.bottom <= viewport.height + 0.5
  );
}

async function expectUsablePartnerLayout(page: Page): Promise<void> {
  const snap = await snapshotLayout(page);
  const { viewport, rects } = snap;
  expect(rects.workspace, 'Partner workspace exists').not.toBeNull();
  expect(rects.conversation, 'Partner conversation exists').not.toBeNull();
  expect(rects.textarea, 'Composer exists').not.toBeNull();

  const workspace = rects.workspace!;
  const conversation = rects.conversation!;
  const textarea = rects.textarea!;

  expect(insideViewport(workspace, viewport), 'workspace is clipped by viewport').toBe(true);
  expect(insideViewport(conversation, viewport), 'conversation is clipped by viewport').toBe(true);
  expect(insideViewport(textarea, viewport), 'composer is clipped by viewport').toBe(true);
  expect(conversation.width, 'conversation needs a readable lane').toBeGreaterThanOrEqual(360);

  if (rects.left) {
    expect(horizontallySeparated(rects.left, workspace), 'left sidebar overlaps workspace').toBe(true);
  }
  if (rects.sources) {
    expect(horizontallySeparated(rects.sources, conversation), 'sources rail overlaps conversation').toBe(true);
  }
  if (rects.artifact) {
    expect(insideViewport(rects.artifact, viewport), 'artifact panel is clipped by viewport').toBe(true);
    expect(horizontallySeparated(conversation, rects.artifact), 'conversation overlaps artifact rail').toBe(
      true,
    );
  }
}

async function expectSelectorInViewport(page: Page, selector: string, label: string): Promise<void> {
  const handle = await page.waitForFunction((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }, selector);
  const box = (await handle.jsonValue()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const viewport = await page.viewportSize();
  expect(viewport, 'viewport size').not.toBeNull();
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport!.height + 0.5);
}

test('Partner layout remains usable without panel overlap across common widths', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `partner-layout-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchToPartner(page);

    await page.setViewportSize({ width: 1280, height: 760 });
    await saveScreenshot(page, '01-desktop-welcome');
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();
    await expectUsablePartnerLayout(page);

    await page.setViewportSize({ width: 980, height: 680 });
    await saveScreenshot(page, '02-narrow-welcome');
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toHaveCount(0);
    await expectUsablePartnerLayout(page);

    await sendPrompt(page, 'partner visual overlap audit prompt');
    await saveScreenshot(page, '03-narrow-after-send');
    await expectUsablePartnerLayout(page);

    const sourcesPanel = page.getByTestId('partner-sources-panel');
    await sourcesPanel.getByRole('button', { name: 'brief.md' }).click();
    await sourcesPanel.getByRole('button', { name: 'Attach selected file' }).click();
    await expect(sourcesPanel.getByText('brief.md').first()).toBeVisible();
    await saveScreenshot(page, '04-source-attached');
    await expectUsablePartnerLayout(page);

    await page.setViewportSize({ width: 820, height: 620 });
    await saveScreenshot(page, '05-compact-width');
    await expect(page.getByTestId('partner-sources-panel')).toHaveCount(0);
    await expect(page.getByTestId('partner-artifact-panel')).toHaveCount(0);
    await expectUsablePartnerLayout(page);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner menu and delete dialog stay above layout and inside the viewport', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `partner-overlays-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchToPartner(page);
    await page.setViewportSize({ width: 980, height: 680 });

    const prompt = 'partner overlay visual audit prompt';
    await sendPrompt(page, prompt);

    const row = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const deleteMenuItem = page.getByRole('menuitem', { name: /^Delete\b/ });
    await expect(deleteMenuItem).toBeVisible();
    await expectSelectorInViewport(page, '[role="menu"]', 'session context menu');
    await saveScreenshot(page, '06-session-menu');

    if (!(await deleteMenuItem.isVisible().catch(() => false))) {
      await row.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: /^Delete\b/ })).toBeVisible();
    }
    await page.getByRole('menuitem', { name: /^Delete\b/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectSelectorInViewport(page, '[role="dialog"]', 'delete dialog');
    await saveScreenshot(page, '07-delete-dialog');
    await expectUsablePartnerLayout(page);
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
