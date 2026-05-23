// Settings IPC handlers — alpha.1
//
// renderer 通过这两 channel 读写 ~/.kodax/space/settings.json。
// 写后立即 ensure 目录存在，让 setDefaultWorkspace 返回后 renderer 直接拿来当
// currentProjectPath 用，不会撞 ENOENT。

import { registerChannel } from './register.js';
import { settingsStore } from '../settings/store.js';
import { validateProjectRoot } from './validate.js';

export function registerSettingsChannels(): void {
  registerChannel('settings.get', async () => {
    const s = await settingsStore.load();
    return { defaultWorkspace: s.defaultWorkspace };
  });

  registerChannel('settings.setDefaultWorkspace', async ({ path }) => {
    // 与 project.recent.add 同样走 validateProjectRoot 防 path traversal
    const safePath = validateProjectRoot(path);
    const next = await settingsStore.setDefaultWorkspace(safePath);
    await settingsStore.ensureWorkspaceExists();
    return { defaultWorkspace: next.defaultWorkspace };
  });
}
