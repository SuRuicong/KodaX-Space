// main → renderer push 工具。
//
// 为什么不直接 import 一个 BrowserWindow 变量：window 在 dev HMR / 用户重开窗口时会重建。
// 我们维护一个 "current webContents getter"，main.ts 在 createMainWindow 时调
// setRendererTarget(getter) 注入，handler/host 用 pushToRenderer 走这个 getter 间接拿当前 webContents。

import {
  PUSH_CHANNEL_NAMES,
  getPushChannel,
  type PushChannelName,
  type PushPayload,
} from '@kodax-space/space-ipc-schema';
import type { WebContents } from 'electron';

let targetGetter: (() => WebContents | null) | null = null;

/** main.ts 在窗口创建后注入；窗口 destroy 时不必清空（getter 自己处理失效）。*/
export function setRendererTarget(getter: () => WebContents | null): void {
  targetGetter = getter;
}

/**
 * push 一条事件到 renderer。
 * 防御：channel 名必须在 PUSH_CHANNEL_NAMES 里（防 main 端代码顺手用了未注册名）；
 * payload 必须通过对应 channel 的 zod parse（防协议漂移，与 invoke 的出参校验对称）。
 * window 缺席（启动早期、关闭中）静默丢弃——push 是 fire-and-forget。
 */
export function pushToRenderer<C extends PushChannelName>(channel: C, payload: PushPayload<C>): void {
  if (!PUSH_CHANNEL_NAMES.has(channel)) {
    console.error(`[push] channel not in PUSH_CHANNEL_NAMES: ${channel}`);
    return;
  }
  const def = getPushChannel(channel);
  if (!def) {
    console.error(`[push] no schema for channel: ${channel}`);
    return;
  }
  const parsed = def.payload.safeParse(payload);
  if (!parsed.success) {
    console.error(`[push] ${channel} payload schema invalid:`, parsed.error.flatten());
    return;
  }
  const wc = targetGetter?.();
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, parsed.data);
}
