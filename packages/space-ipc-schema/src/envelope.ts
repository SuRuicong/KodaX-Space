// IPC result envelope — every renderer→main invoke returns one of these.
//
// 设计思路（详见 HLD.md §6）：
// - main 永远不 throw 到 renderer——所有错误装进 envelope
// - renderer 端拿到 envelope 后用 `.ok` 区分；TypeScript 通过 discriminated union 收敛 data 类型
// - 错误码闭集——便于 UI 决定弹层 vs toast vs silent log

import { z } from 'zod';

export const IPC_ERROR_CODES = [
  'SCHEMA_INVALID', // 入参 zod parse 失败
  'OUTPUT_INVALID', // 出参 zod parse 失败（main 自检，防协议漂移）
  'UNKNOWN_CHANNEL', // 走到了未注册的 channel（理论上 preload 已拦，这里兜底）
  'HANDLER_ERROR', // 业务逻辑 throw
  'INTERNAL', // 未分类
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export const ipcErrorSchema = z.object({
  code: z.enum(IPC_ERROR_CODES),
  message: z.string(),
  // details 通常是 z.ZodError.flatten() 的产物或调试上下文；不强约束 shape
  details: z.unknown().optional(),
});

export type IpcError = z.infer<typeof ipcErrorSchema>;

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail(code: IpcErrorCode, message: string, details?: unknown): IpcResult<never> {
  return { ok: false, error: { code, message, details } };
}
