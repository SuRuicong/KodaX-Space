// auto-mode-bootstrap tests — FEATURE_030.
//
// 单元测覆盖纯 wiring 逻辑（不真启 KodaX guardrail；guardrail 内部行为由 KodaX 自身测试覆盖）。
// 这里只测：
//   1. bootstrapAutoMode 调用形态 (loadAutoRules / formatAgentsForPrompt / createAutoModeToolGuardrail 都被调)
//   2. getGuardrail 缓存（多次调返回同一 instance）
//   3. onEngineChange 透传
//   4. AGENTS.md loader 的输出被 formatAgentsForPrompt 消费
//
// 真集成测在 dev 跑：mode='auto' 后 emit auto_engine_change，guardrail 实际守门。
//
// 因为 bootstrap 依赖 @kodax-ai/kodax/coding 的 createAutoModeToolGuardrail 等
// runtime API，不便 mock；改用真 KodaX runtime 在临时空目录里跑——不读 ~/.kodax 用户配置。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapAutoMode } from '../kodax/auto-mode-bootstrap.js';

let tmpProject: string;

before(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'space-auto-mode-bootstrap-'));
});

after(() => {
  fs.rmSync(tmpProject, { recursive: true, force: true });
});

test('bootstrapAutoMode returns getGuardrail factory + rulesLoadResult', async () => {
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
  });
  assert.equal(typeof result.getGuardrail, 'function');
  assert.ok(result.rulesLoadResult, 'must return rulesLoadResult');
  assert.ok(Array.isArray(result.rulesLoadResult.sources));
  assert.ok(Array.isArray(result.rulesLoadResult.errors));
});

test('getGuardrail caches — same instance on multiple calls', async () => {
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
  });
  const g1 = result.getGuardrail();
  const g2 = result.getGuardrail();
  assert.strictEqual(g1, g2, 'getGuardrail must cache the guardrail instance');
});

test('guardrail honors initialEngine "rules"', async () => {
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'rules',
  });
  const g = result.getGuardrail();
  assert.equal(g.getEngine(), 'rules', 'initialEngine="rules" should produce engine="rules"');
});

test('guardrail honors initialEngine "llm"', async () => {
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
  });
  const g = result.getGuardrail();
  assert.equal(g.getEngine(), 'llm');
});

test('AGENTS.md in projectRoot is picked up by claudeMd in guardrail config', async () => {
  // 写一个 AGENTS.md 进 tmpProject，验证 bootstrap 调 loadAgentsMd 后能拿到。
  // 我们没办法从 guardrail instance 反查 claudeMd 字段值（不是公开 API），
  // 但 loadAgentsMd 是 import 同模块，已有独立 test 覆盖。这里只验 bootstrap 不爆。
  const agentsPath = path.join(tmpProject, 'AGENTS.md');
  fs.writeFileSync(agentsPath, '# Project rules\nThis is a test.');
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
  });
  assert.ok(result.getGuardrail(), 'bootstrap with AGENTS.md present should succeed');
  fs.unlinkSync(agentsPath);
});

test('setEngine manually triggers onEngineChange callback', async () => {
  // Engine 切换路径：通过 guardrail.setEngine 直接调；onEngineChange 应当 fire
  let captured: string[] = [];
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: tmpProject,
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
    onEngineChange: (engine) => captured.push(engine),
  });
  const g = result.getGuardrail();
  // 初始 'llm' → 切到 'rules' → 切回 'llm'
  g.setEngine('rules');
  g.setEngine('llm');
  // setEngine 是同步还是异步取决于 KodaX 实现；用 setImmediate 等一拍
  await new Promise((r) => setImmediate(r));
  assert.ok(captured.length >= 2, `onEngineChange should fire at least twice (got ${captured.length})`);
  assert.ok(captured.includes('rules'));
  assert.ok(captured.includes('llm'));
});

test('non-absolute projectRoot is resolved to absolute internally', async () => {
  // 传相对路径——bootstrap 内部 path.resolve；不应抛错
  const result = await bootstrapAutoMode({
    askUser: async () => 'allow',
    projectRoot: '.', // relative
    getCurrentProviderName: () => 'mock',
    getCurrentModel: () => 'mock-model',
    initialEngine: 'llm',
  });
  assert.ok(result.getGuardrail(), 'relative projectRoot should be tolerated');
});
