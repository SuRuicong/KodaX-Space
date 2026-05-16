// space.version handler — main 端的第一个真实 channel。
//
// 返回 main 进程能拿到的版本号 + 平台。renderer 用这个值做自检 UI。

import { app, type App } from 'electron';
import { registerChannel } from './register.js';
import type { SpaceVersionOutput } from '@kodax-space/space-ipc-schema';

function readSpaceVersion(electronApp: App): string {
  // app.getVersion() 读 packaged 应用的 package.json；dev 模式下可能不是 0.1.0-alpha.0
  // 而是 Electron CLI 默认值（"33.x"）。dev 下用环境变量兜底，保证自检 UI 不混淆。
  if (!electronApp.isPackaged && process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  return electronApp.getVersion();
}

export function registerVersionChannel(): void {
  registerChannel('space.version', (): SpaceVersionOutput => {
    const platform = process.platform;
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
      throw new Error(`unsupported platform: ${platform}`);
    }
    return {
      spaceVersion: readSpaceVersion(app),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform,
    };
  });
}
