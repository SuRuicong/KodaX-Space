// user-config tests — v0.1.6 cleanup
//
// loader 是 SDK loadConfig 的薄包装；测试用 setUserConfigImpl 注入 mock 验证：
//   - 默认值字段映射 (provider/model/thinking/reasoningMode/permissionMode/customProvidersCount)
//   - permissionMode 只接 'plan' / 'accept-edits'，KodaX 的 'default'/'bypass-permissions' → undefined
//   - reasoningCeiling > reasoningMode 优先 (v0.7.29 兼容)
//   - registerKodaxCustomProviders 把数组传给 SDK；空 / undefined skip
//   - SDK loadConfig 抛异常 fallback 全 undefined + count=0
//
// 不测 SDK 端 loadConfig 真行为—— DI mock 隔离。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadKodaxCustomProviders,
  loadKodaxUserDefaults,
  registerKodaxCustomProviders,
  setUserConfigImpl,
  type KodaxUserConfigImpl,
} from '../kodax/user-config.js';

afterEach(() => {
  setUserConfigImpl(null); // 恢复 default
});

function mockUserConfig(
  config: Record<string, unknown>,
  hooks: Partial<{
    registerCalls: Array<{ customProviders?: unknown[] }>;
    throwOnLoad: Error;
    throwOnRegister: Error;
  }> = {},
): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => {
      if (hooks.throwOnLoad) throw hooks.throwOnLoad;
      return config;
    }) as never,
    registerCustomProviders: ((cfg: { customProviders?: unknown[] }) => {
      if (hooks.throwOnRegister) throw hooks.throwOnRegister;
      hooks.registerCalls?.push(cfg);
    }) as never,
  };
  setUserConfigImpl(impl);
}

test('empty config → all undefined + count=0', async () => {
  mockUserConfig({});
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, undefined);
  assert.equal(d.model, undefined);
  assert.equal(d.thinking, undefined);
  assert.equal(d.reasoningMode, undefined);
  assert.equal(d.permissionMode, undefined);
  assert.equal(d.customProvidersCount, 0);
});

test('full config maps all scalars', async () => {
  mockUserConfig({
    provider: 'ark-coding',
    model: 'glm-5.1',
    thinking: true,
    reasoningMode: 'auto',
    permissionMode: 'accept-edits',
    customProviders: [{ name: 'a' }, { name: 'b' }],
  });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, 'ark-coding');
  assert.equal(d.model, 'glm-5.1');
  assert.equal(d.thinking, true);
  assert.equal(d.reasoningMode, 'auto');
  assert.equal(d.permissionMode, 'accept-edits');
  assert.equal(d.customProvidersCount, 2);
});

test('reasoningCeiling preferred over reasoningMode when both set (v0.7.29+ compat)', async () => {
  mockUserConfig({
    reasoningMode: 'quick',
    reasoningCeiling: 'deep',
  });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, 'deep');
});

test('reasoningCeiling alone is used', async () => {
  mockUserConfig({ reasoningCeiling: 'balanced' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, 'balanced');
});

test('reasoning invalid value → undefined', async () => {
  mockUserConfig({ reasoningMode: 'nonsense' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.reasoningMode, undefined);
});

test('KodaX permissionMode "default" → undefined (Space schema has no "default")', async () => {
  mockUserConfig({ permissionMode: 'default' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.permissionMode, undefined);
});

test('KodaX permissionMode "bypass-permissions" → undefined (Space uses auto+rules instead)', async () => {
  mockUserConfig({ permissionMode: 'bypass-permissions' });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.permissionMode, undefined);
});

test('KodaX permissionMode "plan" / "accept-edits" → 1:1 map', async () => {
  mockUserConfig({ permissionMode: 'plan' });
  assert.equal((await loadKodaxUserDefaults()).permissionMode, 'plan');
  mockUserConfig({ permissionMode: 'accept-edits' });
  assert.equal((await loadKodaxUserDefaults()).permissionMode, 'accept-edits');
});

test('SDK loadConfig throws → safe fallback', async () => {
  mockUserConfig({}, { throwOnLoad: new Error('SDK boom') });
  const d = await loadKodaxUserDefaults();
  assert.equal(d.provider, undefined);
  assert.equal(d.customProvidersCount, 0);
});

test('empty / non-string provider → undefined', async () => {
  mockUserConfig({ provider: '' });
  assert.equal((await loadKodaxUserDefaults()).provider, undefined);
  mockUserConfig({ provider: 123 });
  assert.equal((await loadKodaxUserDefaults()).provider, undefined);
});

test('loadKodaxCustomProviders exposes SDK config custom providers as Space summaries', async () => {
  mockUserConfig({
    customProviders: [
      {
        name: 'newapi-anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'NEWAPI_API_KEY',
        model: 'claude-sonnet-4-6',
        models: ['claude-sonnet-4-6', { id: 'claude-opus-4-7' }],
      },
      {
        name: 'unsafe/provider',
        protocol: 'openai',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'UNSAFE_API_KEY',
        model: 'gpt-5',
      },
    ],
  });

  const providers = await loadKodaxCustomProviders();
  assert.deepEqual(providers, [
    {
      id: 'newapi-anthropic',
      displayName: 'newapi-anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://llm.example.com/v1',
      apiKeyEnv: 'NEWAPI_API_KEY',
      defaultModel: 'claude-sonnet-4-6',
      models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
    },
  ]);
});

test('registerKodaxCustomProviders forwards customProviders array to SDK', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    { customProviders: [{ name: 'p1', protocol: 'anthropic' }] },
    { registerCalls: calls },
  );
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customProviders?.length, 1);
});

test('registerKodaxCustomProviders merges Space custom providers into SDK registry config', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    {
      customProviders: [
        {
          name: 'sdk-custom',
          protocol: 'openai',
          baseUrl: 'https://sdk.example.com/v1',
          apiKeyEnv: 'SDK_API_KEY',
          model: 'sdk-model',
        },
      ],
    },
    { registerCalls: calls },
  );

  await registerKodaxCustomProviders([
    {
      id: 'custom_0123456789abcdef',
      protocol: 'anthropic',
      baseUrl: 'https://space.example.com/v1',
      apiKeyEnv: 'SPACE_API_KEY',
      defaultModel: 'space-model',
      models: ['space-model', 'space-alt'],
    },
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].customProviders, [
    {
      name: 'sdk-custom',
      protocol: 'openai',
      baseUrl: 'https://sdk.example.com/v1',
      apiKeyEnv: 'SDK_API_KEY',
      model: 'sdk-model',
    },
    {
      name: 'custom_0123456789abcdef',
      protocol: 'anthropic',
      baseUrl: 'https://space.example.com/v1',
      apiKeyEnv: 'SPACE_API_KEY',
      model: 'space-model',
      models: ['space-model', 'space-alt'],
    },
  ]);
});

test('registerKodaxCustomProviders skips when customProviders empty', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({ customProviders: [] }, { registerCalls: calls });
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders skips when customProviders absent', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({}, { registerCalls: calls });
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders silent on SDK loadConfig throw', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    { customProviders: [{ name: 'p1' }] },
    { throwOnLoad: new Error('config corrupt'), registerCalls: calls },
  );
  // 不应抛
  await registerKodaxCustomProviders();
  assert.equal(calls.length, 0);
});

test('registerKodaxCustomProviders silent when registerCustomProviders throws after successful loadConfig (reviewer LOW-B)', async () => {
  const calls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig(
    { customProviders: [{ name: 'p1', protocol: 'anthropic' }] },
    { throwOnRegister: new Error('LLM registry rejected'), registerCalls: calls },
  );
  // SDK loadConfig 成功，registerCustomProviders 抛 — Space 应当吞掉异常不阻塞启动
  await registerKodaxCustomProviders();
  // calls 数组没 push (因为 throw 在 push 前)，但更重要是 await 完成不向上抛
  assert.equal(calls.length, 0);
});
