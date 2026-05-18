// agents-md-loader tests — FEATURE_034 stub for FEATURE_030 bootstrap.
//
// 覆盖：
//   1. 两处都不存在 → []
//   2. 仅 global 存在 → [global]
//   3. 仅 project 存在 → [project]
//   4. 都存在 → [global, project]（顺序为 KodaX prompt builder 期望）
//   5. 文件超 256KB → 内容被截断 + marker
//   6. projectRoot 非 absolute → [] + warning
//   7. project 与 global 物理同文件 → 不重复
//   8. permission error / 非文件 → skip + warning，不抛

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAgentsMd } from '../kodax/agents-md-loader.js';

let tmpRoot: string;
let projectRoot: string;
let kodaxGlobalDir: string;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'space-agents-md-test-'));
  projectRoot = path.join(tmpRoot, 'project');
  kodaxGlobalDir = path.join(tmpRoot, '.kodax');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(kodaxGlobalDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function cleanFiles(): void {
  for (const p of [
    path.join(projectRoot, 'AGENTS.md'),
    path.join(kodaxGlobalDir, 'AGENTS.md'),
  ]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

test('neither file exists → empty array', () => {
  cleanFiles();
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.deepEqual(result, []);
});

test('only global exists → one entry with scope=global', () => {
  cleanFiles();
  fs.writeFileSync(path.join(kodaxGlobalDir, 'AGENTS.md'), '# Global rules');
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 1);
  assert.equal(result[0].scope, 'global');
  assert.equal(result[0].content, '# Global rules');
});

test('only project exists → one entry with scope=project', () => {
  cleanFiles();
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project rules');
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 1);
  assert.equal(result[0].scope, 'project');
  assert.equal(result[0].content, '# Project rules');
});

test('both exist → global first, project second (KodaX prompt builder priority)', () => {
  cleanFiles();
  fs.writeFileSync(path.join(kodaxGlobalDir, 'AGENTS.md'), '# Global');
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project');
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 2);
  assert.equal(result[0].scope, 'global');
  assert.equal(result[1].scope, 'project');
});

test('file over 256KB (ASCII) is truncated with marker', () => {
  cleanFiles();
  const big = 'x'.repeat(256 * 1024 + 100);
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), big);
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 1);
  assert.ok(result[0].content.endsWith('[truncated by Space loader at 256KB]'));
  assert.ok(result[0].content.length < big.length);
});

test('file over 256KB (CJK / multi-byte) is truncated by byte not char count', () => {
  // 防 byte-vs-char 退化：一个汉字在 UTF-8 是 3 byte。
  // 100K 汉字 ≈ 300KB byte，但 string.length 只有 100K UTF-16 unit。
  // stat.size guard 必须能命中（byte 计量），否则整文件读进内存破坏 size cap。
  cleanFiles();
  const cjk = '中'.repeat(100 * 1024); // ≈ 300 KB UTF-8
  const written = Buffer.byteLength(cjk, 'utf8');
  assert.ok(written > 256 * 1024, 'sanity: CJK fixture must exceed 256KB byte');
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), cjk);
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 1);
  assert.ok(result[0].content.endsWith('[truncated by Space loader at 256KB]'),
    'CJK over-size must trigger byte-based truncation');
  // 截断后的内容（含 marker）byte 数应小于原 + marker 余量
  const truncatedBytes = Buffer.byteLength(result[0].content, 'utf8');
  assert.ok(truncatedBytes <= 256 * 1024 + 100, `truncated byte length ${truncatedBytes} should be near 256KB`);
});

test('non-absolute projectRoot is rejected with warning, returns []', () => {
  cleanFiles();
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), 'will not be read');
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const result = loadAgentsMd({ projectRoot: 'relative/path', kodaxGlobalDir });
    assert.deepEqual(result, []);
    assert.ok(warnings.some((w) => w.includes('must be absolute')), 'should warn about non-absolute');
  } finally {
    console.warn = originalWarn;
  }
});

test('projectRoot === kodaxGlobalDir does not duplicate', () => {
  cleanFiles();
  const samePath = path.join(tmpRoot, 'same');
  fs.mkdirSync(samePath, { recursive: true });
  fs.writeFileSync(path.join(samePath, 'AGENTS.md'), '# Just one');
  const result = loadAgentsMd({ projectRoot: samePath, kodaxGlobalDir: samePath });
  assert.equal(result.length, 1, 'must not double-count the same physical file');
});

test('AGENTS.md is a directory not a file → skipped', () => {
  cleanFiles();
  const trickyPath = path.join(projectRoot, 'AGENTS.md');
  // 把 AGENTS.md 制造成目录
  fs.mkdirSync(trickyPath);
  try {
    const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
    assert.equal(result.length, 0, 'directory at expected file path should be skipped');
  } finally {
    fs.rmdirSync(trickyPath);
  }
});

test('exact 256KB file is not truncated (boundary case)', () => {
  cleanFiles();
  const exactSize = 'y'.repeat(256 * 1024);
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), exactSize);
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  assert.equal(result.length, 1);
  assert.equal(result[0].content.length, 256 * 1024, 'exact 256KB should not trigger truncation');
  assert.ok(!result[0].content.includes('truncated'), 'no truncation marker at boundary');
});

test('returns absolute paths in path field', () => {
  cleanFiles();
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# P');
  fs.writeFileSync(path.join(kodaxGlobalDir, 'AGENTS.md'), '# G');
  const result = loadAgentsMd({ projectRoot, kodaxGlobalDir });
  for (const f of result) {
    assert.ok(path.isAbsolute(f.path), `path must be absolute: ${f.path}`);
  }
});
