// Titlebar 主题同步 — alpha.1
//
// renderer 切 light/dark 主题时曾通过此 channel 更新 Windows titleBarOverlay。
// Windows 现在改为 renderer 自绘窗口按钮，macOS 继续原生 traffic lights，因此这里保留
// 兼容 channel 但不再启用 overlay，避免主题切换时把原生按钮重新打开。
//
// 返回 ok:true 让旧 renderer / 旧调用点无感迁移。

import { registerChannel } from './register.js';

export function registerTitlebarChannels(): void {
  registerChannel('titlebar.setOverlay', async () => {
    return { ok: true };
  });
}
