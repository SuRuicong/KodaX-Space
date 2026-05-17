// Permission display sanitization tests — review H3-sec
//
// 验证 main 端 push 给 renderer 之前剥控制字符 / RTL override / 零宽 / BOM，
// 防止 LLM 用 "‮read" 把 write 操作显示成 "etirw"。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForDisplay, sanitizeInputForDisplay } from '../permission/sanitize.js';

test('strips RTL override (U+202E)', () => {
  const out = sanitizeForDisplay('‮read', 100);
  assert.equal(out, 'read');
});

test('strips zero-width chars and joiner', () => {
  const out = sanitizeForDisplay('a​b‌c‍d', 100);
  assert.equal(out, 'abcd');
});

test('strips BOM (U+FEFF)', () => {
  const out = sanitizeForDisplay('﻿text', 100);
  assert.equal(out, 'text');
});

test('strips C0 control chars', () => {
  const out = sanitizeForDisplay('a\x00b\x01c\x1fd', 100);
  assert.equal(out, 'abcd');
});

test('strips DEL + C1 control chars', () => {
  const out = sanitizeForDisplay('a\x7fb\x80c\x9fd', 100);
  assert.equal(out, 'abcd');
});

test('strips isolate codes (U+2066-2069)', () => {
  const out = sanitizeForDisplay('⁦write⁩', 100);
  assert.equal(out, 'write');
});

test('collapses whitespace after stripping invisibles', () => {
  // BOM strip 后留下普通 space，再被 \s+ 折叠
  const out = sanitizeForDisplay('hello﻿  world', 100);
  assert.equal(out, 'hello world');
});

test('truncates with ellipsis when over maxLen (Unicode-safe)', () => {
  const long = 'a'.repeat(50);
  const out = sanitizeForDisplay(long, 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith('…'));
});

test('truncate respects surrogate-pair emoji (Array.from semantics)', () => {
  // 🔥 = U+1F525 (surrogate pair in UTF-16). Array.from 把它当 1 个元素切
  const emoji = '🔥'.repeat(30);
  const out = sanitizeForDisplay(emoji, 10);
  assert.equal(Array.from(out).length, 10);
});

test('empty string returns empty (no Untitled fallback)', () => {
  assert.equal(sanitizeForDisplay('', 100), '');
  assert.equal(sanitizeForDisplay('​﻿', 100), '');
});

test('sanitizeInputForDisplay strips RTL in nested string fields', () => {
  const input = {
    path: '‮src/main.ts',
    content: 'normal text',
    flags: ['​zero', 'clean'],
  };
  const out = sanitizeInputForDisplay(input);
  assert.equal(out?.path, 'src/main.ts');
  assert.equal(out?.content, 'normal text');
  assert.deepEqual(out?.flags, ['zero', 'clean']);
});

test('sanitizeInputForDisplay preserves non-string values', () => {
  const input = {
    count: 42,
    enabled: true,
    nested: null,
    arr: [1, 2, 'normal'],
  };
  const out = sanitizeInputForDisplay(input);
  assert.equal(out?.count, 42);
  assert.equal(out?.enabled, true);
  assert.equal(out?.nested, null);
  assert.deepEqual(out?.arr, [1, 2, 'normal']);
});

test('sanitizeInputForDisplay handles undefined input', () => {
  assert.equal(sanitizeInputForDisplay(undefined), undefined);
});

test('long strings in input are truncated to 4096', () => {
  const big = 'x'.repeat(5000);
  const out = sanitizeInputForDisplay({ content: big });
  const c = out?.content as string;
  assert.equal(c.length, 4096);
});
