// PopoutOverlay — F011-revised
//
// 右上 toolbar 5 个 popout 的容器。当 active popout 切换时渲染对应面板。
//
// 形态：右侧 panel slide-in（440px 宽），覆盖主区右侧；半透明遮罩可关闭。
// 不全屏覆盖——保留主对话流可见，让用户能在 popout 操作时仍看到对话上下文。

import type { PopoutKind } from '../CommandToolbar.js';
import { PreviewPanel } from './PreviewPanel.js';
import { DiffPanel } from './DiffPanel.js';
import { TerminalPanel } from './TerminalPanel.js';
import { TasksPanel } from './TasksPanel.js';
import { PlanPanel } from './PlanPanel.js';
import { AgentsMdPanel } from './AgentsMdPanel.js';

interface PopoutOverlayProps {
  kind: PopoutKind;
  onClose: () => void;
}

export function PopoutOverlay({ kind, onClose }: PopoutOverlayProps): JSX.Element {
  return (
    <>
      <div
        className="absolute inset-0 bg-black/30 z-30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-0 top-10 bottom-0 w-[480px] bg-zinc-950 border-l border-zinc-900 z-40 flex flex-col">
        <div className="px-3 py-2 border-b border-zinc-900 flex items-center text-xs text-zinc-400 flex-shrink-0">
          <span className="capitalize">{kind}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-2 py-0.5 hover:text-zinc-200"
            aria-label="Close popout"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {kind === 'preview' && <PreviewPanel />}
          {kind === 'diff' && <DiffPanel />}
          {kind === 'terminal' && <TerminalPanel />}
          {kind === 'tasks' && <TasksPanel />}
          {kind === 'plan' && <PlanPanel />}
          {kind === 'agents' && <AgentsMdPanel />}
        </div>
      </aside>
    </>
  );
}
