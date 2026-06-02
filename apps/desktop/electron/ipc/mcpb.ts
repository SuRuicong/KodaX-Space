// .mcpb IPC handlers — F021 (v0.1.3) + v0.1.3.1 patches
//
// v0.1.3.1 修复：
//   - F021-SEC-H2: 卸载守护改用 isInsideExtractBase（path.resolve + startsWith(base+sep)），
//                  不再 substring includes('.kodax-space')（可被 ~/.kodax-space-evil 绕过）
//   - F021-FUNC-M3: 升级时拿 addOrReplace 返回的 displacedInstallDir，把旧 install 目录 rm
//                  （之前升级遗留旧 ver 目录在磁盘上）
//   - installMcpb 新签名带 tmpDir —— TOCTOU 防御副本目录

import { promises as fsp } from 'node:fs';
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
  getTmpBase,
  isInsideExtractBase,
} from '../mcpb/registry.js';

async function pushChanged(): Promise<void> {
  const reg = await readRegistry();
  pushToRenderer('mcpb.changed', {
    extensions: reg.extensions.map(toExternal),
  });
}

/** rm 一个 install 目录 —— 必须先过 isInsideExtractBase 才执行，防 registry 被篡改时越界删 */
async function safeRmInstallDir(installDir: string, label: string): Promise<void> {
  if (!isInsideExtractBase(installDir)) {
    console.warn(`[mcpb] refusing to rm ${label} dir outside extract base: ${installDir}`);
    return;
  }
  await fsp.rm(installDir, { recursive: true, force: true }).catch((err) => {
    console.warn(`[mcpb] failed to rm ${label} dir:`, err instanceof Error ? err.message : err);
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
    const installed = await installMcpb(filePath, getExtractBase(), getTmpBase());
    const entry = buildExtensionFromManifest(installed.manifest, installed.installDir);
    const { displacedInstallDir } = await addOrReplace(entry);
    if (displacedInstallDir) {
      await safeRmInstallDir(displacedInstallDir, 'displaced (upgrade)');
    }
    void pushChanged();
    return { extension: toExternal(entry) };
  });

  registerChannel('mcpb.uninstall', async (input) => {
    const res = await removeByExtensionId(input.extensionId);
    if (!res.removed) return { ok: false };
    if (res.installDir) {
      await safeRmInstallDir(res.installDir, 'uninstall');
    }
    void pushChanged();
    return { ok: true };
  });

  registerChannel('mcpb.list', async () => {
    const reg = await readRegistry();
    return { extensions: reg.extensions.map(toExternal) };
  });
}
