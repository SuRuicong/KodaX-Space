// PermissionBroker mode-aware policy tests — alpha.1 KodaX 接通
//
// 此 batch 把"Permission 统一"指向 KodaXEvents.beforeToolExecute 钩子。
// 钩子内部走 PermissionBroker.request({...mode})。
// 这里反向验证 broker 据 mode 短路的不变量——保护 plan-mode 安全语义：
//   - plan-mode          → 全 deny（不区分 tool name）
//   - bypass-permissions → 全 allow（即便 dangerous，UI 端用 settings flag gate）
//   - accept-edits       → edit/write/multi_edit auto-allow，非 edit/dangerous 走 ask
//
// 配套覆盖 review 反馈：之前 broker 模式短路有逻辑但没专门测试。

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
  }) as unknown as Electron.WebContents);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (permissionRegistry as any).cached = [];
});

afterEach(() => {
  setRendererTarget(() => null);
});

test('plan-mode denies bash without pushing permission.request', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_plan',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'plan-mode',
  });
  assert.equal(result.decision, 'deny');
  // 关键不变量：plan-mode 直接短路 → 不应当推任何 permission.request 给 renderer
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'plan-mode must not show modal',
  );
});

test('plan-mode denies edit (and all write tools) — strict gate', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit', 'web_fetch', 'mcp_call']) {
    const result = await permissionBroker.request({
      sessionId: 's_plan',
      toolId: `t_${toolName}`,
      toolName,
      input: {},
      mode: 'plan-mode',
    });
    assert.equal(result.decision, 'deny', `plan-mode must deny ${toolName}`);
  }
});

test('bypass-permissions auto-allows even dangerous tools without modal', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_bypass',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'rm -rf /' }, // dangerous; 仍 allow because bypass
    mode: 'bypass-permissions',
  });
  assert.equal(result.decision, 'allow_once');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'bypass-permissions must not show modal',
  );
});

test('accept-edits auto-allows non-dangerous edit tools', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit']) {
    const result = await permissionBroker.request({
      sessionId: 's_ae',
      toolId: `t_${toolName}`,
      toolName,
      input: { path: 'src/foo.ts' },
      mode: 'accept-edits',
    });
    assert.equal(result.decision, 'allow_once', `accept-edits should auto-allow ${toolName}`);
  }
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'accept-edits non-dangerous edits should not show modal',
  );
});

test('accept-edits does NOT short-circuit non-edit tools (e.g. bash) — they go through ask', async () => {
  // bash 不在 edit 工具集，accept-edits 让它走 ask-permissions 流程
  const pending = permissionBroker.request({
    sessionId: 's_ae2',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'accept-edits',
  });
  // 让 push 落到 captured（broker 推 permission.request 然后等 renderer 回答）
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'accept-edits + non-edit tool should still show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  // 模拟用户允许
  permissionBroker.resolve(reqId, 'allow_once');
  const result = await pending;
  assert.equal(result.decision, 'allow_once');
});

test('accept-edits + dangerous bash still goes through ask (not auto-allowed)', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_ae3',
    toolId: 't_rm',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/foo' },
    mode: 'accept-edits',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'dangerous tool in accept-edits must still show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

test('ask-permissions (default) shows modal for any tool not in allow-list', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_ask',
    toolId: 't_read',
    toolName: 'read',
    input: { path: 'foo.ts' },
    mode: 'ask-permissions',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1);
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'allow_always');
  const result = await pending;
  assert.equal(result.decision, 'allow_always');
});

test('default mode (undefined) behaves as ask-permissions', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_default',
    toolId: 't1',
    toolName: 'read',
    input: { path: 'foo.ts' },
    // mode 不传——broker 应当默认 'ask-permissions'
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'undefined mode should show modal (default = ask-permissions)');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'allow_once');
  await pending;
});
