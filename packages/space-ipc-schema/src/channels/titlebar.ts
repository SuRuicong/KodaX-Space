// Titlebar 视觉同步 channel — alpha.1
//
// renderer 切换 light/dark 主题时通过此 channel 通知 main 更新
// BrowserWindow.titleBarOverlay 的颜色，让 Windows 上 OS 画的 close/min/max
// 按钮跟着新主题色走，不再"主题切了但右上角按钮还是黑色"。
//
// 颜色用 hex 七位字符串 (#RRGGBB) — 简单、跨进程序列化稳定、与 Electron
// titleBarOverlay 接受的格式一致。

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
