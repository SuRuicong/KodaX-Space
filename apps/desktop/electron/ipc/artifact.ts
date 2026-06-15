// artifact.* IPC handlers — 路径 D + F057 数据层 (记忆 livecanvas_artifact_plan).
//
// sandboxInfo: where the self-hosted LC sandbox is served (P1, LC tier).
// create/list/read/delete: the LC-free artifact store (F057). create/delete push
// `artifact.changed` so the renderer refetches. The generation tool (F058) calls
// artifactStore directly (same singleton) rather than going through IPC.

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { sandboxHost } from '../artifact/sandbox-host.js';
import { artifactStore } from '../artifact/store.js';
import { extForKind, extForImageMime, parseDataUri, sanitizeFilename } from '../artifact/export-helpers.js';

// Lazy electron access (dialog/BrowserWindow) — avoids a top-level 'electron'
// import so this module stays importable under the tsx/esm test loader.
function getElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return req('electron') as typeof import('electron');
}

export function registerArtifactChannels(): void {
  registerChannel('artifact.sandboxInfo', () => sandboxHost.getInfo());

  registerChannel('artifact.create', async (input) => {
    const res = await artifactStore.upsert(input);
    pushToRenderer('artifact.changed', {
      id: res.id,
      sessionId: input.sessionId,
      reason: res.created ? 'created' : 'version',
    });
    return { id: res.id, version: res.version };
  });

  registerChannel('artifact.list', async (input) => {
    const artifacts = await artifactStore.list(input ?? undefined);
    return { artifacts };
  });

  registerChannel('artifact.read', async (input) => {
    const res = await artifactStore.read(input.id, input.version);
    if (!res) {
      throw new Error(
        input.version !== undefined
          ? `artifact ${input.id} has no version ${input.version}`
          : `artifact not found: ${input.id}`,
      );
    }
    return res;
  });

  registerChannel('artifact.delete', async (input) => {
    const deleted = await artifactStore.delete(input.id);
    if (deleted) pushToRenderer('artifact.changed', { id: input.id, reason: 'deleted' });
    return { deleted };
  });

  // Save a content-backed artifact version to a user-chosen file (native dialog).
  registerChannel('artifact.export', async (input) => {
    const res = await artifactStore.read(input.id, input.version);
    if (!res) throw new Error(`artifact not found: ${input.id}`);
    if (res.content === undefined) {
      // doc kinds (path-backed) aren't exported here — already files on disk.
      return { ok: false, error: '该类型 artifact 不支持导出（无内联内容）。' };
    }
    const kind = res.ref.kind;
    let ext: string;
    let bytes: Buffer;
    if (kind === 'image') {
      const parsed = parseDataUri(res.content);
      if (!parsed) return { ok: false, error: '图片数据无效。' };
      ext = extForImageMime(parsed.mime);
      bytes = parsed.data;
    } else {
      ext = extForKind(kind);
      bytes = Buffer.from(res.content, 'utf8');
    }
    const { dialog, BrowserWindow } = getElectron();
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const defaultPath = `${sanitizeFilename(res.ref.title) || 'artifact'}.${ext}`;
    const r = parent
      ? await dialog.showSaveDialog(parent, { defaultPath })
      : await dialog.showSaveDialog({ defaultPath });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fs.writeFile(r.filePath, bytes);
    return { ok: true, path: r.filePath };
  });
}
