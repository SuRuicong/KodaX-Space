// 2026-06-18 — artifact.previewFile 的两块核心逻辑：
//   ① previewKindForPath：扩展名 → 可预览 artifact kind
//   ② 去重：同一 (sessionId, title) 的重复预览复用 id 升版本（不刷出一堆副本）
// handler 走 IPC + electron shell（node:test 无 electron runtime 难直测），这里直测可抽离的
// 纯逻辑 + 用真实 ArtifactStore 锁定去重行为（同 artifact-store.test.ts 的 DI 临时目录约定）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { previewKindForPath } from '../ipc/artifact.js';

test('previewKindForPath: html/svg/md → 对应 kind，其它 → code', () => {
  assert.equal(previewKindForPath('a/index.html'), 'html');
  assert.equal(previewKindForPath('a/page.htm'), 'html');
  assert.equal(previewKindForPath('logo.svg'), 'svg');
  assert.equal(previewKindForPath('README.md'), 'markdown');
  assert.equal(previewKindForPath('notes.markdown'), 'markdown');
  assert.equal(previewKindForPath('app.ts'), 'code');
  assert.equal(previewKindForPath('data.json'), 'code');
  assert.equal(previewKindForPath('Makefile'), 'code');
  assert.equal(previewKindForPath('STYLE.CSS'), 'code'); // 大小写不敏感
});

test('previewFile 去重：同 (session,title,kind) 复用 id 升版本，不同 title 新建', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-file-'));
  const store = new ArtifactStore(join(dir, 'artifacts.json'), dir);
  try {
    const title = 'src/index.html';
    const surface = 'code' as const;

    // 首次预览 → 新建 v1
    const first = await store.upsert({
      sessionId: 's1', surface, kind: 'html', title, content: '<h1>v1</h1>',
    });
    assert.equal(first.created, true);
    assert.equal(first.version, 1);

    // 模拟 handler 的去重查找：list 找同 title+kind
    const existing = (await store.list({ sessionId: 's1' })).find(
      (a) => a.kind === 'html' && a.title === title,
    );
    assert.ok(existing, '应找到已存在的同名预览 artifact');

    // 复用 id → 升 v2（不新建）
    const second = await store.upsert({
      sessionId: 's1', surface, kind: 'html', title, content: '<h1>v2</h1>', id: existing!.id,
    });
    assert.equal(second.created, false);
    assert.equal(second.version, 2);
    assert.equal(second.id, first.id);

    // 列表里仍只有一条该预览（被复用而非翻倍）
    const htmlPreviews = (await store.list({ sessionId: 's1' })).filter(
      (a) => a.kind === 'html' && a.title === title,
    );
    assert.equal(htmlPreviews.length, 1);

    // 不同 title → 新建独立 artifact
    const other = await store.upsert({
      sessionId: 's1', surface, kind: 'html', title: 'src/about.html', content: '<p/>',
    });
    assert.equal(other.created, true);
    assert.notEqual(other.id, first.id);

    // 最新内容可读回 v2
    const read = await store.read(first.id);
    assert.equal(read?.content, '<h1>v2</h1>');
    assert.equal(read?.version, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
