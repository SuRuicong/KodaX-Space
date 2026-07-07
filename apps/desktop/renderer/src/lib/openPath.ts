// openPath — "点一个文件路径/URL 应该发生什么" 的智能路由（2026-06-18 用户反馈）。
//
// 之前 renderer 里到处展示文件路径却全是死文本（聊天 tool 卡、右侧 Context 栏、diff 头）。
// 这里给出一条统一入口 openFileSmart(path)，按扩展名智能路由：
//   - html/svg/md → 在 Artifact 面板里沙盒 iframe 预览（artifact.previewFile）
//   - 代码/文本    → App 内 DiffPanel popout（复用 setLastDiffPath + requestPopout('diff')）
//   - 其它（图片/pdf/二进制/未知）→ 在系统文件管理器里定位（shell.revealPath）
//
// 所有"触达系统 shell"的动作都走 main 端白名单 channel（reveal 不执行目标、openExternal 仅 http/s），
// 见 packages/space-ipc-schema/src/channels/shell.ts 的安全说明。

import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { pushToast } from '../store/toastStore.js';
import { translateMessage } from '../i18n/I18nProvider.js';
import { isPreviewablePath, isCodePath, toProjectRelative } from './pathClassify.js';

// 纯分类/归一化逻辑在 pathClassify.ts（可被 node:test 单测）；这里转出常用的几个，
// 让 caller 仍从 openPath import（单一入口）。
export { extOf, isPreviewablePath, looksLikeFilePath, toProjectRelative } from './pathClassify.js';

interface OpenCtx {
  readonly sessionId?: string | null;
  readonly projectRoot?: string | null;
  readonly surface?: 'code' | 'partner';
}

/** previewFileAsArtifact 的具体上下文 —— session/project 必须非空（调用方先判好）。 */
interface PreviewCtx {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly surface: 'code' | 'partner';
}

export function isAbsolutePathOutsideProject(rawPath: string, projectRoot: string): boolean {
  const p = rawPath.replace(/\\/g, '/');
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const isAbsolute = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (!isAbsolute) return false;
  const a = p.toLowerCase();
  const b = root.toLowerCase();
  return a !== b && !a.startsWith(`${b}/`);
}

/** 系统浏览器打开 http(s) URL。 */
export async function openExternalUrl(url: string): Promise<void> {
  const bridge = window.kodaxSpace;
  if (!bridge) return;
  try {
    const r = await bridge.invoke('shell.openExternal', { url });
    if (!r.ok || !r.data.opened) pushToast(translateMessage('openPath.linkOpenFailed'), 'error');
  } catch {
    pushToast(translateMessage('openPath.linkOpenFailed'), 'error');
  }
}

/** 在系统文件管理器里定位高亮文件。rawPath 绝对则直接定位；相对则配 projectRoot 解析。 */
export async function revealPath(rawPath: string, projectRoot?: string | null): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge) return false;
  try {
    const r = await bridge.invoke(
      'shell.revealPath',
      projectRoot ? { path: rawPath, projectRoot } : { path: rawPath },
    );
    if (r.ok && r.data.revealed) return true;
    pushToast(translateMessage('openPath.fileNotFound'), 'warning');
    return false;
  } catch {
    pushToast(translateMessage('openPath.revealFailed'), 'error');
    return false;
  }
}

/** 把已写盘的可预览文件灌进 Artifact 面板并聚焦。成功返 true。 */
export async function previewFileAsArtifact(rawPath: string, ctx: PreviewCtx): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge) return false;
  const rel = toProjectRelative(rawPath, ctx.projectRoot);
  try {
    const r = await bridge.invoke('artifact.previewFile', {
      sessionId: ctx.sessionId,
      surface: ctx.surface,
      projectRoot: ctx.projectRoot,
      path: rel,
    });
    if (!r.ok) return false;
    // 确保右侧栏开着，然后切到 Artifact tab + 选中该 id（RightSidebar / ArtifactsView 监听此事件）。
    useAppStore.getState().setRightSidebarOpen(true);
    window.dispatchEvent(
      new CustomEvent('kodax-space.focus-artifact', { detail: { id: r.data.id } }),
    );
    return true;
  } catch {
    return false;
  }
}

/** 在 App 内 DiffPanel popout 打开文件（复用 tool-call/git diff 链路）。 */
export async function openInDiff(rawPath: string, projectRoot: string | null): Promise<boolean> {
  const bridge = window.kodaxSpace;
  if (!bridge || !projectRoot) {
    pushToast(translateMessage('openPath.diffNoProject'), 'warning');
    return false;
  }
  if (isAbsolutePathOutsideProject(rawPath, projectRoot)) {
    pushToast(translateMessage('openPath.diffOutsideProject'), 'warning');
    return false;
  }
  const rel = toProjectRelative(rawPath, projectRoot);
  try {
    const check = await bridge.invoke('files.diff', { projectRoot, path: rel });
    if (!check.ok) {
      pushToast(
        translateMessage('openPath.diffFailedWithMessage', {
          message: check.error?.message ?? translateMessage('openPath.invalidPath'),
        }),
        'error',
      );
      return false;
    }
  } catch (err) {
    pushToast(
      translateMessage('openPath.diffFailedWithMessage', {
        message:
          err instanceof Error && err.message.trim()
            ? err.message
            : translateMessage('common.unknownError'),
      }),
      'error',
    );
    return false;
  }
  useAppStore.getState().setLastDiffPath(rel || rawPath);
  useAppStore.getState().requestPopout('diff');
  return true;
}

/**
 * 智能路由：点一个文件路径应该发生什么。ctx 缺省时从 store 读当前 session/project/surface。
 *   预览型 → Artifact 预览；代码型 → App 内 diff；其它 → 文件管理器定位。
 * 上游分支失败（无 session、文件不存在等）一律优雅回退到 reveal。
 */
export async function openFileSmart(rawPath: string, ctx?: OpenCtx): Promise<void> {
  const path = rawPath.trim();
  // 边界守门：空 / 超长直接丢（IPC schema 上限 4096；DiffView/RightSidebar 等 caller 不经
  // looksLikeFilePath 的长度过滤，这里兜一道，避免把异常长的 LLM 串送进 IPC）。
  if (path.length === 0 || path.length > 4096) return;

  const app = useAppStore.getState();
  const sessionId = ctx?.sessionId ?? app.currentSessionId;
  const projectRoot = ctx?.projectRoot ?? app.currentProjectPath;
  const surface = ctx?.surface ?? useSurfaceStore.getState().currentSurface;

  if (isPreviewablePath(path) && sessionId && projectRoot) {
    const ok = await previewFileAsArtifact(path, { sessionId, projectRoot, surface });
    if (ok) return;
    // 预览失败（二进制/过大/不存在）→ 回退到定位。
  } else if (isCodePath(path) && projectRoot) {
    const ok = await openInDiff(path, projectRoot);
    if (ok) return;
  }

  await revealPath(path, projectRoot);
}
