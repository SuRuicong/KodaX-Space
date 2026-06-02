// .mcpb IPC handlers — F021 (v0.1.3)
//
// Channels:
//   - mcpb.install (invoke) — filePath → { extension }
//   - mcpb.uninstall (invoke) — extensionId → { ok }
//   - mcpb.list (invoke) — → { extensions[] }
//   - mcpb.changed (push) — install/uninstall 后 main 主动推 latest list
//
// 失败处理：handler throw 会被 registerChannel 转 IpcResult.fail；message 含
// manifest 路径 / 校验失败原因，不含敏感字段（installer.installMcpb 内 sanitize）。

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { installMcpb } from '../mcpb/installer.js';
import {
  readRegistry,
  addOrReplace,
  removeByExtensionId,
  buildExtensionFromManifest,
  toExternal,
  getExtractBase,
} from '../mcpb/registry.js';

async function pushChanged(): Promise<void> {
  const reg = await readRegistry();
  pushToRenderer('mcpb.changed', {
    extensions: reg.extensions.map(toExternal),
  });
}

export function registerMcpbChannels(): void {
  registerChannel('mcpb.install', async (input) => {
    let filePath = input.filePath;
    if (!filePath) {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const dlg = parent
        ? await dialog.showOpenDialog(parent, {
            title: 'Install MCP bundle',
            filters: [{ name: 'MCP bundle (.mcpb / .dxt)', extensions: ['mcpb', 'dxt'] }],
            properties: ['openFile'],
          })
        : await dialog.showOpenDialog({
            title: 'Install MCP bundle',
            filters: [{ name: 'MCP bundle (.mcpb / .dxt)', extensions: ['mcpb', 'dxt'] }],
            properties: ['openFile'],
          });
      if (dlg.canceled || dlg.filePaths.length === 0) {
        return { cancelled: true } as const;
      }
      filePath = dlg.filePaths[0];
    }
    const baseDir = getExtractBase();
    const installed = await installMcpb(filePath, baseDir);
    const entry = buildExtensionFromManifest(installed.manifest, installed.installDir);
    await addOrReplace(entry);
    void pushChanged();
    return { extension: toExternal(entry) };
  });

  registerChannel('mcpb.uninstall', async (input) => {
    const res = await removeByExtensionId(input.extensionId);
    if (!res.removed) return { ok: false };
    // 删 install 目录 —— 失败不阻塞 IPC（registry 已经更新），下次清理工具回收
    if (res.installDir && path.isAbsolute(res.installDir) && res.installDir.includes('.kodax-space')) {
      await fsp.rm(res.installDir, { recursive: true, force: true }).catch((err) => {
        console.warn(
          '[mcpb] failed to remove install dir:',
          err instanceof Error ? err.message : err,
        );
      });
    }
    void pushChanged();
    return { ok: true };
  });

  registerChannel('mcpb.list', async () => {
    const reg = await readRegistry();
    return { extensions: reg.extensions.map(toExternal) };
  });
}
