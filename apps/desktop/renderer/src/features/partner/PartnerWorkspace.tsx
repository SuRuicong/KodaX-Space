// PartnerWorkspace — F045 路由目标 / F046 三栏实体。
//
// doc-workspace 三栏（ADR-007 / HLD §9.4）：
//   Sources（左）| 对话 + 输入（中）| Artifact 预览（右）
// 去掉 Coder 的 Subagent tree / 内置 Terminal 抽屉（知识工作不需要）。
//
// F046 范围：三栏 shell + 中栏功能可用（真能对话，绑 Partner session）。
//   - 左栏 Sources：占位（F047 接非 git 作用域目录树 / F052 接 URL 源）
//   - 中栏 PartnerConversation：复用 ConversationStreamV2 + 裁剪版 BottomBar
//   - 右栏 Artifact：占位（F048 接 artifact 登记/预览/迭代/导出）
//
// LeftSidebar（项目 / session / SurfaceTabs）是两 surface 共用的全局导航，在本组件之外
// 由 Shell 渲染。per-surface 当前 session 由 store/surface.ts 的 setSurface 维护。

import { Handshake } from 'lucide-react';
import { SourcesPanel } from './SourcesPanel.js';
import { PartnerConversation } from './PartnerConversation.js';
import { ArtifactPanel } from './ArtifactPanel.js';

export function PartnerWorkspace(): JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 h-10 border-b border-border-default flex-shrink-0">
        <Handshake className="w-4 h-4 text-accent-ink" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] text-fg-primary font-medium">Partner</span>
        <span className="text-[11px] text-fg-muted">doc-workspace · 知识工作</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <SourcesPanel />
        <PartnerConversation />
        <ArtifactPanel />
      </div>
    </div>
  );
}
