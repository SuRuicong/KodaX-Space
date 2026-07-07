// Titlebar 视觉同步 channel — alpha.1 legacy compatibility
//
// Windows 窗口按钮已改为 renderer 自绘；macOS 继续原生 traffic lights。
// 这个 channel 仍保留旧入参 shape，让旧调用点安全 no-op，不再打开 titleBarOverlay。
//
// 颜色仍用 hex 七位字符串 (#RRGGBB)，保持协议兼容。

import { z } from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB');

export const titlebarSetOverlayChannel = {
  name: 'titlebar.setOverlay',
  direction: 'invoke',
  input: z.object({
    color: hexColorSchema,
    symbolColor: hexColorSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;
