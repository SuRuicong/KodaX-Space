// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。F059 / F059b。
//
// 仅是 Partner 右栏的外壳（aside + 标题）；artifact 展示主体抽到共享 `ArtifactsView`
// （features/artifact），Coder 的 RightSidebar Artifact section + 全屏 popout 复用同一主体，
// 让 artifact 真正全局（Coder+Partner）。

import { FileOutput, PanelRightClose } from 'lucide-react';
import { ArtifactsView } from '../artifact/ArtifactsView';

interface ArtifactPanelProps {
  readonly onClose?: () => void;
}

export function ArtifactPanel({ onClose }: ArtifactPanelProps): JSX.Element {
  return (
    <aside
      className="w-64 flex-shrink-0 border-l border-border-default flex flex-col bg-surface overflow-hidden"
      data-testid="partner-artifact-panel"
    >
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FileOutput className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">Artifact</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-fg-muted hover:bg-hover-bg hover:text-fg-primary"
            title="Hide artifact panel"
            aria-label="Hide artifact panel"
            data-testid="partner-artifact-panel-close"
          >
            <PanelRightClose className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
      {/* ArtifactsView 根用 h-full：需一个有界高度的 flex 子容器（aside 满高减去 header）。 */}
      <div className="flex-1 min-h-0">
        <ArtifactsView />
      </div>
    </aside>
  );
}
