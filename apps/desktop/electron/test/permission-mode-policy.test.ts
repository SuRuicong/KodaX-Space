// PermissionBroker mode-aware policy tests — FEATURE_029 canonical 3 mode
//
// 对齐 KodaX REPL canonical (ADR-005)：
//   'plan'         → 全 deny（即便不在 PLAN_MODE_BLOCKED_TOOLS 也 deny，
//                    因为 plan mode 的不变量是"agent 不动手"）
//   'accept-edits' → edit/write/multi_edit/insert_after_anchor 自动批；
//                    其他 (bash/web_fetch/...) 走 ask modal；
//                    dangerous (rm -rf 等) 即便是 edit 工具也 ask
//   'auto'         → FEATURE_030 wire AutoModeToolGuardrail 后由 guardrail 守门。
//                    F030 前的 fallback：跟 accept-edits 同行为，保证不比 accept-edits 松。
//
// 已删 mode：
//   - 'ask-permissions'    (KodaX 没有)
//   - 'bypass-permissions' (KodaX 没有；要"全放行"通过 auto + auto-rules.jsonc allow-all 实现)

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

// ---------------------------- plan mode ----------------------------

test('plan denies bash without pushing permission.request', async () => {
  const result = await permissionBroker.request({
    sessionId: 's_plan',
    toolId: 't1',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'plan',
  });
  assert.equal(result.decision, 'deny');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'plan mode must not show modal',
  );
});

test('plan denies edit/write/multi_edit/web_fetch/mcp_call — strict gate', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit', 'web_fetch', 'mcp_call']) {
    const result = await permissionBroker.request({
      sessionId: 's_plan',
      toolId: `t_${toolName}`,
      toolName,
      input: {},
      mode: 'plan',
    });
    assert.equal(result.decision, 'deny', `plan must deny ${toolName}`);
  }
});

test('plan denies even safe tools (no allowlist short-circuit)', async () => {
  // plan mode 不区分 read-only / mutating —— 全 deny。
  // (planModeBlockCheck 在 KodaX 侧已经 fork read-only 工具放行；
  // broker 这一层简单 deny 是 defense-in-depth：万一 KodaX 钩子没被 wire 上，
  // broker 仍兜底)
  const result = await permissionBroker.request({
    sessionId: 's_plan',
    toolId: 't_read',
    toolName: 'read',
    input: { path: 'foo.ts' },
    mode: 'plan',
  });
  assert.equal(result.decision, 'deny', 'plan mode broker deny is conservative');
});

// ---------------------------- accept-edits mode ----------------------------

test('accept-edits auto-allows non-dangerous edit tools (edit/write/multi_edit/insert_after_anchor)', async () => {
  for (const toolName of ['edit', 'write', 'multi_edit', 'insert_after_anchor']) {
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

test('accept-edits does NOT short-circuit non-edit tools (bash) — goes through ask', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_ae2',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'accept-edits',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'accept-edits + non-edit tool should still show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
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

// ---------------------------- auto mode (pre-F030 fallback) ----------------------------

test('auto mode (pre-F030 fallback) auto-allows edits like accept-edits', async () => {
  // FEATURE_030 wire AutoModeToolGuardrail 前，broker fallback 到 accept-edits 行为，
  // 保证 'auto' 至少跟 'accept-edits' 一样严，**绝不更松**。
  for (const toolName of ['edit', 'write', 'multi_edit']) {
    const result = await permissionBroker.request({
      sessionId: 's_auto',
      toolId: `t_${toolName}`,
      toolName,
      input: { path: 'src/x.ts' },
      mode: 'auto',
    });
    assert.equal(result.decision, 'allow_once', `auto fallback should allow edit ${toolName}`);
  }
});

test('auto mode (pre-F030 fallback) still asks for bash', async () => {
  // auto fallback 不应让 bash silent allow — 那会比 accept-edits 更松
  const pending = permissionBroker.request({
    sessionId: 's_auto2',
    toolId: 't_bash',
    toolName: 'bash',
    input: { command: 'echo hi' },
    mode: 'auto',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'auto fallback + bash should still show modal pre-F030');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'allow_once');
  await pending;
});

test('auto mode (pre-F030 fallback) still asks for dangerous bash', async () => {
  const pending = permissionBroker.request({
    sessionId: 's_auto3',
    toolId: 't_rm',
    toolName: 'bash',
    input: { command: 'rm -rf /tmp/foo' },
    mode: 'auto',
  });
  await new Promise((r) => setImmediate(r));
  const reqs = captured.filter((c) => c.channel === 'permission.request');
  assert.equal(reqs.length, 1, 'dangerous bash in auto fallback must show modal');
  const { reqId } = reqs[0].payload as { reqId: string };
  permissionBroker.resolve(reqId, 'deny');
  const result = await pending;
  assert.equal(result.decision, 'deny');
});

// ---------------------------- default mode ----------------------------

test('default mode (undefined) behaves as accept-edits — canonical default', async () => {
  // schema 缺省 'accept-edits' (FEATURE_029)。broker req.mode === undefined 应当
  // fallback 到同一缺省，否则双语义不一致。
  const result = await permissionBroker.request({
    sessionId: 's_default',
    toolId: 't_edit',
    toolName: 'edit',
    input: { path: 'foo.ts' },
    // mode 不传 — broker fallback 应当 'accept-edits'
  });
  assert.equal(result.decision, 'allow_once', 'undefined mode should auto-allow edit');
  assert.equal(
    captured.filter((c) => c.channel === 'permission.request').length,
    0,
    'undefined mode = accept-edits fallback should not show modal for edit',
  );
});
