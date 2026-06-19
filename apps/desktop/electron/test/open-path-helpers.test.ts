// 2026-06-18 — openPath 智能路由的纯函数（路径分类 / 归一化 / inline-code 路径识别）。
// renderer util，从 electron node:test 跑（同 chart-spec.test.ts 的跨树测试约定）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extOf,
  isPreviewablePath,
  isCodePath,
  looksLikeFilePath,
  toProjectRelative,
} from '../../renderer/src/lib/pathClassify.js';

test('extOf: 取小写扩展名，无扩展名返空', () => {
  assert.equal(extOf('src/index.html'), 'html');
  assert.equal(extOf('C:\\proj\\App.TSX'), 'tsx');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('.gitignore'), ''); // 前导点不是扩展名
  assert.equal(extOf('a/b/c'), '');
  assert.equal(extOf('archive.tar.gz'), 'gz');
});

test('isPreviewablePath: 仅 html/svg/md 系可在 Artifact 预览', () => {
  for (const p of ['x.html', 'x.htm', 'logo.svg', 'README.md', 'notes.markdown']) {
    assert.equal(isPreviewablePath(p), true, p);
  }
  for (const p of ['app.ts', 'data.json', 'photo.png', 'doc.pdf', 'noext']) {
    assert.equal(isPreviewablePath(p), false, p);
  }
});

test('isCodePath: 代码/文本走 diff；html/svg/md 不算 code（无 session 时落 reveal）', () => {
  for (const p of ['app.ts', 'main.go', 'styles.css', 'data.json', 'Dockerfile', '.gitignore']) {
    assert.equal(isCodePath(p), true, p);
  }
  // html/svg/md 归 previewable，不在 code 集合 —— 保证无 session 时 html 不会在 diff 看源码
  for (const p of ['index.html', 'logo.svg', 'README.md', 'photo.png', 'doc.pdf']) {
    assert.equal(isCodePath(p), false, p);
  }
});

test('looksLikeFilePath: 宁缺毋滥 —— 需以已知扩展名结尾、无空白、非 URL', () => {
  // 命中
  for (const s of ['src/index.html', 'app.tsx', 'C:\\x\\y.html', './a/b.css', 'package.json']) {
    assert.equal(looksLikeFilePath(s), true, s);
  }
  // 不命中
  for (const s of [
    'e.g',                // 未知扩展名
    'a.b',                // 未知扩展名
    'npm run dev',        // 含空白
    'https://x.com/a.html', // URL
    '',                   // 空
    'just text',          // 含空白
    'arr[0].length',      // 未知扩展名
  ]) {
    assert.equal(looksLikeFilePath(s), false, s);
  }
});

test('looksLikeFilePath: rejects traversal and dotenv secrets for auto-linking', () => {
  for (const s of ['../secrets/config.json', 'src/../package.json', '.env', 'config/.env.local']) {
    assert.equal(looksLikeFilePath(s), false, s);
  }
  assert.equal(looksLikeFilePath('.env.example'), false);
});

test('toProjectRelative: 绝对路径剥 projectRoot 前缀 → posix 相对路径', () => {
  // Windows 风格 + 反斜杠 + 大小写不敏感前缀
  assert.equal(
    toProjectRelative('C:\\proj\\src\\index.html', 'C:\\proj'),
    'src/index.html',
  );
  assert.equal(
    toProjectRelative('C:/Proj/src/a.ts', 'c:/proj'),
    'src/a.ts',
  );
  // posix
  assert.equal(toProjectRelative('/home/u/proj/src/a.ts', '/home/u/proj'), 'src/a.ts');
  // 已经是相对：原样（去前导斜杠）
  assert.equal(toProjectRelative('src/a.ts', '/home/u/proj'), 'src/a.ts');
  assert.equal(toProjectRelative('/src/a.ts', null), 'src/a.ts');
  // 不在 projectRoot 下：原样（交由 main 端 resolveInsideProject 拒绝）
  assert.equal(toProjectRelative('/etc/passwd', '/home/u/proj'), 'etc/passwd');
  // projectRoot 带尾斜杠
  assert.equal(toProjectRelative('/p/x.md', '/p/'), 'x.md');
});
