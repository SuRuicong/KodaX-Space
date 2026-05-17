// Permission IPC handlers — FEATURE_007
//
// 三个 invoke channel：
//   permission.answer  — renderer 回答 main 端 broker pending 的请求
//   permission.list    — 列出 always-allow 规则（设置面板用）
//   permission.revoke  — 撤销一条 always-allow 规则

import { registerChannel } from './register.js';
import { permissionBroker } from '../permission/broker.js';
import { permissionRegistry } from '../permission/registry.js';

export function registerPermissionChannels(): void {
  // permission.answer
  //
  // 流程：
  //   1) 校验 reqId 仍在 pending（pending Map 是真实状态来源；超时 / cancel 会删除）
  //   2) decision='allow_always' 且带 pattern → 先持久化规则，再 resolve broker
  //   3) 其他 decision 直接 resolve broker
  //
  // 即使 broker 没有这条 pending（renderer 重复点击 / 超时后回答），也返回 accepted:false
  // 而不是 throw——envelope 已是 ok，{ accepted:false } 是业务级"晚到的答案被丢弃"。
  registerChannel('permission.answer', async (input) => {
    if (input.decision === 'allow_always' && input.pattern) {
      // 先持久化再 resolve——broker resolve 后调用方继续执行 tool；
      // 如果 add() 失败但用户已批准本次，至少 tool 跑了。但 add 失败应当极少（mkdir + write）。
      try {
        await permissionRegistry.add(input.pattern);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[permission.answer] failed to persist rule "${input.pattern}": ${msg}`);
        // 仍然 resolve broker——不让用户看到"我点了允许但什么都没发生"
      }
    }
    const accepted = permissionBroker.resolve(input.reqId, input.decision, input.pattern);
    return { accepted };
  });

  // permission.list
  registerChannel('permission.list', async () => {
    await permissionRegistry.load();
    return { rules: permissionRegistry.list().map((r) => ({ pattern: r.pattern, createdAt: r.createdAt })) };
  });

  // permission.revoke
  registerChannel('permission.revoke', async (input) => {
    const removed = await permissionRegistry.remove(input.pattern);
    return { removed };
  });
}
