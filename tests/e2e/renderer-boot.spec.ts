// Renderer boot smoke test — last gate before tag-push creates a release.
//
// Catches the v0.1.7 white-screen class of regression: prod-build Electron
// launches, but renderer hits a hard error (React #310 / module load fail /
// CSP block) and shows nothing. CI build-after / release-before step.
//
// Strategy: launch Space in test mode (isolated ~/.kodax tmpdir, no real LLM)
// with console/pageerror listeners attached BEFORE the first render pass,
// give renderer 5s to mount + hydrate, then assert:
//   1. No console error mentioning React error codes (#185 / #310 / etc.)
//   2. No pageerror event fired
//   3. <div id="root"> has child nodes — renderer actually painted something
//   4. window.kodaxSpace preload bridge is exposed
//
// CI runs this on every tag-push (ubuntu-latest leg) before the Release job.
// A failure blocks release before broken binaries reach users.

import { test, expect } from '@playwright/test';
import { launchSpace } from './fixtures.js';

const TEST_ID = `renderer-boot-${Date.now()}`;

test('renderer mounts without error in prod-mode launch', async () => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const reactCodeRe = /React error #\d{3}/i;

  // Critical: listeners attached BEFORE launchSpace's domcontentloaded wait.
  // React #310 reconcile errors fire during the first sync render pass,
  // post-launch listeners would miss them (review MEDIUM round-2).
  const space = await launchSpace(TEST_ID, {
    onConsole: (msg) => {
      if (msg.type === 'error') consoleErrors.push(msg.text);
    },
    onPageError: (err) => pageErrors.push(err.message),
  });

  try {
    // launchSpace already awaited domcontentloaded. Extra 5s for any
    // post-mount async errors (store-hydrate / IPC settle).
    await space.page.waitForTimeout(5000);

    const reactErrors = consoleErrors.filter((e) => reactCodeRe.test(e));
    expect(reactErrors, `React reconciler errors:\n${reactErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `Uncaught renderer pageerror:\n${pageErrors.join('\n')}`).toEqual([]);

    // <div id="root"> populated → React actually rendered something.
    // Catches "renderer crashed before paint".
    const rootPainted = await space.page.evaluate(() => {
      const root = document.getElementById('root');
      return root !== null && root.childNodes.length > 0;
    });
    expect(rootPainted, 'renderer #root is empty after 5s').toBe(true);

    // Preload bridge exposed — proxy for "preload script loaded cleanly".
    const hasBridge = await space.page.evaluate(() => {
      const ks = (window as unknown as { kodaxSpace?: unknown }).kodaxSpace;
      return ks !== undefined && ks !== null;
    });
    expect(hasBridge, 'preload bridge window.kodaxSpace not exposed').toBe(true);
  } finally {
    await space.close();
  }
});
