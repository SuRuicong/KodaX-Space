// Preload script — FEATURE_001
//
// 通过 contextBridge 暴露最小、白名单化的 IPC API 到 renderer。
// 后续 feature 在 packages/space-ipc-schema 注册 channel 时，preload 这里加 allowlist。

import { contextBridge, ipcRenderer } from 'electron';
import { INVOKE_CHANNEL_NAMES, PUSH_CHANNEL_NAMES } from '@kodax-space/space-ipc-schema';

// channel allowlist 直接从 schema 包派生——单一真理源，preload 不再手维护副本。
// 注：esbuild bundle 时会把 schema 包的运行时值内联进 preload.js（见 scripts/build-main.mjs）。
const ALLOWED_INVOKE_CHANNELS = INVOKE_CHANNEL_NAMES;
const ALLOWED_LISTEN_CHANNELS = PUSH_CHANNEL_NAMES;

// 在 exposeInMainWorld 之前把 process.platform 取成原子字符串。
// 暴露 `platform: process.platform` 会让 contextBridge 持有 process 的 getter 句柄，
// 给将来维护者留下"顺手再加 process.env / versions"的口子；这里强制为 primitive。
const platformValue: NodeJS.Platform = process.platform;

contextBridge.exposeInMainWorld('kodaxSpace', {
  /**
   * 调 main 进程注册的 channel。返回 Promise。
   * 未注册的 channel 立刻 reject，不进 IPC。
   */
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error(`[preload] channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, payload);
  },

  /**
   * 订阅 main → renderer 的事件。返回取消订阅函数。
   */
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
      throw new Error(`[preload] listen channel not allowed: ${channel}`);
    }
    const wrapped = (_: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * 平台元信息，便于 renderer 做平台相关 UI 适配。值在 preload 启动时已经被冻结为字符串。
   */
  platform: platformValue,
});

// TypeScript: renderer 那侧的全局类型声明在 apps/desktop/renderer/src/types/global.d.ts
