// host.setAutoModeEngine + auto_engine_change push event tests — FEATURE_029.
//
// 覆盖：
//   1. setAutoModeEngine 改字段 + push 'auto_engine_change' with reason='manual'
//   2. 相同值幂等：不重复 push event
//   3. unknown sessionId → false (无 push)
//   4. createSession 的 autoModeEngine 缺省 'llm'
//   5. createSession 接受显式 'rules' 起步
//   6. session.list 输出 autoModeEngine 字段（IPC shape 与 ManagedSession 对齐）

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';

interface Captured { channel: string; payload: unknown }
const captured: Captured[] = [];

beforeEach(async () => {
  captured.length = 0;
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
    isDestroyed: () => false,
  }) as unknown as Electron.WebContents);
  await kodaxHost.disposeAll();
});

afterEach(async () => {
  setRendererTarget(() => null);
  await kodaxHost.disposeAll();
});

test('createSession defaults autoModeEngine to "llm"', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const s = kodaxHost.get(sessionId);
  assert.equal(s?.autoModeEngine, 'llm', 'default engine should be llm');
});

test('createSession accepts explicit autoModeEngine: "rules"', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    autoModeEngine: 'rules',
  });
  const s = kodaxHost.get(sessionId);
  assert.equal(s?.autoModeEngine, 'rules');
});

test('setAutoModeEngine updates session field; returns true', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const ok = kodaxHost.setAutoModeEngine(sessionId, 'rules');
  assert.equal(ok, true);
  assert.equal(kodaxHost.get(sessionId)?.autoModeEngine, 'rules');
});

test('setAutoModeEngine pushes auto_engine_change event with reason=manual', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  captured.length = 0;
  kodaxHost.setAutoModeEngine(sessionId, 'rules');
  const ev = captured.find(
    (c) => c.channel === 'session.event'
      && (c.payload as { kind: string }).kind === 'auto_engine_change',
  );
  assert.ok(ev, 'should push auto_engine_change');
  const payload = ev!.payload as { kind: string; sessionId: string; engine: string; reason: string };
  assert.equal(payload.sessionId, sessionId);
  assert.equal(payload.engine, 'rules');
  assert.equal(payload.reason, 'manual');
});

test('setAutoModeEngine idempotent: same value does not push event', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
    autoModeEngine: 'llm',
  });
  captured.length = 0;
  const ok = kodaxHost.setAutoModeEngine(sessionId, 'llm');
  assert.equal(ok, true, 'idempotent call still returns true');
  const ev = captured.find(
    (c) => c.channel === 'session.event'
      && (c.payload as { kind: string }).kind === 'auto_engine_change',
  );
  assert.equal(ev, undefined, 'no auto_engine_change push for same-value setter');
});

test('setAutoModeEngine returns false for unknown sessionId; no push', () => {
  captured.length = 0;
  const ok = kodaxHost.setAutoModeEngine('s_does_not_exist', 'rules');
  assert.equal(ok, false);
  assert.equal(
    captured.filter((c) => c.channel === 'session.event').length,
    0,
    'no event should be pushed for unknown session',
  );
});

test('setPermissionMode does NOT auto-emit auto_engine_change (independent setters)', () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  captured.length = 0;
  kodaxHost.setPermissionMode(sessionId, 'auto');
  // 切到 auto 不应当自己 emit auto_engine_change——只有 setAutoModeEngine
  // 或 guardrail onEngineChange callback 才 emit。setPermissionMode 是独立 channel。
  const ev = captured.find(
    (c) => c.channel === 'session.event'
      && (c.payload as { kind: string }).kind === 'auto_engine_change',
  );
  assert.equal(ev, undefined, 'setPermissionMode should not emit auto_engine_change');
});
