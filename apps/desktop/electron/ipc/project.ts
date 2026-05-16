// Project IPC handlers — F005.
//
// 4 个 invoke channel：list / openDialog / recent.add / recent.remove。
// projectStore 持久化在 ~/.kodax/space/projects.json，main 端独占——renderer 永远不写文件。

import { BrowserWindow, dialog } from 'electron';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { projectStore } from '../projects/store.js';

export function registerProjectChannels(): void {
  // project.list
  registerChannel('project.list', async () => {
    const projects = await projectStore.list();
    return { projects };
  });

  // project.openDialog
  // renderer 调这个 → main 调 OS 原生 picker → 返回用户选的 absolute path。
  // 用 focused window 作为 modal parent，picker 表现一致；fallback 到 frameless 模式（无 parent）。
  registerChannel('project.openDialog', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });

    if (result.canceled || result.filePaths.length === 0) {
      return { path: null };
    }
    return { path: result.filePaths[0] };
  });

  // project.recent.add
  // path 必须先过 validateProjectRoot（abs path / no NUL / no ..）——renderer 传来的
  // path 来源应当是 project.openDialog 的输出，但仍然在 IPC 边界再校验一次（防 renderer 篡改）。
  registerChannel('project.recent.add', async (input) => {
    const path = validateProjectRoot(input.path);
    const project = await projectStore.addOrBump(path);
    return { project };
  });

  // project.recent.remove
  registerChannel('project.recent.remove', async (input) => {
    const path = validateProjectRoot(input.path);
    const removed = await projectStore.remove(path);
    return { removed };
  });
}
