// .mcpb IPC handlers — F021 (v0.1.3) + v0.1.3.1 patches
//
// v0.1.3.1 修复：
//   - F021-SEC-H2: 卸载守护改用 isInsideExtractBase（path.resolve + startsWith(base+sep)），
//                  不再 substring includes('.kodax-space')（可被 ~/.kodax-space-evil 绕过）
//   - F021-FUNC-M3: 升级时拿 addOrReplace 返回的 displacedInstallDir，把旧 install 目录 rm
//                  （之前升级遗留旧 ver 目录在磁盘上）
//   - installMcpb 新签名带 tmpDir —— TOCTOU 防御副本目录

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, Notification } from 'electron';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import os from 'node:os';
import { installMcpb, readManifestOnly } from '../mcpb/installer.js';
import {
  readRegistry,
  addOrReplace,
  removeByExtensionId,
  buildExtensionFromManifest,
  toExternal,
  getExtractBase,
  getTmpBase,
  isInsideExtractBase,
  type InternalMcpbEntry,
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

/**
 * 共享 install pipeline —— 给 IPC handler 与 OS file-association / drag-drop entry point 复用。
 * 流程：installMcpb → addOrReplace（拿 displaced 旧 install dir）→ rm 旧 dir → pushChanged.
 */
async function installFromPath(filePath: string): Promise<InternalMcpbEntry> {
  const installed = await installMcpb(filePath, getExtractBase(), getTmpBase());
  const entry = buildExtensionFromManifest(installed.manifest, installed.installDir);
  const { displacedInstallDir } = await addOrReplace(entry);
  if (displacedInstallDir) {
    await safeRmInstallDir(displacedInstallDir, 'displaced (upgrade)');
  }
  void pushChanged();
  return entry;
}

/**
 * F021 v0.1.5：OS 文件关联 / drag-drop 触发的安装入口。
 *
 * 触发场景：
 *   - macOS：app.on('open-file', filePath)
 *   - Windows / Linux：second-instance 拿 argv[1+] 或冷启动 process.argv 解析
 *   - renderer drag-drop 走 mcpb.install IPC 通道（已支持 filePath 入参），不经此路径
 *
 * 跟"Install ext"按钮的区别：
 *   - 用户没在 UI 上 click 任何按钮，需 OS 通知确认安装成功 / 失败
 *   - 失败 reason 通过通知向用户展示，main 端不抛
 *   - silent flag 默认 false（OS 通知响铃），跟 KX-I-07 长任务通知同档
 *
 * 路径校验：
 *   - 必须是 .mcpb 或 .dxt 后缀（防意外打开别的文件类型）
 *   - 必须 abs path —— installMcpb 内 path.resolve + tmp copy 防 TOCTOU 已经处理
 */
/**
 * security review MED-2：通知 body 里 err.message 可能含 archive 内 entry 名（攻击者
 * 可控）或绝对文件系统路径。sanitize 思路跟 updater.ts 同款：strip 绝对路径，strip
 * 控制字符（防伪造换行误导用户），最后 cap 280。
 */
function sanitizeNotificationBody(raw: string): string {
  const home = os.homedir();
  let cleaned = raw;
  if (home.length > 0) cleaned = cleaned.split(home).join('~');
  cleaned = cleaned
    .replace(/([A-Za-z]:[\\/][^\s"]+|\\\\[^\s"]+|\/[A-Za-z][^\s"]+)/g, '<path>')
    .replace(/[\x00-\x1f\x7f]/g, ' '); // eslint-disable-line no-control-regex
  return cleaned.slice(0, 280).trim() || 'Install failed';
}

export async function installMcpbFromOsHandoff(rawPath: string): Promise<void> {
  const filePath = rawPath.trim();
  if (filePath.length === 0) return;
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mcpb' && ext !== '.dxt') {
    // 不是 mcpb 类，OS 路由错了；不通知（用户不该看到莫名其妙的弹窗）
    console.warn(`[mcpb] OS handoff: ignoring non-mcpb file ${filePath}`);
    return;
  }
  try {
    // security review LOW-3：OS 触发的安装不能 silent —— drive-by download +
    // 双击的攻击向量真实存在（VS Code / JetBrains 都加 confirmation prompt）。
    // 先 readManifestOnly 拿 display name / author / version 让用户看到要装的是啥，
    // 再 dialog.showMessageBox 二次确认。Cancel 即静默 return（不通知，无声跳过）。
    let manifestDisplayName: string;
    let manifestVersion: string;
    let manifestAuthor: string | undefined;
    try {
      const m = await readManifestOnly(filePath);
      manifestDisplayName = m.display_name ?? m.name;
      manifestVersion = m.version;
      manifestAuthor = m.author?.name;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mcpb] manifest read failed for ${filePath}: ${msg}`);
      if (Notification.isSupported()) {
        new Notification({
          title: 'MCP bundle install failed',
          body: sanitizeNotificationBody(`Invalid bundle: ${msg}`),
          silent: false,
        }).show();
      }
      return;
    }

    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const detail =
      `From: ${path.basename(filePath)}\n` +
      `Version: ${manifestVersion}` +
      (manifestAuthor ? `\nAuthor: ${manifestAuthor}` : '');
    const choiceRes = parent
      ? await dialog.showMessageBox(parent, {
          type: 'question',
          message: `Install MCP bundle "${manifestDisplayName}"?`,
          detail,
          buttons: ['Install', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
      : await dialog.showMessageBox({
          type: 'question',
          message: `Install MCP bundle "${manifestDisplayName}"?`,
          detail,
          buttons: ['Install', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        });
    if (choiceRes.response !== 0) return; // 用户取消，静默返回

    const entry = await installFromPath(filePath);
    if (Notification.isSupported()) {
      new Notification({
        title: 'MCP bundle installed',
        body: `${entry.displayName} v${entry.version} is now available.`,
        silent: false,
      }).show();
    }
    // window 拉前台 —— 让用户立即看到 McpPanel 里新出现的 extension
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mcpb] OS handoff install failed for ${filePath}: ${msg}`);
    if (Notification.isSupported()) {
      new Notification({
        title: 'MCP bundle install failed',
        body: sanitizeNotificationBody(msg),
        silent: false,
      }).show();
    }
  }
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
    const entry = await installFromPath(filePath);
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
