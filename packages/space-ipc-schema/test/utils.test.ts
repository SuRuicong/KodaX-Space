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

// CRITICAL fix: 防 message 嵌入用户值泄漏
test('invalid_enum_value message is redacted (would otherwise embed value)', () => {
  const schema = z.object({ role: z.enum(['admin', 'user', 'guest']) });
  // 用户原值是个看似 API key 的字符串 —— 不能进 issue.message
  const sensitive = 'sk-ant-secret-key-pretend-leaked-here';
  const result = schema.safeParse({ role: sensitive });
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!);
  const msg = truncated.issues[0].message;
  // 原 Zod message 会有 received '<sensitive>'；redact 后必须不见
  assert.ok(!msg.includes(sensitive), `message must not contain raw value, got: ${msg}`);
  assert.ok(msg.toLowerCase().includes('redacted'), `message should signal redaction, got: ${msg}`);
});

test('unrecognized_keys message is redacted (would otherwise embed key names)', () => {
  const schema = z.object({ name: z.string() }).strict();
  // 假设用户错配字段名，把 API key 当字段名往里塞 (极端案例但 schema 允许任何 string key)
  const sensitive = 'sk-ant-leaked-fieldname';
  const result = schema.safeParse({ name: 'ok', [sensitive]: 'foo' });
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!);
  const msg = truncated.issues[0].message;
  assert.ok(!msg.includes(sensitive), `message must not contain raw key name, got: ${msg}`);
  assert.ok(msg.toLowerCase().includes('redacted'), `message should signal redaction, got: ${msg}`);
});

test('invalid_type message is preserved (safe — only type names)', () => {
  const schema = z.object({ count: z.number() });
  const result = schema.safeParse({ count: 'not a number' });
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!);
  // invalid_type 的 message 只含类型名 ("Expected number, received string")，安全保留
  assert.ok(truncated.issues[0].message.includes('Expected'));
  assert.ok(truncated.issues[0].message.includes('number'));
});

// MEDIUM fix: 单 issue 自身超 maxLen 时 message 应被截短
test('single oversize issue still fits maxLen via message truncation', () => {
  const schema = z.string().refine((s) => s === 'never-matches', {
    // 故意长 message
    message: 'x'.repeat(2000),
  });
  const result = schema.safeParse('foo');
  assert.equal(result.success, false);
  const truncated = truncateZodError(result.error!, 256);
  assert.equal(truncated.issues.length, 1);
  // 整体 serialized 必须 <= maxLen
  const serialized = JSON.stringify(truncated.issues);
  assert.ok(serialized.length <= 256, `should fit in 256 chars, got ${serialized.length}`);
  // message 被截断时应有省略号
  assert.ok(truncated.issues[0].message.endsWith('…'), 'expected ellipsis on truncated message');
});
