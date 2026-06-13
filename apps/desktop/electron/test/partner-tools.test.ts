// F047 — Partner 工具白名单策略（non-bash-subset）单测。
//
// isPartnerToolAllowed 是纯函数：注入 SDK resolveToolCapability 的 tier 结果，便于不加载真 SDK
// 单测策略逻辑。真 SDK tier 的正确性由 e2e/f047-partner-tools.mjs 验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeToolBlockReason, isPartnerToolAllowed, PARTNER_NETWORK_ALLOW } from '../kodax/partner-tools.js';

test('read-tier tools are allowed (read/grep/glob/repo-intel...)', () => {
  assert.equal(isPartnerToolAllowed('read', 'read'), true);
  assert.equal(isPartnerToolAllowed('grep', 'read'), true);
  assert.equal(isPartnerToolAllowed('glob', 'read'), true);
  assert.equal(isPartnerToolAllowed('repo_overview', 'read'), true);
});

test('mutation / shell / subagent tiers are blocked', () => {
  assert.equal(isPartnerToolAllowed('edit', 'edit'), false);
  assert.equal(isPartnerToolAllowed('write', 'edit'), false);
  assert.equal(isPartnerToolAllowed('bash', 'bash:mutating'), false);
  assert.equal(isPartnerToolAllowed('bash', 'bash:read-only'), false); // Partner 默认无 bash，任何 bash tier 都拦
  assert.equal(isPartnerToolAllowed('bash', 'bash:network'), false);
  assert.equal(isPartnerToolAllowed('some_subagent', 'subagent'), false);
});

test('web research tools are explicitly allowed even when tier is not "read"', () => {
  // web_fetch/web_search 真 SDK tier = 'bash:network'（e2e 实测），但 Partner 研究需要 → 显式放行。
  assert.equal(isPartnerToolAllowed('web_fetch', 'bash:network'), true);
  assert.equal(isPartnerToolAllowed('web_search', 'bash:network'), true);
  // 集合内容锁定
  assert.ok(PARTNER_NETWORK_ALLOW.has('web_fetch'));
  assert.ok(PARTNER_NETWORK_ALLOW.has('web_search'));
});

test('fail-closed: unknown tool (SDK resolves to "subagent") is blocked', () => {
  // SDK resolveToolCapability 对未知/MCP 工具 fail-closed 到 'subagent'；Partner 也拦。
  assert.equal(isPartnerToolAllowed('mystery_mcp_tool', 'subagent'), false);
});

// ---- computeToolBlockReason: Partner 白名单 + plan-mode 交互（review HIGH）----

const cap = (c: string) => () => c;
const planAllowed = (b: boolean) => () => b;

test('Partner: read tool allowed regardless of permissionMode (incl. plan)', () => {
  for (const mode of ['accept-edits', 'auto', 'plan'] as const) {
    assert.equal(
      computeToolBlockReason({ surface: 'partner', permissionMode: mode, tool: 'read', resolveCapability: cap('read'), isPlanModeAllowed: planAllowed(false) }),
      null,
      `read 应放行 (mode=${mode})`,
    );
  }
});

test('Partner: web tools allowed even in plan mode (HIGH fix — plan-mode 不再二次裁剪 Partner)', () => {
  // 关键回归：旧逻辑会 fall-through 到 plan-mode → web_fetch 被 [plan] 拦。修复后 Partner-allowed
  // 直接放行。注意：即便 isPlanModeAllowed=false（plan-mode 本会拦 web），Partner 下仍放行。
  const r = computeToolBlockReason({
    surface: 'partner', permissionMode: 'plan', tool: 'web_fetch',
    resolveCapability: cap('bash:network'), isPlanModeAllowed: planAllowed(false),
  });
  assert.equal(r, null, 'Partner+plan-mode 下 web_fetch 必须仍可用');
});

test('Partner: non-whitelisted tool blocked with [partner] reason', () => {
  const r = computeToolBlockReason({
    surface: 'partner', permissionMode: 'accept-edits', tool: 'bash',
    resolveCapability: cap('bash:mutating'), isPlanModeAllowed: planAllowed(false),
  });
  assert.ok(r?.startsWith('[partner]'), 'bash 在 Partner 应得 [partner] block reason');
});

test('Coder: plan-mode behavior preserved (non-partner 分支不变)', () => {
  // accept-edits → 不拦
  assert.equal(
    computeToolBlockReason({ surface: 'code', permissionMode: 'accept-edits', tool: 'edit', resolveCapability: cap('edit'), isPlanModeAllowed: planAllowed(false) }),
    null,
  );
  // plan + 工具 plan-allowed → 放行
  assert.equal(
    computeToolBlockReason({ surface: 'code', permissionMode: 'plan', tool: 'read', resolveCapability: cap('read'), isPlanModeAllowed: planAllowed(true) }),
    null,
  );
  // plan + 工具非 plan-allowed → [plan] 拦
  const r = computeToolBlockReason({ surface: 'code', permissionMode: 'plan', tool: 'write', resolveCapability: cap('edit'), isPlanModeAllowed: planAllowed(false) });
  assert.ok(r?.startsWith('[plan]'), 'Coder plan-mode 拦 write 应得 [plan] reason');
});
