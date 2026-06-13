// F047 real-SDK verification: Partner 工具白名单基于真 SDK resolveToolCapability 的 tier 正确分类。
//
// 单测（partner-tools.test.ts）验策略逻辑（注入 tier）；本 e2e 验**真 SDK** 给代表性工具的
// tier，且 Partner 策略据此放行只读+web、拦 bash/edit/write。对应 [[mock别给假信心]]：tier 是
// SDK 内部 flat switch，必须用真 SDK 核，不能假设。
//
// 策略逻辑与 apps/desktop/electron/kodax/partner-tools.ts 一致（此处内联，因 .mjs 不能 import .ts）。

import { resolveToolCapability } from '@kodax-ai/kodax/coding';

const PARTNER_NETWORK_ALLOW = new Set(['web_fetch', 'web_search']);
const isPartnerToolAllowed = (name, cap) => PARTNER_NETWORK_ALLOW.has(name) || cap === 'read';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

function main() {
  // 代表性工具 → 真 SDK tier（打印出来便于核对 SDK 实际分类）
  const probe = ['read', 'grep', 'glob', 'edit', 'write', 'bash', 'web_fetch', 'web_search'];
  const tiers = Object.fromEntries(probe.map((t) => [t, resolveToolCapability(t)]));
  console.log('[e2e] real SDK tiers:', JSON.stringify(tiers));

  // 只读检索 → 放行
  ok(isPartnerToolAllowed('read', tiers.read), `read 放行 (tier=${tiers.read})`);
  ok(isPartnerToolAllowed('grep', tiers.grep), `grep 放行 (tier=${tiers.grep})`);
  ok(isPartnerToolAllowed('glob', tiers.glob), `glob 放行 (tier=${tiers.glob})`);

  // 写 / shell → 拦
  ok(!isPartnerToolAllowed('edit', tiers.edit), `edit 拦截 (tier=${tiers.edit})`);
  ok(!isPartnerToolAllowed('write', tiers.write), `write 拦截 (tier=${tiers.write})`);
  ok(!isPartnerToolAllowed('bash', tiers.bash), `bash 拦截 (tier=${tiers.bash})`);

  // web 研究 → 放行（显式集，与 tier 无关）
  ok(isPartnerToolAllowed('web_fetch', tiers.web_fetch), `web_fetch 放行 (tier=${tiers.web_fetch})`);
  ok(isPartnerToolAllowed('web_search', tiers.web_search), `web_search 放行 (tier=${tiers.web_search})`);

  // 关键断言：read tier 名副其实（read 真的归 'read'），bash 真的不归 'read'
  ok(tiers.read === 'read', `SDK 把 read 归 'read' tier (实际 ${tiers.read})`);
  ok(tiers.bash !== 'read', `SDK 把 bash 归非 'read' tier (实际 ${tiers.bash})`);

  if (failures > 0) {
    console.error(`[e2e] FAIL: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('[e2e] PASS — Partner 工具白名单在真 SDK tier 下分类正确');
}

main();
