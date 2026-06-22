// host.tryResume — bring a persisted-only session back into the in-flight Map.
//
// 用户场景：重启 Space 后 main 进程 in-flight Map 是空的，但磁盘 ~/.kodax/sessions/ 仍
// 有 jsonl。Sidebar 的 Recents 把 persisted session 也列出来。点击它 → setCurrentSession
// → 用户打字 → session.send IPC handler 走 tryResume() 把它接管回 in-flight。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';
import { setUserConfigImpl, type KodaxUserConfigImpl } from '../kodax/user-config.js';
import { providerConfigStore } from '../providers/config.js';

let mockState: MockSessionState;
let tmpDir = '';

beforeEach(async () => {
  mockState = installSessionStoreMock();
  mockUserConfig({});
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-host-resume-test-'));
  (providerConfigStore as any).spaceCache = null;
  (providerConfigStore as any).customCache = null;
  (providerConfigStore as any).spaceFile = path.join(tmpDir, 'space.json');
  (providerConfigStore as any).spaceDir = tmpDir;
  (providerConfigStore as any).customFile = path.join(tmpDir, 'custom.json');
  (providerConfigStore as any).customDir = tmpDir;
  await kodaxHost.disposeAll();
  // 不需要真 push；测试只看 host.sessions Map 的状态变化
  setRendererTarget(() => null);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  setUserConfigImpl(null);
  mockState.reset();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function mockUserConfig(
  config: Record<string, unknown>,
  opts: { registerCalls?: Array<{ customProviders?: unknown[] }> } = {},
): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => config) as never,
    registerCustomProviders: ((payload: { customProviders?: unknown[] }) => {
      opts.registerCalls?.push(payload);
    }) as never,
  };
  setUserConfigImpl(impl);
}

test('tryResume returns false for sessionId that exists neither in-flight nor on disk', async () => {
  const ok = await kodaxHost.tryResume('s_does-not-exist');
  assert.equal(ok, false);
  assert.equal(kodaxHost.get('s_does-not-exist'), undefined);
});

test('tryResume returns true immediately when session is already in-flight (no-op)', async () => {
  // Use mock provider 走 Mock factory，不依赖真 SDK 加载
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:/proj/example',
    provider: 'mock',
  });
  const sessionBefore = kodaxHost.get(sessionId);
  assert.ok(sessionBefore, 'session should be in-flight after createSession');

  const ok = await kodaxHost.tryResume(sessionId);
  assert.equal(ok, true);
  // Should be the SAME instance — tryResume must not recreate when already in-flight
  assert.equal(kodaxHost.get(sessionId), sessionBefore);
});

test('tryResume rehydrates a persisted-only session into the in-flight Map', async () => {
  // Seed mock storage 模拟磁盘上有这个 session
  const id = 's_persisted-only';
  mockState.seed(id, 'C:/proj/example', '你好');
  assert.equal(kodaxHost.get(id), undefined, 'precondition: not in-flight');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed, 'tryResume should have added to in-flight Map');
  assert.equal(resumed!.sessionId, id);
  assert.equal(resumed!.projectRoot, 'C:/proj/example');
  // title 从 persisted 拉过来
  assert.equal(resumed!.title, '你好');
});

test('tryResume hydrates configured model when it belongs to the resolved provider', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'glm-5.2' });
  const id = 's_resume-model';
  mockState.seed(id, 'C:/proj/example', 'model resume');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.provider, 'zhipu-coding');
  assert.equal(resumed.model, 'glm-5.2');
});

test('tryResume ignores configured model when it does not belong to the resolved provider', async () => {
  mockUserConfig({ provider: 'zhipu-coding', model: 'mimo-v2.5-pro' });
  const id = 's_resume-stale-model';
  mockState.seed(id, 'C:/proj/example', 'stale model');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  const resumed = kodaxHost.get(id);
  assert.ok(resumed);
  assert.equal(resumed.provider, 'zhipu-coding');
  assert.equal(resumed.model, undefined);
});

test('tryResume registers Space custom default provider before rehydrating session', async () => {
  const registerCalls: Array<{ customProviders?: unknown[] }> = [];
  mockUserConfig({}, { registerCalls });
  const customId = await providerConfigStore.addCustom({
    displayName: 'Internal Gateway',
    protocol: 'openai',
    baseUrl: 'http://10.8.0.12:8080/v1',
    skipBaseUrlValidation: true,
    apiKeyEnv: 'INTERNAL_GATEWAY_API_KEY',
    defaultModel: 'gateway-model',
    models: ['gateway-model'],
  });
  await providerConfigStore.setDefault(customId);

  const id = 's_resume-custom-provider';
  mockState.seed(id, 'C:/proj/example', 'custom provider resume');

  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.provider, customId);
  assert.equal(registerCalls.length, 1);
  const registeredNames = registerCalls[0]?.customProviders?.map((p) => (p as { name?: string }).name);
  assert.deepEqual(registeredNames, [customId]);
});

test('tryResume recovers surface from persisted SDK tag (Partner stays Partner)', async () => {
  // F045: 重启后 resume 一个 tag='partner' 的 session，必须恢复成 surface='partner'，
  // 否则它会被默认成 Coder 并在 in-flight 优先 dedup 下整段串面。
  const id = 's_partner-resumed';
  mockState.seedTagged(id, 'C:/proj/example', 'partner', 'doc work');
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.surface, 'partner');
});

test('tryResume defaults surface to "code" for legacy untagged persisted session', async () => {
  const id = 's_legacy-resumed';
  mockState.seed(id, 'C:/proj/example', 'old session'); // 无 tag
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(id)?.surface, 'code');
});

test('tryResume bails out when persisted session lacks gitRoot', async () => {
  const id = 's_no-gitroot';
  // 不通过 seed 走，而是直接往 mock 里塞一个缺 gitRoot 的条目。当前 mock helper 不支持
  // 这种 shape，但我们可以通过空 string gitRoot 模拟近似 case：
  mockState.seed(id, '', 'broken');
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, false, '空 gitRoot 应当被 tryResume 视为不可恢复');
  assert.equal(kodaxHost.get(id), undefined);
});
