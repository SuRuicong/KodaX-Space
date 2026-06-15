// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。F059 / F059b。
//
// 仅是 Partner 右栏的外壳（aside + 标题）；artifact 展示主体抽到共享 `ArtifactsView`
// （features/artifact），Coder 的 RightSidebar Artifact section + 全屏 popout 复用同一主体，
// 让 artifact 真正全局（Coder+Partner）。

import { FileOutput } from 'lucide-react';
import { ArtifactsView } from '../artifact/ArtifactsView';

export function ArtifactPanel(): JSX.Element {
  return (
    <aside className="w-72 flex-shrink-0 border-l border-border-default flex flex-col bg-surface">
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FileOutput className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">Artifact</span>
      </div>
      <ArtifactsView />
    </aside>
  );
}
