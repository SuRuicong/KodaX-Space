// Partner mode e2e coverage.
//
// These tests intentionally mirror Coder's core "normal use" path while staying
// on the Partner surface: create by first send, receive a mock assistant turn,
// use slash/mode controls, switch surfaces, resume after reload, manage sources,
// and recover the composer after deleting the current Partner session.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { launchSpace } from './fixtures.js';

type Surface = 'code' | 'partner';

interface SessionListEnvelope {
  ok: boolean;
  data?: { sessions?: Array<{ sessionId: string; title?: string; surface?: Surface }> };
  error?: { message?: string };
}

interface SourceListEnvelope {
  ok: boolean;
  data?: { sources?: Array<{ id: string; label?: string; path: string }> };
  error?: { message?: string };
}

async function createProject(testId: string): Promise<string> {
  const projectDir = path.join(os.tmpdir(), `kodax-test-${testId}-project`);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'brief.md'),
    '# Partner brief\n\nUse this file as evidence for the Partner e2e flow.\n',
    'utf-8',
  );
  return projectDir;
}

async function switchSurface(page: Page, surface: 'Coder' | 'Partner'): Promise<void> {
  await page.getByRole('button', { name: surface, exact: true }).click();
}

async function readSessions(
  page: Page,
  projectRoot: string,
  surface: Surface,
): Promise<Array<{ sessionId: string; title?: string; surface?: Surface }>> {
  return page.evaluate(async ({ projectRoot: root, surface: targetSurface }) => {
    const bridge = (
      window as unknown as {
        kodaxSpace: { invoke: (name: string, input: unknown) => Promise<SessionListEnvelope> };
      }
    ).kodaxSpace;
    const result = await bridge.invoke('session.list', {
      projectRoot: root,
      surface: targetSurface,
    });
    if (!result.ok) throw new Error(result.error?.message ?? 'session.list failed');
    return result.data?.sessions ?? [];
  }, { projectRoot, surface });
}

async function onlySessionId(page: Page, projectRoot: string, surface: Surface): Promise<string> {
  const sessions = await readSessions(page, projectRoot, surface);
  expect(sessions, `${surface} session count`).toHaveLength(1);
  expect(sessions[0].surface ?? 'code').toBe(surface);
  return sessions[0].sessionId;
}

async function readPartnerSources(page: Page, sessionId: string): Promise<SourceListEnvelope['data']['sources']> {
  return page.evaluate(async (sid) => {
    const bridge = (
      window as unknown as {
        kodaxSpace: { invoke: (name: string, input: unknown) => Promise<SourceListEnvelope> };
      }
    ).kodaxSpace;
    const result = await bridge.invoke('partner.sources.list', { sessionId: sid });
    if (!result.ok) throw new Error(result.error?.message ?? 'partner.sources.list failed');
    return result.data?.sources ?? [];
  }, sessionId);
}

async function sendPartnerPrompt(page: Page, prompt: string): Promise<void> {
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

test('Partner artifact rail can be hidden and restored without losing the conversation lane', async () => {
  const testId = `partner-artifact-rail-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    const artifactToggle = page.getByTestId('partner-artifact-toggle');
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('partner-artifact-panel-close').click();
    await expect(page.getByTestId('partner-artifact-panel')).toHaveCount(0);
    await expect(page.getByTestId('partner-conversation')).toBeVisible();
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'false');

    const edgeToggle = page.getByTestId('partner-artifact-edge-toggle');
    await expect(edgeToggle).toBeVisible();
    await edgeToggle.click();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner supports normal composer use, slash clear, mode shortcut, and resume', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `partner-parity-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);

    await switchSurface(page, 'Partner');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    const sourcesToggle = page.getByTestId('partner-sources-toggle');
    await expect(sourcesToggle).toHaveAttribute('aria-pressed', 'true');
    await sourcesToggle.click();
    await expect(page.getByTestId('partner-sources-panel')).toHaveCount(0);
    await expect(page.getByTestId('partner-conversation')).toBeVisible();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('partner-sources-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('partner-sources-toggle').click();
    await expect(page.getByTestId('partner-sources-panel')).toBeVisible();

    const artifactToggle = page.getByTestId('partner-artifact-toggle');
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('partner-artifact-panel-close').click();
    await expect(page.getByTestId('partner-artifact-panel')).toHaveCount(0);
    await expect(artifactToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('partner-artifact-edge-toggle')).toBeVisible();
    await page.getByTestId('partner-artifact-edge-toggle').click();
    await expect(page.getByTestId('partner-artifact-panel')).toBeVisible();

    const modeLabel = /^(Plan|Accept edits|Auto)/;
    await expect(page.getByText(modeLabel).first()).toBeVisible({ timeout: 10_000 });
    const initialMode = await page.getByText(modeLabel).first().textContent();
    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(async () => (await page.getByText(modeLabel).first().textContent()) ?? '', {
        timeout: 5_000,
      })
      .not.toBe(initialMode);

    const prompt = 'partner e2e normal use check';
    await sendPartnerPrompt(page, prompt);
    await expect.poll(() => readSessions(page, projectDir, 'partner'), { timeout: 10_000 }).toHaveLength(1);
    await expect(await readSessions(page, projectDir, 'code')).toHaveLength(0);

    const partnerRow = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(partnerRow).toBeVisible({ timeout: 10_000 });

    await switchSurface(page, 'Coder');
    await expect(page.getByTestId('partner-workspace')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-session-row').filter({ hasText: prompt })).toHaveCount(0);

    await switchSurface(page, 'Partner');
    await expect(page.getByTestId('partner-workspace')).toBeVisible();
    await expect(page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first()).toBeVisible();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('partner-workspace')).toBeVisible({ timeout: 10_000 });
    const reloadedRow = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await reloadedRow.click();
    const followUp = 'partner e2e resume follow up';
    await sendPartnerPrompt(page, followUp);
    await expect(await readSessions(page, projectDir, 'partner')).toHaveLength(1);

    const textarea = page.locator('textarea').first();
    await textarea.fill('/clear');
    await page.getByLabel('Send message').click();
    await expect(page.getByTestId('conversation-stream').getByText(followUp).first()).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(textarea).toBeEnabled();
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Partner sources can be attached and removed, and deleting the session recovers composer', async () => {
  test.skip(
    !!process.env.CI && process.platform === 'win32',
    'mock assistant turn can stall on Windows CI; keep local and Linux coverage',
  );

  const testId = `partner-sources-delete-${Date.now()}`;
  const projectDir = await createProject(testId);
  const space = await launchSpace(testId);

  try {
    const { page } = space;
    await space.seedProject(projectDir);
    await switchSurface(page, 'Partner');

    const prompt = 'partner e2e source management check';
    await sendPartnerPrompt(page, prompt);
    const sessionId = await onlySessionId(page, projectDir, 'partner');

    const sourcesPanel = page.getByTestId('partner-sources-panel');
    await sourcesPanel.getByRole('button', { name: 'brief.md' }).click();
    await sourcesPanel.getByRole('button', { name: 'Attach selected file' }).click();
    await expect.poll(() => readPartnerSources(page, sessionId), { timeout: 10_000 }).toHaveLength(1);
    await expect(sourcesPanel.getByText('brief.md').first()).toBeVisible();

    await sourcesPanel.locator('button[title="Remove source"]').click();
    await expect.poll(() => readPartnerSources(page, sessionId), { timeout: 10_000 }).toHaveLength(0);
    await expect(sourcesPanel.getByText('No sources attached')).toBeVisible();

    const row = page.getByTestId('sidebar-session-row').filter({ hasText: prompt }).first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Delete\b/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('sidebar-session-row').filter({ hasText: prompt })).toHaveCount(0, {
      timeout: 10_000,
    });
    const composer = page.locator('textarea[placeholder^="Describe a task"]').first();
    await expect(composer).toHaveAttribute('placeholder', /session will be created on send/);
    await expect(composer).toBeEnabled();
    await composer.fill('typing after partner delete still works');
    await expect(composer).toHaveValue('typing after partner delete still works');
  } finally {
    await space.close();
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
});
