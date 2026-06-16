// PopoutOverlay — F011-revised
//
// 右上 toolbar 5 个 popout 的容器。当 active popout 切换时渲染对应面板。
//
// 形态：右侧 panel slide-in，覆盖主区右侧；半透明遮罩可关闭。
// 不全屏覆盖——保留主对话流可见，让用户能在 popout 操作时仍看到对话上下文。
//
// **v0.1.10 fix**: 按 kind 决定宽度。Viewer 类 (preview / terminal) 走宽容器
// (880px) 让 Preview render / Terminal 80 列都够看;
// List 类 (tasks / plan / agents / mcp) 保持 480px 紧凑列表风。
//
// **v0.1.11**: diff 升级为"完整覆盖层"——铺满整个对话区 (left-0)，side-by-side diff
// 不再挤在一半屏。用户反馈 880px 看代码 diff 还是太窄 (2026-06-08)。其它 popout 维持
// 右侧 slide-in 窄 panel。FULL_COVER_KINDS 控制谁走全宽。
// **F059c**: artifact 加入 full-cover —— HTML/图表/报告在 760px 窄条里被截、读不全
// (用户反馈 2026-06-15)。⤢ 后铺满整个中间对话区 (像 diff)；再"单独打开"走 L3 独立窗口。
const FULL_COVER_KINDS = new Set<string>(['diff', 'artifact']);
const POPOUT_WIDTH: Record<string, string> = {
  preview: 'w-[880px]',
  terminal: 'w-[800px]',
};
const DEFAULT_POPOUT_WIDTH = 'w-[480px]';

import { Suspense, lazy } from 'react';
import type { PopoutKind } from '../CommandToolbar.js';
import { PreviewPanel } from './PreviewPanel.js';
import { DiffPanel } from './DiffPanel.js';
// F011 v0.1.6 + F023 v0.1.7: Terminal popout 改成真 PTY (xterm.js + node-pty)；
// F023 引入多 tab 通过 TerminalManager 包装层（每个 tab 自己的 PTY）。
// Lazy 加载：xterm + 2 个 addon + CSS 只在用户首次开 Terminal popout 时拉，
// 避免 startup bundle 体积膨胀 + 把任何 xterm 模块加载错误隔离到 popout 内（不白屏整 app）。
const TerminalPanel = lazy(() =>
  import('../../features/terminal/TerminalManager.js').then((m) => ({
    default: m.TerminalManager,
  })),
);
import { TasksPanel } from './TasksPanel.js';
import { PlanPanel } from './PlanPanel.js';
import { AgentsMdPanel } from './AgentsMdPanel.js';
import { McpPanel } from './McpPanel.js';
import { ArtifactsView } from '../../features/artifact/ArtifactsView.js';

interface PopoutOverlayProps {
  kind: PopoutKind;
  onClose: () => void;
}

export function PopoutOverlay({ kind, onClose }: PopoutOverlayProps): JSX.Element {
  const fullCover = FULL_COVER_KINDS.has(kind);
  // full-cover：left-0 铺满整个对话区；窄 panel：固定宽度从右侧贴边 slide-in。
  const widthCls = fullCover
    ? 'left-0'
    : `${POPOUT_WIDTH[kind] ?? DEFAULT_POPOUT_WIDTH} max-w-[95vw]`;
  return (
    <>
      <div className="absolute inset-0 bg-black/30 z-30" onClick={onClose} aria-hidden />
      <aside
        className={`glass ix-zone absolute right-0 top-10 bottom-0 ${widthCls} border-l border-border-default z-40 flex flex-col`}
      >
        <div className="px-3 py-2 border-b border-border-default flex items-center text-xs text-fg-muted flex-shrink-0">
          <span className="capitalize">{kind}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-2 py-0.5 hover:text-fg-primary"
            aria-label="Close popout"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {kind === 'preview' && <PreviewPanel />}
          {kind === 'diff' && <DiffPanel />}
          {kind === 'terminal' && (
            <Suspense fallback={<div className="p-3 text-xs text-fg-muted">Loading terminal…</div>}>
              <TerminalPanel />
            </Suspense>
          )}
          {kind === 'tasks' && <TasksPanel />}
          {kind === 'plan' && <PlanPanel />}
          {kind === 'agents' && <AgentsMdPanel />}
          {kind === 'mcp' && <McpPanel />}
          {kind === 'artifact' && <ArtifactsView />}
        </div>
      </aside>
    </>
  );
}
