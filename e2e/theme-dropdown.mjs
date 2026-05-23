// Verify ThemeToggle dropdown + ⇧Ctrl+T shortcut
import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SHOT_DIR = 'c:/tmp/theme';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  args: [path.join(repoRoot, 'dist-electron')],
  cwd: repoRoot,
  env: { ...childEnv, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173', NODE_ENV: 'development' },
});

let win = null;
for (let i = 0; i < 30; i++) {
  for (const w of app.windows()) {
    if (w.url().startsWith('http://127.0.0.1:5173')) { win = w; break; }
  }
  if (win) break;
  await new Promise((r) => setTimeout(r, 500));
}

await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2000);
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
});
await win.waitForTimeout(500);

// 1) 点 toggle 弹 dropdown
const toggleBtn = win.locator('button[aria-label*="Theme"]').first();
await toggleBtn.click();
await win.waitForTimeout(400);
await win.screenshot({ path: `${SHOT_DIR}/dropdown-open.png` });
console.log('[theme-dd] dropdown-open.png saved');

// 验证 dropdown 内容
const hasLight = await win.locator('text=Light').isVisible();
const hasDark = await win.locator('text=Dark').isVisible();
const hasSystem = await win.locator('text=System').isVisible();
console.log(`[theme-dd] options visible — Light: ${hasLight} · Dark: ${hasDark} · System: ${hasSystem}`);

// 选 Light
await win.locator('button:has-text("Light")').first().click();
await win.waitForTimeout(600);
await win.screenshot({ path: `${SHOT_DIR}/dd-after-light.png` });
const htmlAfterLight = await win.evaluate(() => document.documentElement.className);
console.log(`[theme-dd] after picking Light, html class: "${htmlAfterLight}"`);

// 测快捷键 ⇧Ctrl+T 循环
await win.keyboard.press('Control+Shift+T');
await win.waitForTimeout(500);
const themeAfterShortcut1 = await win.evaluate(() => {
  return { html: document.documentElement.className, stored: localStorage.getItem('kodax-space.theme') };
});
console.log(`[theme-dd] after ⇧Ctrl+T: html="${themeAfterShortcut1.html}", stored=${themeAfterShortcut1.stored}`);

await win.keyboard.press('Control+Shift+T');
await win.waitForTimeout(500);
const themeAfterShortcut2 = await win.evaluate(() => {
  return { html: document.documentElement.className, stored: localStorage.getItem('kodax-space.theme') };
});
console.log(`[theme-dd] after ⇧Ctrl+T x2: html="${themeAfterShortcut2.html}", stored=${themeAfterShortcut2.stored}`);

await win.keyboard.press('Control+Shift+T');
await win.waitForTimeout(500);
const themeAfterShortcut3 = await win.evaluate(() => {
  return { html: document.documentElement.className, stored: localStorage.getItem('kodax-space.theme') };
});
console.log(`[theme-dd] after ⇧Ctrl+T x3: html="${themeAfterShortcut3.html}", stored=${themeAfterShortcut3.stored}`);

await app.close();
process.exit(0);
