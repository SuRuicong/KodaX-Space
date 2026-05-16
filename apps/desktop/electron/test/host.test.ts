// KodaXHost integration test — Mock adapter end-to-end.
//
// 验证：create → send → 一连串 session.event push → session_complete
// 不依赖 electron 运行时（push.ts 只 import type WebContents；测试注入一个 stub target）。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';

// Stub webContents：捕获所有 session.event payload 到数组里
type CapturedSend = { channel: string; payload: unknown };
const captured: CapturedSend[] = [];

beforeEach(async () => {
  captured.length = 0;
  await kodaxHost.disposeAll();
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
    isDestroyed: () => false,
    // 我们只用到 send/isDestroyed——其他字段 stub 一下避免类型噪音
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
});

function getEvents(): readonly SessionEvent[] {
  return captured.filter((c) => c.channel === 'session.event').map((c) => c.payload as SessionEvent);
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('createSession: returns sessionId starting with "s_" + createdAt timestamp', () => {
  const result = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.match(result.sessionId, /^s_/);
  assert.ok(result.createdAt > 0);
  assert.equal(kodaxHost.get(result.sessionId)?.sessionId, result.sessionId);
});

test('createSession applies default reasoningMode = auto', () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'auto');
});

test('list: enumerates all created sessions', () => {
  kodaxHost.createSession({ projectRoot: '/r1', provider: 'mock' });
  kodaxHost.createSession({ projectRoot: '/r2', provider: 'mock', reasoningMode: 'deep' });
  const list = kodaxHost.list();
  assert.equal(list.length, 2);
});

test('end-to-end Mock stream: send → text_delta(s) → tool_start → tool_result → iteration_end → session_complete', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);

  await session.send('hello world');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const events = getEvents();
  const kinds = events.map((e) => e.kind);

  // 第一个事件是 thinking_delta（Mock 实现先 "analysing prompt"）
  assert.equal(kinds[0], 'thinking_delta');
  // 中段必有 text_delta + tool_start + tool_result + iteration_end
  const required = ['text_delta', 'tool_start', 'tool_result', 'iteration_end'] as const;
  for (const k of required) {
    assert.ok(kinds.includes(k), `missing kind: ${k}`);
  }
  // 最后必是 session_complete
  assert.equal(kinds[kinds.length - 1], 'session_complete');

  // 所有事件 sessionId 都对得上
  for (const evt of events) {
    assert.equal(evt.sessionId, sessionId);
  }
});

test('cancel mid-stream emits session_error("cancelled") and aborts further events', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);

  await session.send('long task');
  // 等第一条 thinking_delta 落地，再 cancel
  await waitFor(() => getEvents().length >= 1);
  await kodaxHost.cancel(sessionId);

  await waitFor(() => getEvents().some((e) => e.kind === 'session_error'));
  const events = getEvents();
  const last = events[events.length - 1];
  assert.equal(last.kind, 'session_error');
  if (last.kind === 'session_error') {
    assert.equal(last.error, 'cancelled');
  }
  // session_complete 不应该出现在 cancel 后
  assert.equal(events.some((e) => e.kind === 'session_complete'), false);
});

test('concurrent send on same session is rejected (no queueing in F003 Mock)', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('first');
  await assert.rejects(() => session.send('second'), /in-flight/);
  // 清理：等第一个跑完
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));
});

test('delete: removes session from list and dispose is idempotent', async () => {
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  assert.equal(kodaxHost.list().length, 1);
  const deleted = await kodaxHost.delete(sessionId);
  assert.equal(deleted, true);
  assert.equal(kodaxHost.list().length, 0);
  // 再 delete 不存在的 session 返回 false
  const second = await kodaxHost.delete(sessionId);
  assert.equal(second, false);
});

test('push payload: every captured event passes session.event schema', async () => {
  // 这个 test 保险 — push.ts 已经在发出前 zod 校验，但我们再确认捕获的 payload 形状对
  const { sessionId } = kodaxHost.createSession({ projectRoot: '/r', provider: 'mock' });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  await session.send('test');
  await waitFor(() => getEvents().some((e) => e.kind === 'session_complete'));

  const { sessionEventChannel } = await import('@kodax-space/space-ipc-schema');
  for (const evt of getEvents()) {
    const result = sessionEventChannel.payload.safeParse(evt);
    assert.equal(result.success, true, `payload failed schema: ${JSON.stringify(evt)}`);
  }
});
