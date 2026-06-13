// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。
//
// F046 占位：空态 + 即将到来的能力说明。F048 接 artifact 一等概念
// （登记 / 富预览 / 迭代版本 / 导出）。本版只立可见骨架，不假装已有产物。

import { FileOutput } from 'lucide-react';

export function ArtifactPanel(): JSX.Element {
  return (
    <aside className="w-72 flex-shrink-0 border-l border-border-default flex flex-col bg-surface">
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FileOutput className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">Artifact</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <FileOutput className="w-6 h-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
        <div className="text-[12px] text-fg-secondary font-medium">产出会显示在这里</div>
        <div className="text-[11px] text-fg-muted leading-relaxed max-w-[200px]">
          报告 / slides / 表格等产物可预览、迭代、导出。F048 接入。
        </div>
      </div>
    </aside>
  );
}
