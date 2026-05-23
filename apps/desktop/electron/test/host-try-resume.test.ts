// host.tryResume — bring a persisted-only session back into the in-flight Map.
//
// 用户场景：重启 Space 后 main 进程 in-flight Map 是空的，但磁盘 ~/.kodax/sessions/ 仍
// 有 jsonl。Sidebar 的 Recents 把 persisted session 也列出来。点击它 → setCurrentSession
// → 用户打字 → session.send IPC handler 走 tryResume() 把它接管回 in-flight。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import { installSessionStoreMock, type MockSessionState } from './_helpers/session-store-mock.js';

let mockState: MockSessionState;

beforeEach(async () => {
  mockState = installSessionStoreMock();
  await kodaxHost.disposeAll();
  // 不需要真 push；测试只看 host.sessions Map 的状态变化
  setRendererTarget(() => null);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  mockState.reset();
});

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

test('tryResume bails out when persisted session lacks gitRoot', async () => {
  const id = 's_no-gitroot';
  // 不通过 seed 走，而是直接往 mock 里塞一个缺 gitRoot 的条目。当前 mock helper 不支持
  // 这种 shape，但我们可以通过空 string gitRoot 模拟近似 case：
  mockState.seed(id, '', 'broken');
  const ok = await kodaxHost.tryResume(id);
  assert.equal(ok, false, '空 gitRoot 应当被 tryResume 视为不可恢复');
  assert.equal(kodaxHost.get(id), undefined);
});
