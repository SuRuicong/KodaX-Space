// artifact.* IPC handlers — F057 数据层 (记忆 livecanvas_artifact_plan).
//
// create/list/read/delete: the LC-free artifact store (F057). create/delete push
// `artifact.changed` so the renderer refetches. The generation tool (F058) calls
// artifactStore directly (same singleton) rather than going through IPC.
// (LC sandbox `artifact.sandboxInfo` channel removed — re-added with the LiveCanvas
// interactive tier as a separate feature.)

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import type { ArtifactKindT } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { artifactStore } from '../artifact/store.js';
import {
  extForKind,
  extForImageMime,
  parseDataUri,
  sanitizeFilename,
} from '../artifact/export-helpers.js';
import { resolveInsideProject, readFileWithGuards } from './files-core.js';
import { projectStore } from '../projects/store.js';
import { kodaxHost } from '../kodax/host.js';

/**
 * 文件扩展名 → 可预览的 artifact kind。
 *   - html/htm → html（sandbox iframe 渲染）
 *   - svg      → svg
 *   - md/markdown → markdown
 *   - 其它一律 'code'（按文本代码渲染，带语法高亮）
 * 返回的 kind 永远是"内容型"（content-backed），不会是 doc/image/react。
 */
export function previewKindForPath(p: string): ArtifactKindT {
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'svg':
      return 'svg';
    case 'md':
    case 'markdown':
      return 'markdown';
    default:
      return 'code';
  }
}

// Lazy electron access (dialog/BrowserWindow) — avoids a top-level 'electron'
// import so this module stays importable under the tsx/esm test loader.
function getElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return req('electron') as typeof import('electron');
}

export function registerArtifactChannels(): void {
  registerChannel('artifact.create', async (input) => {
    if (input.path !== undefined) {
      let session = kodaxHost.get(input.sessionId);
      if (!session && (await kodaxHost.tryResume(input.sessionId))) {
        session = kodaxHost.get(input.sessionId);
      }
      if (!session) throw new Error('session not found for artifact path validation');
      const projectRoot = await projectStore.assertAllowed(session.projectRoot);
      await resolveInsideProject(projectRoot, input.path);
    }
    const res = await artifactStore.upsert(input);
    pushToRenderer('artifact.changed', {
      id: res.id,
      sessionId: input.sessionId,
      reason: res.created ? 'created' : 'version',
    });
    return { id: res.id, version: res.version };
  });

  // 一键预览：把一个已写盘的可预览文件提级为 Artifact（content 来自磁盘）。
  registerChannel('artifact.previewFile', async (input) => {
    await projectStore.assertAllowed(input.projectRoot);
    const absPath = await resolveInsideProject(input.projectRoot, input.path);
    let read;
    try {
      read = await readFileWithGuards(absPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        throw new Error('file not found or is a directory');
      }
      throw err;
    }
    if (read.isBinary) throw new Error('binary file cannot be previewed');
    if (read.truncated) throw new Error('file too large to preview');

    const kind = previewKindForPath(input.path);
    // 标题=相对路径（信息量足、用于 (session,title) 去重）；过长退回 basename。
    const slash = Math.max(input.path.lastIndexOf('/'), input.path.lastIndexOf('\\'));
    const base = slash >= 0 ? input.path.slice(slash + 1) : input.path;
    const title = input.path.length <= 256 ? input.path : base.slice(0, 256);

    // 去重：同一 session 已有同 title+kind 的预览 artifact → 复用其 id 升版本，
    // 避免反复点"预览"刷出一堆副本（store.upsert 对未知 id 会生成新 UUID，故必须先查到真 id）。
    const existing = (await artifactStore.list({ sessionId: input.sessionId })).find(
      (a) => a.kind === kind && a.title === title,
    );

    const res = await artifactStore.upsert({
      sessionId: input.sessionId,
      surface: input.surface,
      kind,
      title,
      content: read.content,
      ...(existing ? { id: existing.id } : {}),
    });
    pushToRenderer('artifact.changed', {
      id: res.id,
      sessionId: input.sessionId,
      reason: res.created ? 'created' : 'version',
    });
    return { id: res.id, version: res.version, kind };
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
