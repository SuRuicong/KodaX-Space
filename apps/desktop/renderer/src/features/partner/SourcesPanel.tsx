// SourcesPanel — Partner 三栏之左栏：知识源。
//
// F046 占位：先显示当前作用域目录（复用 currentProjectPath）。F047 接非 git 作用域目录树，
// F052 接 URL / 文件知识源的"添加"。本版只立可见骨架 + 诚实占位，不假装已有能力。

import { FolderOpen, Plus } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';

export function SourcesPanel(): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const folderName = currentProjectPath
    ? (currentProjectPath.split(/[\\/]/).filter(Boolean).pop() ?? currentProjectPath)
    : null;

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border-default flex flex-col bg-surface">
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FolderOpen className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">Sources</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {folderName ? (
          <div
            className="text-xs text-fg-secondary flex items-center gap-1.5 px-1 py-0.5"
            title={currentProjectPath ?? ''}
          >
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{folderName}</span>
          </div>
        ) : (
          <div className="text-[11px] text-fg-muted px-1 py-2 leading-relaxed">
            打开一个目录作为知识源作用域。
          </div>
        )}
        <button
          type="button"
          disabled
          className="w-full text-left text-xs px-2 py-1.5 rounded text-fg-muted cursor-not-allowed flex items-center gap-1.5"
          title="添加 URL / 文件知识源 — F052 接入"
        >
          <Plus className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          <span>添加知识源</span>
          <span className="ml-auto text-[9px]">F052</span>
        </button>
      </div>
    </aside>
  );
}
