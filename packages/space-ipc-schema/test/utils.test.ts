// truncateZodError tests — OC-09
//
// 验收：
//   1. issue 只保留 { path, code, message }，剥掉 received / expected 字段
//   2. 序列化后 <= maxLen 字符
//   3. 截断时 truncated=true + totalIssues 保留原始总数
//   4. 即使单个 issue 已超 maxLen，至少留 1 条让 debugger 有线索

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { truncateZodError } from '../src/utils.js';

test('strips raw value from issues; keeps path/code/message only', () => {
  const schema = z.object({ name: z.string() });
  const result = schema.safeParse({ name: 12345 });
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!);
  assert.equal(truncated.totalIssues, 1);
  assert.equal(truncated.issues.length, 1);
  const issue = truncated.issues[0];
  // 只有这 3 个字段，no raw value
  assert.deepEqual(Object.keys(issue).sort(), ['code', 'message', 'path']);
  assert.equal(issue.path, 'name');
  // 'received' 不在结果里 (即使 Zod issue 内部有)
  assert.equal((issue as Record<string, unknown>).received, undefined);
});

test('serialized output stays within maxLen', () => {
  // 构造一个会产生很多 issue 的 schema（10 个必填字段都缺）
  const shape: Record<string, z.ZodString> = {};
  for (let i = 0; i < 20; i++) {
    shape[`field_${i}_with_longish_name`] = z.string();
  }
  const schema = z.object(shape);
  const result = schema.safeParse({});
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!, 256);
  assert.ok(JSON.stringify(truncated.issues).length <= 256,
    `issues JSON should fit in 256 chars, got ${JSON.stringify(truncated.issues).length}`);
});

test('truncated=true when output drops issues; totalIssues keeps original count', () => {
  const shape: Record<string, z.ZodString> = {};
  for (let i = 0; i < 30; i++) {
    shape[`field_${i}`] = z.string();
  }
  const schema = z.object(shape);
  const result = schema.safeParse({});
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!, 256);
  assert.equal(truncated.totalIssues, 30);
  assert.ok(truncated.truncated, 'should mark truncated=true');
  assert.ok(truncated.issues.length < 30, 'should have dropped some issues');
  assert.ok(truncated.issues.length >= 1, 'should keep at least one issue for debugging');
});

test('no truncation when all issues fit', () => {
  const schema = z.object({ a: z.string(), b: z.string() });
  const result = schema.safeParse({ a: 1, b: 2 });
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!);
  assert.equal(truncated.truncated, false);
  assert.equal(truncated.issues.length, truncated.totalIssues);
});
