// Global types injected by Electron preload (contextBridge).
// 这是 renderer 唯一允许"看到 electron"的接口面。
//
// FEATURE_002：invoke / on 现在是 channel-typed——传错 channel 名直接 ts 报错。

import type {
  InvokeChannelName,
  PushChannelName,
  ChannelInput,
  ChannelOutput,
  IpcResult,
} from '@kodax-space/space-ipc-schema';

export {};

declare global {
  interface KodaXSpaceBridge {
    /**
     * Renderer → main 请求-响应。永远返回 envelope：调用方用 `result.ok` 区分。
     * Channel 名不在 schema 中会 ts 报错；运行时 preload 也会兜底拒绝。
     */
    invoke<C extends InvokeChannelName>(
      channel: C,
      payload: ChannelInput<C>,
    ): Promise<IpcResult<ChannelOutput<C>>>;

    /**
     * Main → renderer push 事件订阅。返回 unsubscribe 函数。
     * payload 按对应 channel 的 zod schema 推导成强类型。
     */
    on<C extends PushChannelName>(
      channel: C,
      listener: (payload: import('@kodax-space/space-ipc-schema').PushPayload<C>) => void,
    ): () => void;

    platform: NodeJS.Platform;
  }

  interface Window {
    kodaxSpace?: KodaXSpaceBridge;
  }
}
