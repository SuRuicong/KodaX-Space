// Drift guard: apps/desktop/index.html 头部 inline theme-bootstrap 脚本的 sha256 hash
// 必须跟 main.ts 里 THEME_BOOTSTRAP_INLINE_HASH 常量完全一致。
//
// 否则 prod CSP 拦截 inline 脚本 → React 挂载前的主题 class 加不上 → 首帧 light flash
// （是 v0.1.7 dogfood 时 DevTools 抓到的 "Refused to execute inline script" 警告的根因）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { THEME_BOOTSTRAP_INLINE_HASH } from '../csp-config.js';

test('CSP: theme-bootstrap inline script hash matches index.html source', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../../..');
  const indexHtmlPath = path.join(repoRoot, 'apps/desktop/index.html');
  const html = await fs.readFile(indexHtmlPath, 'utf-8');

  // Extract first inline <script>...</script> — non-greedy match
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'apps/desktop/index.html missing inline <script>');

  const content = m[1]!;
  const base64 = crypto.createHash('sha256').update(content).digest('base64');
  const expected = `sha256-${base64}`;

  assert.equal(
    THEME_BOOTSTRAP_INLINE_HASH,
    expected,
    `THEME_BOOTSTRAP_INLINE_HASH in main.ts is out of date. ` +
      `Update it to: ${expected}\n` +
      `(or revert the apps/desktop/index.html inline script change.)`,
  );
});
