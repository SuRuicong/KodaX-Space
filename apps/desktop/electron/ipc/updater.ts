// Auto-update handler — F022 (v0.1.3)
//
// 包装 electron-updater 的 autoUpdater：
//   - 启动时若 app.isPackaged → 立即 checkForUpdates()
//   - 把 'update-available' / 'download-progress' / 'update-downloaded' / 'error'
//     桥接到 push channel 'updater.status'
//   - 提供 'updater.check'（手动触发）和 'updater.install'（quitAndInstall）
//
// 为什么不直接在 main.ts inline：
//   - electron-updater 在 dev (app.isPackaged=false) 下 require 失败 / 抛 unsigned 错
//     —— 用 dynamic import + try/catch 把整个 updater 模块隔离掉，避免拖垮主流程
//   - autoUpdater 是 stateful，手动 check + ready 后 install 都需要拿到同一个实例
//
// 错误 sanitize：
//   electron-updater 的错误信息常常包含本地 cache 路径（%APPDATA%、~/.../Caches/...）
//   和 GitHub feed URL。我们截到 280 字符 + 替换掉绝对路径段，再 push 到 renderer。

import { app } from 'electron';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import type { UpdaterStateT } from '@kodax-space/space-ipc-schema';

let currentState: UpdaterStateT = { state: 'idle' };
let autoUpdaterInstance: typeof import('electron-updater').autoUpdater | null = null;
let initStarted = false;

function pushState(next: UpdaterStateT): void {
  currentState = next;
  pushToRenderer('updater.status', next);
}

/** 把绝对路径段替换为 <path>，截到 280 字符；不暴露 cache 目录给 renderer */
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/([A-Z]:\\[^\s]+)/g, '<path>') // Windows
    .replace(/(\/[A-Za-z][^\s]+)/g, '<path>') // Unix
    .slice(0, 280)
    .trim() || 'Update check failed';
}

async function ensureAutoUpdater(): Promise<typeof import('electron-updater').autoUpdater | null> {
  if (autoUpdaterInstance) return autoUpdaterInstance;
  try {
    const mod = await import('electron-updater');
    autoUpdaterInstance = mod.autoUpdater;
    // 默认行为：下载 ready 后不立即重启，等用户点 install
    autoUpdaterInstance.autoDownload = true;
    autoUpdaterInstance.autoInstallOnAppQuit = false;
    autoUpdaterInstance.logger = null; // electron-updater 默认接 electron-log，未装时会报警

    autoUpdaterInstance.on('checking-for-update', () => {
      pushState({ state: 'checking' });
    });
    autoUpdaterInstance.on('update-available', (info) => {
      pushState({ state: 'available', version: String(info.version ?? '') || 'unknown' });
    });
    autoUpdaterInstance.on('update-not-available', () => {
      pushState({ state: 'idle' });
    });
    autoUpdaterInstance.on('download-progress', (progress) => {
      const percent = typeof progress.percent === 'number' ? Math.max(0, Math.min(100, progress.percent)) : 0;
      const version =
        currentState.state === 'available' || currentState.state === 'downloading' || currentState.state === 'ready'
          ? currentState.version
          : 'unknown';
      pushState({ state: 'downloading', version, percent });
    });
    autoUpdaterInstance.on('update-downloaded', (info) => {
      pushState({ state: 'ready', version: String(info.version ?? '') || 'unknown' });
    });
    autoUpdaterInstance.on('error', (err) => {
      const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      pushState({ state: 'error', message });
    });
    return autoUpdaterInstance;
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    pushState({ state: 'error', message: `updater unavailable: ${message}`.slice(0, 280) });
    return null;
  }
}

/**
 * main.ts 在 app.whenReady 之后调一次。dev 模式（!app.isPackaged）
 * 直接跳过 —— electron-updater 在未签名 dev 包里会立刻 error 出来。
 */
export async function initAutoUpdater(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  if (!app.isPackaged) {
    // dev：保持 idle，UI 仍可见 "no updates" 状态
    pushState({ state: 'idle' });
    return;
  }
  const inst = await ensureAutoUpdater();
  if (!inst) return;
  try {
    await inst.checkForUpdates();
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    pushState({ state: 'error', message });
  }
}

export function registerUpdaterChannels(): void {
  registerChannel('updater.check', async () => {
    if (!app.isPackaged) {
      return { enabled: false, state: { state: 'idle' } };
    }
    const inst = await ensureAutoUpdater();
    if (!inst) {
      return { enabled: true, state: currentState };
    }
    try {
      await inst.checkForUpdates();
    } catch (err) {
      const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      pushState({ state: 'error', message });
    }
    return { enabled: true, state: currentState };
  });

  registerChannel('updater.install', async () => {
    if (!app.isPackaged || !autoUpdaterInstance) {
      return { accepted: false };
    }
    if (currentState.state !== 'ready') {
      return { accepted: false };
    }
    // isSilent=false, isForceRunAfter=true —— 走 NSIS / pkg 安装器 UI，重启后自动起新版
    setTimeout(() => {
      try {
        autoUpdaterInstance?.quitAndInstall(false, true);
      } catch (err) {
        const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
        pushState({ state: 'error', message });
      }
    }, 100);
    return { accepted: true };
  });
}
