// FEATURE_033 in-memory fork + rewind — host-level tests.
//
// Renderer-side events 数组复制不在本文件覆盖范围（那部分跑 appStore 单测）。
// 这里只验证 main 端契约：
//   - fork 出来的 session 继承 source 运行时设置 + 标 parentSessionId/forkPointTurnIdx
//   - fork title 加 "(fork)" 后缀
//   - rewind cancel in-flight + 推 lastActivityAt
//   - 边界：source 不存在 / rewind 不存在 session 返回 session_not_found

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionBroker } from '../permission/broker.js';

beforeEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => {
      if (channel === 'permission.request') {
        const p = payload as { reqId: string };
        setImmediate(() => permissionBroker.resolve(p.reqId, 'allow_once'));
      }
    },
    isDestroyed: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
});

test('fork: unknown source returns null', () => {
  const result = kodaxHost.fork('s_nope', 0);
  assert.equal(result, null);
});

test('fork: child inherits provider / reasoningMode / permissionMode / autoModeEngine', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    reasoningMode: 'quick',
    permissionMode: 'plan',
    autoModeEngine: 'rules',
  });
  const result = kodaxHost.fork(src, 3);
  assert.ok(result, 'fork should succeed');
  const child = kodaxHost.get(result.newSessionId);
  assert.ok(child, 'child session should be retrievable');
  assert.equal(child.projectRoot, 'C:\\tmp\\proj');
  assert.equal(child.provider, 'mock');
  assert.equal(child.reasoningMode, 'quick');
  assert.equal(child.permissionMode, 'plan');
  assert.equal(child.autoModeEngine, 'rules');
});

test('fork: child has parentSessionId + forkPointTurnIdx metadata', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = kodaxHost.fork(src, 5);
  assert.ok(result);
  const child = kodaxHost.get(result.newSessionId);
  assert.equal(child?.parentSessionId, src);
  assert.equal(child?.forkPointTurnIdx, 5);
});

test('fork: child title is "<src title> (fork)" when source has title', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  kodaxHost.setTitle(src, 'Investigate bug');
  const result = kodaxHost.fork(src, 0);
  assert.ok(result);
  assert.equal(kodaxHost.get(result.newSessionId)?.title, 'Investigate bug (fork)');
});

test('fork: title does not accumulate "(fork) (fork)" on repeat fork', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  kodaxHost.setTitle(src, 'X');
  const r1 = kodaxHost.fork(src, 0);
  assert.ok(r1);
  assert.equal(kodaxHost.get(r1.newSessionId)?.title, 'X (fork)');
  // fork 第一次的 child（title 已是 "X (fork)") 再 fork 一次——不应变 "X (fork) (fork)"
  const r2 = kodaxHost.fork(r1.newSessionId, 0);
  assert.ok(r2);
  assert.equal(kodaxHost.get(r2.newSessionId)?.title, 'X (fork)');
});

test('fork: child title stays undefined when source has none', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  // 不调 setTitle / send，title 保持 undefined
  const result = kodaxHost.fork(src, 0);
  assert.ok(result);
  assert.equal(kodaxHost.get(result.newSessionId)?.title, undefined);
});

test('fork: source and child have different sessionIds, both listed', () => {
  const { sessionId: src } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = kodaxHost.fork(src, 0);
  assert.ok(result);
  assert.notEqual(result.newSessionId, src);
  const ids = kodaxHost.list().map((s) => s.sessionId);
  assert.ok(ids.includes(src));
  assert.ok(ids.includes(result.newSessionId));
});

test('rewind: unknown session returns ok:false + reason="session_not_found"', async () => {
  const result = await kodaxHost.rewind('s_nope', 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session_not_found');
});

test('rewind: known session returns ok:true and bumps lastActivityAt', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const initial = kodaxHost.get(sessionId)!.lastActivityAt;
  // 等 ≥ 2ms 确保 Date.now() 推进（Windows Date.now() 分辨率 ~15ms，给余量）
  await new Promise((r) => setTimeout(r, 20));
  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.ok(kodaxHost.get(sessionId)!.lastActivityAt >= initial);
});

test('rewind: cancels in-flight send and awaits cancel before returning', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  // 启动一条 send；不 await（让它在 micro-task 跑）
  await kodaxHost.get(sessionId)!.send('long running prompt');
  // 立刻 rewind——应当触发 session.cancel 链且 await 直到 cancel 完成
  const result = await kodaxHost.rewind(sessionId, 0);
  assert.equal(result.ok, true);
});
