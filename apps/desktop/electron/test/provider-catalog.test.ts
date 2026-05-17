// Built-in provider catalog tests — FEATURE_004
//
// 验收：
//   - 13 个 built-in providers 全部存在
//   - id / apiKeyEnv / protocol 唯一性 + 必填
//   - getBuiltin / isBuiltinId 行为正确
//   - 字段约束符合 schema（id 长度、protocol enum）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PROVIDERS, getBuiltin, isBuiltinId } from '../providers/catalog.js';

test('catalog has 13 built-in providers', () => {
  assert.equal(BUILTIN_PROVIDERS.length, 13);
});

test('all built-in provider ids are unique', () => {
  const ids = BUILTIN_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('all built-in providers have non-empty displayName + apiKeyEnv + defaultModel', () => {
  for (const p of BUILTIN_PROVIDERS) {
    assert.ok(p.displayName.length > 0, `${p.id} missing displayName`);
    assert.ok(p.apiKeyEnv.length > 0, `${p.id} missing apiKeyEnv`);
    assert.ok(p.defaultModel.length > 0, `${p.id} missing defaultModel`);
  }
});

test('all built-in protocols are in valid enum', () => {
  const validProtocols = new Set(['anthropic', 'openai', 'gemini-cli', 'codex-cli']);
  for (const p of BUILTIN_PROVIDERS) {
    assert.ok(validProtocols.has(p.protocol), `${p.id} has invalid protocol: ${p.protocol}`);
  }
});

test('catalog includes expected anchor providers (anthropic, openai, zhipu-coding)', () => {
  const ids = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
  assert.ok(ids.has('anthropic'));
  assert.ok(ids.has('openai'));
  assert.ok(ids.has('zhipu-coding'));
});

test('apiKeyEnv values match KodaX upstream catalog (env var naming convention)', () => {
  // 关键 provider 的 apiKeyEnv 必须与 KodaX 端一致——SDK 通过相同 env 读 key
  const expected: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    'zhipu-coding': 'ZHIPU_API_KEY',
    'zhipu': 'ZHIPU_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    kimi: 'KIMI_API_KEY',
    'kimi-code': 'KIMI_API_KEY', // 共享 KIMI_API_KEY
  };
  for (const [id, env] of Object.entries(expected)) {
    const p = getBuiltin(id);
    assert.ok(p, `missing provider ${id}`);
    assert.equal(p.apiKeyEnv, env, `${id} apiKeyEnv mismatch`);
  }
});

test('getBuiltin returns undefined for unknown id', () => {
  assert.equal(getBuiltin('made-up-provider'), undefined);
});

test('isBuiltinId true for known, false for unknown / custom_ prefix', () => {
  assert.equal(isBuiltinId('anthropic'), true);
  assert.equal(isBuiltinId('made-up'), false);
  assert.equal(isBuiltinId('custom_abc12345'), false);
});

test('CLI-bridge providers have no testEndpoint (skip HTTP probe)', () => {
  const geminiCli = getBuiltin('gemini-cli');
  const codexCli = getBuiltin('codex-cli');
  assert.equal(geminiCli?.testEndpoint, undefined);
  assert.equal(codexCli?.testEndpoint, undefined);
});
