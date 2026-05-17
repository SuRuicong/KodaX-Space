// PermissionBroker tests — FEATURE_007
//
// 验收要点：
//   - request() 推 permission.request；resolve() 让等待的 Promise 兑现
//   - cancelSession 让对应 pending 自动 deny + 推 permission.cancelled
//   - 超时自动 deny（用很短的 timeoutMs 验证）
//   - 多 session 并发请求不串：cancel session A 不影响 session B 的 pending

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { permissionBroker } from '../permission/broker.js';
import { setRendererTarget } from '../ipc/push.js';
import { permissionRegistry } from '../permission/registry.js';

interface Captured { channel: string; payload: unknown }
const captured: Captured[] = [];

beforeEach(() => {
  captured.length = 0;
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
    isDestroyed: () => false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  // 清空已加载的 registry 缓存——避免上次跑测试残留的 rules 让 matches() 短路弹窗。
  // PermissionRegistry 单例在 main 端 import 时构造；测试里不能 new，只能用反射清缓存。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [];
});

afterEach(() => {
  setRendererTarget(() => null);
});

function lastRequest(): { reqId: string; sessionId: string } {
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt, 'expected at least one permission.request push');
  const payload = evt.payload as { reqId: string; sessionId: string };
  return { reqId: payload.reqId, sessionId: payload.sessionId };
}

test('request → resolve(allow_once) returns decision', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'read',
    input: { path: 'a' },
  });
  // 让 push 落到 captured
  await new Promise((r) => setImmediate(r));
  const { reqId } = lastRequest();
  assert.equal(permissionBroker.resolve(reqId, 'allow_once'), true);
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

test('request danger tool: includes risk=danger in pushed payload', async () => {
  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' },
  });
  await new Promise((r) => setImmediate(r));
  const evt = captured.find((c) => c.channel === 'permission.request');
  assert.ok(evt);
  const payload = evt.payload as { risk: string; suggestedPattern?: string };
  assert.equal(payload.risk, 'danger');
  // 危险工具不允许 bulk allow → suggestedPattern 应该 undefined
  assert.equal(payload.suggestedPattern, undefined);

  // 收尾：resolve 不让测试挂
  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

test('cancelSession: pending request auto-resolves to deny + pushes permission.cancelled', async () => {
  const pending = permissionBroker.request({
    sessionId: 's-cancel-me',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'sleep 99' },
  });
  await new Promise((r) => setImmediate(r));

  permissionBroker.cancelSession('s-cancel-me', 'session_cancelled');
  const result = await pending;
  assert.equal(result.decision, 'deny');

  const cancelled = captured.find((c) => c.channel === 'permission.cancelled');
  assert.ok(cancelled);
  const cp = cancelled.payload as { reason: string; sessionId: string };
  assert.equal(cp.reason, 'session_cancelled');
  assert.equal(cp.sessionId, 's-cancel-me');
});

test('cancelSession of session A does not affect session B', async () => {
  const pendingA = permissionBroker.request({
    sessionId: 'sA',
    toolId: 'tA',
    toolName: 'bash',
    input: { command: 'echo a' },
  });
  const pendingB = permissionBroker.request({
    sessionId: 'sB',
    toolId: 'tB',
    toolName: 'bash',
    input: { command: 'echo b' },
  });
  await new Promise((r) => setImmediate(r));

  // 取 sB 的 reqId（permission.request push 顺序无保证，按 sessionId 找）
  const reqB = captured.find(
    (c) => c.channel === 'permission.request' && (c.payload as { sessionId: string }).sessionId === 'sB',
  );
  assert.ok(reqB);
  const reqIdB = (reqB.payload as { reqId: string }).reqId;

  permissionBroker.cancelSession('sA', 'session_cancelled');

  // pendingA 应已 deny
  const resA = await pendingA;
  assert.equal(resA.decision, 'deny');

  // pendingB 仍在等——broker 应当还能 resolve 它
  assert.equal(permissionBroker.resolve(reqIdB, 'allow_once'), true);
  const resB = await pendingB;
  assert.equal(resB.decision, 'allow_once');
});

test('timeout: auto-resolves to deny + pushes permission.cancelled(timeout)', async () => {
  const pending = permissionBroker.request({
    sessionId: 's-timeout',
    toolId: 't1',
    toolName: 'read',
    input: { path: 'a' },
    timeoutMs: 30,
  });
  const result = await pending;
  assert.equal(result.decision, 'deny');

  const cancelled = captured.find(
    (c) => c.channel === 'permission.cancelled' && (c.payload as { reason: string }).reason === 'timeout',
  );
  assert.ok(cancelled);
});

test('resolve with unknown reqId returns false', () => {
  assert.equal(permissionBroker.resolve('does-not-exist', 'allow_once'), false);
});

test('allow_always: cached rule pre-empts second request (same pattern, no push)', async () => {
  // 第一次请求 → resolve allow_always 不直接写规则；我们手工把 rule 塞进 registry
  // 模拟"上次已批准并写入 ~/.kodax/permissions.json"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [{ pattern: 'read', createdAt: Date.now() }];

  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'read',
    input: { path: 'a' },
  });
  await new Promise((r) => setImmediate(r));

  // 这次不应当推任何 permission.request——直接 allow_once
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 0, 'should not push when rule already covers');

  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

test('danger overrides rule: even with bash rule cached, rm -rf still pops modal', async () => {
  // 用户曾经批准过 "bash:rm" 这种规则（极不该有，但假设有）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [{ pattern: 'bash', createdAt: Date.now() }];

  const pending = permissionBroker.request({
    sessionId: 's1',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' },
  });
  await new Promise((r) => setImmediate(r));

  // danger 必须弹窗
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'danger commands must always prompt even with cached rules');

  const { reqId } = lastRequest();
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});
