// Titlebar 主题同步 — alpha.1
//
// renderer 切 light/dark 主题 → 通过此 channel 让 main 更新
// BrowserWindow.setTitleBarOverlay 颜色，让 Windows 上 OS 画的 close/min/max
// 按钮跟着新主题色走（不然主题切了 OS 控件还是旧色）。
//
// 非 Windows 平台直接 return ok:true (没 overlay，但不让 renderer 报错)。

import { BrowserWindow } from 'electron';
import { registerChannel } from './register.js';

export function registerTitlebarChannels(): void {
  registerChannel('titlebar.setOverlay', async ({ color, symbolColor }) => {
    if (process.platform !== 'win32') return { ok: true };
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      try {
        // Electron 33+: setTitleBarOverlay 动态更新（创建时也用 titleBarOverlay 配的同字段）。
        win.setTitleBarOverlay({ color, symbolColor, height: 36 });
      } catch (err) {
        console.warn(
          '[titlebar] setTitleBarOverlay failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { ok: true };
  });
}
